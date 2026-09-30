import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChatInputCommandInteraction,
  ContainerBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SeparatorBuilder,
  SlashCommandBuilder,
  TextChannel,
  TextDisplayBuilder,
} from "discord.js";
import {
  getVerificationConfig,
  saveVerificationConfig,
  disableVerificationConfig,
} from "../lib/verifyManager";

export const data = new SlashCommandBuilder()
  .setName("verify")
  .setDescription("✅ จัดการระบบยืนยันตัวตน (Captcha Verification)")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)

  // /verify setup
  .addSubcommand((sub) =>
    sub
      .setName("setup")
      .setDescription("🔧 ตั้งค่าระบบยืนยันตัวตนในเซิร์ฟเวอร์")
      .addRoleOption((o) =>
        o
          .setName("verified_role")
          .setDescription("🎖️ ยศที่จะให้เมื่อยืนยันสำเร็จ")
          .setRequired(true),
      )
      .addChannelOption((o) =>
        o
          .setName("channel")
          .setDescription("📨 ห้องที่จะส่งป้ายยืนยันตัวตน (ค่าเริ่มต้น: ห้องปัจจุบัน)")
          .setRequired(false),
      )
      .addRoleOption((o) =>
        o
          .setName("unverified_role")
          .setDescription("🚫 ยศที่จะถอดออกเมื่อยืนยันสำเร็จ (เช่น Unverified)")
          .setRequired(false),
      )
      .addStringOption((o) =>
        o
          .setName("title")
          .setDescription("📋 หัวข้อของ Embed ป้ายยืนยัน (ค่าเริ่มต้น: Verify yourself)")
          .setRequired(false),
      )
      .addStringOption((o) =>
        o
          .setName("description")
          .setDescription("📝 รายละเอียดของ Embed ป้ายยืนยัน")
          .setRequired(false),
      )
      .addStringOption((o) =>
        o
          .setName("success_message")
          .setDescription("🎉 ข้อความแสดงเมื่อยืนยันสำเร็จ (ใช้ {server} แทนชื่อเซิร์ฟเวอร์)")
          .setRequired(false),
      ),
  )

  // /verify remove
  .addSubcommand((sub) =>
    sub
      .setName("remove")
      .setDescription("🗑️ ปิดการใช้งานระบบยืนยันตัวตนในเซิร์ฟเวอร์"),
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  const sub = interaction.options.getSubcommand();

  if (sub === "setup") {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const verifiedRole = interaction.options.getRole("verified_role", true);
    const unverifiedRole = interaction.options.getRole("unverified_role");
    const targetChannel = interaction.options.getChannel("channel") ?? interaction.channel;
    const embedTitle = interaction.options.getString("title") ?? "Verify yourself";
    const embedDescription =
      interaction.options.getString("description") ??
      "Click the button below and solve the short captcha to unlock the server.";
    const successMessage =
      interaction.options.getString("success_message") ??
      "You're verified. Welcome to {server}!";

    if (!interaction.guildId) {
      return interaction.editReply("❌ ต้องใช้งานในเซิร์ฟเวอร์เท่านั้น");
    }

    if (!targetChannel || !("send" in targetChannel)) {
      return interaction.editReply("❌ ไม่สามารถส่งข้อความไปยังห้องนี้ได้");
    }

    saveVerificationConfig({
      guildId: interaction.guildId,
      channelId: targetChannel.id,
      verifiedRoleId: verifiedRole.id,
      unverifiedRoleId: unverifiedRole?.id ?? null,
      embedTitle,
      embedDescription,
      successMessage,
      createdAt: Date.now(),
    });

    // Build the public verify panel as a Components v2 container
    const container = new ContainerBuilder()
      .setAccentColor(0x22c55e)
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`# ${embedTitle}`),
        new TextDisplayBuilder().setContent(embedDescription),
      )
      .addSeparatorComponents(new SeparatorBuilder())
      .addActionRowComponents(
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId("verify_start")
            .setLabel("Verify")
            .setStyle(ButtonStyle.Success)
            .setEmoji("✅"),
        ),
      );

    await (targetChannel as TextChannel).send({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
    });

    const roleList = unverifiedRole
      ? `✅ ให้: ${verifiedRole}\n🚫 ถอด: ${unverifiedRole}`
      : `✅ ให้: ${verifiedRole}`;

    return interaction.editReply(
      `✅ ตั้งค่าระบบยืนยันตัวตนเรียบร้อยแล้ว!\n${roleList}\n📨 ส่งป้ายยืนยันไปยัง ${targetChannel}`,
    );
  }

  if (sub === "remove") {
    if (!interaction.guildId) {
      return interaction.reply({ content: "❌ ต้องใช้งานในเซิร์ฟเวอร์เท่านั้น", flags: MessageFlags.Ephemeral });
    }

    const existing = getVerificationConfig(interaction.guildId);
    if (!existing) {
      return interaction.reply({
        content: "❌ ไม่มีการตั้งค่าระบบยืนยันตัวตนในเซิร์ฟเวอร์นี้",
        flags: MessageFlags.Ephemeral,
      });
    }

    disableVerificationConfig(interaction.guildId);
    return interaction.reply({
      content: "✅ ปิดระบบยืนยันตัวตนเรียบร้อยแล้ว",
      flags: MessageFlags.Ephemeral,
    });
  }
}
