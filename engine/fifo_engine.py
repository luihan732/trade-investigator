"""
FIFO Matching Engine
====================

Converts raw exchange fill data into properly matched trades using
first-in-first-out queue consumption with proportional fee allocation.

Validates results using two-level fee accounting:
  Level 1 (bottom-up): per-trade P&L summed across all matched trades
  Level 2 (top-down):  authoritative totals from raw data before matching

The scale factor between L1 and L2 is the reconciliation check.
"""

import pandas as pd
import numpy as np


# ── Fee Parsing ──────────────────────────────────────────────────────────────

def parse_fee(fee_value, trade_time=None, df_ref=None):
    """
    Convert a fee value to a float in the quote currency.

    Handles three formats found in exchange exports:
      '5.52 USDT'   → 5.52
      '0.00527 BNB' → converts using nearest BNB price from df_ref
      5.52           → returned as-is (already numeric)

    Parameters
    ----------
    fee_value  : str or float — raw fee from CSV
    trade_time : Timestamp    — used to find nearest BNB price (optional)
    df_ref     : DataFrame    — full dataset with BNB rows for conversion (optional)

    Returns
    -------
    float — fee in quote currency
    """
    if isinstance(fee_value, (int, float)):
        return float(fee_value)

    fee_str = str(fee_value)

    if 'USDT' in fee_str:
        return float(fee_str.replace(' USDT', '').replace(' BUSD', ''))

    if 'BNB' in fee_str:
        bnb_amount = float(fee_str.replace(' BNB', ''))
        if df_ref is not None and trade_time is not None:
            bnb_trades = df_ref[df_ref['Symbol'] == 'BNBUSDT']
            if len(bnb_trades) > 0:
                time_diffs = (bnb_trades['Time(UTC)'] - trade_time).abs()
                nearest_price = bnb_trades.loc[time_diffs.idxmin(), 'Price']
                return bnb_amount * nearest_price
        return bnb_amount * 600  # fallback estimate

    try:
        return float(fee_str)
    except ValueError:
        return 0.0


# ── Data Loading ─────────────────────────────────────────────────────────────

def load_data(path, date_format='%Y-%m-%d %H:%M:%S', fee_sign='negative'):
    """
    Load and clean one CSV of exchange fill data.

    Parameters
    ----------
    path        : str — path to CSV file
    date_format : str — strptime format for the timestamp column
    fee_sign    : str — 'negative' if fees are stored as -5.52,
                        'positive' if stored as 5.52

    Returns
    -------
    DataFrame with columns: Time(UTC), Symbol, Side, Price, Quantity,
                            Fee, Realized Profit, Amount, Maker
    """
    df = pd.read_csv(path)
    df['Time(UTC)'] = pd.to_datetime(df['Time(UTC)'], format=date_format)

    # Parse fee column — may be string ('5.52 USDT') or numeric
    if df['Fee'].dtype == object:
        df['Fee_USDT'] = df.apply(
            lambda row: parse_fee(row['Fee'], row['Time(UTC)'], df), axis=1
        )
    else:
        df['Fee_USDT'] = df['Fee'].astype(float)

    # Ensure numeric columns
    for col in ['Price', 'Quantity', 'Amount', 'Realized Profit']:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors='coerce')

    df = df.sort_values('Time(UTC)').reset_index(drop=True)
    return df


# ── FIFO Matching Pipeline ───────────────────────────────────────────────────

def process_year(df_raw, year_label='', carryover=None, verbose=True):
    """
    Full FIFO trade matching pipeline.

    Maintains a per-symbol queue of open entries. When a closing fill arrives,
    it consumes from the front of the queue (FIFO). Partial closes leave the
    remaining quantity in the queue with a proportional share of the entry fee.

    Uses two-level fee accounting:
      Level 1: realized_pnl - entry_fee - exit_fee per matched trade
      Level 2: sum(Realized Profit) - sum(|Fee|) from raw data (authoritative)

    Parameters
    ----------
    df_raw      : DataFrame — cleaned data from load_data()
    year_label  : str       — label for display (e.g., '2022')
    carryover   : dict      — open positions from previous period {symbol: {queue: [...]}}
    verbose     : bool      — print diagnostics

    Returns
    -------
    matched_df  : DataFrame — one row per matched trade
    level2      : dict      — authoritative totals {realized, fees, net}
    positions   : dict      — open positions at end (pass as carryover to next period)
    """
    # ── Level 2: authoritative totals (computed before matching) ──────────
    total_realized = df_raw['Realized Profit'].sum()
    total_fees = df_raw['Fee_USDT'].abs().sum()
    total_net = total_realized - total_fees

    level2 = {
        'year': year_label,
        'realized': total_realized,
        'fees': total_fees,
        'net': total_net,
    }

    if verbose:
        print(f'\n── {year_label} Level 2 (authoritative) ──────────────────')
        print(f'  Realized: ${total_realized:>10,.2f}')
        print(f'  Fees:     ${total_fees:>10,.2f}')
        print(f'  Net P&L:  ${total_net:>10,.2f}')

    # ── FIFO matching ────────────────────────────────────────────────────
    matched = []
    skipped = 0
    positions = {}

    # Seed from previous period's open positions
    if carryover:
        for sym, data in carryover.items():
            if data['queue']:
                positions[sym] = {
                    'queue': [{
                        'time': e['time'],
                        'price': e['price'],
                        'qty': e['remaining_qty'],
                        'remaining_qty': e['remaining_qty'],
                        'fee': e.get('fee', 0),
                        'original_qty': e['remaining_qty'],
                        'side': e['side'],
                        'maker': e.get('maker', False),
                    } for e in data['queue'] if e['remaining_qty'] > 0.0001]
                }

    for _, row in df_raw.iterrows():
        sym = row['Symbol']
        is_buy = row['Side'] == 'BUY'
        qty = row['Quantity']
        price = row['Price']
        realized = row['Realized Profit']
        fee = row['Fee_USDT']
        time = row['Time(UTC)']
        maker = row.get('Maker', False)

        if sym not in positions:
            positions[sym] = {'queue': []}

        pos = positions[sym]

        # ── Opening fill (realized profit == 0) ─────────────────────────
        if realized == 0:
            pos['queue'].append({
                'time': time,
                'price': price,
                'qty': qty,
                'remaining_qty': qty,
                'fee': abs(fee),
                'original_qty': qty,
                'side': 'BUY' if is_buy else 'SELL',
                'maker': maker,
            })
            continue

        # ── Closing fill — consume from queue (FIFO) ────────────────────
        remaining = qty
        exit_fee = abs(fee)

        while remaining > 0.0001 and pos['queue']:
            entry = pos['queue'][0]

            # How much of this entry can we consume?
            consume = min(remaining, entry['remaining_qty'])

            if consume < 0.0001:
                pos['queue'].pop(0)
                continue

            # Pro-rate the entry fee
            fee_fraction = consume / entry['original_qty']
            entry_fee_allocated = entry['fee'] * fee_fraction

            # Pro-rate the exit fee
            exit_fee_fraction = consume / qty
            exit_fee_allocated = exit_fee * exit_fee_fraction

            # Pro-rate the realized P&L
            pnl_fraction = consume / qty
            realized_allocated = realized * pnl_fraction

            # Net P&L for this matched trade
            net_pnl = realized_allocated - entry_fee_allocated - exit_fee_allocated

            # Holding time
            hold_hours = (time - entry['time']).total_seconds() / 3600

            matched.append({
                'symbol': sym,
                'side': entry['side'],
                'entry_time': entry['time'],
                'exit_time': time,
                'entry_price': entry['price'],
                'exit_price': price,
                'quantity': consume,
                'position_size': consume * entry['price'],
                'realized_pnl': realized_allocated,
                'entry_fee': entry_fee_allocated,
                'exit_fee': exit_fee_allocated,
                'total_fee': entry_fee_allocated + exit_fee_allocated,
                'net_pnl_per_trade': net_pnl,
                'is_winner': net_pnl > 0,
                'holding_time_hours': hold_hours,
                'entry_hour': entry['time'].hour,
                'maker': entry['maker'],
                'year': year_label,
            })

            # Update queue entry
            entry['remaining_qty'] -= consume
            remaining -= consume

            if entry['remaining_qty'] < 0.0001:
                pos['queue'].pop(0)

        if remaining > 0.0001:
            skipped += 1

    matched_df = pd.DataFrame(matched)

    if verbose and len(matched_df) > 0:
        l1_total = matched_df['net_pnl_per_trade'].sum()
        scale = level2['net'] / l1_total if l1_total != 0 else 1
        print(f'  Matched:  {len(matched_df):,} trades')
        print(f'  L1 total: ${l1_total:>10,.2f}')
        print(f'  Scale:    {scale:.4f}')
        if skipped > 0:
            print(f'  Skipped:  {skipped} closing fills (no matching entry)')

    return matched_df, level2, positions
