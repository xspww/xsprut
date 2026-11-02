import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from "discord.js";
import { buildMainMenu } from "../lib/panel";

export const data = new SlashCommandBuilder()
  .setName("panel")
  .setDescription("🎛️ เปิด Server Configuration Panel")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(interaction: any) {
  if (!interaction.guildId) {
    return interaction.reply({ content: "❌ ใช้ได้เฉพาะใน server", flags: MessageFlags.Ephemeral });
  }
  const container = buildMainMenu();
  return interaction.reply({
    components: [container],
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
  });
}