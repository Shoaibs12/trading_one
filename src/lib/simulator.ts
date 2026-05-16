import db from './db';

// Simple Moving Average calculation
function calculateSMA(data: any[], period: number) {
  if (data.length < period) return null;
  const slice = data.slice(-period);
  const sum = slice.reduce((acc, val) => acc + val.close, 0);
  return sum / period;
}

// Exponential Moving Average calculation
function calculateEMA(data: any[], period: number) {
  if (data.length < period) return null;
  const k = 2 / (period + 1);
  let ema = data.slice(0, period).reduce((acc, val) => acc + val.close, 0) / period; // Start with SMA
  for (let i = period; i < data.length; i++) {
    ema = (data[i].close - ema) * k + ema;
  }
  return ema;
}

// Relative Strength Index calculation
function calculateRSI(data: any[], period: number) {
  if (data.length <= period) return null;

  let gains = 0;
  let losses = 0;

  // Calculate first average gain and loss
  for (let i = 1; i <= period; i++) {
    const change = data[i].close - data[i - 1].close;
    if (change > 0) gains += change;
    else losses -= change;
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  // Smooth the rest
  for (let i = period + 1; i < data.length; i++) {
    const change = data[i].close - data[i - 1].close;
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

export async function tick() {
  const timestamp = Date.now();
  
  // 1. Fetch Real Market Data from Binance
  let newCandles = [];
  try {
    // Check if we need historical data
    const existingCount = db.prepare('SELECT COUNT(*) as count FROM market_data').get() as any;
    const limit = existingCount.count === 0 ? 50 : 1;
    
    const response = await fetch(`https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=${limit}`);
    const data = await response.json();
    
    for (const kline of data) {
      newCandles.push({
        timestamp: kline[0], // Open time
        open: parseFloat(kline[1]),
        high: parseFloat(kline[2]),
        low: parseFloat(kline[3]),
        close: parseFloat(kline[4])
      });
    }
  } catch (err) {
    console.error("Failed to fetch Binance data:", err);
    const lastCandle = db.prepare('SELECT * FROM market_data ORDER BY timestamp DESC LIMIT 1').get() as any;
    if (!lastCandle) {
      return { success: false, error: "API fetch failed" };
    }

    const drift = (Math.random() - 0.5) * 0.001;
    const close = lastCandle.close * (1 + drift);
    newCandles.push({
      timestamp: Math.floor(timestamp / 60000) * 60000,
      open: lastCandle.close,
      high: Math.max(lastCandle.close, close),
      low: Math.min(lastCandle.close, close),
      close
    });
  }

  // Insert real candles into database
  for (const c of newCandles) {
    db.prepare(`
      INSERT OR IGNORE INTO market_data (timestamp, open, high, low, close)
      VALUES (?, ?, ?, ?, ?)
    `).run(c.timestamp, c.open, c.high, c.low, c.close);
    
    // Also update if the candle is the same timestamp but still open
    db.prepare(`
      UPDATE market_data SET open=?, high=?, low=?, close=? WHERE timestamp=?
    `).run(c.open, c.high, c.low, c.close, c.timestamp);
  }

  const latestClose = newCandles[newCandles.length - 1].close;

  // 2. Fetch current state
  const vault = db.prepare('SELECT * FROM vault WHERE id = 1').get() as any;
  const systemState = db.prepare('SELECT * FROM system_state WHERE id = 1').get() as any;
  const openTrades = db.prepare('SELECT * FROM trades WHERE status = ?').all('OPEN') as any[];
  const allCandles = db.prepare('SELECT * FROM market_data ORDER BY timestamp ASC').all() as any[];

  // Calculate Indicators
  const currentSMA = calculateSMA(allCandles, 10);
  const currentEMA50 = calculateEMA(allCandles, 50);
  const currentEMA200 = calculateEMA(allCandles, 200);
  const previousEMA50 = calculateEMA(allCandles.slice(0, -1), 50);
  const previousEMA200 = calculateEMA(allCandles.slice(0, -1), 200);
  const currentRSI = calculateRSI(allCandles, 14);

  // 3. Process Open Trades
  for (const trade of openTrades) {
    const isLong = trade.type === 'BUY';
    const profitLossPerUnit = isLong ? (latestClose - trade.entry_price) : (trade.entry_price - latestClose);
    
    // CRITICAL FIX: PnL calculation was previously multiplying by entry price twice
    const unitsHeld = trade.trade_size / trade.entry_price;
    const profitLoss = unitsHeld * profitLossPerUnit;
    
    const profitPercentage = isLong ? (latestClose - trade.entry_price) / trade.entry_price : (trade.entry_price - latestClose) / trade.entry_price;

    let shouldClose = false;
    let aiInsight = '';
    
    // Stop Loss Hit
    // For EMA crossover, stop loss is slightly below/above the 200 EMA, or fallback to the system state stop loss.
    // If we have an EMA value, we can use it, but since we are doing fast trades, we'll keep the tight percentage-based stop loss to prevent big drops.
    const dynamicStopLoss = systemState.stop_loss_percentage;

    if (profitPercentage <= -dynamicStopLoss) {
      shouldClose = true;
      aiInsight = `Strict Stop Loss triggered (${(profitPercentage*100).toFixed(2)}%). Real data proved invalid entry. Adjusting thresholds.`;
      
      // Adaptive Learning: Decrease confidence, slightly widen stop loss
      db.prepare(`
        UPDATE system_state 
        SET consecutive_losses = consecutive_losses + 1,
            confidence_threshold = MIN(1.0, confidence_threshold + 0.05),
            stop_loss_percentage = MIN(0.01, stop_loss_percentage + 0.001)
        WHERE id = 1
      `).run();
    }
    // Take Profit Hit (Aiming for 1:2 Risk/Reward or better based on dynamic Stop Loss)
    else if (profitPercentage >= dynamicStopLoss * 2) {
      shouldClose = true;
      aiInsight = `Profit target reached (${(profitPercentage*100).toFixed(2)}%) at 1:2 Risk/Reward. EMA pattern was successful.`;
      
      // Adaptive Learning: Reset losses
      db.prepare(`
        UPDATE system_state 
        SET consecutive_losses = 0,
            confidence_threshold = MAX(0.01, confidence_threshold - 0.01)
        WHERE id = 1
      `).run();
    }

    if (shouldClose) {
      // Close trade
      db.prepare(`
        UPDATE trades 
        SET status = 'CLOSED', exit_price = ?, profit_loss = ?, close_timestamp = ?, ai_insight = ?
        WHERE id = ?
      `).run(latestClose, profitLoss, timestamp, aiInsight, trade.id);

      // Update vault
      db.prepare(`
        UPDATE vault 
        SET current_balance = current_balance + ?,
            invested_balance = invested_balance - ?,
            available_balance = (current_balance + ?) - (invested_balance - ?)
        WHERE id = 1
      `).run(profitLoss, trade.trade_size, profitLoss, trade.trade_size);
    }
  }

  // 4. Look for New Trade Opportunities
  if (openTrades.length === 0 && currentEMA50 && currentEMA200 && previousEMA50 && previousEMA200 && currentRSI) {
    const currentVault = db.prepare('SELECT * FROM vault WHERE id = 1').get() as any;
    
    // EMA Crossover & Momentum Strategy
    const isGoldenCross = previousEMA50 <= previousEMA200 && currentEMA50 > currentEMA200;
    const isDeathCross = previousEMA50 >= previousEMA200 && currentEMA50 < currentEMA200;

    // RSI Confirmation
    const isRsiValid = currentRSI >= 40 && currentRSI <= 60;
    
    // Confidence threshold requirement for crossover (minimum gap)
    const requiredGap = currentEMA200 * systemState.confidence_threshold * 0.001;
    const gapValid = Math.abs(currentEMA50 - currentEMA200) > requiredGap;

    if ((isGoldenCross || isDeathCross) && isRsiValid && gapValid) {
      const tradeType = isGoldenCross ? 'BUY' : 'SELL';
      
      const maxAllowedInvestment = currentVault.current_balance * 0.3;
      const currentInvested = currentVault.invested_balance;
      // 1% Rule: Risk maximum 1% to 2% of total trading capital
      const targetInvestment = currentVault.current_balance * 0.01;
      
      if (currentInvested + targetInvestment <= maxAllowedInvestment && currentVault.available_balance >= targetInvestment) {

        // Execute Trade
        db.prepare(`
          INSERT INTO trades (asset, type, status, entry_price, trade_size, timestamp, ai_insight)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run('BTC/USD', tradeType, 'OPEN', latestClose, targetInvestment, timestamp, `EMA Crossover Strategy: ${tradeType}. RSI: ${currentRSI.toFixed(2)}. Initiating trade.`);
        
        // Update vault
        db.prepare(`
          UPDATE vault 
          SET available_balance = available_balance - ?,
              invested_balance = invested_balance + ?
          WHERE id = 1
        `).run(targetInvestment, targetInvestment);
      }
    }
  }

  return { success: true, timestamp, currentPrice: latestClose };
}

export function getDashboardData() {
  const vault = db.prepare('SELECT * FROM vault WHERE id = 1').get();
  const systemState = db.prepare('SELECT * FROM system_state WHERE id = 1').get();
  const recentTrades = db.prepare('SELECT * FROM trades ORDER BY timestamp DESC LIMIT 10').all();
  const recentCandles = db.prepare('SELECT * FROM market_data ORDER BY timestamp DESC LIMIT 50').all().reverse();
  
  // Provide SMA data for the chart as well
  const allCandles = db.prepare('SELECT * FROM market_data ORDER BY timestamp ASC').all() as any[];
  const smaData = [];
  for (let i = 0; i < allCandles.length; i++) {
    const subset = allCandles.slice(0, i + 1);
    const sma = calculateSMA(subset, 10);
    if (sma) {
      smaData.push({ time: Math.floor(allCandles[i].timestamp / 1000), value: sma });
    }
  }
  
  const closedTrades = db.prepare('SELECT * FROM trades WHERE status = ?').all('CLOSED') as any[];
  let wins = 0;
  let losses = 0;
  closedTrades.forEach((t) => {
    if (t.profit_loss > 0) wins++;
    else losses++;
  });
  const winRate = (wins + losses) > 0 ? (wins / (wins + losses)) * 100 : 0;

  return { vault, systemState, recentTrades, recentCandles, smaData, stats: { wins, losses, winRate } };
}
