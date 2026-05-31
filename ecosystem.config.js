module.exports = {
  apps: [
    {
      name: 'ghostrun-web',
      script: 'node_modules/next/dist/bin/next',
      args: 'dev', // Uses Next.js development server. Change to 'start' if running in production mode.
      cwd: './',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'development',
        PORT: 3005
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3005
      }
    },
    {
      name: 'ghostrun-runner',
      script: 'background-runner.js',
      args: '60 3005', // Args: [interval_seconds] [port]. 60s matches the 1-minute candle timeframe. Change 60 to 10 for faster testing.
      cwd: './',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M'
    }
  ]
};
