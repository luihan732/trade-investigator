import { useState, useMemo } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Bar, BarChart, Cell } from "recharts";

/* ═══════════════════════════════════════════════════════════════════════════
   DATA — Embedded from the TradeInvestigator analysis (1,463 entry decisions)
   
   Key mapping (compact to readable):
     t  = entry_time       s  = symbol        y  = year (last 2 digits)
     d  = direction (L/S)  pnl = net P&L      n  = notional ($K)
     h  = holding hours    w  = is_winner      f  = red_flags count
     al = adding_to_loser  rd = red_day       cs = cold_streak
     pb = position_before  dp = daily_pnl     pp = portfolio_pnl
     wr = last10 win rate  ha = hedge_active   hp = hedge_pnl
     ns = n_same_symbol
   ═══════════════════════════════════════════════════════════════════════════ */

import DATA from "../sample_data.json";

/* ─── Helpers ──────────────────────────────────────────────────────────── */
const fmt = (v) => v >= 0 ? `+$${v.toLocaleString()}` : `-$${Math.abs(v).toLocaleString()}`;
const fmtK = (v) => `$${v.toFixed(1)}K`;
const holdStr = (h) => h >= 24 ? `${Math.floor(h / 24)}d ${Math.floor(h % 24)}h` : h >= 1 ? `${Math.floor(h)}h ${Math.floor((h - Math.floor(h)) * 60)}m` : `${Math.floor(h * 60)}m`;
const symFull = (s) => s.endsWith('B') ? s + 'USD' : s + 'USDT';

const FLAG_LABELS = { al: 'Adding to Loser', rd: 'Red Day', cs: 'Cold Streak' };
const FLAG_COLORS = { al: '#E8634A', rd: '#D4553A', cs: '#5B8BD4' };

export default function App() {
    const [selected, setSelected] = useState(null);
    const [flagFilter, setFlagFilter] = useState(0);
    const [symbolFilter, setSymbolFilter] = useState('ALL');
    const [yearFilter, setYearFilter] = useState('ALL');
    const [showBlocked, setShowBlocked] = useState(true);
    const [view, setView] = useState('table');
    const [page, setPage] = useState(0);
    const PAGE_SIZE = 100;

    const symbols = useMemo(() => {
        const unique = [...new Set(DATA.map(d => d.s))].sort();
        return ['ALL', ...unique];
    }, []);
    const years = useMemo(() => {
        const unique = [...new Set(DATA.map(d => d.y))].sort();
        return ['ALL', ...unique];
    }, []);

    /* ─── Filtered data ──────────────────────────────────────────────── */
    const filtered = useMemo(() => {
        setPage(0);
        return DATA.filter(d => {
            if (symbolFilter !== 'ALL' && d.s !== symbolFilter) return false;
            if (yearFilter !== 'ALL' && d.y !== yearFilter) return false;
            if (!showBlocked && d.f >= 3) return false;
            return true;
        });
    }, [symbolFilter, yearFilter, showBlocked]);

    /* ─── Stats ──────────────────────────────────────────────────────── */
    const stats = useMemo(() => {
        const pool = DATA.filter(d => {
            if (symbolFilter !== 'ALL' && d.s !== symbolFilter) return false;
            if (yearFilter !== 'ALL' && d.y !== yearFilter) return false;
            return true;
        });
        const allowed = pool.filter(d => d.f < 3);
        const blocked = pool.filter(d => d.f >= 3);
        return {
            total: pool.length,
            totalPnl: pool.reduce((s, d) => s + d.pnl, 0),
            winRate: pool.filter(d => d.w).length / pool.length * 100,
            allowed: allowed.length,
            allowedPnl: allowed.reduce((s, d) => s + d.pnl, 0),
            blocked: blocked.length,
            blockedPnl: blocked.reduce((s, d) => s + d.pnl, 0),
            blockedWinners: blocked.filter(d => d.w).length,
        };
    }, [symbolFilter, yearFilter]);

    /* ─── Equity curve data ──────────────────────────────────────────── */
    const equityCurve = useMemo(() => {
        const pool = DATA.filter(d => {
            if (symbolFilter !== 'ALL' && d.s !== symbolFilter) return false;
            if (yearFilter !== 'ALL' && d.y !== yearFilter) return false;
            return true;
        }).sort((a, b) => a.t.localeCompare(b.t));

        let cumAll = 0, cumFiltered = 0;
        return pool.map((d, i) => {
            cumAll += d.pnl;
            if (d.f < 3) cumFiltered += d.pnl;
            return {
                i, t: d.t.slice(0, 7),
                actual: Math.round(cumAll),
                filtered: Math.round(cumFiltered),
            };
        }).filter((_, i) => i % 3 === 0); // sample for performance
    }, [symbolFilter, yearFilter]);

    /* ─── Flag distribution for bar chart ────────────────────────────── */
    const flagDist = useMemo(() => {
        const pool = DATA.filter(d => {
            if (symbolFilter !== 'ALL' && d.s !== symbolFilter) return false;
            if (yearFilter !== 'ALL' && d.y !== yearFilter) return false;
            return true;
        });
        return [0, 1, 2, 3, 4].map(f => {
            const sub = pool.filter(d => d.f === f);
            return {
                flags: `${f} flags`,
                count: sub.length,
                pnl: Math.round(sub.reduce((s, d) => s + d.pnl, 0)),
                blocked: f >= 3,
            };
        });
    }, [symbolFilter, yearFilter]);

    return (
        <div style={{ background: '#0D1117', color: '#C9D1D9', minHeight: '100vh', fontFamily: "'JetBrains Mono', 'SF Mono', 'Fira Code', monospace", fontSize: 12 }}>

            {/* ═══ HEADER ═══ */}
            <div style={{ borderBottom: '1px solid #21262D', padding: '16px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                    <span style={{ color: '#58A6FF', fontWeight: 700, fontSize: 15, letterSpacing: 1 }}>TRADE INVESTIGATOR</span>
                    <span style={{ color: '#484F58', marginLeft: 12 }}>{DATA.length} entry decisions · Sample dataset · Modules 1-3</span>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                    <Btn active={view === 'table'} onClick={() => setView('table')}>TABLE</Btn>
                    <Btn active={view === 'dashboard'} onClick={() => setView('dashboard')}>DASHBOARD</Btn>
                </div>
            </div>

            {/* ═══ FILTERS ═══ */}
            <div style={{ borderBottom: '1px solid #21262D', padding: '10px 24px', display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
                <FilterGroup label="Symbol">
                    {symbols.map(s => <Btn key={s} active={symbolFilter === s} onClick={() => setSymbolFilter(s)} small>{s}</Btn>)}
                </FilterGroup>
                <FilterGroup label="Year">
                    {years.map(y => <Btn key={y} active={yearFilter === y} onClick={() => setYearFilter(y)} small>{y === 'ALL' ? 'ALL' : '20' + y}</Btn>)}
                </FilterGroup>
                <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <label style={{ color: '#8B949E', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <input type="checkbox" checked={!showBlocked} onChange={e => setShowBlocked(!e.target.checked)} />
                        Apply 3-flag filter
                    </label>
                </div>
            </div>

            {/* ═══ STAT CARDS ═══ */}
            <div style={{ padding: '12px 24px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
                <StatCard label="Decisions" value={stats.total} />
                <StatCard label="Net P&L" value={fmt(Math.round(stats.totalPnl))} color={stats.totalPnl >= 0 ? '#3FB950' : '#F85149'} />
                <StatCard label="Win Rate" value={`${stats.winRate.toFixed(1)}%`} color={stats.winRate >= 45 ? '#3FB950' : '#F85149'} />
                <StatCard label="3-Flag Blocked" value={stats.blocked} sub={fmt(Math.round(stats.blockedPnl))} />
                <StatCard label="With Rule" value={fmt(Math.round(stats.allowedPnl))} color={stats.allowedPnl >= 0 ? '#3FB950' : '#F0883E'} />
                <StatCard label="Improvement" value={fmt(Math.round(stats.allowedPnl - stats.totalPnl))} color="#3FB950" />
            </div>
            <div style={{ padding: '2px 24px 8px', color: '#484F58', fontSize: 10, fontStyle: 'italic' }}>
                Sample dataset ({DATA.length} anonymized trades) — full analysis covers 1,463 entry decisions across 4 years. See README for methodology and findings.
            </div>

            {view === 'dashboard' ? (
                <Dashboard equityCurve={equityCurve} flagDist={flagDist} stats={stats} />
            ) : (
                <div style={{ display: 'flex', height: 'calc(100vh - 200px)' }}>
                    {/* ═══ TABLE ═══ */}
                    <div style={{ flex: selected ? '0 0 55%' : 1, overflow: 'auto', borderRight: selected ? '1px solid #21262D' : 'none' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr style={{ position: 'sticky', top: 0, background: '#161B22', zIndex: 1 }}>
                                    {['#', 'Time', 'Symbol', 'Dir', 'P&L', 'Notional', 'Hold', 'Flags', '🛡️'].map(h =>
                                        <th key={h} style={{ padding: '8px 6px', textAlign: 'left', color: '#8B949E', fontWeight: 500, borderBottom: '1px solid #21262D', fontSize: 10, letterSpacing: 0.5 }}>{h}</th>
                                    )}
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((d, i) => {
                                    const globalIdx = page * PAGE_SIZE + i;
                                    const isBlocked = d.f >= 3;
                                    const isSelected = selected && selected.t === d.t && selected.s === d.s;
                                    return (
                                        <tr key={globalIdx} onClick={() => setSelected(d)}
                                            style={{
                                                cursor: 'pointer',
                                                background: isSelected ? '#1C2333' : isBlocked ? '#1A1115' : 'transparent',
                                                borderBottom: '1px solid #21262D',
                                                opacity: isBlocked && !showBlocked ? 0.3 : 1,
                                                transition: 'background 0.1s',
                                            }}
                                            onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = '#161B22' }}
                                            onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = isBlocked ? '#1A1115' : 'transparent' }}
                                        >
                                            <td style={cellStyle}><span style={{ color: '#484F58' }}>{globalIdx + 1}</span></td>
                                            <td style={cellStyle}>{d.t}</td>
                                            <td style={cellStyle}><span style={{ color: d.s.includes('ETH') ? '#F0883E' : d.s.includes('BTC') ? '#58A6FF' : '#8B949E', fontWeight: 600 }}>{d.s}</span></td>
                                            <td style={cellStyle}><span style={{ color: d.d === 'L' ? '#3FB950' : '#F85149' }}>{d.d === 'L' ? 'LONG' : 'SHORT'}</span></td>
                                            <td style={{ ...cellStyle, color: d.pnl >= 0 ? '#3FB950' : '#F85149', fontWeight: 600 }}>{fmt(Math.round(d.pnl))}</td>
                                            <td style={cellStyle}>{fmtK(d.n)}</td>
                                            <td style={cellStyle}>{holdStr(d.h)}</td>
                                            <td style={cellStyle}>
                                                <FlagPips flags={d.f} al={d.al} rd={d.rd} cs={d.cs} />
                                            </td>
                                            <td style={cellStyle}>{d.ha ? <span style={{ color: '#58A6FF' }}>●</span> : <span style={{ color: '#21262D' }}>○</span>}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                        {filtered.length > PAGE_SIZE && (
                            <div style={{ padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, borderTop: '1px solid #21262D', background: '#0D1117', position: 'sticky', bottom: 0 }}>
                                <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0}
                                    style={{ background: 'none', border: '1px solid #30363D', color: page === 0 ? '#21262D' : '#8B949E', padding: '4px 12px', borderRadius: 4, cursor: page === 0 ? 'default' : 'pointer', fontFamily: 'inherit', fontSize: 11 }}>
                                    ← Prev
                                </button>
                                <span style={{ color: '#8B949E', fontSize: 11 }}>
                                    {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filtered.length)} of {filtered.length} trades
                                </span>
                                <button onClick={() => setPage(Math.min(Math.ceil(filtered.length / PAGE_SIZE) - 1, page + 1))} disabled={(page + 1) * PAGE_SIZE >= filtered.length}
                                    style={{ background: 'none', border: '1px solid #30363D', color: (page + 1) * PAGE_SIZE >= filtered.length ? '#21262D' : '#8B949E', padding: '4px 12px', borderRadius: 4, cursor: (page + 1) * PAGE_SIZE >= filtered.length ? 'default' : 'pointer', fontFamily: 'inherit', fontSize: 11 }}>
                                    Next →
                                </button>
                            </div>
                        )}
                    </div>

                    {/* ═══ DETAIL PANEL ═══ */}
                    {selected && <DetailPanel trade={selected} onClose={() => setSelected(null)} />}
                </div>
            )}
        </div>
    );
}

/* ═══ COMPONENTS ═══════════════════════════════════════════════════════════ */

const cellStyle = { padding: '6px 6px', whiteSpace: 'nowrap' };

function Btn({ active, onClick, children, small }) {
    return (
        <button onClick={onClick} style={{
            background: active ? '#21262D' : 'transparent',
            border: `1px solid ${active ? '#58A6FF' : '#30363D'}`,
            color: active ? '#58A6FF' : '#8B949E',
            padding: small ? '3px 8px' : '5px 12px',
            borderRadius: 4, cursor: 'pointer', fontSize: small ? 10 : 11,
            fontFamily: 'inherit', fontWeight: active ? 600 : 400,
        }}>{children}</button>
    );
}

function FilterGroup({ label, children }) {
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ color: '#484F58', fontSize: 10, marginRight: 4 }}>{label}:</span>
            {children}
        </div>
    );
}

function StatCard({ label, value, sub, color }) {
    return (
        <div style={{ background: '#161B22', border: '1px solid #21262D', borderRadius: 6, padding: '10px 12px' }}>
            <div style={{ color: '#8B949E', fontSize: 9, letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 4 }}>{label}</div>
            <div style={{ color: color || '#C9D1D9', fontSize: 16, fontWeight: 700 }}>{value}</div>
            {sub && <div style={{ color: '#8B949E', fontSize: 10, marginTop: 2 }}>{sub}</div>}
        </div>
    );
}

function FlagPips({ flags, al, rd, cs }) {
    if (flags === 0) return <span style={{ color: '#21262D' }}>—</span>;
    return (
        <div style={{ display: 'flex', gap: 3 }}>
            {al ? <span title="Adding to loser" style={{ width: 8, height: 8, borderRadius: '50%', background: FLAG_COLORS.al, display: 'inline-block' }} /> : null}
            {rd ? <span title="Red day" style={{ width: 8, height: 8, borderRadius: '50%', background: FLAG_COLORS.rd, display: 'inline-block' }} /> : null}
            {cs ? <span title="Cold streak" style={{ width: 8, height: 8, borderRadius: '50%', background: FLAG_COLORS.cs, display: 'inline-block' }} /> : null}
            {flags >= 3 && <span style={{ color: '#F85149', fontSize: 10, fontWeight: 700, marginLeft: 2 }}>⛔</span>}
        </div>
    );
}

function DetailPanel({ trade: d, onClose }) {
    const hedgeOffset = d.pnl < 0 && d.ha ? (d.hp / Math.abs(d.pnl) * 100) : null;

    return (
        <div style={{ flex: '0 0 45%', overflow: 'auto', padding: '16px 20px', background: '#0D1117' }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
                <div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: d.s.includes('ETH') ? '#F0883E' : '#58A6FF' }}>
                        {symFull(d.s)} <span style={{ color: d.d === 'L' ? '#3FB950' : '#F85149' }}>{d.d === 'L' ? 'LONG' : 'SHORT'}</span>
                    </div>
                    <div style={{ color: '#8B949E', marginTop: 2 }}>{d.t} · 20{d.y}</div>
                </div>
                <button onClick={onClose} style={{ background: 'none', border: '1px solid #30363D', color: '#8B949E', padding: '4px 10px', borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit' }}>✕</button>
            </div>

            {/* P&L Hero */}
            <div style={{ background: '#161B22', border: '1px solid #21262D', borderRadius: 8, padding: 16, marginBottom: 16, textAlign: 'center' }}>
                <div style={{ fontSize: 28, fontWeight: 800, color: d.pnl >= 0 ? '#3FB950' : '#F85149' }}>{fmt(Math.round(d.pnl))}</div>
                <div style={{ color: '#8B949E', fontSize: 11, marginTop: 4 }}>Net P&L (after fees) · {holdStr(d.h)} hold · {fmtK(d.n)} notional</div>
            </div>

            {/* ─── MODULE 2: Pre-Trade Context ─── */}
            <Section title="🧠 PRE-TRADE CONTEXT">
                <ContextRow
                    label="Position Before"
                    value={d.pb === 0 ? 'FLAT (fresh entry)' : `${d.pb > 0 ? '+' : ''}${d.pb.toFixed(2)} (${d.pb > 0 ? 'LONG' : 'SHORT'})`}
                    warn={d.al}
                    warnText="⚠️ ADDING TO A LOSER"
                />
                <ContextRow
                    label="Day Status"
                    value={d.dp === 0 ? 'First trade of day' : `${fmt(Math.round(d.dp))} today`}
                    color={d.dp > 0 ? '#3FB950' : d.dp < -10 ? '#F85149' : '#8B949E'}
                    warn={d.rd}
                    warnText={d.dp < -200 ? `⚠️ Down $${Math.abs(Math.round(d.dp))} — revenge risk` : '⚠️ Red day'}
                />
                <ContextRow
                    label="Portfolio P&L"
                    value={`${fmt(Math.round(d.pp))} lifetime`}
                    color={d.pp > 0 ? '#3FB950' : '#F85149'}
                />
                <ContextRow
                    label="Last 10 Trades"
                    value={`${d.wr.toFixed(0)}% win rate`}
                    color={d.wr >= 50 ? '#3FB950' : d.wr <= 20 ? '#F85149' : '#F0883E'}
                    warn={d.cs}
                    warnText="⚠️ COLD STREAK"
                />
            </Section>

            {/* ─── MODULE 3: Concurrent Positions ─── */}
            <Section title="🔀 CONCURRENT POSITIONS">
                {d.ha ? (
                    <>
                        <ContextRow
                            label="Hedge Status"
                            value="ACTIVE"
                            color="#3FB950"
                        />
                        <ContextRow
                            label="Hedge P&L"
                            value={fmt(Math.round(d.hp))}
                            color={d.hp >= 0 ? '#3FB950' : '#F85149'}
                        />
                        {hedgeOffset !== null && (
                            <ContextRow
                                label="Hedge Offset"
                                value={`${hedgeOffset.toFixed(0)}% of loss covered`}
                                color={hedgeOffset >= 80 ? '#3FB950' : hedgeOffset >= 40 ? '#F0883E' : '#F85149'}
                            />
                        )}
                    </>
                ) : (
                    <ContextRow label="Hedge Status" value="NOT ACTIVE" color="#F85149" />
                )}
                {d.ns > 0 && (
                    <ContextRow
                        label="Same-Symbol Layers"
                        value={`${d.ns} other ${d.s} entries open`}
                        color="#F0883E"
                        warn={true}
                        warnText="⚠️ Position layering"
                    />
                )}
            </Section>

            {/* ─── MODULE 4: Scaling Behavior ─── */}
            <Section title="📐 SCALING BEHAVIOR">
                <ContextRow
                    label="Entry Type"
                    value={d.pb === 0 && d.ns === 0 ? 'Fresh entry' : d.al ? 'Adding to LOSER' : 'Adding to winner'}
                    color={d.al ? '#F85149' : d.pb === 0 ? '#3FB950' : '#F0883E'}
                />
                {d.pb !== 0 && (
                    <ContextRow
                        label="Existing Exposure"
                        value={`${d.pb > 0 ? '+' : ''}${d.pb.toFixed(2)} before this entry`}
                        color="#8B949E"
                    />
                )}
                <ContextRow
                    label="Notional Size"
                    value={fmtK(d.n)}
                    color={d.n > 15 ? '#F0883E' : '#C9D1D9'}
                    warn={d.n > 20}
                    warnText="⚠️ Oversized position"
                />
                {d.ns > 0 && (
                    <ContextRow
                        label="Concurrent Layers"
                        value={`${d.ns} other ${d.s} entries active`}
                        color="#F0883E"
                        warn={d.ns >= 3}
                        warnText={`⚠️ ${d.ns} layers — high concentration risk`}
                    />
                )}
                <ContextRow
                    label="Sizing Verdict"
                    value={d.al && d.ns >= 2 ? 'DANGEROUS — adding to loser with layers' : d.al ? 'RISKY — averaging into losing position' : d.ns >= 3 ? 'CAUTION — many concurrent layers' : d.pb === 0 ? 'CLEAN — fresh entry' : 'OK — scaling into winner'}
                    color={d.al ? '#F85149' : d.ns >= 3 ? '#F0883E' : '#3FB950'}
                />
            </Section>

            {/* ─── MODULE 5: Exit Classification ─── */}
            {(() => {
                const exitType = !d.w
                    ? (d.h < 0.5 && d.f >= 2) ? 'market_panic'
                        : d.h < 2 ? 'stopped_out'
                            : d.h > 24 ? 'held_too_long'
                                : (Math.abs(d.pnl) < d.n * 1.0) ? 'fee_drag'
                                    : 'adverse_move'
                    : d.h < 0.5 ? 'quick_scalp_win'
                        : 'orderly_exit';
                const exitLabels = {
                    market_panic: { text: 'MARKET PANIC', color: '#F85149', desc: 'Exited within 30min under pressure — likely reactive' },
                    stopped_out: { text: 'STOPPED OUT', color: '#E8634A', desc: 'Short hold, rapid loss — hit stop or manual cut' },
                    held_too_long: { text: 'HELD TOO LONG', color: '#D4553A', desc: `Held ${holdStr(d.h)} — the loss grew while you waited` },
                    fee_drag: { text: 'FEE DRAG', color: '#F0883E', desc: 'Tiny loss — would have broken even or won without fees' },
                    adverse_move: { text: 'ADVERSE MOVE', color: '#C9585C', desc: 'Market moved against — moderate hold, clear loss' },
                    quick_scalp_win: { text: 'QUICK SCALP WIN', color: '#3FB950', desc: 'In and out fast with profit' },
                    orderly_exit: { text: 'ORDERLY EXIT', color: '#3FB950', desc: 'Held with conviction and took profit' },
                };
                const e = exitLabels[exitType];
                return (
                    <Section title="🚪 EXIT CLASSIFICATION">
                        <div style={{ padding: '8px 12px', borderRadius: 6, background: '#0D1117', border: `1px solid ${e.color}44`, marginBottom: 8 }}>
                            <span style={{ fontWeight: 700, color: e.color, fontSize: 13 }}>{e.text}</span>
                            <div style={{ color: '#8B949E', fontSize: 10, marginTop: 2 }}>{e.desc}</div>
                        </div>
                        <ContextRow label="Hold Duration" value={holdStr(d.h)} />
                        <ContextRow label="P&L per Hour" value={d.h > 0 ? fmt(Math.round(d.pnl / d.h)) : 'N/A'} color={d.pnl >= 0 ? '#3FB950' : '#F85149'} />
                        {!d.w && d.h > 24 && (
                            <ContextRow label="24h P&L Estimate" value={fmt(Math.round(d.pnl * 24 / d.h))} color="#F0883E" warn={true} warnText="Had you cut at 24h, loss may have been smaller" />
                        )}
                    </Section>
                );
            })()}

            {/* ─── MODULE 6: Trade Tags ─── */}
            {(() => {
                const tradeType = d.h < 0.5 ? 'Scalp' : d.h < 8 ? 'Day Trade' : d.h < 168 ? 'Swing' : 'Position';
                const hr = parseInt(d.t.slice(11, 13), 10);
                const session = hr >= 13 && hr < 21 ? 'US Session' : hr >= 7 && hr < 13 ? 'EU Session' : hr >= 0 && hr < 7 ? 'Asia Session' : 'Late US / Off-Hours';
                const edgeWindow = (hr >= 14 && hr <= 16) || (hr >= 20 && hr <= 22);
                const dangerWindow = hr >= 0 && hr <= 6;
                const outcome = d.w ? (d.pnl > 200 ? 'Big Winner' : d.pnl > 50 ? 'Solid Winner' : 'Small Winner')
                    : (Math.abs(d.pnl) > 500 ? 'Catastrophic' : Math.abs(d.pnl) > 100 ? 'Large Loss' : Math.abs(d.pnl) > 20 ? 'Medium Loss' : 'Small Loss');
                const outcomeColor = d.w ? '#3FB950' : Math.abs(d.pnl) > 500 ? '#F85149' : Math.abs(d.pnl) > 100 ? '#E8634A' : '#F0883E';
                return (
                    <Section title="🏷️ TRADE TAGS">
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                            <TagPill label={tradeType} color="#58A6FF" />
                            <TagPill label={`20${d.y}`} color="#8B949E" />
                            <TagPill label={d.d === 'L' ? 'LONG' : 'SHORT'} color={d.d === 'L' ? '#3FB950' : '#F85149'} />
                            <TagPill label={symFull(d.s)} color="#D2A8FF" />
                            <TagPill label={outcome} color={outcomeColor} />
                        </div>
                        <ContextRow label="Session" value={`${session} (${hr}:00 UTC)`} color={edgeWindow ? '#3FB950' : dangerWindow ? '#F85149' : '#C9D1D9'} warn={dangerWindow} warnText="⚠️ Danger window — historically weak hours" />
                        {edgeWindow && <div style={{ color: '#3FB950', fontSize: 10, marginTop: 2, paddingLeft: 4 }}>✦ Edge window — historically strong hours</div>}
                    </Section>
                );
            })()}

            {/* ─── RED FLAG SUMMARY ─── */}
            <Section title="🚩 RED FLAGS">
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
                    <FlagBadge active={d.al} label="Adding to Loser" />
                    <FlagBadge active={d.rd} label="Red Day" />
                    <FlagBadge active={d.cs} label="Cold Streak" />
                    <FlagBadge active={d.pp < -100} label="Underwater" />
                </div>
                <div style={{
                    marginTop: 12, padding: '8px 12px', borderRadius: 6,
                    background: d.f >= 3 ? '#2A1215' : '#122117',
                    border: `1px solid ${d.f >= 3 ? '#F8514933' : '#3FB95033'}`,
                }}>
                    <span style={{ fontWeight: 700, color: d.f >= 3 ? '#F85149' : '#3FB950' }}>
                        {d.f >= 3 ? `⛔ ${d.f} FLAGS — DO NOT ENTER` : `✅ ${d.f} flags — within tolerance`}
                    </span>
                </div>
            </Section>
        </div>
    );
}

function Section({ title, children }) {
    return (
        <div style={{ marginBottom: 16 }}>
            <div style={{ color: '#58A6FF', fontSize: 11, fontWeight: 600, marginBottom: 8, letterSpacing: 0.5 }}>{title}</div>
            <div style={{ background: '#161B22', border: '1px solid #21262D', borderRadius: 6, padding: 12 }}>
                {children}
            </div>
        </div>
    );
}

function ContextRow({ label, value, color, warn, warnText }) {
    return (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', borderBottom: '1px solid #21262D' }}>
            <span style={{ color: '#8B949E' }}>{label}</span>
            <div style={{ textAlign: 'right' }}>
                <span style={{ color: color || '#C9D1D9', fontWeight: 500 }}>{value}</span>
                {warn && <div style={{ color: '#F85149', fontSize: 10, marginTop: 1 }}>{warnText}</div>}
            </div>
        </div>
    );
}

function FlagBadge({ active, label }) {
    return (
        <span style={{
            padding: '3px 8px', borderRadius: 4, fontSize: 10, fontWeight: 600,
            background: active ? '#F8514922' : '#21262D',
            color: active ? '#F85149' : '#484F58',
            border: `1px solid ${active ? '#F8514944' : '#30363D'}`,
        }}>{active ? '●' : '○'} {label}</span>
    );
}

function TagPill({ label, color }) {
    return (
        <span style={{
            padding: '2px 8px', borderRadius: 12, fontSize: 9, fontWeight: 600,
            background: `${color}18`, color, border: `1px solid ${color}44`,
        }}>{label}</span>
    );
}

function Dashboard({ equityCurve, flagDist, stats }) {
    return (
        <div style={{ padding: '16px 24px' }}>
            {/* Equity curve */}
            <div style={{ background: '#161B22', border: '1px solid #21262D', borderRadius: 8, padding: 16, marginBottom: 16 }}>
                <div style={{ color: '#58A6FF', fontSize: 11, fontWeight: 600, marginBottom: 12 }}>EQUITY CURVE — Actual vs 3-Flag Filtered</div>
                <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={equityCurve}>
                        <XAxis dataKey="t" tick={{ fill: '#484F58', fontSize: 9 }} interval={Math.floor(equityCurve.length / 6)} />
                        <YAxis tick={{ fill: '#484F58', fontSize: 9 }} tickFormatter={v => `$${(v / 1000).toFixed(0)}K`} />
                        <Tooltip
                            contentStyle={{ background: '#161B22', border: '1px solid #30363D', borderRadius: 6, fontSize: 11 }}
                            labelStyle={{ color: '#8B949E' }}
                            formatter={(v, n) => [`$${v.toLocaleString()}`, n === 'actual' ? 'Actual' : 'With 3-Flag Rule']}
                        />
                        <ReferenceLine y={0} stroke="#30363D" />
                        <Line type="monotone" dataKey="actual" stroke="#F85149" strokeWidth={1.5} dot={false} name="actual" />
                        <Line type="monotone" dataKey="filtered" stroke="#3FB950" strokeWidth={1.5} dot={false} name="filtered" />
                    </LineChart>
                </ResponsiveContainer>
                <div style={{ display: 'flex', gap: 20, justifyContent: 'center', marginTop: 8 }}>
                    <span style={{ color: '#F85149', fontSize: 10 }}>━ Actual: {fmt(Math.round(stats.totalPnl))}</span>
                    <span style={{ color: '#3FB950', fontSize: 10 }}>━ With Rule: {fmt(Math.round(stats.allowedPnl))}</span>
                    <span style={{ color: '#58A6FF', fontSize: 10 }}>Improvement: {fmt(Math.round(stats.allowedPnl - stats.totalPnl))}</span>
                </div>
            </div>

            {/* Flag distribution */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div style={{ background: '#161B22', border: '1px solid #21262D', borderRadius: 8, padding: 16 }}>
                    <div style={{ color: '#58A6FF', fontSize: 11, fontWeight: 600, marginBottom: 12 }}>P&L BY FLAG COUNT</div>
                    <ResponsiveContainer width="100%" height={180}>
                        <BarChart data={flagDist}>
                            <XAxis dataKey="flags" tick={{ fill: '#8B949E', fontSize: 10 }} />
                            <YAxis tick={{ fill: '#484F58', fontSize: 9 }} tickFormatter={v => `$${(v / 1000).toFixed(0)}K`} />
                            <Tooltip contentStyle={{ background: '#161B22', border: '1px solid #30363D', borderRadius: 6, fontSize: 11 }} />
                            <Bar dataKey="pnl" name="Net P&L">
                                {flagDist.map((d, i) => (
                                    <Cell key={i} fill={d.blocked ? '#F8514966' : '#3FB95066'} stroke={d.blocked ? '#F85149' : '#3FB950'} />
                                ))}
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                    <div style={{ color: '#8B949E', fontSize: 10, textAlign: 'center', marginTop: 4 }}>
                        Red = would be blocked by 3-flag rule
                    </div>
                </div>

                <div style={{ background: '#161B22', border: '1px solid #21262D', borderRadius: 8, padding: 16 }}>
                    <div style={{ color: '#58A6FF', fontSize: 11, fontWeight: 600, marginBottom: 12 }}>RULE IMPACT</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 8 }}>
                        <RuleRow label="Trades blocked" value={stats.blocked} sub={`of ${stats.total}`} />
                        <RuleRow label="Losses avoided" value={fmt(Math.round(Math.abs(stats.blockedPnl)))} color="#3FB950" />
                        <RuleRow label="Winners missed" value={stats.blockedWinners} color="#F0883E" />
                        <RuleRow label="Net improvement" value={fmt(Math.round(stats.allowedPnl - stats.totalPnl))} color="#58A6FF" />
                    </div>
                    <div style={{ marginTop: 16, padding: '10px 12px', background: '#0D1117', borderRadius: 6, border: '1px solid #21262D' }}>
                        <div style={{ fontSize: 10, color: '#8B949E', marginBottom: 4 }}>THE 3-FLAG RULE</div>
                        <div style={{ fontSize: 10, color: '#C9D1D9', lineHeight: 1.6 }}>
                            If 3+ of these are true, don't trade:<br />
                            <span style={{ color: '#F85149' }}>●</span> Adding to a losing position<br />
                            <span style={{ color: '#F85149' }}>●</span> Already down on the day<br />
                            <span style={{ color: '#F85149' }}>●</span> Last 10 trades ≤20% win rate<br />
                            <span style={{ color: '#F85149' }}>●</span> Portfolio underwater
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

function RuleRow({ label, value, sub, color }) {
    return (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: '#8B949E', fontSize: 11 }}>{label}</span>
            <span style={{ color: color || '#C9D1D9', fontWeight: 600, fontSize: 13 }}>{value} {sub && <span style={{ color: '#484F58', fontSize: 10, fontWeight: 400 }}>{sub}</span>}</span>
        </div>
    );
}
