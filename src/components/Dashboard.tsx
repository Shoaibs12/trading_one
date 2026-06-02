'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Activity, Briefcase, TrendingUp, TrendingDown,
  Play, Square, Target, Shield, BarChart3, Zap, RotateCcw,
  AlertTriangle, Newspaper, Gauge,
} from 'lucide-react';
import dynamic from 'next/dynamic';

const Chart = dynamic(() => import('./Chart'), { ssr: false });

/* ─── Types ─── */
interface VaultData {
  initial_balance: number;
  current_balance: number;
  available_balance: number;
  invested_balance: number;
}

interface SystemState {
  confidence_threshold: number;
  profit_target_percentage: number;
  stop_loss_percentage: number;
  trailing_stop_distance: number;
  breakeven_trigger: number;
  consecutive_losses: number;
  cooldown_until: number;
  max_daily_loss_percentage: number;
  daily_profit_target: number;
  max_position_percentage: number;
}

interface Trade {
  id: number;
  asset: string;
  type: string;
  status: string;
  entry_price: number;
  exit_price: number | null;
  trade_size: number;
  profit_loss: number;
  timestamp: number;
  close_timestamp: number | null;
  ai_insight: string | null;
  trailing_stop_price: number | null;
  peak_price: number | null;
  strategy_signal: any;
}

interface Signal {
  score: number;
  direction: string;
  agreementCount: number;
  breakdown: {
    emaCrossover: number;
    rsi: number;
    macd: number;
    bollinger: number;
    volume: number;
    news: number;
  };
  insight: string;
}

interface Indicators {
  rsi: number;
  macd: { macdLine: number; signalLine: number; histogram: number } | null;
  bollingerBands: { upper: number; middle: number; lower: number; width: number } | null;
  volumeRatio: number;
  volumeSpike: boolean;
}

interface Stats {
  wins: number;
  losses: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  sharpeRatio: number;
  maxDrawdown: number;
}

interface DailyPnl {
  date: string;
  starting_balance: number;
  ending_balance: number | null;
  total_pnl: number;
  trade_count: number;
  win_count: number;
  loss_count: number;
  target_hit: boolean;
}

interface NewsHeadline {
  headline: string;
  source: string;
  timestamp: number;
  sentiment_score: number;
  impact_level: string;
}

interface SentimentData {
  overallScore: number;
  fearGreedIndex: number;
  marketRegime: string;
  headlines: NewsHeadline[];
}

interface DashboardData {
  vault: VaultData;
  systemState: SystemState;
  recentTrades: Trade[];
  recentCandles: any[];
  ema9Data: any[];
  ema21Data: any[];
  bbData: any[];
  currentSignal: Signal | null;
  currentIndicators: Indicators;
  stats: Stats;
  dailyPnl: DailyPnl | null;
  allDailyPnl: DailyPnl[];
  tradeMarkers: any[];
  sentimentData: SentimentData | null;
  tickError?: string;
}

/* ─── Helpers ─── */
function formatMoney(v: number): string {
  return v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function getSignalColor(score: number): string {
  if (score > 0.3) return 'var(--success-color)';
  if (score < -0.3) return 'var(--danger-color)';
  return 'var(--text-secondary)';
}

function getBreakdownLabel(key: string): string {
  const map: Record<string, string> = {
    emaCrossover: 'EMA Cross',
    rsi: 'RSI',
    macd: 'MACD',
    bollinger: 'Bollinger',
    volume: 'Volume',
    news: 'News',
  };
  return map[key] || key;
}

function getTimeAgo(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function EquityCurve({ data, initialBalance }: { data: DailyPnl[]; initialBalance: number }) {
  // data comes newest-first from API, reverse it
  const sorted = [...data].reverse();
  if (sorted.length < 2) return null;

  const values = sorted.map(d => d.ending_balance ?? d.starting_balance + d.total_pnl);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const w = 100;
  const h = 100;

  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w;
    const y = h - ((v - min) / range) * h;
    return `${x},${y}`;
  }).join(' ');

  const lastValue = values[values.length - 1];
  const isProfit = lastValue >= initialBalance;
  const color = isProfit ? 'var(--success-color)' : 'var(--danger-color)';

  // Create fill path
  const fillPoints = `0,${h} ${points} ${w},${h}`;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: '100%', height: '100%' }}>
      <defs>
        <linearGradient id="equityFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.15" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <polygon points={fillPoints} fill="url(#equityFill)" />
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      {/* Initial balance reference line */}
      {(() => {
        const refY = h - ((initialBalance - min) / range) * h;
        return <line x1="0" y1={refY} x2={w} y2={refY} stroke="rgba(255,255,255,0.1)" strokeWidth="0.5" vectorEffect="non-scaling-stroke" strokeDasharray="4,4" />;
      })()}
    </svg>
  );
}

/* ─── Component ─── */
export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/data');
      const json = await res.json();
      setData(json);
      setLoading(false);
    } catch (err) {
      console.error('Failed to fetch data:', err);
    }
  }, []);

  // Initial load
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Simulation tick loop
  useEffect(() => {
    if (!isRunning) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch('/api/tick', { method: 'POST' });
        const json = await res.json();
        setData(json);
      } catch (err) {
        console.error('Tick error:', err);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [isRunning]);

  // Auto-refresh data every 30s when paused
  useEffect(() => {
    if (isRunning) return;
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [isRunning, fetchData]);

  const handleReset = async () => {
    try {
      setIsRunning(false);
      await fetch('/api/reset', { method: 'POST' });
      await fetchData();
    } catch (err) {
      console.error('Reset error:', err);
    }
  };

  /* ─── Loading ─── */
  if (loading || !data) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner" />
        <div className="loading-text">Initializing Trading Engine...</div>
      </div>
    );
  }

  const { vault, systemState, recentTrades, recentCandles, stats, currentSignal, currentIndicators, dailyPnl, ema9Data, ema21Data, bbData, tradeMarkers } = data;
  const totalProfit = vault.current_balance - vault.initial_balance;
  const profitPct = ((totalProfit) / vault.initial_balance) * 100;
  const currentPrice = recentCandles.length > 0 ? recentCandles[recentCandles.length - 1].close : null;

  // Daily target progress
  const dailyTarget = systemState.daily_profit_target || 10;
  const todayPnl = dailyPnl?.total_pnl ?? 0;
  const targetProgress = Math.min(Math.max((todayPnl / dailyTarget) * 100, 0), 100);
  const targetHit = dailyPnl?.target_hit ?? false;

  return (
    <div className="container">
      {/* ──── Header ──── */}
      <header className="header">
        <h1>
          <Activity size={22} className="panel-title-icon" />
          Ghost Run Trading Engine
          <span className="header-subtitle">Multi-Indicator AI Analysis</span>
        </h1>
        <div className="controls">
          {data.sentimentData && (
            <div className={`regime-badge ${data.sentimentData.marketRegime.toLowerCase().replace('_', '-')}`}>
              {data.sentimentData.marketRegime.replace('_', ' ')}
            </div>
          )}
          {isRunning && (
            <div className="live-badge">
              <div className="pulse" /> LIVE
            </div>
          )}
          <button
            className={`button ${isRunning ? 'button-warning' : 'button-primary'}`}
            onClick={() => setIsRunning(!isRunning)}
          >
            {isRunning ? <><Square size={14} /> Pause</> : <><Play size={14} /> Start</>}
          </button>
          <button className="button button-danger" onClick={handleReset}>
            <RotateCcw size={14} /> Reset
          </button>
        </div>
      </header>

      {data.tickError && (
        <div className="error-banner">
          <AlertTriangle size={14} />
          Tick Error: {data.tickError}
        </div>
      )}

      {/* ──── Grid ──── */}
      <div className="dashboard-grid">
        {/* ──── Main Column ──── */}
        <div className="main-col">

          {/* Chart Panel */}
          <div className="panel">
            <div className="panel-header-row">
              <h2 className="panel-title" style={{ marginBottom: 0 }}>
                <BarChart3 size={16} className="panel-title-icon" />
                BTC/USD Live
              </h2>
              {currentPrice && (
                <span className="panel-meta">
                  Last: <strong style={{ color: '#fff' }}>${formatMoney(currentPrice)}</strong>
                </span>
              )}
            </div>
            {recentCandles.length > 0 ? (
              <Chart
                data={recentCandles}
                ema9Data={ema9Data}
                ema21Data={ema21Data}
                bbData={bbData}
                tradeMarkers={tradeMarkers}
              />
            ) : (
              <div className="chart-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
                Awaiting market data...
              </div>
            )}
          </div>

          {/* Equity Curve */}
          {data.allDailyPnl && data.allDailyPnl.length > 1 && (
            <div className="panel">
              <h2 className="panel-title">
                <TrendingUp size={16} className="panel-title-icon" />
                Equity Curve
              </h2>
              <div className="equity-chart-container">
                <EquityCurve data={data.allDailyPnl} initialBalance={vault.initial_balance} />
              </div>
            </div>
          )}

          {/* Signal Panel */}
          <div className="panel">
            <h2 className="panel-title">
              <Zap size={16} className="panel-title-icon" />
              Composite Signal Analysis
            </h2>

            {currentSignal ? (
              <>
                <div className="signal-header-row">
                  <div className={`direction-badge ${currentSignal.direction === 'BUY' ? 'buy-dir' : currentSignal.direction === 'SELL' ? 'sell-dir' : 'hold-dir'}`}>
                    {currentSignal.direction === 'BUY' ? <TrendingUp size={14} /> : currentSignal.direction === 'SELL' ? <TrendingDown size={14} /> : null}
                    {currentSignal.direction}
                  </div>
                  <div className="signal-agreement">
                    <div className="agreement-dot" />
                    {currentSignal.agreementCount}/6 indicators agree
                  </div>
                </div>

                {/* Signal gauge */}
                <div className="signal-gauge-container">
                  <div
                    className="signal-gauge-value"
                    style={{
                      left: `${((currentSignal.score + 1) / 2) * 100}%`,
                      color: getSignalColor(currentSignal.score),
                    }}
                  >
                    {currentSignal.score > 0 ? '+' : ''}{currentSignal.score.toFixed(2)}
                  </div>
                  <div className="signal-gauge-track">
                    <div className="signal-gauge-center" />
                    {currentSignal.score >= 0 ? (
                      <div
                        className="signal-gauge-fill positive"
                        style={{ width: `${currentSignal.score * 50}%` }}
                      />
                    ) : (
                      <div
                        className="signal-gauge-fill negative"
                        style={{ width: `${Math.abs(currentSignal.score) * 50}%` }}
                      />
                    )}
                  </div>
                  <div className="signal-gauge-labels">
                    <span>-1.0 Sell</span>
                    <span>Neutral</span>
                    <span>+1.0 Buy</span>
                  </div>
                </div>

                {/* Breakdown bars */}
                <div className="breakdown-grid">
                  {Object.entries(currentSignal.breakdown).map(([key, val]) => {
                    const numVal = Number(val);
                    const fillPct = Math.abs(numVal) * 100;
                    const cls = numVal > 0 ? 'bullish' : numVal < 0 ? 'bearish' : 'neutral';
                    return (
                      <div className="breakdown-item" key={key}>
                        <div className="breakdown-label">
                          {getBreakdownLabel(key)} <span style={{ color: getSignalColor(numVal), fontWeight: 700 }}>{numVal > 0 ? '+' : ''}{numVal.toFixed(1)}</span>
                        </div>
                        <div className="breakdown-bar-track">
                          <div className={`breakdown-bar-fill ${cls}`} style={{ width: `${fillPct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>

                {currentSignal.insight && (
                  <div className="signal-insight">{currentSignal.insight}</div>
                )}
              </>
            ) : (
              <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '1.5rem 0', fontSize: '0.85rem' }}>
                No signal computed yet. Start the simulation to generate signals.
              </div>
            )}
          </div>

          {/* Trade History Table */}
          <div className="panel">
            <h2 className="panel-title">
              <Activity size={16} className="panel-title-icon" />
              Trade History
            </h2>
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Asset</th>
                    <th>Type</th>
                    <th>Entry</th>
                    <th>Exit</th>
                    <th>P&amp;L</th>
                    <th>AI Insight</th>
                  </tr>
                </thead>
                <tbody>
                  {recentTrades.map((trade) => {
                    const unrealizedPnl = trade.status === 'OPEN' && currentPrice
                      ? ((trade.type === 'BUY'
                        ? (currentPrice - trade.entry_price)
                        : (trade.entry_price - currentPrice)) * (trade.trade_size / trade.entry_price))
                        - (trade.trade_size * 0.001) // Entry fee
                        - ((trade.trade_size / trade.entry_price) * currentPrice * 0.001) // Exit fee
                      : null;

                    return (
                      <tr key={trade.id}>
                        <td style={{ whiteSpace: 'nowrap', fontSize: '0.78rem' }}>
                          {new Date(trade.timestamp).toLocaleTimeString()}
                        </td>
                        <td>{trade.asset}</td>
                        <td>
                          <span className={`badge ${trade.type.toLowerCase()}`}>{trade.type}</span>
                        </td>
                        <td>${trade.entry_price.toFixed(2)}</td>
                        <td>{trade.exit_price ? `$${trade.exit_price.toFixed(2)}` : '—'}</td>
                        <td>
                          {trade.status === 'OPEN' ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                              <span className="badge open">OPEN</span>
                              {unrealizedPnl !== null && (
                                <span className={unrealizedPnl >= 0 ? 'profit-positive' : 'profit-negative'} style={{ fontSize: '0.82rem' }}>
                                  {unrealizedPnl >= 0 ? '+' : '-'}${Math.abs(unrealizedPnl).toFixed(2)}
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className={trade.profit_loss >= 0 ? 'profit-positive' : 'profit-negative'}>
                              {trade.profit_loss >= 0 ? '+' : '-'}${Math.abs(trade.profit_loss).toFixed(2)}
                            </span>
                          )}
                        </td>
                        <td>
                          {trade.ai_insight && <div className="ai-insight">{trade.ai_insight}</div>}
                        </td>
                      </tr>
                    );
                  })}
                  {recentTrades.length === 0 && (
                    <tr>
                      <td colSpan={7} className="table-empty">No trades executed yet. Start the engine to begin trading.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* ──── Sidebar ──── */}
        <div className="side-col">

          {/* Vault Status */}
          <div className="panel">
            <h2 className="panel-title">
              <Briefcase size={16} className="panel-title-icon" />
              Vault Status
            </h2>
            <div className="stats-grid">
              <div className="stat-box">
                <div className="stat-label">Total Balance</div>
                <div className="stat-value">${formatMoney(vault.current_balance)}</div>
              </div>
              <div className="stat-box">
                <div className="stat-label">Initial Balance</div>
                <div className="stat-value" style={{ color: 'var(--text-secondary)', fontSize: '1.1rem' }}>${formatMoney(vault.initial_balance)}</div>
              </div>
              <div className="stat-box">
                <div className="stat-label">Available</div>
                <div className="stat-value">${formatMoney(vault.available_balance)}</div>
              </div>
              <div className="stat-box">
                <div className="stat-label">Invested</div>
                <div className="stat-value warning">${formatMoney(vault.invested_balance)}</div>
              </div>
            </div>
            <div className="stat-divider">
              <div className="stat-label">Total P&amp;L</div>
              <div className={`stat-value-row ${totalProfit >= 0 ? '' : ''}`}>
                <div className={`stat-value ${totalProfit >= 0 ? 'success' : 'danger'} ${totalProfit > 5 ? 'profit-celebration' : ''}`}>
                  {totalProfit >= 0 ? <TrendingUp size={20} /> : <TrendingDown size={20} />}
                </div>
                <div className={`stat-value ${totalProfit >= 0 ? 'success' : 'danger'} ${totalProfit > 5 ? 'profit-celebration' : ''}`}>
                  {totalProfit >= 0 ? '+' : '-'}${formatMoney(Math.abs(totalProfit))}
                </div>
                <span className="stat-sub" style={{ marginTop: 0 }}>({profitPct >= 0 ? '+' : ''}{profitPct.toFixed(2)}%)</span>
              </div>
            </div>
          </div>

          {/* Daily Target */}
          <div className="panel">
            <h2 className="panel-title">
              <Target size={16} className="panel-title-icon" />
              Daily Target
            </h2>
            <div className="progress-container">
              <div className="progress-label-row">
                <span className="progress-label">Progress to ${dailyTarget.toFixed(0)}</span>
                <span className={`progress-value ${todayPnl >= 0 ? 'profit-positive' : 'profit-negative'}`}>
                  {todayPnl >= 0 ? '+' : '-'}${formatMoney(Math.abs(todayPnl))}
                </span>
              </div>
              <div className="progress-track">
                <div
                  className={`progress-fill ${targetHit ? 'target-hit' : todayPnl >= 0 ? 'success' : 'danger'}`}
                  style={{ width: `${todayPnl < 0 ? 0 : targetProgress}%` }}
                />
              </div>
            </div>
            {dailyPnl && (
              <div className="daily-stats-row">
                <div className="daily-stat">
                  <div className="daily-stat-value">{dailyPnl.trade_count}</div>
                  <div className="daily-stat-label">Trades</div>
                </div>
                <div className="daily-stat">
                  <div className="daily-stat-value" style={{ color: 'var(--success-color)' }}>{dailyPnl.win_count}</div>
                  <div className="daily-stat-label">Wins</div>
                </div>
                <div className="daily-stat">
                  <div className="daily-stat-value" style={{ color: 'var(--danger-color)' }}>{dailyPnl.loss_count}</div>
                  <div className="daily-stat-label">Losses</div>
                </div>
              </div>
            )}
          </div>

          {/* System Performance */}
          <div className="panel">
            <h2 className="panel-title">
              <BarChart3 size={16} className="panel-title-icon" />
              System Performance
            </h2>
            <div className="perf-grid">
              <div className="perf-item">
                <div className="perf-item-value" style={{ color: stats.winRate >= 50 ? 'var(--success-color)' : 'var(--danger-color)' }}>
                  {stats.winRate.toFixed(1)}%
                </div>
                <div className="perf-item-label">Win Rate</div>
              </div>
              <div className="perf-item">
                <div className="perf-item-value profit-positive">+${formatMoney(stats.avgWin)}</div>
                <div className="perf-item-label">Avg Win</div>
              </div>
              <div className="perf-item">
                <div className="perf-item-value profit-negative">-${formatMoney(stats.avgLoss)}</div>
                <div className="perf-item-label">Avg Loss</div>
              </div>
              <div className="perf-item">
                <div className="perf-item-value" style={{ color: stats.profitFactor >= 1 ? 'var(--success-color)' : 'var(--danger-color)' }}>
                  {stats.profitFactor.toFixed(2)}
                </div>
                <div className="perf-item-label">Profit Factor</div>
              </div>
              <div className="perf-item">
                <div className="perf-item-value" style={{ color: stats.sharpeRatio >= 1 ? 'var(--success-color)' : stats.sharpeRatio >= 0 ? 'var(--warning-color)' : 'var(--danger-color)' }}>
                  {stats.sharpeRatio.toFixed(2)}
                </div>
                <div className="perf-item-label">Sharpe Ratio</div>
              </div>
              <div className="perf-item">
                <div className="perf-item-value profit-negative">
                  {stats.maxDrawdown.toFixed(2)}%
                </div>
                <div className="perf-item-label">Max Drawdown</div>
              </div>
            </div>
          </div>

          {/* Indicator Readings */}
          <div className="panel">
            <h2 className="panel-title">
              <Gauge size={16} className="panel-title-icon" />
              Indicator Readings
            </h2>
            <div className="indicator-cards-grid">
              <div className={`indicator-card ${currentIndicators?.rsi != null ? (currentIndicators.rsi < 30 ? 'green-border' : currentIndicators.rsi > 70 ? 'red-border' : 'blue-border') : ''}`}>
                <div className="indicator-card-label">RSI (14)</div>
                <div className="indicator-card-value" style={{ color: currentIndicators?.rsi != null ? (currentIndicators.rsi < 30 ? 'var(--success-color)' : currentIndicators.rsi > 70 ? 'var(--danger-color)' : '#fff') : 'var(--text-muted)' }}>
                  {currentIndicators?.rsi != null ? currentIndicators.rsi.toFixed(1) : '—'}
                </div>
              </div>
              <div className={`indicator-card ${currentIndicators?.macd ? (currentIndicators.macd.histogram > 0 ? 'green-border' : 'red-border') : ''}`}>
                <div className="indicator-card-label">MACD Hist</div>
                <div className="indicator-card-value" style={{ color: currentIndicators?.macd ? (currentIndicators.macd.histogram > 0 ? 'var(--success-color)' : 'var(--danger-color)') : 'var(--text-muted)' }}>
                  {currentIndicators?.macd ? currentIndicators.macd.histogram.toFixed(2) : '—'}
                </div>
              </div>
              <div className={`indicator-card ${currentIndicators?.bollingerBands ? 'purple-border' : ''}`}>
                <div className="indicator-card-label">BB Width</div>
                <div className="indicator-card-value">
                  {currentIndicators?.bollingerBands ? (currentIndicators.bollingerBands.width * 100).toFixed(2) + '%' : '—'}
                </div>
              </div>
              <div className={`indicator-card ${currentIndicators?.volumeSpike ? 'orange-border' : ''}`}>
                <div className="indicator-card-label">Vol Ratio</div>
                <div className="indicator-card-value" style={{ color: currentIndicators?.volumeSpike ? 'var(--warning-color)' : '#fff' }}>
                  {currentIndicators?.volumeRatio ? currentIndicators.volumeRatio.toFixed(1) + 'x' : '—'}
                </div>
              </div>
            </div>
          </div>

          {/* Risk Parameters */}
          <div className="panel">
            <h2 className="panel-title">
              <Shield size={16} className="panel-title-icon" />
              Risk Parameters
            </h2>
            <div className="risk-params">
              <div className="risk-row">
                <span className="risk-row-label">Stop Loss</span>
                <span className="risk-row-value danger">{(systemState.stop_loss_percentage * 100).toFixed(1)}%</span>
              </div>
              <div className="risk-row">
                <span className="risk-row-label">Take Profit</span>
                <span className="risk-row-value success">{(systemState.profit_target_percentage * 100).toFixed(1)}%</span>
              </div>
              <div className="risk-row">
                <span className="risk-row-label">Trailing Stop</span>
                <span className="risk-row-value warning">{(systemState.trailing_stop_distance * 100).toFixed(2)}%</span>
              </div>
              <div className="risk-row">
                <span className="risk-row-label">Confidence Threshold</span>
                <span className="risk-row-value">{(systemState.confidence_threshold * 100).toFixed(0)}%</span>
              </div>
              <div className="risk-row">
                <span className="risk-row-label">Max Position</span>
                <span className="risk-row-value">{(systemState.max_position_percentage * 100).toFixed(0)}%</span>
              </div>
              <div className="risk-row">
                <span className="risk-row-label">Consecutive Losses</span>
                <span className={`risk-row-value ${systemState.consecutive_losses > 0 ? 'warning' : 'success'}`}>
                  {systemState.consecutive_losses}
                </span>
              </div>
            </div>

            {systemState.cooldown_until && (
              <div className="cooldown-alert">
                <Shield size={14} />
                Cooldown active — pausing trades until cooldown expires.
              </div>
            )}
          </div>

          {/* News & Sentiment */}
          <div className="panel">
            <h2 className="panel-title">
              <Newspaper size={16} className="panel-title-icon" />
              News & Sentiment
            </h2>
            {data.sentimentData ? (
              <>
                {/* Sentiment Summary */}
                <div className="news-sentiment-summary">
                  <div>
                    <div className="stat-label">Sentiment</div>
                    <div className={`sentiment-score-display ${data.sentimentData.overallScore >= 0 ? 'profit-positive' : 'profit-negative'}`}>
                      {data.sentimentData.overallScore >= 0 ? '+' : ''}{data.sentimentData.overallScore.toFixed(2)}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div className="stat-label">Fear & Greed</div>
                    <div className="fear-greed-value" style={{
                      color: data.sentimentData.fearGreedIndex < 30 ? 'var(--danger-color)' 
                           : data.sentimentData.fearGreedIndex > 70 ? 'var(--success-color)' 
                           : 'var(--warning-color)'
                    }}>
                      {Math.round(data.sentimentData.fearGreedIndex)}
                    </div>
                    <div className="fear-greed-label" style={{
                      color: data.sentimentData.fearGreedIndex < 20 ? 'var(--danger-color)'
                           : data.sentimentData.fearGreedIndex < 40 ? 'var(--warning-color)'
                           : data.sentimentData.fearGreedIndex < 60 ? 'var(--text-secondary)'
                           : data.sentimentData.fearGreedIndex < 80 ? 'var(--success-color)'
                           : 'var(--success-color)'
                    }}>
                      {data.sentimentData.fearGreedIndex < 20 ? 'Extreme Fear'
                       : data.sentimentData.fearGreedIndex < 40 ? 'Fear'
                       : data.sentimentData.fearGreedIndex < 60 ? 'Neutral'
                       : data.sentimentData.fearGreedIndex < 80 ? 'Greed'
                       : 'Extreme Greed'}
                    </div>
                  </div>
                </div>

                {/* Fear & Greed Bar */}
                <div className="fear-greed-bar">
                  <div className="fear-greed-marker" style={{ left: `${data.sentimentData.fearGreedIndex}%` }} />
                </div>

                {/* News Headlines */}
                <div className="news-feed" style={{ marginTop: '1rem' }}>
                  {data.sentimentData.headlines.length > 0 ? (
                    data.sentimentData.headlines.slice(0, 8).map((item, i) => (
                      <div className="news-item" key={i}>
                        <div className={`news-item-dot ${item.sentiment_score > 0.2 ? 'bullish' : item.sentiment_score < -0.2 ? 'bearish' : 'neutral'}`} />
                        <div className="news-item-content">
                          <div className="news-item-headline">{item.headline}</div>
                          <div className="news-item-meta">
                            <span>{item.source}</span>
                            <span>•</span>
                            <span>{getTimeAgo(item.timestamp)}</span>
                          </div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem', textAlign: 'center', padding: '1rem 0' }}>
                      No news data yet. Start the engine to fetch headlines.
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem', textAlign: 'center', padding: '1.5rem 0' }}>
                Awaiting sentiment data...
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
