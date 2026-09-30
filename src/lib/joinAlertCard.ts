import {
  ContainerBuilder,
  SectionBuilder,
  SeparatorBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
} from "discord.js";

/**
 * Build the Components v2 welcome card shown when a new member joins.
 * Shared by the `guildMemberAdd` event and the `/test joinalert` preview so the
 * test output is always identical to the real thing.
 */
export function createJoinAlertContainer(opts: {
  username: string;
  avatarUrl: string;
  accountCreatedUnix: number;
  nowUnix?: number;
}): ContainerBuilder {
  const nowUnix = opts.nowUnix ?? Math.floor(Date.now() / 1000);

  const headerText = new TextDisplayBuilder().setContent("# ⚠️ SECURITY ALERT");
  const detailsText = new TextDisplayBuilder().setContent(
    "**Unauthorized User Detected**\n" +
      `• Member: \`${opts.username}\`\n` +
      `• Account created: <t:${opts.accountCreatedUnix}:R>\n` +
      `• Joined: <t:${nowUnix}:F>`,
  );
  const footerText = new TextDisplayBuilder().setContent("Powered by Diff Team");

  return new ContainerBuilder()
    .setAccentColor(0xef4444)
    .addSectionComponents(
      new SectionBuilder()
        .setThumbnailAccessory(new ThumbnailBuilder().setURL(opts.avatarUrl))
        .addTextDisplayComponents(headerText, detailsText),
    )
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(footerText);
}
