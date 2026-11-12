import {
  ContainerBuilder,
  Message,
  MessageFlags,
  PermissionFlagsBits,
  SeparatorBuilder,
  TextChannel,
  TextDisplayBuilder,
} from "discord.js";
import config from "../../lib/config";
import logger from "../../lib/logger";
import { checkCooldown } from "../../lib/cooldown";
import { getVerificationConfig, createInviteVerificationCode } from "../../lib/verifyManager";
import { ROBLOX_CHANNELS } from "../../lib/constants";
import { getRobloxVersion } from "../../lib/robloxVersion";

/**
 * The public prefix commands: `?ver` and `?inv`.
 *
 * Both are only served outside a protected room — the honeypot must punish
 * ANY message, so a prefix command cannot be used to slip through it.
 */

/** Handle `?ver` / `?inv`. Returns once the command has been answered. */
export async function handlePrefixCommand(message: Message): Promise<void> {
  if (await handleVerCommand(message)) return;
  await handleInviteCommand(message);
}

/**
 * `?ver [channel]` — show the current Roblox version.
 *
 * Returns true when the message was a `?ver` command and has been answered.
 */
async function handleVerCommand(message: Message): Promise<boolean> {
  const verMatch = message.content.match(/^\?ver(?:\s+(.+))?$/i);
  if (!verMatch) return false;

  // Anti-spam: ?ver hits the Roblox API every time, so limit each user
  // to one call per cooldown window. Silently ignore repeats.
  if (checkCooldown(`ver:${message.author.id}`, config.COMMAND_COOLDOWN_MS) > 0) {
    return true;
  }

  try {
    const wantedRaw = verMatch[1]?.trim() ?? "LIVE";
    const channel = (ROBLOX_CHANNELS as readonly string[]).find(
      (c) => c.toLowerCase() === wantedRaw.toLowerCase(),
    );
    if (!channel) {
      await message.reply(
        `❌ Unknown channel \`${wantedRaw}\`. Available: ${ROBLOX_CHANNELS.map((c) => `\`${c}\``).join(", ")}`,
      );
      return true;
    }
    // Cached (30s) + WEAO fallback for LIVE — ?ver previously hit the
    // Roblox API on every call with no fallback.
    const version = await getRobloxVersion(channel);
    await message.reply(
      version
        ? `Current version of \`${channel}\` is \`${version}\``
        : "❌ Could not fetch version info right now, please try again later",
    );
  } catch (error) {
    logger.error("[VER] Failed to handle ?ver:", error);
  }
  return true;
}

/**
 * `?inv` — create a temporary invite link for the current channel.
 *
 * The link expires after 30 minutes and works for only 1 use.
 */
async function handleInviteCommand(message: Message): Promise<void> {
  if (!/^\?inv\s*$/i.test(message.content)) return;

  // Anti-spam: one invite per user per cooldown window (same as ?ver).
  if (checkCooldown(`inv:${message.author.id}`, config.COMMAND_COOLDOWN_MS) > 0) {
    return;
  }

  try {
    // Creating an invite needs Create Instant Invite IN THIS CHANNEL —
    // check the channel overwrite-resolved permissions, not the
    // guild-wide ones (they can differ per channel).
    const botMember = await message.guild!.members.fetchMe();
    const channelPerms = (message.channel as TextChannel).permissionsFor?.(botMember);
    if (!channelPerms?.has(PermissionFlagsBits.CreateInstantInvite)) {
      await message.reply("❌ The bot lacks the `Create Instant Invite` permission in this channel");
      return;
    }

    const verification = getVerificationConfig(message.guildId!);

    // In Code mode only members who already passed verification (or
    // admins/the owner) may mint an invite + code. Otherwise an
    // unverified member could generate a code for themselves and bypass
    // the gate entirely.
    if (verification?.verificationMode === "code") {
      // Fetch instead of trusting the cache: a stale member object could
      // still list the verified role after staff removed it.
      const member =
        (await message.guild!.members.fetch(message.author.id).catch(() => null)) ??
        message.member;
      const canInvite =
        message.guild!.ownerId === message.author.id ||
        member?.permissions.has(PermissionFlagsBits.Administrator) === true ||
        member?.roles.cache.has(verification.verifiedRoleId) === true;

      if (!canInvite) {
        await message.reply("❌ Only verified members can create an invite and verification code");
        return;
      }
    }

    const invite = await (message.channel as TextChannel).createInvite({
      maxAge: 30 * 60, // Expire after 30 minutes (in seconds)
      maxUses: 1, // Maximum number of uses: 1
      // Discord reuses a matching invite by default. That invite may
      // already have a code (even a consumed one), which would make
      // createInviteVerificationCode throw. Force a fresh invite so the
      // new code is bound to a new invite.
      unique: true,
    });

    // In Code mode the link alone is not enough: the inviter must send
    // the single-use code too. If code creation fails, revoke the invite
    // so the new member cannot slip in unverified.
    let verificationCode: string | null = null;
    if (verification?.verificationMode === "code") {
      try {
        const { code } = createInviteVerificationCode({
          guildId: message.guildId!,
          channelId: message.channelId,
          inviterId: message.author.id,
          inviteCode: invite.code,
        });
        verificationCode = code;
      } catch (codeError) {
        try {
          await invite.delete("Could not create a verification code");
        } catch {
          // Best-effort: the invite still expires on its own.
        }
        throw codeError;
      }
    }

    // Components v2 has no legacy `content` field, so the code can use
    // headings and stand out instead of being buried in a text line.
    const container = new ContainerBuilder().setAccentColor(0x22c55e);
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`**🔗 Invite link**\n${invite.url}`),
    );

    if (verificationCode) {
      container
        .addSeparatorComponents(new SeparatorBuilder())
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent("## 🔑 Verification code"),
          new TextDisplayBuilder().setContent(`# \`${verificationCode}\``),
        );
    }

    container
      .addSeparatorComponents(new SeparatorBuilder())
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `⏱️ Expires in **30 minutes** | **1 use**\n_This message will be auto-deleted <t:${Math.floor((Date.now() + 30_000) / 1000)}:R>_`,
        ),
      );

    const reply = await message.reply({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
    });
    // Auto-delete the reply AND the command message after 30s so the
    // invite link doesn't linger in chat. Deleting another user's
    // message needs Manage Messages — if that fails it's best-effort.
    const timer = setTimeout(async () => {
      try {
        await reply.delete();
      } catch {
        // Reply already gone — fine.
      }
      try {
        await message.delete();
      } catch {
        // Command message already gone, or bot lacks Manage Messages — fine.
      }
    }, 30_000);
    timer.unref?.();
  } catch (error) {
    logger.error("[INV] Failed to handle ?inv:", error);
    await message.reply("❌ Could not create an invite link, please try again later");
  }
}
