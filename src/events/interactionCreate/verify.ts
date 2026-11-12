import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  ModalBuilder,
  SeparatorBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type Guild,
  type ModalSubmitInteraction,
} from "discord.js";
import logger from "../../lib/logger";
import { renderCaptchaImage } from "../../lib/captchaImage";
import {
  consumeInviteCode,
  createCaptchaSession,
  getVerificationConfig,
  releaseInviteCode,
  validateCaptchaSession,
  validateInviteCode,
  type VerificationConfig,
} from "../../lib/verifyManager";

/**
 * The verification flow: the "Verify" button, the captcha modal and the
 * invite-code modal.
 */

/** Modal shown in Code mode. One field: the code from the invite. */
export function buildInviteCodeModal(): ModalBuilder {
  return new ModalBuilder()
    .setCustomId("verify_code_modal_submit")
    .setTitle("Enter Verification Code")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("invite_code_input")
          .setLabel("Code from your invite")
          .setStyle(TextInputStyle.Short)
          .setMinLength(11)
          .setMaxLength(16)
          .setPlaceholder("XXXX-XXX-XXXX")
          .setRequired(true),
      ),
    );
}

/** Shared role swap for both verification modes. */
async function grantVerifiedRole(
  guild: Guild,
  userId: string,
  cfg: VerificationConfig,
): Promise<void> {
  const member = await guild.members.fetch(userId);
  await member.roles.add(cfg.verifiedRoleId, "Verification passed");
  if (cfg.unverifiedRoleId) {
    await member.roles.remove(cfg.unverifiedRoleId, "Verification passed").catch(() => {});
  }
}

// ─── Buttons ───────────────────────────────────────────────────────────────

/** The verification buttons on the panel and on the public message. */
export async function handleVerifyButton(interaction: ButtonInteraction): Promise<unknown> {
  if (interaction.customId === "verify_start") {
    await handleVerifyStart(interaction);
    return;
  }
  if (interaction.customId === "verify_enter_code") {
    await showCaptchaInputModal(interaction);
  }
}

/** "Verify" — start the flow, either the captcha card or the invite-code modal. */
async function handleVerifyStart(interaction: ButtonInteraction): Promise<unknown> {
  const { user, guildId } = interaction;
  try {
    if (!guildId) return;
    const cfg = getVerificationConfig(guildId);
    if (!cfg) {
      return interaction.reply({
        content: "❌ Verification is not set up in this server",
        flags: MessageFlags.Ephemeral,
      });
    }

    // Code mode: the invited user enters the code that came with their
    // invite. No image captcha is generated in this mode.
    if (cfg.verificationMode === "code") {
      return interaction.showModal(buildInviteCodeModal());
    }

    const code = createCaptchaSession(user.id);

    // Components v2 captcha card — the code is rendered as an image
    // (PNG with noise) so it cannot be scraped as plain text.
    const captchaImage = renderCaptchaImage(code);
    const container = new ContainerBuilder()
      .setAccentColor(0x5865f2)
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent("**🔐 Solve the captcha**"),
        new TextDisplayBuilder().setContent(
          "Enter the **4 digits** shown in the image below. You have **3 minutes**.",
        ),
      )
      .addMediaGalleryComponents(
        new MediaGalleryBuilder().addItems(
          new MediaGalleryItemBuilder()
            .setURL("attachment://captcha.png")
            .setDescription("Captcha code"),
        ),
      )
      .addSeparatorComponents(new SeparatorBuilder())
      .addActionRowComponents(
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId("verify_enter_code")
            .setLabel("Enter code")
            .setStyle(ButtonStyle.Primary),
        ),
      );

    return interaction.reply({
      components: [container],
      files: [{ attachment: captchaImage, name: "captcha.png" }],
      flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    });
  } catch (err) {
    logger.error("Error in verify_start button handler:", err);
    try {
      return interaction.reply({
        content: "❌ An error occurred, please try again",
        flags: MessageFlags.Ephemeral,
      });
    } catch (e) {
      logger.warn("Button interaction error: ", e);
    }
  }
}

/** "Enter code" — show the modal that asks for the captcha digits. */
async function showCaptchaInputModal(interaction: ButtonInteraction): Promise<unknown> {
  const modal = new ModalBuilder()
    .setCustomId("verify_modal_submit")
    .setTitle("Enter Captcha Code");

  const input = new TextInputBuilder()
    .setCustomId("captcha_input")
    .setLabel("Enter the 4-digit code")
    .setStyle(TextInputStyle.Short)
    .setMinLength(4)
    .setMaxLength(4)
    .setPlaceholder("e.g. 9985")
    .setRequired(true);

  modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
  return interaction.showModal(modal);
}

// ─── Modals ────────────────────────────────────────────────────────────────

/** The captcha and invite-code modals. */
export async function handleVerifyModal(interaction: ModalSubmitInteraction): Promise<unknown> {
  if (interaction.customId === "verify_modal_submit") {
    await handleCaptchaModal(interaction);
    return;
  }
  if (interaction.customId === "verify_code_modal_submit") {
    await handleInviteCodeModal(interaction);
  }
}

/** Captcha mode — check the four digits the user typed. */
async function handleCaptchaModal(interaction: ModalSubmitInteraction): Promise<unknown> {
  const { user, guildId, guild } = interaction;
  if (!guildId || !guild) {
    return interaction.reply({
      content: "❌ This can only be used in a server",
      flags: MessageFlags.Ephemeral,
    });
  }

  const cfg = getVerificationConfig(guildId);
  if (!cfg) {
    return interaction.reply({
      content: "❌ Verification is not set up in this server",
      flags: MessageFlags.Ephemeral,
    });
  }
  if (cfg.verificationMode !== "captcha") {
    return interaction.reply({
      content: "❌ Captcha verification is not enabled in this server",
      flags: MessageFlags.Ephemeral,
    });
  }

  const inputCode = interaction.fields.getTextInputValue("captcha_input").trim();
  const result = validateCaptchaSession(user.id, inputCode);

  if (result === "expired") {
    return interaction.reply({
      content: "⏰ The code has expired. Please press **Verify** again",
      flags: MessageFlags.Ephemeral,
    });
  }
  if (result === "not_found") {
    return interaction.reply({
      content: "❓ Session not found. Please press **Verify** again",
      flags: MessageFlags.Ephemeral,
    });
  }
  if (result === "wrong") {
    return interaction.reply({
      content: "❌ Incorrect code. Please press **Verify** again",
      flags: MessageFlags.Ephemeral,
    });
  }
  if (result === "locked") {
    return interaction.reply({
      content: "🚫 Too many incorrect attempts. Please press **Verify** to get a new code",
      flags: MessageFlags.Ephemeral,
    });
  }

  // ✅ Correct! Acknowledge before the role REST calls so a slow fetch /
  // rate-limited role update cannot blow Discord's 3-second window.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    await grantVerifiedRole(guild, user.id, cfg);
  } catch (err) {
    logger.error(`Failed to assign verified role to ${user.id}:`, err);
    return interaction.editReply({
      content: "❌ Failed to assign the role. Please contact an admin",
    });
  }

  const successMsg = cfg.successMessage.replace("{server}", guild.name);
  return interaction.editReply({ content: `✅ ${successMsg}` });
}

/** Code mode — check the single-use code that came with the invite. */
async function handleInviteCodeModal(interaction: ModalSubmitInteraction): Promise<unknown> {
  const { user, guildId, guild } = interaction;
  if (!guildId || !guild) {
    return interaction.reply({
      content: "❌ This can only be used in a server",
      flags: MessageFlags.Ephemeral,
    });
  }

  const cfg = getVerificationConfig(guildId);
  if (!cfg) {
    return interaction.reply({
      content: "❌ Verification is not set up in this server",
      flags: MessageFlags.Ephemeral,
    });
  }
  if (cfg.verificationMode !== "code") {
    return interaction.reply({
      content: "❌ Code verification is not enabled in this server",
      flags: MessageFlags.Ephemeral,
    });
  }

  const inputCode = interaction.fields.getTextInputValue("invite_code_input").trim();
  const validation = validateInviteCode(guildId, inputCode);

  if (validation.status === "expired") {
    return interaction.reply({
      content: "⏰ This code has expired. Ask the member who invited you for a new invite and code.",
      flags: MessageFlags.Ephemeral,
    });
  }
  if (validation.status === "used") {
    return interaction.reply({
      content: "🚫 This code has already been used. Each invite code works only once.",
      flags: MessageFlags.Ephemeral,
    });
  }
  if (validation.status !== "correct") {
    return interaction.reply({
      content: "❌ Invalid or expired code. Check the `XXXX-XXX-XXXX` code that came with your invite.",
      flags: MessageFlags.Ephemeral,
    });
  }

  // Acknowledge before consuming / role REST calls so a slow fetch or
  // rate-limited role update cannot blow Discord's 3-second window.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  // Consume before granting the role so two people cannot race the same
  // code. If Discord rejects the role change, release it again.
  const consumed = consumeInviteCode(validation.record.codeHash, user.id);
  if (!consumed) {
    return interaction.editReply({
      content: "🚫 This code is no longer valid. It may have expired or already been used.",
    });
  }

  try {
    await grantVerifiedRole(guild, user.id, cfg);
  } catch (err) {
    // Only release when the role grant itself failed. If the success
    // reply below fails, the role was already granted — releasing would
    // make the one-time code reusable.
    releaseInviteCode(validation.record.codeHash, user.id);
    logger.error(`Failed to assign verified role to ${user.id} (code mode):`, err);
    return interaction.editReply({
      content: "❌ Failed to assign the role. Please contact an admin",
    });
  }

  const successMsg = cfg.successMessage.replace("{server}", guild.name);
  return interaction.editReply({ content: `✅ ${successMsg}` });
}
