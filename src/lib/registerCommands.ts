import { REST, Routes } from "discord.js";
import config, { assertConfig } from "./config";
import logger from "./logger";
import { loadCommands } from "../commands";

export async function registerCommands() {
  try {
    assertConfig();
    const rest = new REST({ version: "10" }).setToken(config.DISCORD_BOT_TOKEN!);
    const commands = await loadCommands();
    const commandsData = Object.values(commands).map((command) => command.data);

    logger.info("Started registering commands.");

    if (config.DISCORD_GUILD_IDS.length > 0) {
      await rest.put(Routes.applicationCommands(config.DISCORD_CLIENT_ID!), {
        body: [],
      });

      for (const guildId of config.DISCORD_GUILD_IDS) {
        await rest.put(
          Routes.applicationGuildCommands(config.DISCORD_CLIENT_ID!, guildId),
          {
            body: commandsData,
          },
        );
      }
    } else {
      await rest.put(Routes.applicationCommands(config.DISCORD_CLIENT_ID!), {
        body: commandsData,
      });
    }

    logger.info("Successfully registered commands.");
  } catch (error) {
    // Rethrow so the CLI entry point can exit non-zero — a failed
    // registration must not look like a success to a script or a deploy.
    logger.error("Failed to register commands:", error);
    throw error;
  }
}
