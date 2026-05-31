module.exports = {
  apps: [
    {
      name: 'ghostrun-web',
      script: 'npm',
      args: 'run start', // Runs the production build
      cwd: './',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 3005
      }
    },
    {
      name: 'ghostrun-runner',
      script: 'background-runner.js',
      args: '60 3005', // 60s ticks on port 3005
      cwd: './',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};
