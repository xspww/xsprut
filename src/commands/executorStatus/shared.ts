import {
  APIInteractionDataResolvedChannel,
  ChatInputCommandInteraction,
  GuildBasedChannel,
  MessageFlags,
} from "discord.js";
import {
  EMBED_REFRESH_INTERVAL_MAX_MS,
  EMBED_REFRESH_INTERVAL_MIN_MS,
  formatIntervalMs,
  parseIntervalToMs,
} from "../../lib/constants";

/**
 * A channel option value.
 *
 * Discord hands back either the cached channel or the raw API payload, so a
 * handler that only needs the id or the parent category must accept both.
 */
export type OptionChannel = GuildBasedChannel | APIInteractionDataResolvedChannel;

/** A parsed `interval` option, or the reply to send when the value is invalid. */
export type IntervalResult =
  | { ok: true; ms: number }
  | { ok: false; content: string };

/**
 * Parse and range-check an `interval` option (e.g. `30s`, `5m`, `1h`).
 *
 * The caller decides what an absent option means: `track add` falls back to
 * the default interval, `track edit` leaves the stored value untouched.
 */
export function validateInterval(raw: string): IntervalResult {
  const parsed = parseIntervalToMs(raw);
  if (parsed === null) {
    return {
      ok: false,
      content: "❌ Invalid **interval** format (valid examples: `30s`, `1m`, `5m`, `1h`)",
    };
  }
  if (parsed < EMBED_REFRESH_INTERVAL_MIN_MS) {
    return {
      ok: false,
      content: `❌ Interval must be at least **${formatIntervalMs(EMBED_REFRESH_INTERVAL_MIN_MS)}**`,
    };
  }
  if (parsed > EMBED_REFRESH_INTERVAL_MAX_MS) {
    return {
      ok: false,
      content: `❌ Interval must be at most **${formatIntervalMs(EMBED_REFRESH_INTERVAL_MAX_MS)}**`,
    };
  }
  return { ok: true, ms: parsed };
}

/**
 * The parent category of a channel option value.
 *
 * Only guild channels have a parent; a DM channel has none. The API payload
 * shape spells the field `parent_id`, so only the cached channel can answer.
 */
export function categoryIdOf(channel: OptionChannel): string | null {
  if ("parentId" in channel) {
    return channel.parentId || null;
  }
  return null;
}

/**
 * Reply for an option value the handler does not know.
 *
 * Discord validates the choice list before the command runs, so this is a
 * safety net for a subcommand or tracker type that was renamed on one side
 * only — it must not fall through and leave the interaction unanswered.
 */
export function unknownChoice(
  interaction: ChatInputCommandInteraction,
  kind: string,
  value: string,
) {
  return interaction.reply({
    content: `❌ Unknown ${kind} \`${value}\``,
    flags: MessageFlags.Ephemeral,
  });
}
