import {
  ChatInputCommandInteraction,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import { ROBLOX_CHANNELS } from "../lib/constants";
import { getRobloxVersion } from "../lib/robloxVersion";

export const data = new SlashCommandBuilder()
  .setName("ver")
  .setDescription("🔍 Check the current Roblox version")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addStringOption((option) =>
    option
      .setName("channel")
      .setDescription("Roblox channel to check (default: LIVE)")
      .setRequired(false)
      .addChoices(
        ...ROBLOX_CHANNELS.map((channel) => ({
          name: channel,
          value: channel,
        })),
      ),
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  const channel = interaction.options.getString("channel") || "LIVE";
  // Cached (30s) + WEAO fallback for LIVE — previously a direct fetch with
  // neither, so every /ver hit Roblox and LIVE outages always errored.
  const version = await getRobloxVersion(channel);

  if (version) {
    interaction.reply({
      content: `Current version of \`${channel}\` is \`${version}\``,
      flags: MessageFlags.Ephemeral,
    });
  } else {
    interaction.reply({
      content: "❌ Could not fetch version info right now, please try again later",
      flags: MessageFlags.Ephemeral,
    });
  }
}
