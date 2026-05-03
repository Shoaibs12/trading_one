'use client';

import { useState, useEffect } from 'react';
import { Activity, Briefcase, TrendingUp, TrendingDown, RefreshCw, AlertCircle, Play, Square } from 'lucide-react';
import dynamic from 'next/dynamic';
const Chart = dynamic(() => import('./Chart'), { ssr: false });

export default function Dashboard() {
  const [data, setData] = useState<any>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [loading, setLoading] = useState(true);

  // Fetch initial data
  useEffect(() => {
    fetch('/api/data')
      .then((res) => res.json())
      .then((json) => {
        setData(json);
        setLoading(false);
      });
  }, []);

  // Simulation loop
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isRunning) {
      interval = setInterval(() => {
        fetch('/api/tick', { method: 'POST' })
          .then((res) => res.json())
          .then((json) => setData(json));
      }, 3000); // Tick every 3 seconds for observation
    }
    return () => clearInterval(interval);
  }, [isRunning]);

  if (loading || !data) {
    return <div className="container" style={{ textAlign: 'center', paddingTop: '5rem' }}>Loading Dashboard...</div>;
  }

  const { vault, systemState, recentTrades, recentCandles, stats } = data;
  const totalProfit = vault.current_balance - vault.initial_balance;
  const profitPercentage = ((vault.current_balance - vault.initial_balance) / vault.initial_balance) * 100;
  
  const currentPrice = recentCandles.length > 0 ? recentCandles[recentCandles.length - 1].close : null;

  return (
    <div className="container">
      <header className="header">
        <h1><Activity color="var(--accent-color)" /> Ghost Run Simulator</h1>
        <div className="controls">
          {isRunning && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--success-color)' }}>
              <div className="pulse"></div> Live Simulating
            </div>
          )}
          <button 
            className="button" 
            onClick={() => setIsRunning(!isRunning)}
            style={{ backgroundColor: isRunning ? 'var(--warning-color)' : 'var(--success-color)' }}
          >
            {isRunning ? <><Square size={16} /> Pause</> : <><Play size={16} /> Start Simulation</>}
          </button>
        </div>
      </header>

      <div className="dashboard-grid">
        <div className="main-col" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          
          <div className="panel">
            <h2 className="panel-title">Asset Tracker: BTC/USD</h2>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
               <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Pattern Confidence Threshold: {(systemState.confidence_threshold * 100).toFixed(0)}%</span>
               <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Target: {systemState.profit_target_multiplier}x | SL: {systemState.stop_loss_percentage * 100}%</span>
            </div>
            {recentCandles.length > 0 ? (
              <Chart data={recentCandles} smaData={data.smaData} />
            ) : (
              <div style={{ height: '400px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>No market data yet</div>
            )}
          </div>

          <div className="panel">
            <h2 className="panel-title">Trade History & AI Learning Log</h2>
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Asset</th>
                    <th>Type</th>
                    <th>Entry</th>
                    <th>Exit</th>
                    <th>Profit/Loss</th>
                    <th>AI Insight</th>
                  </tr>
                </thead>
                <tbody>
                  {recentTrades.map((trade: any) => (
                    <tr key={trade.id}>
                      <td>{new Date(trade.timestamp).toLocaleTimeString()}</td>
                      <td>{trade.asset}</td>
                      <td>
                        <span className={`badge ${trade.type.toLowerCase()}`}>{trade.type}</span>
                      </td>
                      <td>${trade.entry_price.toFixed(2)}</td>
                      <td>{trade.exit_price ? `$${trade.exit_price.toFixed(2)}` : '-'}</td>
                      <td>
                        {trade.status === 'OPEN' ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <span className="badge open">OPEN</span>
                            {currentPrice && (() => {
                              const priceDifference = trade.type === 'BUY' ? (currentPrice - trade.entry_price) : (trade.entry_price - currentPrice);
                              const unitsHeld = trade.trade_size / trade.entry_price;
                              const currentProfit = unitsHeld * priceDifference;
                              return (
                                <span style={{ 
                                  color: currentProfit > 0 ? 'var(--success-color)' : 'var(--danger-color)', 
                                  fontSize: '0.85rem', fontWeight: 600 
                                }}>
                                  {currentProfit > 0 ? '+' : ''}${currentProfit.toFixed(2)}
                                </span>
                              );
                            })()}
                          </div>
                        ) : (
                          <span style={{ color: trade.profit_loss > 0 ? 'var(--success-color)' : 'var(--danger-color)', fontWeight: 600 }}>
                            {trade.profit_loss > 0 ? '+' : ''}${trade.profit_loss.toFixed(2)}
                          </span>
                        )}
                      </td>
                      <td>
                        {trade.ai_insight && <div className="ai-insight">{trade.ai_insight}</div>}
                      </td>
                    </tr>
                  ))}
                  {recentTrades.length === 0 && (
                    <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>No trades executed yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="side-col" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div className="panel">
            <h2 className="panel-title"><Briefcase size={18} /> Vault Status</h2>
            <div className="stats-grid">
              <div className="stat-box">
                <div className="stat-label">Total Balance</div>
                <div className="stat-value">${vault.current_balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
              </div>
              <div className="stat-box">
                <div className="stat-label">Initial Balance</div>
                <div className="stat-value" style={{ color: 'var(--text-secondary)' }}>${vault.initial_balance.toLocaleString()}</div>
              </div>
              <div className="stat-box">
                <div className="stat-label">Available to Invest</div>
                <div className="stat-value">${vault.available_balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
              </div>
              <div className="stat-box">
                <div className="stat-label">Currently Invested</div>
                <div className="stat-value" style={{ color: 'var(--warning-color)' }}>${vault.invested_balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
              </div>
            </div>
            
            <div style={{ marginTop: '1.5rem', paddingTop: '1.5rem', borderTop: '1px solid var(--border-color)' }}>
              <div className="stat-label">Total Profit/Loss</div>
              <div className={`stat-value ${totalProfit >= 0 ? 'success' : 'danger'}`} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                {totalProfit >= 0 ? <TrendingUp size={24} /> : <TrendingDown size={24} />}
                {totalProfit >= 0 ? '+' : '-'}${Math.abs(totalProfit).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                <span style={{ fontSize: '0.9rem', opacity: 0.8 }}>({profitPercentage >= 0 ? '+' : ''}{profitPercentage.toFixed(2)}%)</span>
              </div>
            </div>
          </div>

          <div className="panel">
            <h2 className="panel-title">System Performance</h2>
            <div className="stats-grid">
              <div className="stat-box" style={{ gridColumn: 'span 2' }}>
                <div className="stat-label">Win/Loss Ratio</div>
                <div className="stat-value">{stats.winRate.toFixed(1)}% Win Rate</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                  {stats.wins} Wins | {stats.losses} Losses
                </div>
              </div>
              <div className="stat-box" style={{ gridColumn: 'span 2' }}>
                <div className="stat-label">Current Strategy Constraints</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.5rem', fontSize: '0.85rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Max Drawdown:</span>
                    <span>30% of Vault</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Profit Target:</span>
                    <span style={{ color: 'var(--success-color)' }}>{systemState.profit_target_multiplier}x</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Stop Loss:</span>
                    <span style={{ color: 'var(--danger-color)' }}>{(systemState.stop_loss_percentage * 100).toFixed(1)}%</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Consecutive Losses:</span>
                    <span style={{ color: systemState.consecutive_losses > 0 ? 'var(--warning-color)' : 'var(--success-color)' }}>
                      {systemState.consecutive_losses}
                    </span>
                  </div>
                </div>
              </div>
            </div>
            
            {systemState.consecutive_losses > 0 && (
              <div style={{ marginTop: '1rem', padding: '0.75rem', background: 'rgba(218, 54, 51, 0.1)', border: '1px solid var(--danger-color)', borderRadius: '6px', fontSize: '0.8rem', display: 'flex', gap: '0.5rem' }}>
                <AlertCircle size={16} color="var(--danger-color)" style={{ flexShrink: 0 }} />
                <span>AI adjusted parameters to be more conservative due to recent losses.</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
