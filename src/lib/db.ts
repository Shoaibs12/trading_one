import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

// Ensure data directory exists
const dataDir = path.join(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'trading_sim.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

// Initialize database schema
export function initDB() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS vault (
      id INTEGER PRIMARY KEY,
      initial_balance REAL NOT NULL,
      current_balance REAL NOT NULL,
      available_balance REAL NOT NULL,
      invested_balance REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asset TEXT NOT NULL,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      entry_price REAL NOT NULL,
      exit_price REAL,
      trade_size REAL NOT NULL,
      profit_loss REAL,
      timestamp INTEGER NOT NULL,
      close_timestamp INTEGER,
      ai_insight TEXT,
      trailing_stop_price REAL,
      peak_price REAL,
      strategy_signal TEXT
    );

    CREATE TABLE IF NOT EXISTS system_state (
      id INTEGER PRIMARY KEY,
      confidence_threshold REAL NOT NULL,
      profit_target_percentage REAL NOT NULL,
      stop_loss_percentage REAL NOT NULL,
      trailing_stop_distance REAL NOT NULL,
      breakeven_trigger REAL NOT NULL,
      consecutive_losses INTEGER NOT NULL DEFAULT 0,
      cooldown_until INTEGER NOT NULL DEFAULT 0,
      max_daily_loss_percentage REAL NOT NULL,
      daily_profit_target REAL NOT NULL,
      max_position_percentage REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS market_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL UNIQUE,
      open REAL NOT NULL,
      high REAL NOT NULL,
      low REAL NOT NULL,
      close REAL NOT NULL,
      volume REAL NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS daily_pnl (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL UNIQUE,
      starting_balance REAL NOT NULL,
      ending_balance REAL,
      total_pnl REAL NOT NULL DEFAULT 0,
      trade_count INTEGER NOT NULL DEFAULT 0,
      win_count INTEGER NOT NULL DEFAULT 0,
      loss_count INTEGER NOT NULL DEFAULT 0,
      target_hit INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS news_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      headline TEXT NOT NULL,
      source TEXT,
      sentiment_score REAL NOT NULL,
      category TEXT,
      impact_level TEXT
    );

    CREATE TABLE IF NOT EXISTS sentiment_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      news_sentiment REAL NOT NULL,
      fear_greed_index REAL NOT NULL,
      market_regime TEXT NOT NULL,
      headlines_analyzed INTEGER NOT NULL
    );

    -- Performance indexes
    CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status);
    CREATE INDEX IF NOT EXISTS idx_trades_timestamp ON trades(timestamp);
    CREATE INDEX IF NOT EXISTS idx_market_data_timestamp ON market_data(timestamp);
    CREATE INDEX IF NOT EXISTS idx_daily_pnl_date ON daily_pnl(date);
    CREATE INDEX IF NOT EXISTS idx_news_events_timestamp ON news_events(timestamp);
    CREATE INDEX IF NOT EXISTS idx_sentiment_timestamp ON sentiment_history(timestamp);
  `);

  // Initialize vault if empty (Starting balance: $10,000)
  const vaultRow = db.prepare('SELECT * FROM vault WHERE id = 1').get();
  if (!vaultRow) {
    db.prepare(`
      INSERT INTO vault (id, initial_balance, current_balance, available_balance, invested_balance)
      VALUES (1, 10000, 10000, 10000, 0)
    `).run();
  }

  // Initialize AI system state if empty
  const stateRow = db.prepare('SELECT * FROM system_state WHERE id = 1').get();
  if (!stateRow) {
    db.prepare(`
      INSERT INTO system_state (
        id, confidence_threshold, profit_target_percentage, stop_loss_percentage,
        trailing_stop_distance, breakeven_trigger, consecutive_losses, cooldown_until,
        max_daily_loss_percentage, daily_profit_target, max_position_percentage
      )
      VALUES (1, 0.6, 0.015, 0.008, 0.005, 0.003, 0, 0, 0.03, 10.0, 0.02)
    `).run();
    /*
     * confidence_threshold: 0.6 = minimum composite signal score to enter a trade
     * profit_target_percentage: 0.015 = 1.5% take profit
     * stop_loss_percentage: 0.008 = 0.8% hard stop loss
     * trailing_stop_distance: 0.005 = 0.5% trailing distance from peak
     * breakeven_trigger: 0.003 = 0.3% profit to move stop to breakeven
     * max_daily_loss_percentage: 0.03 = 3% max daily drawdown
     * daily_profit_target: 10.0 = $10 daily profit target
     * max_position_percentage: 0.02 = risk max 2% of vault per trade
     */
  }

  // Initialize today's daily PnL record
  const today = new Date().toISOString().split('T')[0];
  const todayPnl = db.prepare('SELECT * FROM daily_pnl WHERE date = ?').get(today);
  if (!todayPnl) {
    const vault = db.prepare('SELECT current_balance FROM vault WHERE id = 1').get() as any;
    if (vault) {
      db.prepare(`
        INSERT OR IGNORE INTO daily_pnl (date, starting_balance, total_pnl)
        VALUES (?, ?, 0)
      `).run(today, vault.current_balance);
    }
  }
}

initDB();

export default db;
