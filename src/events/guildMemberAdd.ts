import { GuildMember, Events, PermissionsBitField } from "discord.js";
import db from "../lib/db";
import { sendV2Message } from "../lib/v2Message";
import { createJoinAlertContainer } from "../lib/joinAlertCard";
import logger from "../lib/logger";

export const name = Events.GuildMemberAdd;
export const once = false;

export async function execute(member: GuildMember) {
  const guildId = member.guild?.id;
  if (!guildId) return;

  // ── Bot whitelist enforcement ────────────────────────────────────────────
  // If the joining member is a bot, only let it stay if its ID is in the
  // guild-scoped allowlist. Otherwise, kick it immediately.
  if (member.user?.bot) {
    const allowed = db
      .prepare(
        "SELECT 1 FROM allowedBots WHERE guildId = ? AND botId = ?",
      )
      .get(guildId, member.id);

    if (!allowed) {
      const botMember = member.guild.members.me;
      if (!botMember?.permissions.has(PermissionsBitField.Flags.KickMembers)) {
        logger.warn(
          `[BOT-GUARD] Cannot kick unauthorized bot ${member.id} in guild ${guildId} — missing Kick Members permission`,
        );
        return;
      }

      try {
        await member.kick("Unauthorized bot — not in allowlist");
        logger.warn(
          `[BOT-GUARD] Kicked unauthorized bot ${member.user.tag} (${member.id}) from guild ${guildId}`,
        );
      } catch (err) {
        logger.warn(
          `[BOT-GUARD] Failed to kick bot ${member.id} in guild ${guildId}: ${err}`,
        );
      }
      return;
    }

    // Bot is allowed — don't trigger member join alerts for bots.
    return;
  }
  // ────────────────────────────────────────────────────────────────────────

  const config = db
    .prepare(
      `
      SELECT channelId, customMessage
      FROM memberJoinAlerts
      WHERE guildId = ?
        AND enabled = 1
    `,
    )
    .get(guildId) as { channelId: string; customMessage: string } | undefined;

  if (!config) {
    return;
  }

  const channel = await member.guild.channels.fetch(config.channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) {
    return;
  }

  const botMember = member.guild.members.me;
  if (!botMember) {
    return;
  }

  const permissions = channel.permissionsFor(botMember);
  if (!permissions?.has(PermissionsBitField.Flags.ViewChannel) || !permissions?.has(PermissionsBitField.Flags.SendMessages)) {
    return;
  }

  // Components v2 welcome card — same design language as the executor status
  // cards: accent color, big heading, avatar thumbnail, pill values, footer.
  const container = createJoinAlertContainer({
    username: member.user.username,
    avatarUrl: member.displayAvatarURL(),
    accountCreatedUnix: Math.floor(member.user.createdTimestamp / 1000),
  });

  // Top text: mention (pings only the new member) + optional custom message.
  const content = `<@${member.id}>${config.customMessage ? ` ${config.customMessage}` : ""}`;

  await sendV2Message(channel, [container], content, {
    allowedMentions: { users: [member.id] },
  });
}
