import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow Binance API calls from server-side
  serverExternalPackages: ['better-sqlite3'],
};

export default nextConfig;
