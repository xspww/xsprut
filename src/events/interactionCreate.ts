import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  Events,
  Interaction,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  ModalBuilder,
  SeparatorBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { client } from "../lib/client";
import logger from "../lib/logger";
import config from "../lib/config";
import { checkCooldown, formatCooldown } from "../lib/cooldown";
import { reportError } from "../lib/errorReporter";
import {
  createCaptchaSession,
  validateCaptchaSession,
  getVerificationConfig,
} from "../lib/verifyManager";
import { renderCaptchaImage } from "../lib/captchaImage";

export const name = Events.InteractionCreate;

export async function execute(interaction: Interaction) {
  // ─── Slash Commands ────────────────────────────────────────────────────────
  if (interaction.isChatInputCommand()) {
    try {
      logger.info(`Received command interaction: ${interaction.commandName} from ${interaction.user?.tag ?? interaction.user?.id}`);
    } catch {}

    // ✅ Restrict to allowed users (if list is non‑empty)
    const allowed = config.ALLOWED_USER_IDS;
    if (allowed.length > 0 && !allowed.includes(interaction.user.id)) {
      try {
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({ content: "You are not authorized to use this bot", flags: 64 });
        } else {
          await interaction.reply({ content: "You are not authorized to use this bot", flags: 64 });
        }
      } catch {}
      return;
    }

    const command = client.commands.get(interaction.commandName);
    if (!command) {
      logger.error(`No command matching ${interaction.commandName} was found.`);
      try {
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({ content: "This command is unavailable (command not found)", flags: 64 });
        } else {
          await interaction.reply({ content: "This command is unavailable (command not found)", flags: 64 });
        }
      } catch (e) {
        logger.warn(`Failed to notify about missing command ${interaction.commandName}:`, e);
      }
      return;
    }

    // ─── Anti-spam cooldown (rate limiting) ────────────────────────────────
    // Commands may export a custom `cooldownMs`; 0 disables the cooldown for
    // that command. Default comes from COMMAND_COOLDOWN_MS (5s).
    const cooldownMs = (command as any).cooldownMs ?? config.COMMAND_COOLDOWN_MS;
    if (cooldownMs > 0) {
      const remaining = checkCooldown(
        `${interaction.user.id}:${interaction.commandName}`,
        cooldownMs,
      );
      if (remaining > 0) {
        try {
          await interaction.reply({
            content: `⏳ You're using this command too quickly. Please wait **${formatCooldown(remaining)}** before trying again`,
            flags: 64,
          });
          // Auto-delete the warning after COOLDOWN_MESSAGE_TTL_MS so it never
          // litters the chat. The timer is unref'd — it must not keep the
          // process alive on its own.
          if (config.COOLDOWN_MESSAGE_TTL_MS > 0) {
            const timer = setTimeout(async () => {
              try {
                await interaction.deleteReply();
              } catch {
                // Reply already gone (user dismissed it / interaction expired) — fine.
              }
            }, config.COOLDOWN_MESSAGE_TTL_MS);
            timer.unref?.();
          }
        } catch (e) {
          logger.warn(`Failed to send cooldown reply for ${interaction.commandName}:`, e);
        }
        return;
      }
    }

    try {
      await command.execute(interaction);
    } catch (error) {
      logger.error(`Error executing command ${interaction.commandName}:`, error);
      reportError(
        `Command error: /${interaction.commandName}`,
        error,
        `User: ${interaction.user.tag} (${interaction.user.id})`,
      );
      try {
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({ content: "An error occurred while processing this command!", flags: 64 });
        } else {
          await interaction.reply({ content: "An error occurred while processing this command!", flags: 64 });
        }
      } catch (e) {
        logger.warn(`Failed to send error reply for ${interaction.commandName}:`, e);
      }
    }

  // ─── Autocomplete ──────────────────────────────────────────────────────────
  } else if (interaction.isAutocomplete()) {
    const command = client.commands.get(interaction.commandName);
    if (!command) return;
    try {
      if (command.autocomplete) {
        await command.autocomplete(interaction);
      }
    } catch (error) {
      logger.error(`Error executing autocomplete for ${interaction.commandName}:`, error);
    }

  // ─── Button Interactions ───────────────────────────────────────────────────
  } else if (interaction.isButton()) {
    const { customId, user, guildId } = interaction;

    // User pressed the "Verify" button on the verification panel
    if (customId === "verify_start") {
      try {
        if (!guildId) return;
        const cfg = getVerificationConfig(guildId);
        if (!cfg) {
          return interaction.reply({ content: "❌ Verification is not set up in this server", flags: 64 });
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
          return interaction.reply({ content: "❌ An error occurred, please try again", flags: 64 });
        } catch {}
      }
    }

    // User pressed the "Enter code" button — show the Modal
    if (customId === "verify_enter_code") {
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

  // ─── Modal Submissions ─────────────────────────────────────────────────────
  } else if (interaction.isModalSubmit()) {
    if (interaction.customId !== "verify_modal_submit") return;

    const { user, guildId, guild } = interaction;
    if (!guildId || !guild) {
      return interaction.reply({ content: "❌ This can only be used in a server", flags: 64 });
    }

    const cfg = getVerificationConfig(guildId);
    if (!cfg) {
      return interaction.reply({ content: "❌ Verification is not set up in this server", flags: 64 });
    }

    const inputCode = interaction.fields.getTextInputValue("captcha_input").trim();
    const result = validateCaptchaSession(user.id, inputCode);

    if (result === "expired") {
      return interaction.reply({ content: "⏰ The code has expired. Please press **Verify** again", flags: 64 });
    }
    if (result === "not_found") {
      return interaction.reply({ content: "❓ Session not found. Please press **Verify** again", flags: 64 });
    }
    if (result === "wrong") {
      return interaction.reply({ content: "❌ Incorrect code. Please press **Verify** again", flags: 64 });
    }

    // ✅ Correct! Grant/remove roles
    try {
      const member = await guild.members.fetch(user.id);

      // Give verified role
      await member.roles.add(cfg.verifiedRoleId, "Captcha verification passed");

      // Remove unverified role if configured
      if (cfg.unverifiedRoleId) {
        await member.roles.remove(cfg.unverifiedRoleId, "Captcha verification passed").catch(() => {});
      }

      const successMsg = cfg.successMessage.replace("{server}", guild.name);
      return interaction.reply({ content: `✅ ${successMsg}`, flags: 64 });
    } catch (err) {
      logger.error(`Failed to assign verified role to ${user.id}:`, err);
      return interaction.reply({
        content: "❌ Failed to assign the role. Please contact an admin",
        flags: 64,
      });
    }
  }
}

