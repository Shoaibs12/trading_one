import db from './db';

// Simple Moving Average calculation
function calculateSMA(data: any[], period: number) {
  if (data.length < period) return null;
  const slice = data.slice(-period);
  const sum = slice.reduce((acc, val) => acc + val.close, 0);
  return sum / period;
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

  // Calculate Indicator: 10-period Simple Moving Average
  const currentSMA = calculateSMA(allCandles, 10);

  // 3. Process Open Trades
  for (const trade of openTrades) {
    const isLong = trade.type === 'BUY';
    const profitLossPerUnit = isLong ? (latestClose - trade.entry_price) : (trade.entry_price - latestClose);
    
    // CRITICAL FIX: PnL calculation was previously multiplying by entry price twice
    const unitsHeld = trade.trade_size / trade.entry_price;
    const profitLoss = unitsHeld * profitLossPerUnit;
    const scalpProfitTarget = Math.max(0.1, trade.trade_size * 0.0001); // Reduced for faster profit taking
    
    const profitPercentage = isLong ? (latestClose - trade.entry_price) / trade.entry_price : (trade.entry_price - latestClose) / trade.entry_price;

    let shouldClose = false;
    let aiInsight = '';
    
    // Stop Loss Hit
    if (profitPercentage <= -systemState.stop_loss_percentage) {
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
    // Take Profit Hit
    else if (profitPercentage >= (systemState.profit_target_multiplier - 1)) {
      shouldClose = true;
      aiInsight = `Profit target reached (${(profitPercentage*100).toFixed(2)}%). SMA pattern was successful.`;
      
      // Adaptive Learning: Reset losses
      db.prepare(`
        UPDATE system_state 
        SET consecutive_losses = 0,
            confidence_threshold = MAX(0.1, confidence_threshold - 0.01)
        WHERE id = 1
      `).run();
    }
    // Quick scalp exit for short-term simulation
    else if (profitLoss >= scalpProfitTarget) {
      shouldClose = true;
      aiInsight = `Quick scalp profit captured (+$${profitLoss.toFixed(2)}). Closing early to bank the short-term move.`;

      db.prepare(`
        UPDATE system_state
        SET consecutive_losses = 0,
            confidence_threshold = MAX(0.1, confidence_threshold - 0.005)
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
  if (openTrades.length === 0 && currentSMA) {
    const currentVault = db.prepare('SELECT * FROM vault WHERE id = 1').get() as any;
    
    // AI Indicator Logic using Real SMA and Price
    const priceDiffPercentage = Math.abs(latestClose - currentSMA) / currentSMA;
    const isUptrend = latestClose > currentSMA;
    
    // Trigger when price diverges enough from SMA to avoid tiny noise, while still
    // producing enough trades for a 1-minute simulator to learn from outcomes.
    const requiredDivergence = systemState.confidence_threshold * 0.001; // Reduced for faster trades

    if (priceDiffPercentage > requiredDivergence) {
      // Strategy: Mean Reversion. If price is far above SMA, we short. If far below, we long.
      const tradeType = isUptrend ? 'SELL' : 'BUY';
      
      const maxAllowedInvestment = currentVault.current_balance * 0.3;
      const currentInvested = currentVault.invested_balance;
      const targetInvestment = currentVault.current_balance * 0.1; // 10% per trade
      
      if (currentInvested + targetInvestment <= maxAllowedInvestment && currentVault.available_balance >= targetInvestment) {
        // Execute Trade
        db.prepare(`
          INSERT INTO trades (asset, type, status, entry_price, trade_size, timestamp, ai_insight)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run('BTC/USD', tradeType, 'OPEN', latestClose, targetInvestment, timestamp, `Price diverges from SMA by ${(priceDiffPercentage*100).toFixed(2)}%. Initiating Mean Reversion ${tradeType}.`);
        
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
