/**
 * Ghost Run Trading Engine - Background Runner
 * 
 * This script continuously simulates trading ticks in the background by calling
 * the Next.js API. It prints formatted real-time performance and sentiment metrics.
 * 
 * Usage:
 *   node background-runner.js [interval_seconds] [port]
 */

const http = require('http');

// Configurable settings
const INTERVAL_MS = (parseInt(process.argv[2], 10) || 10) * 1000; // Default: 10 seconds
const PORT = parseInt(process.argv[3], 10) || 3000;              // Default Next.js port: 3000
const HOST = 'localhost';
const PATH = '/api/tick';

console.log('===================================================');
console.log('   GHOST RUN TRADING ENGINE - BACKGROUND RUNNER     ');
console.log('===================================================');
console.log(`Interval: ${INTERVAL_MS / 1000}s | Target: http://${HOST}:${PORT}${PATH}`);
console.log('Starting server status checks...\n');

// Helper to format currency
function formatCurrency(val) {
  if (val === undefined || val === null) return '$0.00';
  return '$' + Number(val).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Helper to perform HTTP POST
function sendTick() {
  const options = {
    hostname: HOST,
    port: PORT,
    path: PATH,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': 0
    }
  };

  const req = http.request(options, (res) => {
    let body = '';
    res.on('data', (chunk) => body += chunk);
    res.on('end', () => {
      if (res.statusCode !== 200) {
        console.error(`[\x1b[31mError\x1b[0m] Server responded with code ${res.statusCode}`);
        return;
      }

      try {
        const data = JSON.parse(body);
        
        if (data.tickError) {
          console.error(`[\x1b[31mTick Error\x1b[0m] ${data.tickError}`);
          return;
        }

        const timestamp = new Date().toLocaleTimeString();
        const price = data.currentIndicators?.currentPrice || 0;
        
        // Vault and performance
        const vault = data.vault || {};
        const balance = vault.current_balance || 0;
        const initial = vault.initial_balance || 10000;
        const pnlPct = ((balance - initial) / initial) * 100;
        const pnlColor = pnlPct >= 0 ? '\x1b[32m' : '\x1b[31m'; // Green or Red
        
        // Active trades count
        const activeTrades = data.recentTrades ? data.recentTrades.filter(t => t.status === 'OPEN').length : 0;

        // Sentiment
        const sentiment = data.sentimentData || {};
        const score = sentiment.overallScore || 0;
        const fearGreed = sentiment.fearGreedIndex || 50;
        const regime = sentiment.marketRegime || 'RISK_ON';
        const sentimentSymbol = score >= 0.1 ? '📈 Bullish' : score <= -0.1 ? '📉 Bearish' : '⚖️ Neutral';
        
        // Formatted log line
        console.log(
          `[${timestamp}] ` +
          `BTC: \x1b[36m${formatCurrency(price)}\x1b[0m | ` +
          `Regime: \x1b[35m${regime.replace('_', ' ')}\x1b[0m (F&G: ${Math.round(fearGreed)}) | ` +
          `Sentiment: ${sentimentSymbol} (${score >= 0 ? '+' : ''}${score.toFixed(2)}) | ` +
          `Balance: ${pnlColor}${formatCurrency(balance)} (${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%)\x1b[0m | ` +
          `Active Trades: \x1b[33m${activeTrades}\x1b[0m`
        );
      } catch (err) {
        console.error('[\x1b[31mJSON Parse Error\x1b[0m] Failed to read response.');
      }
    });
  });

  req.on('error', (err) => {
    if (err.code === 'ECONNREFUSED') {
      console.warn(`[\x1b[33mOffline\x1b[0m] Next.js server is not running on port ${PORT}. Retrying next tick...`);
    } else {
      console.error('[\x1b[31mConnection Error\x1b[0m]', err.message);
    }
  });

  req.end();
}

// Check server status before starting the interval loop
function checkServerConnection() {
  const options = {
    hostname: HOST,
    port: PORT,
    path: '/api/data',
    method: 'GET'
  };

  const req = http.request(options, (res) => {
    if (res.statusCode === 200) {
      console.log(`\x1b[32mSuccess:\x1b[0m Connected to Next.js server successfully!`);
      console.log(`Running continuous background simulation every ${INTERVAL_MS / 1000} seconds...\n`);
      
      // Execute first tick immediately
      sendTick();
      
      // Set interval
      setInterval(sendTick, INTERVAL_MS);
    } else {
      console.warn(`\x1b[33mWarning:\x1b[0m Connected to port ${PORT} but received status ${res.statusCode}. Retrying in 5 seconds...`);
      setTimeout(checkServerConnection, 5000);
    }
  });

  req.on('error', () => {
    console.log(`\x1b[33mAwaiting server:\x1b[0m Next.js server is not running yet. Please start it using 'npm run dev' or 'npm run build && npm start'. Retrying in 5s...`);
    setTimeout(checkServerConnection, 5000);
  });

  req.end();
}

// Start connection sequence
checkServerConnection();
