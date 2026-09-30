import {
  MessageFlags,
  TextDisplayBuilder,
  type Message,
  type MessageCreateOptions,
  type TextBasedChannel,
} from "discord.js";

/**
 * Shared helpers for Components v2 messages (alerts, executor status, ...).
 *
 * v2 messages cannot use the legacy `content` field, so custom content must be
 * injected as a TextDisplay above the other components. These helpers centralize
 * the placeholder interpolation + injection so every caller does it the same way.
 */

/** Tokens that can be interpolated into custom content on a Components v2 message. */
export type V2ContentTokens = {
  hash?: string;
  channel?: string;
  version?: string;
  date?: string;
};

/**
 * Replace {hash}/{channel}/{version}/{date} tokens in custom content.
 * Returns undefined when the input is missing or empty after interpolation.
 */
export function interpolateV2Content(
  content: string | null | undefined,
  tokens: V2ContentTokens,
): string | undefined {
  if (!content) return undefined;
  const result = content
    .replace(/\{hash\}/g, tokens.hash ?? "")
    .replace(/\{channel\}/g, tokens.channel ?? "")
    .replace(/\{version\}/g, tokens.version ?? "")
    .replace(/\{date\}/g, tokens.date ?? "")
    .trim();
  return result === "" ? undefined : result;
}

/**
 * Send a Components v2 message to a channel. When `customContent` is set, it is
 * injected as a TextDisplay above the given components. Returns the sent
 * message, or null when the channel cannot be used for sending.
 *
 * Errors from the API are NOT caught here — callers own their try/catch so they
 * keep error context (channel deleted, permissions, etc.).
 */
export async function sendV2Message(
  channel: TextBasedChannel,
  components: NonNullable<MessageCreateOptions["components"]>,
  customContent?: string,
  options?: {
    allowedMentions?: MessageCreateOptions["allowedMentions"];
    files?: MessageCreateOptions["files"];
  },
): Promise<Message | null> {
  if (!channel.isSendable()) return null;

  const payload: MessageCreateOptions = {
    components,
    flags: MessageFlags.IsComponentsV2,
    ...(options?.allowedMentions ? { allowedMentions: options.allowedMentions } : {}),
    ...(options?.files ? { files: options.files } : {}),
  };

  if (customContent) {
    payload.components = [new TextDisplayBuilder().setContent(customContent), ...components];
  }

  return channel.send(payload);
}
