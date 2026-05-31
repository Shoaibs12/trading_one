#!/bin/bash
# ====================================================================
# Ghost Run Trading Engine - DigitalOcean Setup Script
# ====================================================================
# Run this script on your fresh Ubuntu Droplet to set up the system.
# Command to run: bash setup-ubuntu.sh

echo "🚀 Starting Ghost Run Trading Engine Server Setup..."

# 1. Update Ubuntu
echo "📦 Updating system packages..."
sudo apt update && sudo apt upgrade -y

# 2. Install Node.js v20
echo "🟢 Installing Node.js..."
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# 3. Install PM2 globally
echo "⚙️ Installing PM2..."
sudo npm install -g pm2

# 4. Install project dependencies
echo "📚 Installing project dependencies..."
npm install

# 5. Build Next.js for production
echo "🏗️ Building Next.js production bundle..."
npm run build

# 6. Start the server & runner
echo "🚀 Starting services with PM2..."
pm2 start ecosystem.prod.js

# 7. Ensure PM2 restarts on server reboot
echo "🔄 Configuring PM2 to start on boot..."
pm2 save
sudo env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u $USER --hp $HOME

echo "✅ Setup Complete! Your trading engine is now running 24/7."
echo "Use 'pm2 logs' to view the background runner."
