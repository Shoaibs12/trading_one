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
      type TEXT NOT NULL, -- 'BUY' or 'SELL'
      status TEXT NOT NULL, -- 'OPEN' or 'CLOSED'
      entry_price REAL NOT NULL,
      exit_price REAL,
      trade_size REAL NOT NULL,
      profit_loss REAL,
      timestamp INTEGER NOT NULL,
      close_timestamp INTEGER,
      ai_insight TEXT
    );

    CREATE TABLE IF NOT EXISTS system_state (
      id INTEGER PRIMARY KEY,
      confidence_threshold REAL NOT NULL,
      profit_target_multiplier REAL NOT NULL,
      stop_loss_percentage REAL NOT NULL,
      consecutive_losses INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS market_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL UNIQUE,
      open REAL NOT NULL,
      high REAL NOT NULL,
      low REAL NOT NULL,
      close REAL NOT NULL
    );
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
      INSERT INTO system_state (id, confidence_threshold, profit_target_multiplier, stop_loss_percentage, consecutive_losses)
      VALUES (1, 0.25, 1.0015, 0.0015, 0)
    `).run();
  }

  db.prepare(`
    UPDATE system_state
    SET confidence_threshold = 0.25,
        profit_target_multiplier = 1.0015,
        stop_loss_percentage = 0.0015
    WHERE id = 1
      AND confidence_threshold = 0.7
      AND profit_target_multiplier = 1.1
      AND stop_loss_percentage = 0.05
      AND consecutive_losses = 0
  `).run();

  db.prepare(`
    UPDATE system_state
    SET profit_target_multiplier = 1.0015,
        stop_loss_percentage = 0.0015
    WHERE id = 1
      AND confidence_threshold = 0.25
      AND profit_target_multiplier = 1.005
      AND stop_loss_percentage = 0.003
      AND consecutive_losses = 0
  `).run();
}

initDB();

export default db;
