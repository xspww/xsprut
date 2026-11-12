import {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  MessageFlags,
  PermissionFlagsBits,
} from "discord.js";
import logger from "../lib/logger";
import { fetchExecutorData } from "../monitoring/executorStatus";
import { data } from "./executorStatus/data";
import { handleTrack } from "./executorStatus/track";
import { handleBotVoice } from "./executorStatus/botVoice";
import { handleBotChat } from "./executorStatus/botChat";

export { data };

export async function autocomplete(interaction: AutocompleteInteraction) {
  try {
    const focusedValue = interaction.options.getFocused().toLowerCase();
    const exploits = await fetchExecutorData();
    const options = exploits
      .filter((e) => e.title && e.title.toLowerCase().includes(focusedValue))
      .slice(0, 25)
      .map((e) => ({ name: e.title!, value: e.title! }));

    await interaction.respond(options);
  } catch (error) {
    logger.error("Autocomplete error:", error);
    await interaction.respond([]);
  }
}

export async function execute(interaction: ChatInputCommandInteraction) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({
      content: "❌ Administrator permission required",
      flags: MessageFlags.Ephemeral,
    });
  }

  if (!interaction.guildId) {
    return interaction.reply({
      content: "❌ This command can only be used in a server",
      flags: MessageFlags.Ephemeral,
    });
  }

  const group = interaction.options.getSubcommandGroup(true);
  const sub = interaction.options.getSubcommand(true);

  switch (group) {
    case "track":
      return handleTrack(interaction, sub);
    case "voice":
      return handleBotVoice(interaction, sub);
    case "chat":
      return handleBotChat(interaction, sub);
    default:
      return interaction.reply({
        content: `❌ Unknown command group \`${group}\``,
        flags: MessageFlags.Ephemeral,
      });
  }
}
