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
  type APIRole,
  type Role,
  TextDisplayBuilder,
} from "discord.js";
import {
  getVerificationConfig,
  saveVerificationConfig,
  disableVerificationConfig,
  deleteInviteCodesForGuild,
  updatePanelMessageId,
  type VerificationMode,
} from "../lib/verifyManager";
import { errorMessage } from "../lib/errorMessage";
import {
  deleteLocalPanelImage,
  panelImageDisplayUrl,
  panelImageFilesForPost,
  persistPanelImageFromUrl,
  resolvePanelImageInput,
} from "../lib/panelImage";
import { buildVerifyPublicContainer } from "../lib/panel";

export const data = new SlashCommandBuilder()
  .setName("verify")
  .setDescription("✅ Manage the verification system (Captcha or invite code)")
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
      // Discord rejects required options that come after optional ones, so
      // `mode` must stay with the other required option at the top.
      .addStringOption((o) =>
        o
          .setName("mode")
          .setDescription("🔐 Verification method (Captcha or Code)")
          .setRequired(true)
          .addChoices(
            { name: "Captcha — solve an image code", value: "captcha" },
            { name: "Code — member sends invite + code", value: "code" },
          ),
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
  switch (interaction.options.getSubcommand()) {
    case "setup":
      return verifySetup(interaction);
    case "remove":
      return verifyRemove(interaction);
    default:
      return interaction.reply({
        content: "❌ Unknown subcommand",
        flags: MessageFlags.Ephemeral,
      });
  }
}

/** /verify setup — configure the verification system for this server. */
async function verifySetup(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (!interaction.guildId) {
    return interaction.editReply("❌ This can only be used in a server");
  }

  // Preserve the current mode when the option is absent. That happens only
  // when the command definition has not been re-registered yet; silently
  // dropping a Code-mode server to Captcha would also invalidate its codes.
  const previous = getVerificationConfig(interaction.guildId);
  const settings = readVerifySettings(interaction, previous);

  const storedImage = await resolveStoredBanner(interaction, previous?.imageUrl ?? null);
  if (storedImage === undefined) return;

  const targetChannel = interaction.options.getChannel("channel") ?? interaction.channel;
  if (!targetChannel || !("send" in targetChannel)) {
    return interaction.editReply("❌ Unable to send a message to this channel");
  }

  const verifiedRole = interaction.options.getRole("verified_role", true);
  const unverifiedRole = interaction.options.getRole("unverified_role");

  saveVerificationConfig({
    guildId: interaction.guildId,
    channelId: targetChannel.id,
    verifiedRoleId: verifiedRole.id,
    unverifiedRoleId: unverifiedRole?.id ?? null,
    embedTitle: settings.embedTitle,
    embedDescription: settings.embedDescription,
    successMessage: settings.successMessage,
    imageUrl: storedImage,
    verificationMode: settings.mode,
    createdAt: Date.now(),
  });
  // Swap happened — drop the replaced local copy (no-op for URLs).
  if (previous?.imageUrl && previous.imageUrl !== storedImage) {
    deleteLocalPanelImage(previous.imageUrl);
  }
  // Any setup that is not Code mode invalidates every outstanding invite
  // code. Staying in Code mode must not wipe codes still in circulation.
  // (Unconditional for non-Code modes so stale rows from a manually
  // disabled config cannot revive if Code mode is re-enabled later.)
  if (settings.mode !== "code") {
    deleteInviteCodesForGuild(interaction.guildId);
  }

  // Build the public verify panel as a Components v2 container.
  const container = buildVerifyPublicContainer({
    embedTitle: settings.embedTitle,
    embedDescription: settings.embedDescription,
    mode: settings.mode,
    imageUrl: storedImage,
  });

  const sentPanel = await (targetChannel as TextChannel).send({
    components: [container],
    files: panelImageFilesForPost(storedImage),
    flags: MessageFlags.IsComponentsV2,
  });
  updatePanelMessageId(interaction.guildId, sentPanel.id);

  return interaction.editReply(buildSetupReply({
    mode: settings.mode,
    verifiedRole,
    unverifiedRole,
    targetChannel,
  }));
}

/** The panel texts and mode the user asked for. */
type VerifySettings = {
  mode: VerificationMode;
  embedTitle: string;
  embedDescription: string;
  successMessage: string;
};

/** Read the panel texts and the mode out of the command options. */
function readVerifySettings(
  interaction: ChatInputCommandInteraction,
  previous: ReturnType<typeof getVerificationConfig>,
): VerifySettings {
  const mode = resolveRequestedMode(interaction, previous);
  return {
    mode,
    embedTitle: interaction.options.getString("title") ?? "Verify yourself",
    embedDescription:
      interaction.options.getString("description") ??
      (mode === "code"
        ? "Click the button below and enter the code that came with your invite."
        : "Click the button below and solve the short captcha to unlock the server."),
    successMessage:
      interaction.options.getString("success_message") ??
      "You're verified. Welcome to {server}!",
  };
}

/** The verification mode to apply — the option, or the one already stored. */
function resolveRequestedMode(
  interaction: ChatInputCommandInteraction,
  previous: ReturnType<typeof getVerificationConfig>,
): VerificationMode {
  const requestedMode = interaction.options.getString("mode");
  if (requestedMode === "code" || requestedMode === "captcha") return requestedMode;
  return previous?.verificationMode ?? "captcha";
}

/**
 * Store the optional banner image (upload wins over URL).
 *
 * Returns the stored image path, or undefined when the value was rejected —
 * the reply has been sent in that case.
 */
async function resolveStoredBanner(
  interaction: ChatInputCommandInteraction,
  current: string | null,
): Promise<string | null | undefined> {
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
    await interaction.editReply(resolved.error);
    return undefined;
  }

  if (resolved.image?.kind === "attachment") {
    try {
      return await persistPanelImageFromUrl(resolved.image.url, resolved.image.filename, {
        contentType: attachment?.contentType,
        scope: "verify",
      });
    } catch (e) {
      await interaction.editReply(errorMessage(e) ?? "❌ Could not save the image");
      return undefined;
    }
  }
  if (resolved.image?.kind === "url") {
    return resolved.image.url;
  }
  return current;
}

/** The confirmation text of a successful setup. */
function buildSetupReply(opts: {
  mode: VerificationMode;
  verifiedRole: Role | APIRole;
  unverifiedRole: Role | APIRole | null;
  targetChannel: { id: string };
}): string {
  const roleList = opts.unverifiedRole
    ? `✅ Grant: ${opts.verifiedRole}\n🚫 Remove: ${opts.unverifiedRole}`
    : `✅ Grant: ${opts.verifiedRole}`;
  const modeLine =
    opts.mode === "code"
      ? "🔑 Mode: **Code** — `?inv` now includes one single-use code per invite"
      : "🔐 Mode: **Captcha** — users solve an image code";
  const codeHint =
    opts.mode === "code"
      ? "\n💡 A member must send the invited user both the invite link and its code." +
        "\n🔒 Run `?inv` where only trusted members can read the channel."
      : "";

  return (
    `✅ Verification system set up!\n${modeLine}\n${roleList}` +
    `\n📨 Verification panel sent to ${opts.targetChannel}${codeHint}`
  );
}

/** /verify remove — turn the verification system off. */
async function verifyRemove(interaction: ChatInputCommandInteraction) {
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
  deleteInviteCodesForGuild(interaction.guildId);
  deleteLocalPanelImage(existing.imageUrl);
  return interaction.reply({
    content: "✅ Verification system disabled",
    flags: MessageFlags.Ephemeral,
  });
}
