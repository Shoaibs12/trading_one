// ============================================================================
// NEWS SENTIMENT ENGINE
// ============================================================================
// Fetches crypto news from Google News RSS, analyzes sentiment using a curated
// keyword dictionary, calculates a Fear & Greed proxy, and detects market regime.
// No external AI API needed — fast, free, deterministic.

import db from './db';

// ============================================================================
// TYPES
// ============================================================================

export interface NewsHeadline {
  headline: string;
  source: string;
  timestamp: number;
  sentiment_score: number;
  category: 'regulatory' | 'market' | 'technology' | 'macro' | 'general';
  impact_level: 'high' | 'medium' | 'low';
}

export interface SentimentResult {
  overallScore: number;        // -1.0 to +1.0
  headlines: NewsHeadline[];
  bullishCount: number;
  bearishCount: number;
  neutralCount: number;
}

export interface FearGreedData {
  index: number;               // 0-100 (0=extreme fear, 100=extreme greed)
  label: string;
  components: {
    volatility: number;        // 0-100
    volume: number;            // 0-100
    sentiment: number;         // 0-100
    momentum: number;          // 0-100
  };
}

export type MarketRegime = 'RISK_ON' | 'RISK_OFF' | 'EXTREME_FEAR' | 'EXTREME_GREED';

// ============================================================================
// SENTIMENT KEYWORD DICTIONARY
// ============================================================================

interface KeywordEntry {
  score: number;               // -1.0 to +1.0
  category: NewsHeadline['category'];
  impact: NewsHeadline['impact_level'];
}

const BULLISH_KEYWORDS: Record<string, KeywordEntry> = {
  // Strong bullish — regulatory / institutional (high impact)
  'etf approved': { score: 0.9, category: 'regulatory', impact: 'high' },
  'etf approval': { score: 0.9, category: 'regulatory', impact: 'high' },
  'spot etf': { score: 0.8, category: 'regulatory', impact: 'high' },
  'institutional adoption': { score: 0.8, category: 'market', impact: 'high' },
  'institutional investment': { score: 0.8, category: 'market', impact: 'high' },
  'mass adoption': { score: 0.7, category: 'market', impact: 'high' },
  'legal tender': { score: 0.85, category: 'regulatory', impact: 'high' },
  'strategic reserve': { score: 0.85, category: 'regulatory', impact: 'high' },
  'pro crypto': { score: 0.6, category: 'regulatory', impact: 'medium' },
  'pro-crypto': { score: 0.6, category: 'regulatory', impact: 'medium' },
  'regulatory clarity': { score: 0.6, category: 'regulatory', impact: 'medium' },

  // Strong bullish — market (high impact)
  'all-time high': { score: 0.8, category: 'market', impact: 'high' },
  'all time high': { score: 0.8, category: 'market', impact: 'high' },
  'new ath': { score: 0.8, category: 'market', impact: 'high' },
  'record high': { score: 0.75, category: 'market', impact: 'high' },
  'bull run': { score: 0.7, category: 'market', impact: 'high' },
  'bull market': { score: 0.65, category: 'market', impact: 'medium' },
  'parabolic': { score: 0.7, category: 'market', impact: 'medium' },
  'breakout': { score: 0.6, category: 'market', impact: 'medium' },
  'bullish breakout': { score: 0.7, category: 'market', impact: 'medium' },
  'price surge': { score: 0.65, category: 'market', impact: 'medium' },
  'price rally': { score: 0.6, category: 'market', impact: 'medium' },

  // Medium bullish
  'halving': { score: 0.5, category: 'technology', impact: 'medium' },
  'bitcoin halving': { score: 0.55, category: 'technology', impact: 'medium' },
  'partnership': { score: 0.4, category: 'market', impact: 'medium' },
  'upgrade': { score: 0.35, category: 'technology', impact: 'medium' },
  'accumulation': { score: 0.45, category: 'market', impact: 'medium' },
  'whale buying': { score: 0.5, category: 'market', impact: 'medium' },
  'whale accumulation': { score: 0.5, category: 'market', impact: 'medium' },
  'inflows': { score: 0.45, category: 'market', impact: 'medium' },
  'fund inflow': { score: 0.45, category: 'market', impact: 'medium' },
  'buying pressure': { score: 0.4, category: 'market', impact: 'medium' },
  'bullish': { score: 0.4, category: 'market', impact: 'low' },
  'optimistic': { score: 0.3, category: 'market', impact: 'low' },
  'recovery': { score: 0.35, category: 'market', impact: 'medium' },
  'rebound': { score: 0.35, category: 'market', impact: 'medium' },
  'support level': { score: 0.25, category: 'market', impact: 'low' },
  'buy signal': { score: 0.35, category: 'market', impact: 'low' },
  'moon': { score: 0.3, category: 'market', impact: 'low' },
  'gains': { score: 0.3, category: 'market', impact: 'low' },
  'soars': { score: 0.5, category: 'market', impact: 'medium' },
  'surges': { score: 0.5, category: 'market', impact: 'medium' },
  'jumps': { score: 0.4, category: 'market', impact: 'medium' },
  'climbs': { score: 0.35, category: 'market', impact: 'low' },
  'rallies': { score: 0.5, category: 'market', impact: 'medium' },
  'green': { score: 0.15, category: 'market', impact: 'low' },
  'positive': { score: 0.2, category: 'general', impact: 'low' },
  'momentum': { score: 0.25, category: 'market', impact: 'low' },
  'demand': { score: 0.25, category: 'market', impact: 'low' },
  'mainstream': { score: 0.3, category: 'market', impact: 'low' },
  'milestone': { score: 0.25, category: 'general', impact: 'low' },
};

const BEARISH_KEYWORDS: Record<string, KeywordEntry> = {
  // Strong bearish — regulatory / security (high impact)
  'sec lawsuit': { score: -0.85, category: 'regulatory', impact: 'high' },
  'sec charges': { score: -0.8, category: 'regulatory', impact: 'high' },
  'sec sues': { score: -0.85, category: 'regulatory', impact: 'high' },
  'banned': { score: -0.8, category: 'regulatory', impact: 'high' },
  'ban crypto': { score: -0.85, category: 'regulatory', impact: 'high' },
  'crypto ban': { score: -0.85, category: 'regulatory', impact: 'high' },
  'crackdown': { score: -0.7, category: 'regulatory', impact: 'high' },
  'hacked': { score: -0.8, category: 'technology', impact: 'high' },
  'hack': { score: -0.75, category: 'technology', impact: 'high' },
  'exploit': { score: -0.7, category: 'technology', impact: 'high' },
  'stolen': { score: -0.75, category: 'technology', impact: 'high' },
  'rug pull': { score: -0.9, category: 'market', impact: 'high' },
  'ponzi': { score: -0.9, category: 'market', impact: 'high' },
  'scam': { score: -0.7, category: 'market', impact: 'high' },
  'fraud': { score: -0.8, category: 'regulatory', impact: 'high' },
  'collapse': { score: -0.85, category: 'market', impact: 'high' },
  'insolvency': { score: -0.85, category: 'market', impact: 'high' },
  'insolvent': { score: -0.85, category: 'market', impact: 'high' },
  'bankruptcy': { score: -0.8, category: 'market', impact: 'high' },

  // Strong bearish — market (high impact)
  'crash': { score: -0.8, category: 'market', impact: 'high' },
  'flash crash': { score: -0.85, category: 'market', impact: 'high' },
  'market crash': { score: -0.85, category: 'market', impact: 'high' },
  'liquidation': { score: -0.6, category: 'market', impact: 'high' },
  'liquidated': { score: -0.6, category: 'market', impact: 'high' },
  'mass liquidation': { score: -0.75, category: 'market', impact: 'high' },
  'capitulation': { score: -0.7, category: 'market', impact: 'high' },
  'bear market': { score: -0.6, category: 'market', impact: 'medium' },
  'crypto winter': { score: -0.65, category: 'market', impact: 'medium' },
  'whale dump': { score: -0.6, category: 'market', impact: 'high' },
  'whale selling': { score: -0.55, category: 'market', impact: 'medium' },

  // Medium bearish
  'selloff': { score: -0.5, category: 'market', impact: 'medium' },
  'sell-off': { score: -0.5, category: 'market', impact: 'medium' },
  'sell off': { score: -0.5, category: 'market', impact: 'medium' },
  'plunges': { score: -0.6, category: 'market', impact: 'medium' },
  'plummets': { score: -0.6, category: 'market', impact: 'medium' },
  'tumbles': { score: -0.5, category: 'market', impact: 'medium' },
  'tanks': { score: -0.55, category: 'market', impact: 'medium' },
  'dumps': { score: -0.5, category: 'market', impact: 'medium' },
  'drops': { score: -0.35, category: 'market', impact: 'medium' },
  'falls': { score: -0.3, category: 'market', impact: 'low' },
  'decline': { score: -0.35, category: 'market', impact: 'medium' },
  'downturn': { score: -0.4, category: 'market', impact: 'medium' },
  'correction': { score: -0.3, category: 'market', impact: 'medium' },
  'outflows': { score: -0.4, category: 'market', impact: 'medium' },
  'fund outflow': { score: -0.4, category: 'market', impact: 'medium' },
  'selling pressure': { score: -0.4, category: 'market', impact: 'medium' },
  'bearish': { score: -0.4, category: 'market', impact: 'low' },
  'warning': { score: -0.25, category: 'general', impact: 'low' },
  'concerns': { score: -0.2, category: 'general', impact: 'low' },
  'fear': { score: -0.3, category: 'market', impact: 'low' },
  'panic': { score: -0.5, category: 'market', impact: 'medium' },
  'uncertainty': { score: -0.25, category: 'general', impact: 'low' },
  'volatile': { score: -0.15, category: 'market', impact: 'low' },
  'volatility': { score: -0.1, category: 'market', impact: 'low' },
  'risk': { score: -0.15, category: 'general', impact: 'low' },
  'bubble': { score: -0.4, category: 'market', impact: 'medium' },
  'overvalued': { score: -0.35, category: 'market', impact: 'low' },
  'resistance': { score: -0.15, category: 'market', impact: 'low' },
  'red': { score: -0.1, category: 'market', impact: 'low' },
  'negative': { score: -0.2, category: 'general', impact: 'low' },
  'losses': { score: -0.3, category: 'market', impact: 'low' },
  'losing': { score: -0.25, category: 'market', impact: 'low' },

  // Macro bearish
  'rate hike': { score: -0.4, category: 'macro', impact: 'medium' },
  'interest rate': { score: -0.2, category: 'macro', impact: 'medium' },
  'inflation': { score: -0.25, category: 'macro', impact: 'medium' },
  'recession': { score: -0.5, category: 'macro', impact: 'high' },
  'tariff': { score: -0.3, category: 'macro', impact: 'medium' },
  'trade war': { score: -0.4, category: 'macro', impact: 'medium' },
  'sanctions': { score: -0.35, category: 'macro', impact: 'medium' },
};

// ============================================================================
// NEWS FETCHING
// ============================================================================

// Cache news to avoid fetching every tick
let newsCache: { headlines: NewsHeadline[]; fetchedAt: number } | null = null;
const NEWS_CACHE_TTL = 60_000; // 1 minute cache

/**
 * Fetches crypto news from Google News RSS.
 * Caches results for 1 minute to avoid excessive requests.
 */
export async function fetchCryptoNews(): Promise<NewsHeadline[]> {
  // Return cached data if fresh
  if (newsCache && Date.now() - newsCache.fetchedAt < NEWS_CACHE_TTL) {
    return newsCache.headlines;
  }

  try {
    const query = encodeURIComponent('bitcoin cryptocurrency crypto');
    const url = `https://news.google.com/rss/search?q=${query}&hl=en-US&gl=US&ceid=US:en`;

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; TradingBot/1.0)',
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      console.warn(`News fetch failed: HTTP ${response.status}`);
      return newsCache?.headlines ?? [];
    }

    const xml = await response.text();
    const headlines = parseRSSFeed(xml);
    const analyzed = headlines.map(h => analyzeHeadline(h.headline, h.source, h.timestamp));

    // Store in database
    storeNewsEvents(analyzed);

    // Cache
    newsCache = { headlines: analyzed, fetchedAt: Date.now() };
    return analyzed;
  } catch (err) {
    console.warn('News fetch error:', err);
    // Return cached data or empty array on failure
    return newsCache?.headlines ?? getRecentNewsFromDB();
  }
}

/**
 * Parses Google News RSS XML and extracts headline items.
 */
function parseRSSFeed(xml: string): { headline: string; source: string; timestamp: number }[] {
  const items: { headline: string; source: string; timestamp: number }[] = [];

  // Extract <item> blocks
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  let count = 0;

  while ((match = itemRegex.exec(xml)) !== null && count < 10) {
    const itemXml = match[1];

    // Extract title
    const titleMatch = itemXml.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>(.*?)<\/title>/);
    const headline = titleMatch ? (titleMatch[1] || titleMatch[2] || '').trim() : '';

    // Extract source from title (Google News format: "Headline - Source")
    let source = 'Unknown';
    const sourceMatch = headline.match(/\s-\s([^-]+)$/);
    if (sourceMatch) {
      source = sourceMatch[1].trim();
    } else {
      // Try <source> tag
      const srcTagMatch = itemXml.match(/<source[^>]*>(.*?)<\/source>/);
      if (srcTagMatch) source = srcTagMatch[1].trim();
    }

    // Extract publication date
    const pubDateMatch = itemXml.match(/<pubDate>(.*?)<\/pubDate>/);
    const timestamp = pubDateMatch ? new Date(pubDateMatch[1]).getTime() : Date.now();

    // Clean headline (remove source suffix)
    const cleanHeadline = headline.replace(/\s-\s[^-]+$/, '').trim();

    if (cleanHeadline) {
      items.push({ headline: cleanHeadline, source, timestamp });
      count++;
    }
  }

  return items;
}

// ============================================================================
// SENTIMENT ANALYSIS
// ============================================================================

/**
 * Analyzes a single headline for sentiment using keyword matching.
 */
function analyzeHeadline(headline: string, source: string, timestamp: number): NewsHeadline {
  const lowerHeadline = headline.toLowerCase();
  let totalScore = 0;
  let matchCount = 0;
  let highestImpact: NewsHeadline['impact_level'] = 'low';
  let detectedCategory: NewsHeadline['category'] = 'general';

  // Check bullish keywords (check multi-word phrases first for better matching)
  const allBullish = Object.entries(BULLISH_KEYWORDS).sort((a, b) => b[0].length - a[0].length);
  for (const [keyword, entry] of allBullish) {
    if (lowerHeadline.includes(keyword)) {
      totalScore += entry.score;
      matchCount++;
      if (impactWeight(entry.impact) > impactWeight(highestImpact)) {
        highestImpact = entry.impact;
      }
      if (entry.category !== 'general') {
        detectedCategory = entry.category;
      }
    }
  }

  // Check bearish keywords
  const allBearish = Object.entries(BEARISH_KEYWORDS).sort((a, b) => b[0].length - a[0].length);
  for (const [keyword, entry] of allBearish) {
    if (lowerHeadline.includes(keyword)) {
      totalScore += entry.score; // entry.score is already negative
      matchCount++;
      if (impactWeight(entry.impact) > impactWeight(highestImpact)) {
        highestImpact = entry.impact;
      }
      if (entry.category !== 'general') {
        detectedCategory = entry.category;
      }
    }
  }

  // Normalize score to -1 to +1 range
  const sentimentScore = matchCount > 0
    ? Math.max(-1, Math.min(1, totalScore / Math.max(matchCount, 1)))
    : 0;

  return {
    headline,
    source,
    timestamp,
    sentiment_score: sentimentScore,
    category: detectedCategory,
    impact_level: highestImpact,
  };
}

function impactWeight(impact: string): number {
  switch (impact) {
    case 'high': return 3;
    case 'medium': return 2;
    case 'low': return 1;
    default: return 0;
  }
}

/**
 * Computes overall sentiment from an array of headlines.
 * High-impact headlines get 3x weight.
 */
export function computeOverallSentiment(headlines: NewsHeadline[]): SentimentResult {
  if (headlines.length === 0) {
    return { overallScore: 0, headlines, bullishCount: 0, bearishCount: 0, neutralCount: 0 };
  }

  let weightedSum = 0;
  let totalWeight = 0;
  let bullishCount = 0;
  let bearishCount = 0;
  let neutralCount = 0;

  for (const h of headlines) {
    const weight = impactWeight(h.impact_level);
    weightedSum += h.sentiment_score * weight;
    totalWeight += weight;

    if (h.sentiment_score > 0.15) bullishCount++;
    else if (h.sentiment_score < -0.15) bearishCount++;
    else neutralCount++;
  }

  const overallScore = totalWeight > 0
    ? Math.max(-1, Math.min(1, weightedSum / totalWeight))
    : 0;

  return { overallScore, headlines, bullishCount, bearishCount, neutralCount };
}

// ============================================================================
// FEAR & GREED PROXY
// ============================================================================

/**
 * Calculates a Fear & Greed proxy index (0-100) from multiple inputs.
 * - Volatility (35%): High volatility → fear
 * - Volume anomaly (25%): Unusual volume → extreme sentiment
 * - News sentiment (25%): Headlines mood
 * - Momentum (15%): Consecutive direction → greed/fear
 */
export function calculateFearGreedProxy(params: {
  closes: number[];
  volumes: number[];
  newsSentiment: number; // -1 to +1
}): FearGreedData {
  const { closes, volumes, newsSentiment } = params;

  // 1. Volatility component (35%) — lower vol = more greed, higher vol = more fear
  let volatilityScore = 50;
  if (closes.length >= 20) {
    const recentCloses = closes.slice(-20);
    const returns = [];
    for (let i = 1; i < recentCloses.length; i++) {
      returns.push((recentCloses[i] - recentCloses[i - 1]) / recentCloses[i - 1]);
    }
    const mean = returns.reduce((s, v) => s + v, 0) / returns.length;
    const variance = returns.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);

    // Map stdDev to 0-100 (lower vol = higher score = greed)
    // For BTC 1-min: ~0.001 = calm, ~0.005 = volatile, ~0.01 = extreme
    const normalizedVol = Math.min(1, stdDev / 0.008);
    volatilityScore = (1 - normalizedVol) * 100;
  }

  // 2. Volume anomaly component (25%) — unusual volume amplifies sentiment
  let volumeScore = 50;
  if (volumes.length >= 21) {
    const avgVol = volumes.slice(-21, -1).reduce((s, v) => s + v, 0) / 20;
    const currentVol = volumes[volumes.length - 1];
    const ratio = avgVol > 0 ? currentVol / avgVol : 1;

    // High volume with positive price action = greed, with negative = fear
    const priceDirection = closes.length >= 2
      ? closes[closes.length - 1] > closes[closes.length - 2] ? 1 : -1
      : 0;

    if (ratio > 1.5) {
      // Volume spike — amplify in direction of price
      volumeScore = priceDirection > 0
        ? 50 + Math.min(50, (ratio - 1) * 30) // Push toward greed
        : 50 - Math.min(50, (ratio - 1) * 30); // Push toward fear
    } else {
      volumeScore = 50; // Normal volume = neutral
    }
  }

  // 3. News sentiment component (25%) — map -1..+1 to 0..100
  const sentimentScore = (newsSentiment + 1) / 2 * 100;

  // 4. Momentum component (15%) — consecutive up/down candles
  let momentumScore = 50;
  if (closes.length >= 10) {
    const recent = closes.slice(-10);
    let upCount = 0;
    let downCount = 0;
    for (let i = 1; i < recent.length; i++) {
      if (recent[i] > recent[i - 1]) upCount++;
      else if (recent[i] < recent[i - 1]) downCount++;
    }
    // More up candles = greed, more down = fear
    const ratio = (upCount - downCount) / (recent.length - 1);
    momentumScore = (ratio + 1) / 2 * 100;
  }

  // Weighted composite
  const index = Math.round(
    volatilityScore * 0.35 +
    volumeScore * 0.25 +
    sentimentScore * 0.25 +
    momentumScore * 0.15
  );

  const clampedIndex = Math.max(0, Math.min(100, index));

  let label: string;
  if (clampedIndex < 20) label = 'Extreme Fear';
  else if (clampedIndex < 40) label = 'Fear';
  else if (clampedIndex < 60) label = 'Neutral';
  else if (clampedIndex < 80) label = 'Greed';
  else label = 'Extreme Greed';

  return {
    index: clampedIndex,
    label,
    components: {
      volatility: Math.round(volatilityScore),
      volume: Math.round(volumeScore),
      sentiment: Math.round(sentimentScore),
      momentum: Math.round(momentumScore),
    },
  };
}

// ============================================================================
// MARKET REGIME DETECTION
// ============================================================================

/**
 * Detects current market regime based on Fear & Greed index.
 * Returns regime and position sizing multiplier.
 */
export function detectMarketRegime(fearGreedIndex: number): {
  regime: MarketRegime;
  positionMultiplier: number;
  description: string;
} {
  if (fearGreedIndex < 20) {
    return {
      regime: 'EXTREME_FEAR',
      positionMultiplier: 0.3,
      description: 'Extreme fear detected. Reducing position sizes by 70%. Contrarian buy signals amplified.',
    };
  }
  if (fearGreedIndex < 40) {
    return {
      regime: 'RISK_OFF',
      positionMultiplier: 0.5,
      description: 'Risk-off environment. Reducing position sizes by 50%. Tightening stop losses.',
    };
  }
  if (fearGreedIndex > 80) {
    return {
      regime: 'EXTREME_GREED',
      positionMultiplier: 0.3,
      description: 'Extreme greed detected. Reducing position sizes by 70%. Contrarian sell signals amplified.',
    };
  }
  return {
    regime: 'RISK_ON',
    positionMultiplier: 1.0,
    description: 'Normal market conditions. Full position sizing enabled.',
  };
}

// ============================================================================
// DATABASE HELPERS
// ============================================================================

function storeNewsEvents(headlines: NewsHeadline[]): void {
  try {
    const stmt = db.prepare(`
      INSERT OR IGNORE INTO news_events (timestamp, headline, source, sentiment_score, category, impact_level)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    for (const h of headlines) {
      stmt.run(h.timestamp, h.headline, h.source, h.sentiment_score, h.category, h.impact_level);
    }
  } catch (err) {
    console.warn('Failed to store news events:', err);
  }
}

export function storeSentimentSnapshot(data: {
  timestamp: number;
  newsSentiment: number;
  fearGreedIndex: number;
  marketRegime: string;
  headlinesAnalyzed: number;
}): void {
  try {
    db.prepare(`
      INSERT INTO sentiment_history (timestamp, news_sentiment, fear_greed_index, market_regime, headlines_analyzed)
      VALUES (?, ?, ?, ?, ?)
    `).run(data.timestamp, data.newsSentiment, data.fearGreedIndex, data.marketRegime, data.headlinesAnalyzed);
  } catch (err) {
    console.warn('Failed to store sentiment snapshot:', err);
  }
}

function getRecentNewsFromDB(): NewsHeadline[] {
  try {
    const rows = db.prepare(
      'SELECT * FROM news_events ORDER BY timestamp DESC LIMIT 10'
    ).all() as any[];

    return rows.map(r => ({
      headline: r.headline,
      source: r.source || 'Unknown',
      timestamp: r.timestamp,
      sentiment_score: r.sentiment_score,
      category: r.category || 'general',
      impact_level: r.impact_level || 'low',
    }));
  } catch {
    return [];
  }
}
