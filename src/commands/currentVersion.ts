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
  .setDescription("🔍 ตรวจสอบเวอร์ชัน Roblox ปัจจุบัน")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addStringOption((option) =>
    option
      .setName("channel")
      .setDescription("ช่อง Roblox ที่ต้องการตรวจสอบ (ค่าเริ่มต้น: LIVE)")
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
      content: `เวอร์ชันปัจจุบันของ \`${channel}\` คือ \`${version}\``,
      flags: MessageFlags.Ephemeral,
    });
  } else {
    interaction.reply({
      content: "❌ ไม่สามารถดึงข้อมูลเวอร์ชันได้ในตอนนี้ กรุณาลองใหม่ภายหลัง",
      flags: MessageFlags.Ephemeral,
    });
  }
}
