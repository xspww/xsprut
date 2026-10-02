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
  .setDescription("✅ Manage the verification system (Captcha Verification)")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)

  // /verify setup
  .addSubcommand((sub) =>
    sub
      .setName("setup")
      .setDescription("🔧 Set up the verification system in this server")
      .addRoleOption((o) =>
        o
          .setName("verified_role")
          .setDescription("🎖️ Role to grant upon successful verification")
          .setRequired(true),
      )
      .addChannelOption((o) =>
        o
          .setName("channel")
          .setDescription("📨 Channel to send the verification panel to (default: current channel)")
          .setRequired(false),
      )
      .addRoleOption((o) =>
        o
          .setName("unverified_role")
          .setDescription("🚫 Role to remove upon successful verification (e.g. Unverified)")
          .setRequired(false),
      )
      .addStringOption((o) =>
        o
          .setName("title")
          .setDescription("📋 Title of the verification panel embed (default: Verify yourself)")
          .setRequired(false),
      )
      .addStringOption((o) =>
        o
          .setName("description")
          .setDescription("📝 Description of the verification panel embed")
          .setRequired(false),
      )
      .addStringOption((o) =>
        o
          .setName("success_message")
          .setDescription("🎉 Message shown upon successful verification (use {server} for the server name)")
          .setRequired(false),
      ),
  )

  // /verify remove
  .addSubcommand((sub) =>
    sub
      .setName("remove")
      .setDescription("🗑️ Disable the verification system in this server"),
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
      return interaction.editReply("❌ This can only be used in a server");
    }

    if (!targetChannel || !("send" in targetChannel)) {
      return interaction.editReply("❌ Unable to send a message to this channel");
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
      ? `✅ Grant: ${verifiedRole}\n🚫 Remove: ${unverifiedRole}`
      : `✅ Grant: ${verifiedRole}`;

    return interaction.editReply(
      `✅ Verification system set up!\n${roleList}\n📨 Verification panel sent to ${targetChannel}`,
    );
  }

  if (sub === "remove") {
    if (!interaction.guildId) {
      return interaction.reply({ content: "❌ This can only be used in a server", flags: MessageFlags.Ephemeral });
    }

    const existing = getVerificationConfig(interaction.guildId);
    if (!existing) {
      return interaction.reply({
        content: "❌ No verification system is configured in this server",
        flags: MessageFlags.Ephemeral,
      });
    }

    disableVerificationConfig(interaction.guildId);
    return interaction.reply({
      content: "✅ Verification system disabled",
      flags: MessageFlags.Ephemeral,
    });
  }
}
