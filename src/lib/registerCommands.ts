import { REST, Routes } from "discord.js";
import config from "./config";
import logger from "./logger";
import { loadCommands } from "../commands";

const rest = new REST({ version: "10" }).setToken(config.DISCORD_BOT_TOKEN);

export async function registerCommands() {
  try {
    const commands = await loadCommands();
    const commandsData = Object.values(commands).map((command) => command.data);

    logger.info("Started registering commands.");

    if (config.DISCORD_GUILD_IDS.length > 0) {
      await rest.put(Routes.applicationCommands(config.DISCORD_CLIENT_ID), {
        body: [],
      });

      for (const guildId of config.DISCORD_GUILD_IDS) {
        await rest.put(
          Routes.applicationGuildCommands(config.DISCORD_CLIENT_ID, guildId),
          {
            body: commandsData,
          },
        );
      }
    } else {
      await rest.put(Routes.applicationCommands(config.DISCORD_CLIENT_ID), {
        body: commandsData,
      });
    }

    logger.info("Successfully registered commands.");
  } catch (error) {
    logger.error("Failed to register commands:", error);
  }
}

registerCommands();
