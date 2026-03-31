"""
Analysis Module
===============

Summary analytics that run on top of matched + flagged trade data.
Each function takes a DataFrame and returns formatted results.
"""

import pandas as pd
import numpy as np


def holding_period_analysis(matched_df):
    """
    Break down P&L by holding-period regime.

    The core finding: the minimum viable holding period is determined by
    the fee structure, not the signal quality. Trades held below the
    threshold can't generate enough price movement to overcome costs.

    Parameters
    ----------
    matched_df : DataFrame — output from fifo_engine.process_year()

    Returns
    -------
    DataFrame with regime breakdown
    """
    bins = [0, 0.5, 2, 8, 24, 168, float('inf')]
    labels = ['< 30 min', '30m – 2h', '2 – 8h', '8 – 24h', '1 – 7 days', '> 7 days']

    df = matched_df.copy()
    df['regime'] = pd.cut(
        df['holding_time_hours'], bins=bins, labels=labels, right=False
    )

    summary = df.groupby('regime', observed=False).agg(
        trades=('net_pnl_per_trade', 'count'),
        win_rate=('is_winner', 'mean'),
        net_pnl=('net_pnl_per_trade', 'sum'),
        avg_pnl=('net_pnl_per_trade', 'mean'),
    ).round(2)

    summary['win_rate'] = (summary['win_rate'] * 100).round(1)

    # Classify
    summary['status'] = summary['avg_pnl'].apply(
        lambda x: 'Edge' if x > 0.5 else ('Breakeven' if x > -0.5 else 'Bleed')
    )

    print('\nHOLDING-PERIOD REGIME ANALYSIS')
    print('=' * 68)
    print(summary.to_string())

    # Summary stat
    short = df[df['holding_time_hours'] < 2]
    long = df[df['holding_time_hours'] >= 2]
    print(f'\n  Sub-2h:  {len(short):,} trades, ${short["net_pnl_per_trade"].sum():>10,.2f}')
    print(f'  2h+:     {len(long):,} trades, ${long["net_pnl_per_trade"].sum():>10,.2f}')

    return summary


def time_of_day_analysis(matched_df):
    """
    P&L breakdown by entry hour (UTC).

    Parameters
    ----------
    matched_df : DataFrame — needs 'entry_hour' column

    Returns
    -------
    DataFrame with hourly breakdown, sorted by total P&L
    """
    hourly = matched_df.groupby('entry_hour').agg(
        trades=('net_pnl_per_trade', 'count'),
        total_pnl=('net_pnl_per_trade', 'sum'),
        avg_pnl=('net_pnl_per_trade', 'mean'),
        win_rate=('is_winner', 'mean'),
    ).round(2)

    hourly['win_rate'] = (hourly['win_rate'] * 100).round(1)
    hourly = hourly.sort_values('total_pnl', ascending=False)

    print('\nTIME-OF-DAY ANALYSIS (by entry hour, UTC)')
    print('=' * 68)
    print(hourly.to_string())

    return hourly


def year_summary(matched_dfs, level2s):
    """
    Year-over-year summary table.

    Parameters
    ----------
    matched_dfs : dict — {year: matched_df}
    level2s     : dict — {year: level2_dict}

    Returns
    -------
    DataFrame with annual stats
    """
    rows = []
    for yr in sorted(matched_dfs.keys()):
        m = matched_dfs[yr]
        l2 = level2s[yr]

        if len(m) == 0:
            continue

        wr = m['is_winner'].mean() * 100
        avg_win = m[m['is_winner']]['net_pnl_per_trade'].mean() if m['is_winner'].any() else 0
        avg_loss = m[~m['is_winner']]['net_pnl_per_trade'].mean() if (~m['is_winner']).any() else 0
        wl_ratio = abs(avg_win / avg_loss) if avg_loss != 0 else 0
        avg_hold = m['holding_time_hours'].mean()

        gross_wins = m[m['is_winner']]['net_pnl_per_trade'].sum()
        gross_losses = m[~m['is_winner']]['net_pnl_per_trade'].sum()
        pf = gross_wins / abs(gross_losses) if gross_losses != 0 else 0

        rows.append({
            'Year': yr,
            'Trades': len(m),
            'Win Rate': round(wr, 1),
            'Net P&L': round(l2['net'], 2),
            'Total Fees': round(l2['fees'], 2),
            'Profit Factor': round(pf, 2),
            'W/L Ratio': round(wl_ratio, 2),
            'Avg Hold (h)': round(avg_hold, 1),
        })

    summary = pd.DataFrame(rows).set_index('Year')

    print('\nYEAR-OVER-YEAR SUMMARY')
    print('=' * 68)
    print(summary.to_string())

    total_net = summary['Net P&L'].sum()
    total_fees = summary['Total Fees'].sum()
    print(f'\n  Total Net P&L:   ${total_net:,.2f}')
    print(f'  Total Fees:      ${total_fees:,.2f}')

    return summary


def flag_impact_summary(flagged_df):
    """
    Analyze the impact of the 3-flag behavioral filter.

    Shows P&L breakdown by flag count and the improvement from
    blocking entries with 3+ flags active.

    Parameters
    ----------
    flagged_df : DataFrame — output from investigator.compute_flags()

    Returns
    -------
    dict with keys: by_flag_count, allowed, blocked, improvement
    """
    print('\n3-FLAG FILTER ANALYSIS')
    print('=' * 68)

    # By flag count
    by_count = flagged_df.groupby('flag_count').agg(
        decisions=('net_pnl_per_trade', 'count'),
        win_rate=('is_winner', 'mean'),
        net_pnl=('net_pnl_per_trade', 'sum'),
        avg_pnl=('net_pnl_per_trade', 'mean'),
    ).round(2)
    by_count['win_rate'] = (by_count['win_rate'] * 100).round(1)

    print('\nP&L by flag count:')
    print(by_count.to_string())

    # Filter impact
    allowed = flagged_df[~flagged_df['blocked']]
    blocked = flagged_df[flagged_df['blocked']]

    total_pnl = flagged_df['net_pnl_per_trade'].sum()
    allowed_pnl = allowed['net_pnl_per_trade'].sum()
    blocked_pnl = blocked['net_pnl_per_trade'].sum()
    improvement = allowed_pnl - total_pnl

    blocked_winners = blocked['is_winner'].sum()
    blocked_losers = (~blocked['is_winner']).sum()

    print(f'\n  Total decisions:   {len(flagged_df):,}')
    print(f'  Blocked (3+ flags):{len(blocked):,} ({len(blocked)/len(flagged_df)*100:.1f}%)')
    print(f'  Allowed (<3 flags):{len(allowed):,}')
    print(f'\n  Current net P&L:   ${total_pnl:>10,.2f}')
    print(f'  Blocked P&L:       ${blocked_pnl:>10,.2f}')
    print(f'  With rule applied: ${allowed_pnl:>10,.2f}')
    print(f'  Improvement:       ${improvement:>+10,.2f}')
    print(f'\n  Blocked winners:   {int(blocked_winners)} (gains missed)')
    print(f'  Blocked losers:    {int(blocked_losers)} (losses avoided)')

    # Individual flag impact
    print('\n  Individual flag impact:')
    for flag in ['adding_to_loser', 'red_day', 'cold_streak', 'underwater']:
        if flag in flagged_df.columns:
            with_flag = flagged_df[flagged_df[flag]]
            print(f'    {flag:20s}: {len(with_flag):,} trades, '
                  f'${with_flag["net_pnl_per_trade"].sum():>10,.2f} net')

    return {
        'by_flag_count': by_count,
        'total_decisions': len(flagged_df),
        'blocked': len(blocked),
        'allowed': len(allowed),
        'improvement': improvement,
    }
