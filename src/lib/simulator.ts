import db from './db';
import {
  fetchCryptoNews,
  computeOverallSentiment,
  calculateFearGreedProxy,
  detectMarketRegime,
  storeSentimentSnapshot,
  type NewsHeadline,
  type MarketRegime,
} from './news';

// ============================================================================
// CONSTANTS
// ============================================================================

const TRADING_FEE_RATE = 0.001; // 0.1% Binance taker fee per trade (0.2% round trip)

// ============================================================================
// TECHNICAL INDICATORS
// ============================================================================

/** Exponential Moving Average */
function calculateEMA(data: number[], period: number): number[] {
  const ema: number[] = [];
  if (data.length === 0) return ema;
  const multiplier = 2 / (period + 1);
  ema[0] = data[0];
  for (let i = 1; i < data.length; i++) {
    ema[i] = (data[i] - ema[i - 1]) * multiplier + ema[i - 1];
  }
  return ema;
}

/** Simple Moving Average */
function calculateSMA(data: number[], period: number): number | null {
  if (data.length < period) return null;
  const slice = data.slice(-period);
  return slice.reduce((sum, v) => sum + v, 0) / period;
}

/** RSI (Relative Strength Index) */
function calculateRSI(closes: number[], period: number = 14): number | null {
  if (closes.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  // Initial average gain/loss
  for (let i = closes.length - period; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) gains += change;
    else losses += Math.abs(change);
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

/** MACD (Moving Average Convergence Divergence) */
function calculateMACD(closes: number[]): { macdLine: number; signalLine: number; histogram: number } | null {
  if (closes.length < 35) return null; // Need enough data for 26-period EMA + 9 signal
  const ema12 = calculateEMA(closes, 12);
  const ema26 = calculateEMA(closes, 26);
  const macdLine: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    macdLine.push(ema12[i] - ema26[i]);
  }
  const signalLine = calculateEMA(macdLine, 9);
  const lastIdx = closes.length - 1;
  return {
    macdLine: macdLine[lastIdx],
    signalLine: signalLine[lastIdx],
    histogram: macdLine[lastIdx] - signalLine[lastIdx],
  };
}

/** Bollinger Bands */
function calculateBollingerBands(closes: number[], period: number = 20, stdDevMultiplier: number = 2): { upper: number; middle: number; lower: number; width: number } | null {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  const mean = slice.reduce((s, v) => s + v, 0) / period;
  const variance = slice.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / period;
  const stdDev = Math.sqrt(variance);
  return {
    upper: mean + stdDevMultiplier * stdDev,
    middle: mean,
    lower: mean - stdDevMultiplier * stdDev,
    width: (2 * stdDevMultiplier * stdDev) / mean, // Normalized width
  };
}

/** Volume Spike Detection */
function detectVolumeSpike(volumes: number[], period: number = 20): { isSpike: boolean; ratio: number } {
  if (volumes.length < period + 1) return { isSpike: false, ratio: 1 };
  const avgVolume = volumes.slice(-(period + 1), -1).reduce((s, v) => s + v, 0) / period;
  const currentVolume = volumes[volumes.length - 1];
  if (avgVolume === 0) return { isSpike: false, ratio: 1 };
  const ratio = currentVolume / avgVolume;
  return { isSpike: ratio > 1.5, ratio };
}

// ============================================================================
// COMPOSITE SIGNAL SCORING (with News as 6th indicator)
// ============================================================================

interface IndicatorReadings {
  ema9: number | null;
  ema21: number | null;
  rsi: number | null;
  macd: { macdLine: number; signalLine: number; histogram: number } | null;
  bollingerBands: { upper: number; middle: number; lower: number; width: number } | null;
  volumeSpike: { isSpike: boolean; ratio: number };
  currentPrice: number;
  newsSentiment: number; // -1.0 to +1.0 (NEW)
}

interface SignalResult {
  score: number;         // -1.0 (strong sell) to +1.0 (strong buy)
  direction: 'BUY' | 'SELL' | 'HOLD';
  agreementCount: number; // How many indicators agree
  breakdown: {
    emaCrossover: number;
    rsi: number;
    macd: number;
    bollinger: number;
    volume: number;
    news: number;        // NEW: News sentiment contribution
  };
  insight: string;
}

function calculateCompositeSignal(indicators: IndicatorReadings): SignalResult {
  const breakdown = { emaCrossover: 0, rsi: 0, macd: 0, bollinger: 0, volume: 0, news: 0 };
  let activatedCount = 0;
  let bullishCount = 0;
  let bearishCount = 0;
  const reasons: string[] = [];

  // 1. EMA Crossover (9/21) — Weight: 20% (was 25%)
  if (indicators.ema9 !== null && indicators.ema21 !== null) {
    const emaDiff = (indicators.ema9 - indicators.ema21) / indicators.ema21;
    if (indicators.ema9 > indicators.ema21) {
      // Bullish crossover — scale by magnitude
      breakdown.emaCrossover = Math.min(1, emaDiff * 100);
      bullishCount++;
      reasons.push(`EMA9>${Math.round(indicators.ema21)} bullish`);
    } else {
      breakdown.emaCrossover = Math.max(-1, emaDiff * 100);
      bearishCount++;
      reasons.push(`EMA9<${Math.round(indicators.ema21)} bearish`);
    }
    activatedCount++;
  }

  // 2. RSI (14) — Weight: 17% (AGGRESSIVE: wider zones for faster triggers)
  if (indicators.rsi !== null) {
    if (indicators.rsi < 30) {
      // Strongly oversold — strong bullish signal
      breakdown.rsi = (30 - indicators.rsi) / 30; // 0 to 1
      bullishCount++;
      reasons.push(`RSI=${indicators.rsi.toFixed(0)} oversold`);
    } else if (indicators.rsi > 70) {
      // Strongly overbought — strong bearish signal
      breakdown.rsi = -(indicators.rsi - 70) / 30; // -1 to 0
      bearishCount++;
      reasons.push(`RSI=${indicators.rsi.toFixed(0)} overbought`);
    } else if (indicators.rsi < 40) {
      // Mildly oversold — trigger at 40 instead of 45 for more trades
      breakdown.rsi = 0.5 * (40 - indicators.rsi) / 10;
      bullishCount++;
      reasons.push(`RSI=${indicators.rsi.toFixed(0)} leaning oversold`);
    } else if (indicators.rsi > 60) {
      // Mildly overbought — trigger at 60 instead of 55 for more trades
      breakdown.rsi = -0.5 * (indicators.rsi - 60) / 10;
      bearishCount++;
      reasons.push(`RSI=${indicators.rsi.toFixed(0)} leaning overbought`);
    }
    activatedCount++;
  }

  // 3. MACD — Weight: 20% (was 25%)
  if (indicators.macd !== null) {
    const { histogram, macdLine, signalLine } = indicators.macd;
    if (histogram > 0 && macdLine > signalLine) {
      breakdown.macd = Math.min(1, Math.abs(histogram) / (Math.abs(indicators.currentPrice) * 0.001));
      bullishCount++;
      reasons.push('MACD bullish crossover');
    } else if (histogram < 0 && macdLine < signalLine) {
      breakdown.macd = -Math.min(1, Math.abs(histogram) / (Math.abs(indicators.currentPrice) * 0.001));
      bearishCount++;
      reasons.push('MACD bearish crossover');
    }
    activatedCount++;
  }

  // 4. Bollinger Bands — Weight: 13% (was 15%)
  if (indicators.bollingerBands !== null) {
    const { upper, lower, middle } = indicators.bollingerBands;
    const price = indicators.currentPrice;
    const bandRange = upper - lower;
    if (bandRange > 0) {
      const position = (price - lower) / bandRange; // 0 = at lower, 1 = at upper
      if (price <= lower) {
        // At or below lower band — bullish bounce expected
        breakdown.bollinger = Math.min(1, (lower - price) / (bandRange * 0.1) + 0.5);
        bullishCount++;
        reasons.push('Price at lower BB (bounce expected)');
      } else if (price >= upper) {
        // At or above upper band — bearish pullback expected
        breakdown.bollinger = -Math.min(1, (price - upper) / (bandRange * 0.1) + 0.5);
        bearishCount++;
        reasons.push('Price at upper BB (pullback expected)');
      } else if (position < 0.3) {
        breakdown.bollinger = 0.3;
        bullishCount++;
      } else if (position > 0.7) {
        breakdown.bollinger = -0.3;
        bearishCount++;
      }
    }
    activatedCount++;
  }

  // 5. Volume Analysis — Weight: 12% (was 15%)
  if (indicators.volumeSpike.ratio > 0) {
    if (indicators.volumeSpike.isSpike) {
      // Volume spike amplifies the existing signal direction
      const existingDirection = breakdown.emaCrossover + breakdown.rsi + breakdown.macd + breakdown.bollinger;
      breakdown.volume = existingDirection > 0 ? Math.min(1, indicators.volumeSpike.ratio / 3) : -Math.min(1, indicators.volumeSpike.ratio / 3);
      if (breakdown.volume > 0) bullishCount++;
      else bearishCount++;
      reasons.push(`Volume spike ${indicators.volumeSpike.ratio.toFixed(1)}x`);
    }
    activatedCount++;
  }

  // 6. NEWS SENTIMENT — Weight: 18% (AGGRESSIVE: lower threshold ±0.05 for more triggers)
  if (indicators.newsSentiment !== 0) {
    const sentimentAbs = Math.abs(indicators.newsSentiment);
    if (indicators.newsSentiment > 0.05) {
      // Bullish news — lowered from 0.15 to 0.05
      let newsScore = Math.min(1, indicators.newsSentiment * 1.5); // Amplify weak signals
      if (sentimentAbs > 0.5) newsScore = Math.min(1, newsScore * 1.5);
      breakdown.news = newsScore;
      bullishCount++;
      reasons.push(`News bullish (${indicators.newsSentiment.toFixed(2)})`);
    } else if (indicators.newsSentiment < -0.05) {
      // Bearish news — lowered from -0.15 to -0.05
      let newsScore = Math.max(-1, indicators.newsSentiment * 1.5); // Amplify weak signals
      if (sentimentAbs > 0.5) newsScore = Math.max(-1, newsScore * 1.5);
      breakdown.news = newsScore;
      bearishCount++;
      reasons.push(`News bearish (${indicators.newsSentiment.toFixed(2)})`);
    }
    activatedCount++;
  }

  // Weighted composite score (updated weights for 6 indicators)
  const weights = { ema: 0.20, rsi: 0.17, macd: 0.20, bollinger: 0.13, volume: 0.12, news: 0.18 };
  const score = (
    breakdown.emaCrossover * weights.ema +
    breakdown.rsi * weights.rsi +
    breakdown.macd * weights.macd +
    breakdown.bollinger * weights.bollinger +
    breakdown.volume * weights.volume +
    breakdown.news * weights.news
  );

  const agreementCount = Math.max(bullishCount, bearishCount);
  let direction: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
  // AGGRESSIVE: Only need 2 indicators to agree (was 3) for faster trade entry
  if (score > 0 && bullishCount >= 2) direction = 'BUY';
  else if (score < 0 && bearishCount >= 2) direction = 'SELL';

  return {
    score,
    direction,
    agreementCount,
    breakdown,
    insight: reasons.length > 0 ? reasons.join(', ') : 'No clear signal',
  };
}

// ============================================================================
// HELPERS
// ============================================================================

/** Fetch with retry and exponential backoff */
async function fetchWithRetry(url: string, maxRetries: number = 3): Promise<Response> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(10000),
      });
      if (response.ok) return response;
      // If rate limited or server error, retry
      if (response.status === 429 || response.status >= 500) {
        const delay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
        console.warn(`Fetch attempt ${attempt + 1} failed (HTTP ${response.status}), retrying in ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      return response; // Non-retryable error
    } catch (err) {
      if (attempt === maxRetries - 1) throw err;
      const delay = Math.pow(2, attempt) * 1000;
      console.warn(`Fetch attempt ${attempt + 1} error, retrying in ${delay}ms...`, err);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw new Error('Max retries exceeded');
}

// ============================================================================
// MAIN TICK FUNCTION
// ============================================================================

export async function tick() {
  const timestamp = Date.now();

  // 1. Fetch Real Market Data from Binance (with retry)
  let newCandles: any[] = [];
  try {
    const existingCount = db.prepare('SELECT COUNT(*) as count FROM market_data').get() as any;
    const limit = existingCount.count < 100 ? 100 : 2;

    const response = await fetchWithRetry(
      `https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=${limit}`
    );
    const data = await response.json();

    if (Array.isArray(data)) {
      for (const kline of data) {
        newCandles.push({
          timestamp: kline[0],
          open: parseFloat(kline[1]),
          high: parseFloat(kline[2]),
          low: parseFloat(kline[3]),
          close: parseFloat(kline[4]),
          volume: parseFloat(kline[5]),
        });
      }
    } else {
      console.warn('Binance API returned non-array data:', data);
      return { success: false, error: 'API rate limit or invalid data' };
    }
  } catch (err) {
    console.error('Failed to fetch Binance data:', err);
    return { success: false, error: 'API fetch failed' };
  }

  // Upsert candles into database
  const upsertStmt = db.prepare(`
    INSERT INTO market_data (timestamp, open, high, low, close, volume)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(timestamp) DO UPDATE SET open=excluded.open, high=excluded.high, low=excluded.low, close=excluded.close, volume=excluded.volume
  `);
  for (const c of newCandles) {
    upsertStmt.run(c.timestamp, c.open, c.high, c.low, c.close, c.volume);
  }

  const latestCandle = newCandles[newCandles.length - 1];
  const latestClose = latestCandle.close;

  // 2. Fetch News & Calculate Sentiment (NEW)
  let newsHeadlines: NewsHeadline[] = [];
  let newsSentimentScore = 0;
  let fearGreedData = { index: 50, label: 'Neutral', components: { volatility: 50, volume: 50, sentiment: 50, momentum: 50 } };
  let regimeData = { regime: 'RISK_ON' as MarketRegime, positionMultiplier: 1.0, description: 'Normal conditions' };

  try {
    newsHeadlines = await fetchCryptoNews();
    const sentimentResult = computeOverallSentiment(newsHeadlines);
    newsSentimentScore = sentimentResult.overallScore;

    // Get closes and volumes for Fear & Greed calculation
    const recentForFG = db.prepare('SELECT close, volume FROM market_data ORDER BY timestamp DESC LIMIT 200').all() as any[];
    const fgCloses = recentForFG.map((c: any) => c.close).reverse();
    const fgVolumes = recentForFG.map((c: any) => c.volume || 0).reverse();

    fearGreedData = calculateFearGreedProxy({
      closes: fgCloses,
      volumes: fgVolumes,
      newsSentiment: newsSentimentScore,
    });

    regimeData = detectMarketRegime(fearGreedData.index);

    // Store sentiment snapshot
    storeSentimentSnapshot({
      timestamp,
      newsSentiment: newsSentimentScore,
      fearGreedIndex: fearGreedData.index,
      marketRegime: regimeData.regime,
      headlinesAnalyzed: newsHeadlines.length,
    });
  } catch (err) {
    console.warn('News/sentiment processing error (continuing without):', err);
  }

  // 3. Fetch current state
  const vault = db.prepare('SELECT * FROM vault WHERE id = 1').get() as any;
  const systemState = db.prepare('SELECT * FROM system_state WHERE id = 1').get() as any;
  const openTrades = db.prepare('SELECT * FROM trades WHERE status = ?').all('OPEN') as any[];
  // BUG FIX #7: Only load last 200 candles instead of ALL (enough for all indicators)
  const allCandles = db.prepare('SELECT * FROM market_data ORDER BY timestamp DESC LIMIT 200').all().reverse() as any[];

  // 4. Calculate ALL indicators (including news sentiment)
  const closes = allCandles.map((c: any) => c.close);
  const volumes = allCandles.map((c: any) => c.volume || 0);

  const ema9Array = calculateEMA(closes, 9);
  const ema21Array = calculateEMA(closes, 21);

  const indicators: IndicatorReadings = {
    ema9: ema9Array.length > 0 ? ema9Array[ema9Array.length - 1] : null,
    ema21: ema21Array.length > 0 ? ema21Array[ema21Array.length - 1] : null,
    rsi: calculateRSI(closes, 14),
    macd: calculateMACD(closes),
    bollingerBands: calculateBollingerBands(closes, 20, 2),
    volumeSpike: detectVolumeSpike(volumes, 20),
    currentPrice: latestClose,
    newsSentiment: newsSentimentScore, // NEW: Feed news into signal
  };

  const signal = calculateCompositeSignal(indicators);

  // 5. Check daily loss limit
  const today = new Date().toISOString().split('T')[0];
  let dailyPnl = db.prepare('SELECT * FROM daily_pnl WHERE date = ?').get(today) as any;
  if (!dailyPnl) {
    db.prepare('INSERT OR IGNORE INTO daily_pnl (date, starting_balance, total_pnl) VALUES (?, ?, 0)').run(today, vault.current_balance);
    dailyPnl = db.prepare('SELECT * FROM daily_pnl WHERE date = ?').get(today) as any;
  }

  const dailyLossLimit = dailyPnl.starting_balance * systemState.max_daily_loss_percentage;
  const isDailyLossLimitHit = dailyPnl.total_pnl < -dailyLossLimit;

  // 6. Process Open Trades (trailing stops, take profit, stop loss)
  // BUG FIX #6: Wrap trade close operations in a transaction for atomicity
  const closeTradeTransaction = db.transaction((trade: any) => {
    const isLong = trade.type === 'BUY';
    const unitsHeld = trade.trade_size / trade.entry_price;
    const profitLossPerUnit = isLong
      ? (latestClose - trade.entry_price)
      : (trade.entry_price - latestClose);
    const grossProfitLoss = unitsHeld * profitLossPerUnit;
    const profitPercentage = isLong
      ? (latestClose - trade.entry_price) / trade.entry_price
      : (trade.entry_price - latestClose) / trade.entry_price;

    // BUG FIX #3: Deduct trading fees from P&L
    const entryFee = trade.trade_size * TRADING_FEE_RATE;
    const exitValue = unitsHeld * latestClose;
    const exitFee = exitValue * TRADING_FEE_RATE;
    const profitLoss = grossProfitLoss - entryFee - exitFee;

    // Update peak price for trailing stop
    let peakPrice = trade.peak_price || trade.entry_price;
    let trailingStopPrice = trade.trailing_stop_price;

    if (isLong) {
      if (latestClose > peakPrice) {
        peakPrice = latestClose;
        trailingStopPrice = peakPrice * (1 - systemState.trailing_stop_distance);
      }
    } else {
      if (latestClose < peakPrice) {
        peakPrice = latestClose;
        trailingStopPrice = peakPrice * (1 + systemState.trailing_stop_distance);
      }
    }

    // Move to breakeven once +breakeven_trigger% in profit (breakeven must cover 0.2% round-trip fees)
    const trueBreakevenLong = trade.entry_price * (1 + (TRADING_FEE_RATE * 2));
    const trueBreakevenShort = trade.entry_price * (1 - (TRADING_FEE_RATE * 2));

    if (profitPercentage >= systemState.breakeven_trigger && trailingStopPrice !== null) {
      if (isLong && trailingStopPrice < trueBreakevenLong) {
        trailingStopPrice = trueBreakevenLong;
      } else if (!isLong && trailingStopPrice > trueBreakevenShort) {
        trailingStopPrice = trueBreakevenShort;
      }
    }

    // Update trailing stop in DB
    db.prepare('UPDATE trades SET peak_price = ?, trailing_stop_price = ? WHERE id = ?')
      .run(peakPrice, trailingStopPrice, trade.id);

    let shouldClose = false;
    let aiInsight = '';

    // Check HARD stop loss
    if (profitPercentage <= -systemState.stop_loss_percentage) {
      shouldClose = true;
      aiInsight = `Hard Stop Loss hit at ${(profitPercentage * 100).toFixed(2)}%. ` + signal.insight;

      // Adaptive confidence — raise bar slightly after loss, NO COOLDOWN for continuous trading
      const newConsecutive = systemState.consecutive_losses + 1;
      const newConfidence = Math.min(0.5, systemState.confidence_threshold + 0.02);
      db.prepare(`
        UPDATE system_state
        SET consecutive_losses = ?,
            confidence_threshold = ?,
            cooldown_until = 0
        WHERE id = 1
      `).run(newConsecutive, newConfidence);
    }

    // BUG FIX #1: Check take-profit BEFORE trailing stop (was unreachable due to else-if)
    if (!shouldClose && profitPercentage >= systemState.profit_target_percentage) {
      shouldClose = true;
      aiInsight = `Take Profit reached at ${(profitPercentage * 100).toFixed(2)}%. ${signal.insight}`;
      // Reset to hyper-aggressive baseline after a win
      db.prepare('UPDATE system_state SET consecutive_losses = 0, confidence_threshold = 0.05, cooldown_until = 0 WHERE id = 1').run();
    }

    // Check trailing stop hit
    if (!shouldClose && trailingStopPrice !== null) {
      if (isLong && latestClose <= trailingStopPrice) {
        shouldClose = true;
        aiInsight = `Trailing stop hit at $${latestClose.toFixed(2)} (stop was $${trailingStopPrice.toFixed(2)}). P&L: ${(profitPercentage * 100).toFixed(2)}%`;
        if (profitLoss > 0) {
          db.prepare('UPDATE system_state SET consecutive_losses = 0, confidence_threshold = 0.05, cooldown_until = 0 WHERE id = 1').run();
        } else {
          const newConsecutive = systemState.consecutive_losses + 1;
          const newConfidence = Math.min(0.5, systemState.confidence_threshold + 0.02);
          db.prepare('UPDATE system_state SET consecutive_losses = ?, confidence_threshold = ?, cooldown_until = 0 WHERE id = 1')
            .run(newConsecutive, newConfidence);
        }
      } else if (!isLong && latestClose >= trailingStopPrice) {
        shouldClose = true;
        aiInsight = `Trailing stop hit at $${latestClose.toFixed(2)} (stop was $${trailingStopPrice.toFixed(2)}). P&L: ${(profitPercentage * 100).toFixed(2)}%`;
        if (profitLoss > 0) {
          db.prepare('UPDATE system_state SET consecutive_losses = 0, confidence_threshold = 0.05, cooldown_until = 0 WHERE id = 1').run();
        } else {
          const newConsecutive = systemState.consecutive_losses + 1;
          const newConfidence = Math.min(0.5, systemState.confidence_threshold + 0.02);
          db.prepare('UPDATE system_state SET consecutive_losses = ?, confidence_threshold = ?, cooldown_until = 0 WHERE id = 1')
            .run(newConsecutive, newConfidence);
        }
      }
    }

    if (shouldClose) {
      // Add sentiment context to AI insight
      if (newsSentimentScore !== 0) {
        aiInsight += ` | Sentiment: ${newsSentimentScore > 0 ? '+' : ''}${newsSentimentScore.toFixed(2)} | Regime: ${regimeData.regime}`;
      }

      // Close trade
      db.prepare(`
        UPDATE trades
        SET status = 'CLOSED', exit_price = ?, profit_loss = ?, close_timestamp = ?, ai_insight = ?
        WHERE id = ?
      `).run(latestClose, profitLoss, timestamp, aiInsight, trade.id);

      // Update vault atomically
      db.prepare('UPDATE vault SET current_balance = current_balance + ? WHERE id = 1').run(profitLoss);
      db.prepare('UPDATE vault SET invested_balance = invested_balance - ? WHERE id = 1').run(trade.trade_size);
      const updatedVault = db.prepare('SELECT * FROM vault WHERE id = 1').get() as any;
      db.prepare('UPDATE vault SET available_balance = ? WHERE id = 1')
        .run(updatedVault.current_balance - updatedVault.invested_balance);

      // Update daily PnL
      // BUG FIX #2: Don't increment trade_count here (it was already counted on open)
      const pnlUpdate = profitLoss > 0
        ? 'total_pnl = total_pnl + ?, win_count = win_count + 1, ending_balance = ?'
        : 'total_pnl = total_pnl + ?, loss_count = loss_count + 1, ending_balance = ?';
      db.prepare(`UPDATE daily_pnl SET ${pnlUpdate} WHERE date = ?`)
        .run(profitLoss, updatedVault.current_balance, today);

      // Check if daily target hit
      const updatedDailyPnl = db.prepare('SELECT * FROM daily_pnl WHERE date = ?').get(today) as any;
      if (updatedDailyPnl && updatedDailyPnl.total_pnl >= systemState.daily_profit_target) {
        db.prepare('UPDATE daily_pnl SET target_hit = 1 WHERE date = ?').run(today);
      }
    }

    return shouldClose;
  });

  for (const trade of openTrades) {
    try {
      closeTradeTransaction(trade);
    } catch (err) {
      console.error(`Failed to process trade ${trade.id}:`, err);
    }
  }

  // 7. Look for New Trade Opportunities
  const refreshedOpenTrades = db.prepare('SELECT * FROM trades WHERE status = ?').all('OPEN') as any[];
  const refreshedState = db.prepare('SELECT * FROM system_state WHERE id = 1').get() as any;

  // BUG FIX #4: Check daily target hit before allowing new trades
  const refreshedDailyPnl = db.prepare('SELECT * FROM daily_pnl WHERE date = ?').get(today) as any;
  const dailyTargetHit = refreshedDailyPnl?.target_hit === 1;

  // AGGRESSIVE: Skip cooldown if signal is very strong (score > 0.4)
  const skipCooldown = Math.abs(signal.score) > 0.4;

  const canTrade =
    refreshedOpenTrades.length === 0 &&
    !isDailyLossLimitHit &&
    !dailyTargetHit &&
    (skipCooldown || timestamp > refreshedState.cooldown_until) &&
    signal.direction !== 'HOLD' &&
    Math.abs(signal.score) >= refreshedState.confidence_threshold &&
    signal.agreementCount >= 1 && // HYPER-AGGRESSIVE: 1 indicator (was 2) for non-stop trading
    allCandles.length >= 35; // Need enough history for all indicators

  if (canTrade) {
    const currentVault = db.prepare('SELECT * FROM vault WHERE id = 1').get() as any;
    const tradeType = signal.direction;

    // Position sizing: risk max_position_percentage of vault
    const riskAmount = currentVault.current_balance * refreshedState.max_position_percentage;
    // Guard against division by zero
    const stopLossPct = Math.max(0.001, refreshedState.stop_loss_percentage);
    const positionSize = riskAmount / stopLossPct;

    // NEW: Apply regime-aware position sizing
    const regimeAdjustedSize = positionSize * regimeData.positionMultiplier;
    const targetInvestment = Math.min(regimeAdjustedSize, currentVault.available_balance * 0.5);

    if (targetInvestment >= 10 && currentVault.available_balance >= targetInvestment) {
      // Set initial trailing stop at hard stop loss distance
      const initialStopPrice = tradeType === 'BUY'
        ? latestClose * (1 - refreshedState.stop_loss_percentage)
        : latestClose * (1 + refreshedState.stop_loss_percentage);

      // Build trade insight with sentiment info
      let tradeInsight = `Score: ${signal.score.toFixed(3)} | ${signal.insight} | ${signal.agreementCount}/6 indicators agree`;
      if (newsSentimentScore !== 0) {
        tradeInsight += ` | Sentiment: ${newsSentimentScore > 0 ? '+' : ''}${newsSentimentScore.toFixed(2)} | Regime: ${regimeData.regime} (${(regimeData.positionMultiplier * 100).toFixed(0)}% size)`;
      }

      db.prepare(`
        INSERT INTO trades (asset, type, status, entry_price, trade_size, timestamp, ai_insight, trailing_stop_price, peak_price, strategy_signal)
        VALUES (?, ?, 'OPEN', ?, ?, ?, ?, ?, ?, ?)
      `).run(
        'BTC/USD', tradeType, latestClose, targetInvestment, timestamp,
        tradeInsight, initialStopPrice, latestClose,
        JSON.stringify(signal.breakdown)
      );

      // Update vault
      db.prepare('UPDATE vault SET available_balance = available_balance - ?, invested_balance = invested_balance + ? WHERE id = 1')
        .run(targetInvestment, targetInvestment);

      // Update daily trade count (only once here — BUG FIX #2)
      db.prepare('UPDATE daily_pnl SET trade_count = trade_count + 1 WHERE date = ?').run(today);
    }
  }

  return {
    success: true,
    timestamp,
    currentPrice: latestClose,
    signal: {
      score: signal.score,
      direction: signal.direction,
      agreementCount: signal.agreementCount,
      breakdown: signal.breakdown,
      insight: signal.insight,
    },
    indicators: {
      ema9: indicators.ema9,
      ema21: indicators.ema21,
      rsi: indicators.rsi,
      macd: indicators.macd,
      bollingerBands: indicators.bollingerBands,
      volumeRatio: indicators.volumeSpike.ratio,
    },
    // NEW: Return sentiment data
    sentiment: {
      overallScore: newsSentimentScore,
      fearGreedIndex: fearGreedData.index,
      fearGreedLabel: fearGreedData.label,
      marketRegime: regimeData.regime,
      regimeDescription: regimeData.description,
      positionMultiplier: regimeData.positionMultiplier,
      headlinesCount: newsHeadlines.length,
    },
  };
}

// ============================================================================
// DASHBOARD DATA
// ============================================================================

export function getDashboardData() {
  const vault = db.prepare('SELECT * FROM vault WHERE id = 1').get();
  const systemState = db.prepare('SELECT * FROM system_state WHERE id = 1').get();
  const recentTrades = db.prepare('SELECT * FROM trades ORDER BY timestamp DESC LIMIT 20').all();
  const recentCandles = db.prepare('SELECT * FROM market_data ORDER BY timestamp DESC LIMIT 100').all().reverse();

  // BUG FIX #7: Only load last 200 candles for indicator calculation
  const allCandles = db.prepare('SELECT * FROM market_data ORDER BY timestamp DESC LIMIT 200').all().reverse() as any[];
  const closes = allCandles.map((c: any) => c.close);
  const volumes = allCandles.map((c: any) => c.volume || 0);

  // EMA arrays for chart overlay
  const ema9Array = calculateEMA(closes, 9);
  const ema21Array = calculateEMA(closes, 21);

  const ema9Data = allCandles.map((c: any, i: number) => ({
    time: Math.floor(c.timestamp / 1000),
    value: ema9Array[i],
  })).filter((_: any, i: number) => i >= 8); // Only valid after enough periods

  const ema21Data = allCandles.map((c: any, i: number) => ({
    time: Math.floor(c.timestamp / 1000),
    value: ema21Array[i],
  })).filter((_: any, i: number) => i >= 20);

  // Bollinger Bands for chart
  const bbData: any[] = [];
  for (let i = 19; i < allCandles.length; i++) {
    const subCloses = closes.slice(0, i + 1);
    const bb = calculateBollingerBands(subCloses, 20, 2);
    if (bb) {
      bbData.push({
        time: Math.floor(allCandles[i].timestamp / 1000),
        upper: bb.upper,
        middle: bb.middle,
        lower: bb.lower,
      });
    }
  }

  // Get latest sentiment data
  const latestSentiment = db.prepare(
    'SELECT * FROM sentiment_history ORDER BY timestamp DESC LIMIT 1'
  ).get() as any;

  // Get recent news headlines
  const recentNews = db.prepare(
    'SELECT * FROM news_events ORDER BY timestamp DESC LIMIT 10'
  ).all() as any[];

  const sentimentData = latestSentiment ? {
    overallScore: latestSentiment.news_sentiment,
    fearGreedIndex: latestSentiment.fear_greed_index,
    marketRegime: latestSentiment.market_regime,
    headlines: recentNews.map((n: any) => ({
      headline: n.headline,
      source: n.source || 'Unknown',
      timestamp: n.timestamp,
      sentiment_score: n.sentiment_score,
      impact_level: n.impact_level || 'low',
    })),
  } : null;

  // Current indicator readings (with news sentiment)
  const currentIndicators = {
    ema9: ema9Array.length > 0 ? ema9Array[ema9Array.length - 1] : null,
    ema21: ema21Array.length > 0 ? ema21Array[ema21Array.length - 1] : null,
    rsi: calculateRSI(closes, 14),
    macd: calculateMACD(closes),
    bollingerBands: calculateBollingerBands(closes, 20, 2),
    volumeSpike: detectVolumeSpike(volumes, 20),
    currentPrice: closes.length > 0 ? closes[closes.length - 1] : 0,
    newsSentiment: latestSentiment?.news_sentiment ?? 0,
  };

  const currentSignal = closes.length >= 35 ? calculateCompositeSignal(currentIndicators) : null;

  // Stats
  const closedTrades = db.prepare('SELECT * FROM trades WHERE status = ?').all('CLOSED') as any[];
  let wins = 0;
  let losses = 0;
  let totalProfit = 0;
  let totalLoss = 0;
  closedTrades.forEach((t: any) => {
    if (t.profit_loss > 0) { wins++; totalProfit += t.profit_loss; }
    else { losses++; totalLoss += Math.abs(t.profit_loss); }
  });
  const winRate = (wins + losses) > 0 ? (wins / (wins + losses)) * 100 : 0;
  const avgWin = wins > 0 ? totalProfit / wins : 0;
  const avgLoss = losses > 0 ? totalLoss / losses : 0;
  const profitFactor = totalLoss > 0 ? totalProfit / totalLoss : totalProfit > 0 ? Infinity : 0;

  // NEW: Sharpe Ratio (from daily PnL returns)
  const allDailyPnlRecords = db.prepare('SELECT * FROM daily_pnl ORDER BY date ASC').all() as any[];
  let sharpeRatio = 0;
  if (allDailyPnlRecords.length >= 2) {
    const dailyReturns = allDailyPnlRecords.map((d: any) => {
      const start = d.starting_balance || 1;
      return d.total_pnl / start;
    });
    const meanReturn = dailyReturns.reduce((s: number, v: number) => s + v, 0) / dailyReturns.length;
    const variance = dailyReturns.reduce((s: number, v: number) => s + Math.pow(v - meanReturn, 2), 0) / dailyReturns.length;
    const stdDev = Math.sqrt(variance);
    sharpeRatio = stdDev > 0 ? (meanReturn / stdDev) * Math.sqrt(252) : 0; // Annualized
  }

  // NEW: Max Drawdown
  let maxDrawdown = 0;
  if (allDailyPnlRecords.length >= 1) {
    let peak = allDailyPnlRecords[0]?.starting_balance || 0;
    for (const d of allDailyPnlRecords) {
      const balance = d.ending_balance ?? (d.starting_balance + d.total_pnl);
      if (balance > peak) peak = balance;
      const drawdown = peak > 0 ? ((peak - balance) / peak) * 100 : 0;
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    }
  }

  // Daily PnL
  const today = new Date().toISOString().split('T')[0];
  const dailyPnl = db.prepare('SELECT * FROM daily_pnl WHERE date = ?').get(today);
  const allDailyPnl = db.prepare('SELECT * FROM daily_pnl ORDER BY date DESC LIMIT 30').all();

  // Trade markers for chart
  const tradeMarkers = closedTrades.slice(-20).map((t: any) => ({
    time: Math.floor(t.timestamp / 1000),
    type: t.type,
    price: t.entry_price,
    exitTime: t.close_timestamp ? Math.floor(t.close_timestamp / 1000) : null,
    exitPrice: t.exit_price,
    profitLoss: t.profit_loss,
  }));

  return {
    vault,
    systemState,
    recentTrades,
    recentCandles,
    ema9Data,
    ema21Data,
    bbData,
    currentSignal,
    currentIndicators: {
      rsi: currentIndicators.rsi,
      macd: currentIndicators.macd,
      bollingerBands: currentIndicators.bollingerBands,
      volumeRatio: currentIndicators.volumeSpike.ratio,
      volumeSpike: currentIndicators.volumeSpike.isSpike,
    },
    stats: { wins, losses, winRate, avgWin, avgLoss, profitFactor, sharpeRatio, maxDrawdown },
    dailyPnl,
    allDailyPnl,
    tradeMarkers,
    sentimentData, // NEW: News sentiment data for dashboard
  };
}
