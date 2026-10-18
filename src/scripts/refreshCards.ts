/**
 * One-shot maintenance script: force-refresh every enabled "Embed Status" card
 * immediately instead of waiting for its per-row interval.
 *
 * Usage: `npm run refresh-cards`
 *
 * ⚠️ Takes the bot's gateway session, exactly like launching the bot does. Do
 * NOT run it while the main bot is online — Discord allows one session per
 * token and the second login invalidates the first (the running bot will
 * reconnect, and you will see "session invalidated" in its logs).
 *
 * Logs in, waits for the gateway to be ready (guild + channel caches are
 * populated by then), runs one refresh pass, then exits with a status code.
 */
import { Events } from "discord.js";
import { client } from "../lib/client";
import config, { assertConfig } from "../lib/config";
import logger from "../lib/logger";
import { forceRefreshEmbeds } from "../monitoring/executorStatus";

async function main() {
  assertConfig();
  await client.login(config.DISCORD_BOT_TOKEN!);

  if (!client.isReady()) {
    await new Promise<void>((resolve) => client.once(Events.ClientReady, () => resolve()));
  }

  logger.info("Refreshing all enabled Embed Status cards...");
  await forceRefreshEmbeds();
  logger.ok("Embed Status refresh complete.");
}

main()
  .then(() => {
    client.destroy();
    process.exit(0);
  })
  .catch((error) => {
    logger.error("Embed Status refresh failed:", error);
    client.destroy();
    process.exit(1);
  });
