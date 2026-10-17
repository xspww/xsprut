import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChatInputCommandInteraction,
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
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
import {
  deleteLocalPanelImage,
  panelImageDisplayUrl,
  panelImageFilesForPost,
  persistPanelImageFromUrl,
  resolvePanelImageInput,
} from "../lib/panelImage";

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
          .setDescription("📨 Channel for the verification panel (default: current channel)")
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
          .setDescription("📋 Panel title (default: Verify yourself)")
          .setRequired(false),
      )
      .addStringOption((o) =>
        o
          .setName("description")
          .setDescription("📝 Panel description shown under the title")
          .setRequired(false),
      )
      .addStringOption((o) =>
        o
          .setName("success_message")
          .setDescription("🎉 Message after verification (use {server} for the server name)")
          .setRequired(false),
      )
      .addAttachmentOption((o) =>
        o
          .setName("banner")
          .setDescription("🖼️ Banner image uploaded with the command (shown above the panel)")
          .setRequired(false),
      )
      .addStringOption((o) =>
        o
          .setName("banner_url")
          .setDescription("🔗 Banner image HTTPS link (ignored if a banner is uploaded)")
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

    if (!interaction.guildId) {
      return interaction.editReply("❌ This can only be used in a server");
    }

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

    // Optional banner image (upload wins over URL). Uploaded files are
    // persisted to the local store (like /protectroom) so re-running setup
    // keeps showing the banner the admin configured last time.
    const attachment = interaction.options.getAttachment("banner");
    const resolved = resolvePanelImageInput(
      attachment
        ? { url: attachment.url, name: attachment.name, contentType: attachment.contentType, size: attachment.size }
        : null,
      interaction.options.getString("banner_url"),
    );
    if (resolved.error) {
      return interaction.editReply(resolved.error);
    }

    const previous = getVerificationConfig(interaction.guildId);
    let storedImage: string | null = previous?.imageUrl ?? null;
    if (resolved.image?.kind === "attachment") {
      try {
        storedImage = await persistPanelImageFromUrl(resolved.image.url, resolved.image.filename, {
          contentType: attachment?.contentType,
          scope: "verify",
        });
      } catch (e: any) {
        return interaction.editReply(e?.message ?? "❌ Could not save the image");
      }
    } else if (resolved.image?.kind === "url") {
      storedImage = resolved.image.url;
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
      imageUrl: storedImage,
      createdAt: Date.now(),
    });
    // Swap happened — drop the replaced local copy (no-op for URLs).
    if (previous?.imageUrl && previous.imageUrl !== storedImage) {
      deleteLocalPanelImage(previous.imageUrl);
    }

    // Build the public verify panel as a Components v2 container.
    const bannerUrl = panelImageDisplayUrl(storedImage);
    const container = new ContainerBuilder().setAccentColor(0x22c55e);
    if (bannerUrl) {
      container
        .addMediaGalleryComponents(
          new MediaGalleryBuilder().addItems(
            new MediaGalleryItemBuilder().setURL(bannerUrl).setDescription("Verification banner"),
          ),
        )
        .addSeparatorComponents(new SeparatorBuilder());
    }
    container
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
      files: panelImageFilesForPost(storedImage),
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
    deleteLocalPanelImage(existing.imageUrl);
    return interaction.reply({
      content: "✅ Verification system disabled",
      flags: MessageFlags.Ephemeral,
    });
  }
}
