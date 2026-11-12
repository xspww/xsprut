import {
  MessageFlags,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
} from "discord.js";
import { client } from "../../lib/client";
import config from "../../lib/config";
import logger from "../../lib/logger";
import { checkCooldown, formatCooldown } from "../../lib/cooldown";
import { reportError } from "../../lib/errorReporter";
import type { Command } from "../../commands";

/** Slash-command dispatch: allow-list, rate limit, then the command itself. */
export async function handleSlashCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  try {
    logger.info(
      `Received command interaction: ${interaction.commandName} from ${interaction.user?.tag ?? interaction.user?.id}`,
    );
  } catch (e) {
    logger.warn("Interaction error: ", e);
  }

  // ✅ Restrict to allowed users (if list is non‑empty)
  const allowed = config.ALLOWED_USER_IDS;
  if (allowed.length > 0 && !allowed.includes(interaction.user.id)) {
    await replyOrFollowUp(
      interaction,
      "You are not authorized to use this bot",
      "Embed refresh error: ",
    );
    return;
  }

  const command = client.commands.get(interaction.commandName);
  if (!command) {
    logger.error(`No command matching ${interaction.commandName} was found.`);
    await replyOrFollowUp(
      interaction,
      "This command is unavailable (command not found)",
      `Failed to notify about missing command ${interaction.commandName}:`,
    );
    return;
  }

  // ─── Anti-spam cooldown (rate limiting) ────────────────────────────────
  // Commands may export a custom `cooldownMs`; 0 disables the cooldown for
  // that command. Default comes from COMMAND_COOLDOWN_MS (5s).
  if (!(await passCooldown(interaction, command))) return;

  try {
    await command.execute(interaction);
  } catch (error) {
    logger.error(`Error executing command ${interaction.commandName}:`, error);
    reportError(
      `Command error: /${interaction.commandName}`,
      error,
      `User: ${interaction.user.tag} (${interaction.user.id})`,
    );
    await replyOrFollowUp(
      interaction,
      "An error occurred while processing this command!",
      `Failed to send error reply for ${interaction.commandName}:`,
    );
  }
}

/**
 * Apply the per-command rate limit.
 *
 * Returns false when the command is on cooldown — the warning has already
 * been sent and the caller must stop.
 */
async function passCooldown(
  interaction: ChatInputCommandInteraction,
  command: Command,
): Promise<boolean> {
  const cooldownMs = command.cooldownMs ?? config.COMMAND_COOLDOWN_MS;
  if (cooldownMs <= 0) return true;

  const remaining = checkCooldown(
    `${interaction.user.id}:${interaction.commandName}`,
    cooldownMs,
  );
  if (remaining <= 0) return true;

  try {
    await interaction.reply({
      content: `⏳ You're using this command too quickly. Please wait **${formatCooldown(remaining)}** before trying again`,
      flags: MessageFlags.Ephemeral,
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
  return false;
}

/**
 * Reply to an interaction, following up instead when it was already
 * answered. Failures are logged with `warnPrefix` and swallowed — the
 * interaction may already be gone.
 */
async function replyOrFollowUp(
  interaction: ChatInputCommandInteraction,
  content: string,
  warnPrefix: string,
): Promise<void> {
  try {
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
    } else {
      await interaction.reply({ content, flags: MessageFlags.Ephemeral });
    }
  } catch (e) {
    logger.warn(warnPrefix, e);
  }
}

/** Autocomplete dispatch. */
export async function handleAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const command = client.commands.get(interaction.commandName);
  if (!command) return;
  try {
    if (command.autocomplete) {
      await command.autocomplete(interaction);
    }
  } catch (error) {
    logger.error(`Error executing autocomplete for ${interaction.commandName}:`, error);
  }
}
