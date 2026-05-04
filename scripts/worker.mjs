const appUrl = process.env.APP_URL || "http://127.0.0.1:3000";
const tickIntervalMs = Number(process.env.TICK_INTERVAL_MS || 3000);

let isTicking = false;

async function runTick() {
  if (isTicking) {
    return;
  }

  isTicking = true;
  try {
    const response = await fetch(`${appUrl}/api/tick`, { method: "POST" });
    const payload = await response.text();

    if (!response.ok) {
      throw new Error(`Tick failed with ${response.status}: ${payload}`);
    }

    const data = JSON.parse(payload);
    const trade = data.recentTrades?.[0];
    const status = trade
      ? `${trade.status} ${trade.type} ${trade.asset} pnl=${trade.profit_loss ?? "open"}`
      : "no trade";

    console.log(`[${new Date().toISOString()}] tick ok - ${status}`);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] tick error`, error);
  } finally {
    isTicking = false;
  }
}

console.log(`Trading worker started: ${appUrl}, every ${tickIntervalMs}ms`);
runTick();
setInterval(runTick, tickIntervalMs);
