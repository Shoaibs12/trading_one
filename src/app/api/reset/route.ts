import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { initDB } from '@/lib/db';

export async function POST() {
  try {
    // Clear all trades
    db.prepare('DELETE FROM trades').run();
    // Clear market data
    db.prepare('DELETE FROM market_data').run();
    // Clear daily PnL
    db.prepare('DELETE FROM daily_pnl').run();

    // Reset vault to initial balance
    db.prepare(`
      UPDATE vault
      SET current_balance = initial_balance,
          available_balance = initial_balance,
          invested_balance = 0
      WHERE id = 1
    `).run();

    // Reset system state to aggressive scalping defaults
    db.prepare(`
      UPDATE system_state
      SET confidence_threshold = 0.10,
          profit_target_percentage = 0.001,
          stop_loss_percentage = 0.002,
          trailing_stop_distance = 0.0005,
          breakeven_trigger = 0.0005,
          max_position_percentage = 0.30,
          consecutive_losses = 0,
          cooldown_until = 0
      WHERE id = 1
    `).run();

    // Re-initialize daily PnL for today
    const today = new Date().toISOString().split('T')[0];
    const vault = db.prepare('SELECT current_balance FROM vault WHERE id = 1').get() as any;
    db.prepare('INSERT OR IGNORE INTO daily_pnl (date, starting_balance, total_pnl) VALUES (?, ?, 0)')
      .run(today, vault.current_balance);

    return NextResponse.json({ success: true, message: 'Vault and trades reset successfully' });
  } catch (error: any) {
    console.error('Reset error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
