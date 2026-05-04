module.exports = {
  apps: [
    {
      name: "trading-one-web",
      script: "npm",
      args: "run start",
      env: {
        NODE_ENV: "production",
        PORT: "3000"
      }
    },
    {
      name: "trading-one-worker",
      script: "npm",
      args: "run worker",
      env: {
        NODE_ENV: "production",
        APP_URL: "http://127.0.0.1:3000",
        TICK_INTERVAL_MS: "3000"
      }
    }
  ]
};
