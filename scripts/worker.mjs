// ============================================================================
// GHOST RUN TRADING WORKER
// Background process: runs tick loop + Telegram bot integration
// AGGRESSIVE SCALPING MODE — trades fast, notifies on every action
// ============================================================================

import {
  sendTelegramMessage,
  isTelegramEnabled,
  getChatId,
  pollForCommands,
  sendStartupMessage,
  formatTradeOpenMessage,
  formatTradeCloseMessage,
  formatStatusMessage,
  formatDailyPnlMessage,
  formatPeriodicStatus,
} from './telegram.mjs';

const appUrl = process.env.APP_URL || 'http://127.0.0.1:3000';
const tickIntervalMs = Number(process.env.TICK_INTERVAL_MS || 1500); // Default: 1.5s for scalping

let isTicking = false;
let tradeState = new Map();
let initialized = false;
let lastDashboardData = null;
let tickCount = 0;
let lastPeriodicStatusTime = 0;

const PERIODIC_STATUS_INTERVAL = 5 * 60 * 1000; // 5 minutes

// ============================================================================
// TRADE CHANGE DETECTION & NOTIFICATIONS
// ============================================================================

async function notifyTradeChanges(trades) {
  // Re-check every tick — chat ID may be registered mid-session
  if (!isTelegramEnabled()) return;

  // On first tick, just record current state without notifying
  if (!initialized) {
    trades.forEach((trade) => tradeState.set(trade.id, { ...trade }));
    initialized = true;
    return;
  }

  for (const trade of trades) {
    const previous = tradeState.get(trade.id);

    if (!previous) {
      // New trade appeared — it just opened
      if (trade.status === 'OPEN') {
        await sendTelegramMessage(formatTradeOpenMessage(trade));
        console.log(`[Telegram] 🟢 Notified: Trade #${trade.id} OPENED`);
      } else if (trade.status === 'CLOSED') {
        // Trade opened and closed between ticks
        await sendTelegramMessage(formatTradeCloseMessage(trade));
        console.log(`[Telegram] ⚡ Notified: Trade #${trade.id} CLOSED (fast)`);
      }
    } else if (previous.status === 'OPEN' && trade.status === 'CLOSED') {
      // Trade was open, now closed
      await sendTelegramMessage(formatTradeCloseMessage(trade));
      console.log(`[Telegram] ✅ Notified: Trade #${trade.id} CLOSED`);
    }

    tradeState.set(trade.id, { ...trade });
  }
}

// ============================================================================
// PERIODIC STATUS BROADCAST
// ============================================================================

async function sendPeriodicStatus() {
  if (!isTelegramEnabled() || !lastDashboardData) return;

  const now = Date.now();
  if (now - lastPeriodicStatusTime < PERIODIC_STATUS_INTERVAL) return;

  lastPeriodicStatusTime = now;

  const msg = formatPeriodicStatus(lastDashboardData);
  if (msg) {
    await sendTelegramMessage(msg);
    console.log(`[Telegram] ⏰ Sent periodic status update`);
  }
}

// ============================================================================
// TELEGRAM COMMAND HANDLER
// ============================================================================

async function handleCommands() {
  const commands = await pollForCommands();

  for (const { command, chatId } of commands) {
    try {
      switch (true) {
        case command === '/status' || command === '/start': {
          if (!lastDashboardData) {
            await sendTelegramMessage('⏳ _Waiting for first tick data..._', { chatId });
            break;
          }
          await sendTelegramMessage(formatStatusMessage(lastDashboardData), { chatId });
          break;
        }

        case command === '/trades': {
          if (!lastDashboardData || !lastDashboardData.recentTrades) {
            await sendTelegramMessage('⏳ _No trade data available yet._', { chatId });
            break;
          }

          const trades = lastDashboardData.recentTrades.slice(0, 10); // Show 10 instead of 5
          if (trades.length === 0) {
            await sendTelegramMessage('📋 _No trades yet._', { chatId });
            break;
          }

          let msg = '📋 *RECENT TRADES (Last 10)*\n' + '─'.repeat(30) + '\n';
          for (const t of trades) {
            const emoji = t.status === 'OPEN' ? '🔵' : (t.profit_loss > 0 ? '✅' : '❌');
            const pnl = t.profit_loss != null ? `P/L: $${Number(t.profit_loss).toFixed(2)}` : 'OPEN';
            msg += `\n${emoji} ${t.type} ${t.asset} @ $${Number(t.entry_price).toFixed(2)}\n`;
            msg += `   Size: $${Number(t.trade_size).toFixed(2)} | ${pnl}\n`;
          }
          await sendTelegramMessage(msg, { chatId });
          break;
        }

        case command === '/daily': {
          if (!lastDashboardData) {
            await sendTelegramMessage('⏳ _Waiting for first tick data..._', { chatId });
            break;
          }
          await sendTelegramMessage(
            formatDailyPnlMessage(lastDashboardData.dailyPnl, lastDashboardData.vault),
            { chatId }
          );
          break;
        }

        case command === '/price': {
          if (!lastDashboardData || !lastDashboardData.recentCandles) {
            await sendTelegramMessage('⏳ _Waiting for price data..._', { chatId });
            break;
          }
          const candles = lastDashboardData.recentCandles;
          const latest = candles[candles.length - 1];
          if (latest) {
            await sendTelegramMessage(
              `💲 *BTC/USD Price*\n\n` +
              `Price: $${Number(latest.close).toFixed(2)}\n` +
              `High: $${Number(latest.high).toFixed(2)}\n` +
              `Low: $${Number(latest.low).toFixed(2)}\n` +
              `🕐 ${new Date(latest.timestamp).toLocaleString()}`,
              { chatId }
            );
          }
          break;
        }

        case command === '/sentiment': {
          if (!lastDashboardData || !lastDashboardData.sentimentData) {
            await sendTelegramMessage('🧠 _No sentiment data available yet._', { chatId });
            break;
          }
          const s = lastDashboardData.sentimentData;
          let msg = [
            `🧠 *MARKET SENTIMENT*`,
            `${'─'.repeat(30)}`,
            ``,
            `📰 News Score: ${(s.overallScore || 0).toFixed(2)}`,
            `😰 Fear & Greed: ${(s.fearGreedIndex || 50).toFixed(0)}/100`,
            `🏷️ Regime: ${s.marketRegime || 'N/A'}`,
          ];

          if (s.headlines && s.headlines.length > 0) {
            msg.push(``, `📰 *Recent Headlines:*`);
            for (const h of s.headlines.slice(0, 5)) {
              const sentEmoji = h.sentiment_score > 0 ? '🟢' : h.sentiment_score < 0 ? '🔴' : '⚪';
              msg.push(`${sentEmoji} ${h.headline}`);
            }
          }
          await sendTelegramMessage(msg.join('\n'), { chatId });
          break;
        }

        case command === '/reset': {
          try {
            const res = await fetch(`${appUrl}/api/reset`, { method: 'POST' });
            if (res.ok) {
              tradeState.clear();
              initialized = false;
              lastDashboardData = null;
              await sendTelegramMessage('🔄 *System Reset Complete!*\n\nVault reset to $10,000. All trades cleared.', { chatId });
            } else {
              await sendTelegramMessage('❌ Reset failed. Check server logs.', { chatId });
            }
          } catch (err) {
            await sendTelegramMessage(`❌ Reset error: ${err.message}`, { chatId });
          }
          break;
        }

        case command === '/help': {
          await sendTelegramMessage(
            `🤖 *Ghost Run Trading Bot — Commands*\n` +
            `${'─'.repeat(30)}\n\n` +
            `⚡ *Mode: Aggressive Scalping*\n\n` +
            `/status — Vault balance, performance stats, open trades\n` +
            `/trades — Last 10 trades with P/L\n` +
            `/daily — Today's P/L summary\n` +
            `/price — Current BTC/USD price\n` +
            `/sentiment — Market sentiment & news\n` +
            `/reset — Reset vault to $10,000 (⚠️ clears all trades)\n` +
            `/help — Show this message\n\n` +
            `📊 Auto-updates every 5 minutes\n` +
            `🔔 Real-time trade open/close alerts`,
            { chatId }
          );
          break;
        }

        default: {
          if (command.startsWith('/')) {
            await sendTelegramMessage(`❓ Unknown command: \`${command}\`\n\nType /help for available commands.`, { chatId });
          }
          break;
        }
      }
    } catch (err) {
      console.error(`[Telegram] Command error (${command}):`, err.message);
    }
  }
}

// ============================================================================
// MAIN TICK LOOP
// ============================================================================

async function runTick() {
  if (isTicking) return;

  isTicking = true;
  try {
    const response = await fetch(`${appUrl}/api/tick`, { method: 'POST' });
    const payload = await response.text();

    if (!response.ok) {
      throw new Error(`Tick failed with ${response.status}: ${payload}`);
    }

    const data = JSON.parse(payload);
    lastDashboardData = data;
    tickCount++;

    const trades = Array.isArray(data.recentTrades) ? data.recentTrades : [];
    await notifyTradeChanges(trades);

    // Periodic status broadcast every 5 minutes
    await sendPeriodicStatus();

    // Console log summary
    const trade = trades[0];
    const price = data.recentCandles
      ? `$${Number(data.recentCandles[data.recentCandles.length - 1]?.close || 0).toFixed(2)}`
      : '??';
    const balance = data.vault ? `$${Number(data.vault.current_balance).toFixed(2)}` : '??';
    const status = trade
      ? `${trade.status} ${trade.type} pnl=${trade.profit_loss ?? 'open'}`
      : 'no trade';
    const tgStatus = isTelegramEnabled() ? '📲' : '⏳';

    console.log(`[${new Date().toISOString()}] tick #${tickCount} ${tgStatus} | BTC=${price} | Balance=${balance} | ${status}`);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] tick ✗`, error.message || error);
  } finally {
    isTicking = false;
  }
}

// ============================================================================
// STARTUP
// ============================================================================

console.log('═'.repeat(50));
console.log('  🤖 GHOST RUN TRADING ENGINE — SCALPING MODE');
console.log(`  📡 Server: ${appUrl}`);
console.log(`  ⏱️  Tick Interval: ${tickIntervalMs}ms`);
console.log(`  📲 Telegram: ${isTelegramEnabled() ? 'CONNECTED' : 'WAITING (send /start to bot)'}`);
console.log('═'.repeat(50));

// Send startup notification
await sendStartupMessage();

// Initialize periodic status timer
lastPeriodicStatusTime = Date.now();

// Run first tick immediately
runTick();

// Main tick loop — fast for scalping
setInterval(runTick, tickIntervalMs);

// Poll for Telegram commands every 2 seconds
// IMPORTANT: This runs even without CHAT_ID — enables auto-registration
setInterval(handleCommands, 2000);

// Log reminder about Telegram connection
if (!isTelegramEnabled()) {
  console.log('\n📲 To connect Telegram:');
  console.log('   1. Open Telegram and find your bot');
  console.log('   2. Send /start');
  console.log('   3. Bot will auto-register and start sending notifications\n');
}
