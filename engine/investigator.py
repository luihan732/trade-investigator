"""
Trade Investigator
==================

Decomposes individual trades into behavioral context: what was the portfolio
state, daily P&L, recent momentum, and concurrent exposure when each entry
decision was made?

Computes three behavioral risk flags per entry:
  - Adding to loser: entering same direction on an underwater position
  - Red day: daily P&L already negative before this entry
  - Cold streak: last 10 closed trades had ≤20% win rate
"""

import pandas as pd
import numpy as np


# ── Trade Investigation ──────────────────────────────────────────────────────

def investigate_trade(entry_time, exit_time, df_raw, symbol=None, label=''):
    """
    Deep investigation of a single trade: fills, fees, P&L breakdown, metrics.

    Parameters
    ----------
    entry_time : Timestamp — trade open time
    exit_time  : Timestamp — trade close time
    df_raw     : DataFrame — raw fill data for the period
    symbol     : str       — filter to specific instrument (recommended)
    label      : str       — display label for the output

    Returns
    -------
    dict with keys: opening, closing, metrics
    """
    trade_rows = df_raw[
        (df_raw['Time(UTC)'] >= entry_time) &
        (df_raw['Time(UTC)'] <= exit_time)
    ].copy()

    if symbol:
        trade_rows = trade_rows[trade_rows['Symbol'] == symbol]

    opening = trade_rows[trade_rows['Realized Profit'] == 0.0]
    closing = trade_rows[trade_rows['Realized Profit'] != 0.0]

    if opening.empty or closing.empty:
        print(f'  No matching rows found between {entry_time} and {exit_time}')
        return None

    # ── Compute metrics ──────────────────────────────────────────────────
    total_open_qty = opening['Quantity'].sum()
    wavg_entry = (opening['Price'] * opening['Quantity']).sum() / total_open_qty
    entry_fees = opening['Fee_USDT'].abs().sum() if 'Fee_USDT' in opening.columns else opening['Fee'].abs().sum()

    total_close_qty = closing['Quantity'].sum()
    wavg_exit = (closing['Price'] * closing['Quantity']).sum() / total_close_qty
    exit_fees = closing['Fee_USDT'].abs().sum() if 'Fee_USDT' in closing.columns else closing['Fee'].abs().sum()

    realized_pnl = closing['Realized Profit'].sum()
    total_fees = entry_fees + exit_fees
    net_pnl = realized_pnl - total_fees
    hold_hours = (exit_time - entry_time).total_seconds() / 3600

    direction = opening.iloc[0]['Side']
    price_change = wavg_exit - wavg_entry
    price_change_pct = price_change / wavg_entry * 100
    fee_pct = total_fees / (total_open_qty * wavg_entry) * 100

    metrics = {
        'direction': 'LONG' if direction == 'BUY' else 'SHORT',
        'wavg_entry': wavg_entry,
        'wavg_exit': wavg_exit,
        'quantity': total_open_qty,
        'notional': total_open_qty * wavg_entry,
        'realized_pnl': realized_pnl,
        'entry_fees': entry_fees,
        'exit_fees': exit_fees,
        'total_fees': total_fees,
        'net_pnl': net_pnl,
        'hold_hours': hold_hours,
        'price_change_pct': price_change_pct,
        'fee_pct': fee_pct,
        'n_opening_fills': len(opening),
        'n_closing_fills': len(closing),
    }

    # ── Print report ─────────────────────────────────────────────────────
    header = f'  {label}  ' if label else ''
    print('=' * 72)
    print(f'  TRADE INVESTIGATION{header}')
    print('=' * 72)

    print(f'\n  Timeline')
    print(f'    Opened:   {entry_time}')
    print(f'    Closed:   {exit_time}')
    print(f'    Duration: {hold_hours:.2f} hours')

    print(f'\n  Entry ({len(opening)} fills)')
    print(f'    Weighted avg price: ${wavg_entry:.4f}')
    print(f'    Total quantity:     {total_open_qty:.6f}')
    print(f'    Entry fees:         ${entry_fees:.4f}')

    print(f'\n  Exit ({len(closing)} fills)')
    print(f'    Weighted avg price: ${wavg_exit:.4f}')
    print(f'    Exit fees:          ${exit_fees:.4f}')

    print(f'\n  P&L Breakdown')
    print(f'    Realized P&L:       ${realized_pnl:>10,.4f}')
    print(f'    Total fees:         ${total_fees:>10,.4f}')
    print(f'    Net after fees:     ${net_pnl:>10,.4f}')

    print(f'\n  Metrics')
    print(f'    Direction:          {metrics["direction"]}')
    print(f'    Price move:         {price_change_pct:+.4f}%')
    print(f'    Fee as % of trade:  {fee_pct:.4f}%')

    if net_pnl < 0 and abs(net_pnl) < total_fees:
        print(f'\n    ** FEE DRAG: this trade would have been profitable without fees')

    return {'opening': opening, 'closing': closing, 'metrics': metrics}


# ── Worst-N Extraction ───────────────────────────────────────────────────────

def extract_worst(matched_df, n=20):
    """
    Extract the N worst trades by net P&L.

    Parameters
    ----------
    matched_df : DataFrame — output from fifo_engine.process_year()
    n          : int       — number of worst trades to return

    Returns
    -------
    DataFrame sorted by net P&L (worst first)
    """
    display_cols = [
        'year', 'symbol', 'entry_time', 'exit_time',
        'holding_time_hours', 'side', 'position_size',
        'net_pnl_per_trade', 'entry_hour'
    ]
    available_cols = [c for c in display_cols if c in matched_df.columns]

    worst = (
        matched_df
        .sort_values('net_pnl_per_trade')
        .head(n)[available_cols]
        .reset_index(drop=True)
    )
    worst.index += 1  # rank from 1
    return worst


# ── Behavioral Flags ─────────────────────────────────────────────────────────

def compute_flags(matched_df):
    """
    Compute behavioral risk flags for each trade in the matched DataFrame.

    Three flags are computed:
      adding_to_loser : True if entering same symbol while existing position underwater
      red_day         : True if daily P&L was negative before this entry
      cold_streak     : True if last 10 closed trades had ≤20% win rate

    Also computes:
      portfolio_pnl   : cumulative P&L at entry time
      daily_pnl       : P&L already accumulated on the entry day
      last10_winrate  : win rate of last 10 trades

    Parameters
    ----------
    matched_df : DataFrame — output from fifo_engine.process_year()

    Returns
    -------
    DataFrame with flag columns added
    """
    df = matched_df.sort_values('entry_time').reset_index(drop=True).copy()

    # Cumulative P&L at each point
    df['portfolio_pnl'] = df['net_pnl_per_trade'].cumsum().shift(1, fill_value=0)

    # Daily P&L before each trade
    df['entry_date'] = df['entry_time'].dt.date
    df['daily_pnl'] = (
        df.groupby('entry_date')['net_pnl_per_trade']
        .cumsum()
        .shift(1, fill_value=0)
    )

    # Rolling win rate of last 10 trades
    df['last10_winrate'] = (
        df['is_winner']
        .rolling(window=10, min_periods=1)
        .mean()
        .shift(1, fill_value=0.5)  # assume neutral before first 10
    ) * 100

    # ── Flag computation ─────────────────────────────────────────────────

    # Adding to loser: same symbol was already open and losing
    # Simplified: check if previous trade on same symbol was a loser
    df['adding_to_loser'] = False
    for sym in df['symbol'].unique():
        sym_mask = df['symbol'] == sym
        sym_idx = df[sym_mask].index
        for i, idx in enumerate(sym_idx):
            if i == 0:
                continue
            prev_idx = sym_idx[i - 1]
            # Was the previous trade on this symbol a loser and exited
            # after this trade's entry? (i.e., overlapping)
            if (df.loc[prev_idx, 'exit_time'] > df.loc[idx, 'entry_time'] and
                    df.loc[prev_idx, 'net_pnl_per_trade'] < 0):
                df.loc[idx, 'adding_to_loser'] = True

    # Red day: daily P&L was negative before this entry
    df['red_day'] = df['daily_pnl'] < 0

    # Cold streak: last 10 trades had ≤20% win rate
    df['cold_streak'] = df['last10_winrate'] <= 20

    # Portfolio underwater
    df['underwater'] = df['portfolio_pnl'] < 0

    # Flag count
    df['flag_count'] = (
        df['adding_to_loser'].astype(int) +
        df['red_day'].astype(int) +
        df['cold_streak'].astype(int) +
        df['underwater'].astype(int)
    )

    # Blocked by 3-flag rule
    df['blocked'] = df['flag_count'] >= 3

    # Clean up
    df.drop(columns=['entry_date'], inplace=True)

    return df


# ── Session Classification ───────────────────────────────────────────────────

def classify_session(hour):
    """
    Classify an entry hour (UTC) into a trading session.

    Returns
    -------
    str — session label
    """
    if 0 <= hour <= 6:
        return 'Asia (00-06 UTC)'
    elif 7 <= hour <= 12:
        return 'Europe (07-12 UTC)'
    elif 13 <= hour <= 20:
        return 'US (13-20 UTC)'
    else:
        return 'Late/Off-hours (21-23 UTC)'
