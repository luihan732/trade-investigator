"""
Example Analysis
================

Loads the anonymized sample dataset and runs the full Trade Investigator
pipeline: FIFO matching → behavioral flags → summary analytics.

Usage:
    python engine/example_analysis.py

This demonstrates the pipeline mechanics using 100 anonymized trades.
The key findings documented in README.md were produced by running this
same code against the complete private dataset (6,232 trades, 4 years).
"""

import os
import sys
import pandas as pd

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from engine.fifo_engine import load_data, process_year
from engine.investigator import extract_worst, compute_flags, classify_session
from engine.analysis import (
    holding_period_analysis,
    time_of_day_analysis,
    flag_impact_summary,
)


def main():
    # ── Load sample data ─────────────────────────────────────────────────
    data_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        'data', 'sample_trades.csv'
    )

    print('TRADE INVESTIGATOR — Example Analysis')
    print('=' * 68)
    print(f'Loading sample data from: {data_path}')

    df = load_data(data_path)
    print(f'  Loaded {len(df):,} raw fills')

    # ── Run FIFO matching ────────────────────────────────────────────────
    print('\n' + '─' * 68)
    print('STEP 1: FIFO MATCHING')
    print('─' * 68)

    matched_df, level2, _ = process_year(df, year_label='sample')

    if len(matched_df) == 0:
        print('  No matched trades found. Check data format.')
        return

    print(f'\n  Matched {len(matched_df):,} trades from {len(df):,} fills')
    print(f'  Winners: {matched_df["is_winner"].sum():.0f} '
          f'({matched_df["is_winner"].mean()*100:.1f}%)')

    # ── Compute behavioral flags ─────────────────────────────────────────
    print('\n' + '─' * 68)
    print('STEP 2: BEHAVIORAL FLAG COMPUTATION')
    print('─' * 68)

    flagged = compute_flags(matched_df)
    print(f'  Computed flags for {len(flagged):,} trades')
    print(f'  Trades with 3+ flags: {flagged["blocked"].sum():.0f} '
          f'({flagged["blocked"].mean()*100:.1f}%)')

    # ── Worst trades ─────────────────────────────────────────────────────
    print('\n' + '─' * 68)
    print('STEP 3: WORST TRADES')
    print('─' * 68)

    worst = extract_worst(matched_df, n=5)
    print(f'\n  5 worst trades by net P&L:')
    print(worst.to_string())

    # ── Holding-period analysis ──────────────────────────────────────────
    print('\n' + '─' * 68)
    print('STEP 4: HOLDING-PERIOD REGIME')
    print('─' * 68)

    holding_period_analysis(matched_df)

    # ── Time-of-day analysis ─────────────────────────────────────────────
    print('\n' + '─' * 68)
    print('STEP 5: TIME-OF-DAY ANALYSIS')
    print('─' * 68)

    time_of_day_analysis(matched_df)

    # ── Flag impact ──────────────────────────────────────────────────────
    print('\n' + '─' * 68)
    print('STEP 6: 3-FLAG FILTER IMPACT')
    print('─' * 68)

    flag_impact_summary(flagged)

    # ── Done ─────────────────────────────────────────────────────────────
    print('\n' + '=' * 68)
    print('Analysis complete.')
    print('This sample demonstrates pipeline mechanics.')
    print('Full findings were derived from the complete 4-year dataset.')
    print('=' * 68)


if __name__ == '__main__':
    main()
