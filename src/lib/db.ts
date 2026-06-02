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
      VALUES (1, 0.25, 0.005, 0.004, 0.003, 0.002, 0, 0, 0.03, 50.0, 0.03)
    `).run();
    /*
     * AGGRESSIVE SCALPING PARAMETERS:
     * confidence_threshold: 0.25 = low bar to enter trades quickly
     * profit_target_percentage: 0.005 = 0.5% take profit (grab small wins fast)
     * stop_loss_percentage: 0.004 = 0.4% hard stop loss (tight risk control)
     * trailing_stop_distance: 0.003 = 0.3% trailing distance from peak
     * breakeven_trigger: 0.002 = 0.2% profit to move stop to breakeven
     * max_daily_loss_percentage: 0.03 = 3% max daily drawdown
     * daily_profit_target: 50.0 = $50 daily profit target
     * max_position_percentage: 0.03 = risk 3% of vault per trade (bigger positions)
     */
  }

  // MIGRATION: Update existing databases to aggressive scalping parameters
  if (stateRow) {
    const existing = stateRow as any;
    // Only migrate if still on old conservative defaults
    if (existing.confidence_threshold >= 0.5 || existing.profit_target_percentage >= 0.01) {
      db.prepare(`
        UPDATE system_state SET
          confidence_threshold = 0.25,
          profit_target_percentage = 0.005,
          stop_loss_percentage = 0.004,
          trailing_stop_distance = 0.003,
          breakeven_trigger = 0.002,
          daily_profit_target = 50.0,
          max_position_percentage = 0.03,
          consecutive_losses = 0,
          cooldown_until = 0
        WHERE id = 1
      `).run();
      console.log('[DB] Migrated system_state to aggressive scalping parameters');
    }
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
