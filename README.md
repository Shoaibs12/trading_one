This is a [Next.js](https://nextjs.org) trading simulator dashboard with a background worker for continuous ticks.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

To run the simulator while your browser is closed, start the worker in a second terminal:

```bash
npm run worker
```

The dashboard is only the display. The worker is what keeps calling `/api/tick`.

## Run Continuously In The Cloud

Use a small VPS first. This app currently stores data in SQLite at `data/trading_sim.db`, so a normal server with persistent disk is the simplest deployment.

Recommended server setup:

```bash
git clone https://github.com/Shoaibs12/trading_one.git
cd trading_one
npm install
npm run build
npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

After that:

- `trading-one-web` serves the phone dashboard.
- `trading-one-worker` keeps the simulator ticking every 3 seconds.
- The bot keeps running after you close your laptop.

Open the server URL from your phone:

```text
http://YOUR_SERVER_IP:3000
```

For a production domain, point a domain to the server and put Nginx or another reverse proxy in front of port 3000.

## Cloud Notes

- A VPS is best for the current SQLite version.
- DigitalOcean App Platform or Render can also work, but use their background worker feature and move the database to Postgres for a stronger setup.
- Plain serverless hosting is not ideal for a continuously running bot.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
