import {
  ChatInputCommandInteraction,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import db from "../lib/db";
import {
  STATUS_ROTATION_DEFAULT_INTERVAL_MS,
  STATUS_ROTATION_MIN_INTERVAL_MS,
  addBotStatusMessage,
  refreshBotStatus,
  resetBotStatus,
} from "../lib/presenceManager";
import { formatIntervalMs, parseIntervalToMs } from "../lib/constants";

const NUMBER_EMOJIS = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];

export const data = new SlashCommandBuilder()
  .setName("status")
  .setDescription("🤖 Manage the bot's status")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand((subcommand) =>
    subcommand
      .setName("add")
      .setDescription("➕ Add a bot status message (add multiple messages to rotate automatically)")
      .addStringOption((option) =>
        option
          .setName("text")
          .setDescription("The status text to display")
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName("url")
          .setDescription("Stream URL link (optional)")
          .setRequired(false),
      )
      .addStringOption((option) =>
        option
          .setName("custom")
          .setDescription("Custom Status text shown on the profile card (optional, emoji allowed)")
          .setRequired(false),
      )
      .addStringOption((option) =>
        option
          .setName("interval")
          .setDescription(
            `⏱️ Display duration before rotating (e.g. 30s, 1m, 5m; default ${formatIntervalMs(STATUS_ROTATION_DEFAULT_INTERVAL_MS)})`,
          )
          .setRequired(false),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("remove")
      .setDescription("🗑️ Clear all status messages"),
  )
  .addSubcommand((subcommand) =>
    subcommand.setName("list").setDescription("📋 View all configured status messages"),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("refresh")
      .setDescription("🔄 Force-refresh the bot status immediately"),
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({
      content: "❌ Administrator permission is required to manage the bot status",
      flags: MessageFlags.Ephemeral,
    });
  }

  const subcommand = interaction.options.getSubcommand();

  if (subcommand === "add") {
    const text = interaction.options.getString("text", true).trim();
    if (text === "") {
      return interaction.reply({
        content: "❌ Please provide a status message (text)",
        flags: MessageFlags.Ephemeral,
      });
    }
    const url = interaction.options.getString("url")?.trim();
    const custom = interaction.options.getString("custom")?.trim();

    const intervalRaw = interaction.options.getString("interval");
    let intervalMs = STATUS_ROTATION_DEFAULT_INTERVAL_MS;
    if (intervalRaw) {
      const parsed = parseIntervalToMs(intervalRaw);
      if (parsed === null) {
        return interaction.reply({
          content: `❌ Invalid **interval** format (valid examples: \`30s\`, \`1m\`, \`5m\`, \`1h\`)`,
          flags: MessageFlags.Ephemeral,
        });
      }
      if (parsed < STATUS_ROTATION_MIN_INTERVAL_MS) {
        return interaction.reply({
          content: `❌ interval must be at least **${formatIntervalMs(STATUS_ROTATION_MIN_INTERVAL_MS)}**`,
          flags: MessageFlags.Ephemeral,
        });
      }
      intervalMs = parsed;
    }

    addBotStatusMessage(text, url, custom, intervalMs);

    const count = db
      .prepare(`SELECT COUNT(*) AS c FROM botStatusMessages WHERE enabled = 1`)
      .get() as { c: number };

    const rotationNote =
      count.c > 1
        ? `\n📋 There are now **${count.c}** status messages in total — they will rotate automatically on schedule`
        : `\n📋 There is now 1 status message — use /status add to add more so they rotate automatically`;

    return interaction.reply({
      content:
        `✅ Status message added: \`${text}\`${custom ? `\n💬 Custom Status: \`${custom}\`` : ""}` +
        `\n⏱️ This message will be shown for **${formatIntervalMs(intervalMs)}** then rotate to the next one${rotationNote}`,
      flags: MessageFlags.Ephemeral,
    });
  }

  if (subcommand === "remove") {
    resetBotStatus();

    return interaction.reply({
      content: "✅ All status messages cleared (the bot status has been removed)",
      flags: MessageFlags.Ephemeral,
    });
  }

  if (subcommand === "refresh") {
    refreshBotStatus();

    return interaction.reply({
      content: "✅ Bot status refreshed (now showing the configured message)",
      flags: MessageFlags.Ephemeral,
    });
  }

  // list (formerly view)
  const messages = db
    .prepare(
      `SELECT activityText, streamUrl, customStatus, intervalMs
       FROM botStatusMessages
       WHERE enabled = 1
       ORDER BY id`,
    )
    .all() as { activityText: string; streamUrl: string; customStatus: string; intervalMs: number }[];

  if (messages.length === 0) {
    return interaction.reply({
      content: "ℹ️ No custom status message configured yet (use /status add to add one)",
      flags: MessageFlags.Ephemeral,
    });
  }

  const lines = messages.map((m, i) => {
    const num = i < NUMBER_EMOJIS.length ? `${NUMBER_EMOJIS[i]} ` : `${i + 1}. `;
    const interval = formatIntervalMs(m.intervalMs || STATUS_ROTATION_DEFAULT_INTERVAL_MS);
    return (
      `${num}\`${m.activityText}\` (rotates every **${interval}**)${
        m.customStatus ? `\n   💬 Custom: \`${m.customStatus}\`` : ""
      }` +
      `\n   🔗 ${m.streamUrl}`
    );
  });

  return interaction.reply({
    content: `📋 Configured status messages (**${messages.length}** messages) — they rotate automatically on schedule:\n${lines.join("\n")}`,
    flags: MessageFlags.Ephemeral,
  });
}
