module.exports = {
  apps: [
    {
      name: "roblox-bot",
      script: "dist/index.js",
      cwd: __dirname,
      autorestart: true,
      // High enough that a burst of fast crashes (e.g. during a network outage)
      // can never put the bot into PM2's "errored" state and leave it dead for
      // hours — which is what happened before (2h outage on 2026-08-10).
      max_restarts: 1000,
      min_uptime: 5000,
      restart_delay: 10000,
      // Operational RAM guard: if the bot ever leaks past 300 MB, PM2 restarts
      // it instead of letting it grow unbounded.
      max_memory_restart: "300M",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};