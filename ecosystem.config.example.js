// PM2 process config for the Roblox Update Tracker bot.
//
// Copy this file to `ecosystem.config.js` in the project root and adjust as
// needed, then run `npm run pm2:start`.
//
// `ecosystem.config.js` is intentionally gitignored: it holds machine-specific
// paths and credentials that must not be shared.
module.exports = {
  apps: [
    {
      name: "roblox-update-tracker",
      script: "dist/index.js",
      cwd: __dirname,
      // Restart forever on crash, but back off so a permanent failure (bad
      // token, missing env) does not spin the CPU.
      autorestart: true,
      max_restarts: 20,
      restart_delay: 5000,
      // Keep logs next to the app; `bot.log` is also written by the logger.
      out_file: "./pm2-out.log",
      error_file: "./pm2-error.log",
      merge_logs: true,
      time: true,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
