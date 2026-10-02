import { getVoiceConnection } from "@discordjs/voice";
import {
  ChatInputCommandInteraction,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import { client } from "../lib/client";
import { collectKickedGuilds, deleteGuildData } from "../lib/guildCleanup";
import { clearDbCaches } from "../lib/dbCache";

export const data = new SlashCommandBuilder()
  .setName("cleanup")
  .setDescription("🧹 Clean up data for guilds the bot is no longer in (no restart needed)")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand((sub) =>
    sub.setName("run").setDescription("🧹 Immediately clean up data for guilds the bot is no longer in"),
  )
  .addSubcommand((sub) =>
    sub
      .setName("preview")
      .setDescription("👀 Preview guilds the bot is no longer in (without deleting)"),
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({
      content: "❌ Administrator permission required",
      flags: MessageFlags.Ephemeral,
    });
  }

  const sub = interaction.options.getSubcommand();
  const orphaned = collectKickedGuilds(client.guilds.cache.keys());

  if (sub === "preview") {
    if (orphaned.length === 0) {
      return interaction.reply({
        content: "✅ Nothing to clean up — all data belongs to guilds the bot is still in",
        flags: MessageFlags.Ephemeral,
      });
    }
    return interaction.reply({
      content: `📋 Guilds the bot is no longer in (will be deleted if you run \`/cleanup run\`):\n${orphaned
        .map((g) => `• \`${g}\``)
        .join("\n")}`,
      flags: MessageFlags.Ephemeral,
    });
  }

  if (orphaned.length === 0) {
    return interaction.reply({
      content: "✅ Nothing to clean up — all data belongs to guilds the bot is still in",
      flags: MessageFlags.Ephemeral,
    });
  }

  for (const guildId of orphaned) {
    try {
      const conn = getVoiceConnection(guildId);
      if (conn) conn.destroy();
    } catch {}
  }

  const deleted = deleteGuildData(orphaned);
  // Mass deletes touched every cached table — drop all cached rows so the next
  // read goes back to the (already updated) DB instead of serving stale data
  // for the TTL window. Matches the boot-time cleanup in guildCleanup.ts.
  clearDbCaches();

  return interaction.reply({
    content: `🧹 Cleaned up ${orphaned.length} guild(s) (${deleted} rows):\n${orphaned
      .map((g) => `• \`${g}\``)
      .join("\n")}`,
    flags: MessageFlags.Ephemeral,
  });
}
