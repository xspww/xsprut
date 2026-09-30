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
  .setDescription("🧹 ล้างข้อมูล guild ที่บอทไม่ได้อยู่แล้ว (ไม่ต้อง restart)")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand((sub) =>
    sub.setName("run").setDescription("🧹 ล้างข้อมูล guild ที่บอทไม่ได้อยู่แล้วทันที"),
  )
  .addSubcommand((sub) =>
    sub
      .setName("preview")
      .setDescription("👀 ดูตัวอย่าง guild ที่บอทไม่ได้อยู่แล้ว (ยังไม่ลบ)"),
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({
      content: "❌ ต้องมีสิทธิ์ Administrator",
      flags: MessageFlags.Ephemeral,
    });
  }

  const sub = interaction.options.getSubcommand();
  const orphaned = collectKickedGuilds(client.guilds.cache.keys());

  if (sub === "preview") {
    if (orphaned.length === 0) {
      return interaction.reply({
        content: "✅ ไม่มี guild ที่ต้องล้าง — ข้อมูลทั้งหมดเป็นของ guild ที่บอทยังอยู่",
        flags: MessageFlags.Ephemeral,
      });
    }
    return interaction.reply({
      content: `📋 Guild ที่บอทไม่ได้อยู่แล้ว (จะถูกลบถ้ารัน \`/cleanup run\`):\n${orphaned
        .map((g) => `• \`${g}\``)
        .join("\n")}`,
      flags: MessageFlags.Ephemeral,
    });
  }

  if (orphaned.length === 0) {
    return interaction.reply({
      content: "✅ ไม่มี guild ที่ต้องล้าง — ข้อมูลทั้งหมดเป็นของ guild ที่บอทยังอยู่",
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
    content: `🧹 ล้างข้อมูล ${orphaned.length} guild แล้ว (${deleted} แถว):\n${orphaned
      .map((g) => `• \`${g}\``)
      .join("\n")}`,
    flags: MessageFlags.Ephemeral,
  });
}
