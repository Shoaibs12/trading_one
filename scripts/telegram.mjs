// ============================================================================
// TELEGRAM BOT SERVICE
// Handles sending notifications and receiving commands via Telegram
// Token is hardcoded — repo must be kept PRIVATE
// ============================================================================

// Hardcoded bot token (repo is private)
const TELEGRAM_BOT_TOKEN = '8859478288:AAFDynRw5UReYsVWQlxv-baBQLSr1ZafwdQ';
let TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '1321791329';

const BASE_URL = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;
let lastUpdateId = 0;

// ============================================================================
// CORE API
// ============================================================================

export function isTelegramEnabled() {
  return !!TELEGRAM_BOT_TOKEN && !!TELEGRAM_CHAT_ID;
}

export function getChatId() {
  return TELEGRAM_CHAT_ID;
}

export async function sendTelegramMessage(text, options = {}) {
  if (!TELEGRAM_BOT_TOKEN) return false;
  const chatId = options.chatId || TELEGRAM_CHAT_ID;
  if (!chatId) return false;

  const url = `${BASE_URL}/sendMessage`;
  const body = {
    chat_id: chatId,
    text,
    parse_mode: 'Markdown',
    disable_web_page_preview: true,
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Telegram send failed:', response.status, errorText);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Telegram send error:', error.message);
    return false;
  }
}

// ============================================================================
// FORMATTED MESSAGES
// ============================================================================

function fmt(n) {
  return `$${Number(n).toFixed(2)}`;
}

function pctFmt(n) {
  return `${(Number(n) * 100).toFixed(2)}%`;
}

export function formatTradeOpenMessage(trade) {
  const emoji = trade.type === 'BUY' ? '🟢' : '🔴';
  return [
    `${emoji} *NEW TRADE OPENED*`,
    ``,
    `📊 *${trade.asset}* — ${trade.type}`,
    `💰 Entry Price: ${fmt(trade.entry_price)}`,
    `📏 Position Size: ${fmt(trade.trade_size)}`,
    `🕐 Time: ${new Date(trade.timestamp).toLocaleString()}`,
    ``,
    trade.ai_insight ? `🤖 _${trade.ai_insight}_` : '',
  ].filter(Boolean).join('\n');
}

export function formatTradeCloseMessage(trade) {
  const isProfit = trade.profit_loss > 0;
  const emoji = isProfit ? '✅' : '❌';
  const profitPct = ((trade.profit_loss / trade.trade_size) * 100).toFixed(2);

  return [
    `${emoji} *TRADE CLOSED* — ${isProfit ? 'PROFIT' : 'LOSS'}`,
    ``,
    `📊 *${trade.asset}* — ${trade.type}`,
    `💰 Entry: ${fmt(trade.entry_price)}`,
    `🏁 Exit: ${fmt(trade.exit_price)}`,
    `📏 Size: ${fmt(trade.trade_size)}`,
    `${isProfit ? '💵' : '💸'} P/L: ${fmt(trade.profit_loss)} (${profitPct}%)`,
    `🕐 Closed: ${new Date(trade.close_timestamp).toLocaleString()}`,
    ``,
    trade.ai_insight ? `🤖 _${trade.ai_insight}_` : '',
  ].filter(Boolean).join('\n');
}

export function formatStatusMessage(data) {
  const vault = data.vault;
  const stats = data.stats;
  const systemState = data.systemState;
  const openTrades = (data.recentTrades || []).filter(t => t.status === 'OPEN');
  const pnl = vault.current_balance - vault.initial_balance;
  const pnlPct = ((pnl / vault.initial_balance) * 100).toFixed(2);
  const pnlEmoji = pnl >= 0 ? '📈' : '📉';

  let msg = [
    `🤖 *GHOST RUN — STATUS REPORT*`,
    `${'─'.repeat(30)}`,
    ``,
    `💰 *Vault*`,
    `   Initial: ${fmt(vault.initial_balance)}`,
    `   Current: ${fmt(vault.current_balance)}`,
    `   Available: ${fmt(vault.available_balance)}`,
    `   Invested: ${fmt(vault.invested_balance)}`,
    `   ${pnlEmoji} Total P/L: ${fmt(pnl)} (${pnlPct}%)`,
    ``,
    `📊 *Performance*`,
    `   Wins: ${stats.wins} | Losses: ${stats.losses}`,
    `   Win Rate: ${stats.winRate.toFixed(1)}%`,
    `   Profit Factor: ${stats.profitFactor === Infinity ? '∞' : stats.profitFactor.toFixed(2)}`,
    `   Sharpe Ratio: ${(stats.sharpeRatio || 0).toFixed(2)}`,
    `   Max Drawdown: ${(stats.maxDrawdown || 0).toFixed(2)}%`,
    ``,
    `⚙️ *System State*`,
    `   Confidence: ${systemState.confidence_threshold}`,
    `   Stop Loss: ${pctFmt(systemState.stop_loss_percentage)}`,
    `   Take Profit: ${pctFmt(systemState.profit_target_percentage)}`,
    `   Consecutive Losses: ${systemState.consecutive_losses}`,
  ];

  if (openTrades.length > 0) {
    msg.push(``, `📌 *Open Trades (${openTrades.length})*`);
    for (const t of openTrades) {
      msg.push(`   • ${t.type} ${t.asset} @ ${fmt(t.entry_price)} (${fmt(t.trade_size)})`);
    }
  } else {
    msg.push(``, `📌 _No open trades_`);
  }

  // Sentiment data
  if (data.sentimentData) {
    const s = data.sentimentData;
    msg.push(
      ``,
      `🧠 *Market Sentiment*`,
      `   News Score: ${(s.overallScore || 0).toFixed(2)}`,
      `   Fear & Greed: ${(s.fearGreedIndex || 50).toFixed(0)}`,
      `   Regime: ${s.marketRegime || 'N/A'}`,
    );
  }

  return msg.join('\n');
}

export function formatDailyPnlMessage(dailyPnl, vault) {
  if (!dailyPnl) return '📅 _No daily PnL data available yet._';
  
  const pnl = dailyPnl.total_pnl || 0;
  const emoji = pnl >= 0 ? '📈' : '📉';
  const targetEmoji = dailyPnl.target_hit ? '🎯' : '⏳';

  return [
    `📅 *DAILY P/L REPORT*`,
    `${'─'.repeat(30)}`,
    ``,
    `📆 Date: ${dailyPnl.date}`,
    `💰 Starting Balance: ${fmt(dailyPnl.starting_balance)}`,
    `${emoji} P/L: ${fmt(pnl)}`,
    `📊 Trades: ${dailyPnl.trade_count || 0}`,
    `✅ Wins: ${dailyPnl.win_count || 0} | ❌ Losses: ${dailyPnl.loss_count || 0}`,
    `${targetEmoji} Daily Target: ${dailyPnl.target_hit ? 'HIT! ✨' : 'In Progress'}`,
  ].join('\n');
}

// ============================================================================
// PERIODIC STATUS (condensed version for auto-broadcast)
// ============================================================================

export function formatPeriodicStatus(data) {
  if (!data || !data.vault) return null;

  const vault = data.vault;
  const pnl = vault.current_balance - vault.initial_balance;
  const pnlPct = ((pnl / vault.initial_balance) * 100).toFixed(2);
  const pnlEmoji = pnl >= 0 ? '📈' : '📉';
  const openTrades = (data.recentTrades || []).filter(t => t.status === 'OPEN');
  const stats = data.stats || {};
  
  // Get latest price
  const candles = data.recentCandles || [];
  const latestPrice = candles.length > 0 ? candles[candles.length - 1]?.close : null;

  let msg = [
    `⏰ *PERIODIC STATUS UPDATE*`,
    `${'─'.repeat(28)}`,
    ``,
    latestPrice ? `💲 BTC: ${fmt(latestPrice)}` : '',
    `💰 Balance: ${fmt(vault.current_balance)}`,
    `${pnlEmoji} P/L: ${fmt(pnl)} (${pnlPct}%)`,
    `📊 W/L: ${stats.wins || 0}/${stats.losses || 0} (${(stats.winRate || 0).toFixed(0)}%)`,
    `📌 Open: ${openTrades.length} trade${openTrades.length !== 1 ? 's' : ''}`,
    ``,
    `🕐 ${new Date().toLocaleString()}`,
  ].filter(Boolean).join('\n');

  return msg;
}

// ============================================================================
// COMMAND POLLING (receive commands from Telegram)
// Always polls even without CHAT_ID — enables auto-registration
// ============================================================================

export async function pollForCommands() {
  // Always poll if we have a token — this enables auto-registration
  if (!TELEGRAM_BOT_TOKEN) return [];

  try {
    const url = `${BASE_URL}/getUpdates?offset=${lastUpdateId + 1}&timeout=5&allowed_updates=["message"]`;
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
    
    if (!response.ok) return [];
    
    const data = await response.json();
    if (!data.ok || !data.result || data.result.length === 0) return [];

    const commands = [];

    for (const update of data.result) {
      lastUpdateId = update.update_id;

      if (update.message && update.message.text) {
        const chatId = update.message.chat.id.toString();
        const text = update.message.text.trim().toLowerCase();
        const fromUser = update.message.from?.first_name || 'User';

        // Auto-register chat ID if not set
        if (!TELEGRAM_CHAT_ID) {
          TELEGRAM_CHAT_ID = chatId;
          console.log(`[Telegram] ✅ Auto-registered chat ID: ${chatId} (from: ${fromUser})`);
          await sendTelegramMessage(
            `✅ *Ghost Run Trading Bot Connected!*\n\n` +
            `Welcome, ${fromUser}! Your chat ID has been registered.\n\n` +
            `🆔 Chat ID: \`${chatId}\`\n\n` +
            `⚡ *Mode: Aggressive Scalping*\n` +
            `📊 Trades every few minutes, tight TP/SL\n\n` +
            `⚠️ *To persist across restarts:*\n` +
            `Set \`TELEGRAM_CHAT_ID=${chatId}\` in Render env vars\n\n` +
            `Available commands:\n` +
            `/status — View vault & performance\n` +
            `/trades — View recent trades\n` +
            `/daily — Today's P/L summary\n` +
            `/price — Current BTC price\n` +
            `/sentiment — Market sentiment\n` +
            `/help — Show all commands`,
            { chatId }
          );
        }

        // Only process commands from the registered chat
        if (chatId === TELEGRAM_CHAT_ID) {
          commands.push({ command: text, chatId, fromUser });
        }
      }
    }

    return commands;
  } catch (error) {
    // Polling errors are non-critical
    if (error.name !== 'AbortError') {
      console.error('Telegram poll error:', error.message);
    }
    return [];
  }
}

// ============================================================================
// STARTUP MESSAGE
// ============================================================================

export async function sendStartupMessage() {
  if (!TELEGRAM_BOT_TOKEN) {
    console.log('[Telegram] No bot token — notifications disabled.');
    return;
  }

  if (!TELEGRAM_CHAT_ID) {
    console.log('[Telegram] ⚠️  No CHAT_ID set — polling for auto-registration...');
    console.log('[Telegram] 👉 Send /start to your bot on Telegram to connect!');
    return;
  }

  await sendTelegramMessage(
    `🚀 *Ghost Run Trading Engine Started!*\n\n` +
    `⚡ *Mode: Aggressive Scalping*\n` +
    `🕐 ${new Date().toLocaleString()}\n` +
    `📡 Monitoring BTC/USD on Binance\n` +
    `⏱️ Tick interval: ${process.env.TICK_INTERVAL_MS || 1500}ms\n\n` +
    `You'll get notifications for every trade open/close.\n` +
    `Plus status updates every 5 minutes.\n\n` +
    `Type /help for available commands.`
  );
}
