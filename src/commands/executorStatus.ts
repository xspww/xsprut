import {
  ChatInputCommandInteraction,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  ChannelType,
  AutocompleteInteraction,
} from "discord.js";
import { getVoiceConnection } from "@discordjs/voice";
import db from "../lib/db";
import logger from "../lib/logger";
import { invalidateExecutorAlerts } from "../lib/dbCache";
import {
  updateExecutorStatusChannels,
  updateExecutorChatStatusChannels,
  updateBotVoiceChannels,
  updateBotChatChannels,
  fetchExecutorData,
  forceRefreshEmbeds,
} from "../monitoring/executorStatus";
import {
  EMBED_REFRESH_INTERVAL_DEFAULT_MS,
  EMBED_REFRESH_INTERVAL_MIN_MS,
  EMBED_REFRESH_INTERVAL_MAX_MS,
  formatIntervalMs,
  parseIntervalToMs,
} from "../lib/constants";

export const data = new SlashCommandBuilder()
  .setName("ex")
  .setDescription("🎛️ Manage the Executor tracking and status system")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)

  // ─── /ex track ─────────────────────────────────────────────────────────
  .addSubcommandGroup((group) =>
    group
      .setName("track")
      .setDescription("📡 Executor status and update tracking system")
      .addSubcommand((sub) =>
        sub
          .setName("add")
          .setDescription("➕ Add an Executor tracker")
          .addStringOption((o) =>
            o
              .setName("display")
              .setDescription("🎨 Display format")
              .setRequired(true)
              .addChoices(
                { name: "🔊 Voice Channel — Rename channel by status", value: "voice" },
                { name: "💬 Text Channel — Rename channel by status", value: "chat" },
                { name: "📊 Embed Status — Create a status embed updated every 1 minute", value: "embed" },
                { name: "📢 Alert Message — Send an alert message on updates", value: "alert" },
              ),
          )
          .addStringOption((o) =>
            o
              .setName("executor")
              .setDescription("🔍 Executor name (type to search)")
              .setRequired(true)
              .setAutocomplete(true),
          )
          .addChannelOption((o) =>
            o
              .setName("channel")
              .setDescription("📨 Text channel (for Alert Message / Embed Status mode)")
              .setRequired(false)
              .addChannelTypes(ChannelType.GuildText),
          )
          .addStringOption((o) =>
            o
              .setName("content")
              .setDescription("💬 Message before the embed (optional)")
              .setRequired(false),
          )
          .addChannelOption((o) =>
            o
              .setName("category")
              .setDescription("📁 Category (for Voice/Text Channel mode, to create a sub-channel)")
              .setRequired(false)
              .addChannelTypes(ChannelType.GuildCategory),
          )
          .addStringOption((o) =>
            o
              .setName("interval")
              .setDescription("⏱️ Embed auto-update frequency (e.g. 30s, 1m, 5m; min 10s, max 1h)")
              .setRequired(false),
          ),
      )
      .addSubcommand((sub) =>
        sub
          .setName("remove")
          .setDescription("🗑️ Remove an Executor tracker")
          .addStringOption((o) =>
            o
              .setName("display")
              .setDescription("🎨 Display format to remove")
              .setRequired(true)
              .addChoices(
                { name: "🔊 Voice Channel", value: "voice" },
                { name: "💬 Text Channel", value: "chat" },
                { name: "📊 Embed Status", value: "embed" },
                { name: "📢 Alert Message", value: "alert" },
              ),
          )
          .addStringOption((o) =>
            o
              .setName("executor")
              .setDescription("🔍 Executor name (type to search)")
              .setRequired(true)
              .setAutocomplete(true),
          )
          .addChannelOption((o) =>
            o
              .setName("channel")
              .setDescription("📨 Text channel (for Alert Message / Embed Status mode)")
              .setRequired(false)
              .addChannelTypes(ChannelType.GuildText),
          ),
      )
      .addSubcommand((sub) =>
        sub
          .setName("edit")
          .setDescription("✏️ Edit the message or update frequency of Embed Status / Alert")
          .addStringOption((o) =>
            o
              .setName("executor")
              .setDescription("🔍 Executor name (type to search)")
              .setRequired(true)
              .setAutocomplete(true),
          )
          .addStringOption((o) =>
            o
              .setName("content")
              .setDescription("💬 New message before the embed (optional)")
              .setRequired(false),
          )
          .addStringOption((o) =>
            o
              .setName("interval")
              .setDescription("⏱️ New embed auto-update frequency (e.g. 30s, 1m, 5m)")
              .setRequired(false),
          ),
      )
      .addSubcommand((sub) =>
        sub.setName("list").setDescription("📋 View all configured Executors (grouped by format)"),
      )
      .addSubcommand((sub) =>
        sub.setName("refresh").setDescription("🔄 Force-update all statuses and embeds immediately"),
      ),
  )

  // ─── /ex voice ─────────────────────────────────────────────────────
  .addSubcommandGroup((group) =>
    group
      .setName("voice")
      .setDescription("🔊 Voice channel the bot stays in 24/7 with status display")
      .addSubcommand((sub) =>
        sub
          .setName("add")
          .setDescription("➕ Set up a voice channel for the bot to stay in")
          .addStringOption((o) =>
            o
              .setName("mode")
              .setDescription("🎨 Channel name format")
              .setRequired(true)
              .addChoices(
                { name: "✏️ Custom — Set a custom channel name", value: "custom" },
                { name: "🎮 Roblox Version — Show the Roblox version", value: "roblox-version" },
              ),
          )
          .addChannelOption((o) =>
            o
              .setName("channel")
              .setDescription("🔊 Select an existing voice channel")
              .setRequired(false)
              .addChannelTypes(ChannelType.GuildVoice),
          )
          .addChannelOption((o) =>
            o
              .setName("category")
              .setDescription("📁 Or select a category for the bot to create a new channel")
              .setRequired(false)
              .addChannelTypes(ChannelType.GuildCategory),
          )
          .addStringOption((o) =>
            o
              .setName("display_name")
              .setDescription("✏️ Desired channel name (for Custom mode)")
              .setRequired(false),
          )
          .addStringOption((o) =>
            o
              .setName("roblox_channel")
              .setDescription("📡 Select a Roblox channel (for Roblox Version mode)")
              .setRequired(false)
              .addChoices(
                { name: "🟢 LIVE", value: "LIVE" },
                { name: "🟡 ZBeta", value: "ZBeta" },
              ),
          ),
      )
      .addSubcommand((sub) =>
        sub.setName("remove").setDescription("🗑️ Remove the bot voice channel"),
      )
      .addSubcommand((sub) =>
        sub.setName("list").setDescription("📋 View the current bot voice channel settings"),
      )
      .addSubcommand((sub) =>
        sub.setName("refresh").setDescription("🔄 Force-update the bot voice channel immediately"),
      ),
  )

  // ─── /ex chat ─────────────────────────────────────────────────────
  .addSubcommandGroup((group) =>
    group
      .setName("chat")
      .setDescription("💬 Chat channel renamed automatically by Roblox version")
      .addSubcommand((sub) =>
        sub
          .setName("add")
          .setDescription("➕ Set up a chat channel renamed by Roblox version")
          .addStringOption((o) =>
            o
              .setName("mode")
              .setDescription("🎨 Channel name format")
              .setRequired(true)
              .addChoices(
                { name: "✏️ Custom — Set a custom channel name", value: "custom" },
                { name: "🎮 Roblox Version — Show the Roblox version", value: "roblox-version" },
              ),
          )
          .addChannelOption((o) =>
            o
              .setName("channel")
              .setDescription("💬 Select an existing text channel")
              .setRequired(false)
              .addChannelTypes(ChannelType.GuildText),
          )
          .addChannelOption((o) =>
            o
              .setName("category")
              .setDescription("📁 Or select a category for the bot to create a new channel")
              .setRequired(false)
              .addChannelTypes(ChannelType.GuildCategory),
          )
          .addStringOption((o) =>
            o
              .setName("display_name")
              .setDescription("✏️ Desired channel name (for Custom mode)")
              .setRequired(false),
          )
          .addStringOption((o) =>
            o
              .setName("roblox_channel")
              .setDescription("📡 Select a Roblox channel (for Roblox Version mode)")
              .setRequired(false)
              .addChoices(
                { name: "🟢 LIVE", value: "LIVE" },
                { name: "🟡 ZBeta", value: "ZBeta" },
              ),
          ),
      )
      .addSubcommand((sub) =>
        sub.setName("remove").setDescription("🗑️ Remove the bot chat channel"),
      )
      .addSubcommand((sub) =>
        sub.setName("list").setDescription("📋 View the current bot chat channel settings"),
      )
      .addSubcommand((sub) =>
        sub.setName("refresh").setDescription("🔄 Force-update the bot chat channel name immediately"),
      ),
  );

export async function autocomplete(interaction: AutocompleteInteraction) {
  try {
    const focusedValue = interaction.options.getFocused().toLowerCase();
    const exploits = await fetchExecutorData();
    const options = exploits
      .filter((e) => e.title && e.title.toLowerCase().includes(focusedValue))
      .slice(0, 25)
      .map((e) => ({ name: e.title!, value: e.title! }));

    await interaction.respond(options);
  } catch (error) {
    logger.error("Autocomplete error:", error);
    await interaction.respond([]);
  }
}

export async function execute(interaction: ChatInputCommandInteraction) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({
      content: "❌ Administrator permission required",
      flags: MessageFlags.Ephemeral,
    });
  }

  if (!interaction.guildId) {
    return interaction.reply({
      content: "❌ This command can only be used in a server",
      flags: MessageFlags.Ephemeral,
    });
  }

  const group = interaction.options.getSubcommandGroup(true);
  const sub = interaction.options.getSubcommand(true);

  // ─── TRACK ──────────────────────────────────────────────────────────────
  if (group === "track") {
    if (sub === "add") {
      const display = interaction.options.getString("display", true);
      // Use the executor name (from WEAO) directly as the display name — no display_name input needed
      const executorName = interaction.options.getString("executor", true);
      const channel = interaction.options.getChannel("channel", false);
      const category = interaction.options.getChannel("category", false);

      if (display === "alert") {
        if (!channel) {
          return interaction.reply({
            content: "❌ Please specify a **channel** (text channel) for alerts",
            flags: MessageFlags.Ephemeral,
          });
        }
        const alertContent = interaction.options.getString("content") ?? "";
        db.prepare(
          `INSERT INTO executorAlerts (guildId, channelId, executorName, displayName, customContent, enabled)
           VALUES (?, ?, ?, ?, ?, 1)
           ON CONFLICT(guildId, channelId, executorName) DO UPDATE SET displayName = excluded.displayName, customContent = excluded.customContent, enabled = 1`,
        ).run(interaction.guildId, channel.id, executorName, executorName, alertContent);
        invalidateExecutorAlerts();

        return interaction.reply({
          content: `✅ Alert Message for **${executorName}** in <#${channel.id}> has been set up`,
          flags: MessageFlags.Ephemeral,
        });
      }

      if (display === "embed") {
        if (!channel) {
          return interaction.reply({
            content: "❌ Please specify a **channel** (text channel) for Embed Status",
            flags: MessageFlags.Ephemeral,
          });
        }
        const customContent = interaction.options.getString("content") ?? "";

        const intervalRaw = interaction.options.getString("interval");
        let intervalMs = EMBED_REFRESH_INTERVAL_DEFAULT_MS;
        if (intervalRaw) {
          const parsed = parseIntervalToMs(intervalRaw);
          if (parsed === null) {
            return interaction.reply({
              content: `❌ Invalid **interval** format (valid examples: \`30s\`, \`1m\`, \`5m\`, \`1h\`)`,
              flags: MessageFlags.Ephemeral,
            });
          }
          if (parsed < EMBED_REFRESH_INTERVAL_MIN_MS) {
            return interaction.reply({
              content: `❌ Interval must be at least **${formatIntervalMs(EMBED_REFRESH_INTERVAL_MIN_MS)}**`,
              flags: MessageFlags.Ephemeral,
            });
          }
          if (parsed > EMBED_REFRESH_INTERVAL_MAX_MS) {
            return interaction.reply({
              content: `❌ Interval must be at most **${formatIntervalMs(EMBED_REFRESH_INTERVAL_MAX_MS)}**`,
              flags: MessageFlags.Ephemeral,
            });
          }
          intervalMs = parsed;
        }

        db.prepare(
          `INSERT INTO executorEmbedStatusChannels (guildId, channelId, executorName, displayName, customContent, intervalMs, enabled, updatedAt)
           VALUES (?, ?, ?, ?, ?, ?, 1, ?)
           ON CONFLICT(guildId, channelId, executorName) DO UPDATE SET displayName = excluded.displayName, customContent = excluded.customContent, intervalMs = excluded.intervalMs, enabled = 1, updatedAt = excluded.updatedAt`,
        ).run(interaction.guildId, channel.id, executorName, executorName, customContent, intervalMs, Date.now());

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        await forceRefreshEmbeds();

        return interaction.editReply(
          `✅ Status embed for **${executorName}** in <#${channel.id}> has been set up (auto-updates every **${formatIntervalMs(intervalMs)}**)`,
        );
      }

      if (display === "voice" || display === "chat") {
        if (!category) {
          return interaction.reply({
            content: "❌ Please specify a **category** for the bot to create a channel in",
            flags: MessageFlags.Ephemeral,
          });
        }

        const table = display === "voice" ? "executorStatusChannels" : "executorChatStatusChannels";
        const channelIdField = display === "voice" ? "voiceChannelId" : "channelId";

        db.prepare(
          `INSERT INTO ${table} (guildId, categoryId, executorName, displayName, ${channelIdField}, updatedAt)
           VALUES (?, ?, ?, ?, NULL, ?)
           ON CONFLICT(guildId, executorName) DO UPDATE SET
             categoryId = excluded.categoryId,
             displayName = excluded.displayName,
             enabled = 1,
             updatedAt = excluded.updatedAt`,
        ).run(interaction.guildId, category.id, executorName, executorName, Date.now());

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        if (display === "voice") {
          await updateExecutorStatusChannels();
        } else {
          await updateExecutorChatStatusChannels();
        }

        return interaction.editReply(
          `✅ ${display === "voice" ? "Voice" : "Text"} Status for **${executorName}** in category \`${category.id}\` has been set up`,
        );
      }
    }

    if (sub === "remove") {
      const display = interaction.options.getString("display", true);
      const executorName = interaction.options.getString("executor", true);
      const channel = interaction.options.getChannel("channel", false);

      if (display === "embed") {
        const row = db
          .prepare(`SELECT messageId, channelId FROM executorEmbedStatusChannels WHERE guildId = ? AND LOWER(executorName) = ?`)
          .get(interaction.guildId, executorName.toLowerCase()) as any;

        if (row?.messageId && row?.channelId && interaction.guild) {
          try {
            const ch = await interaction.guild.channels.fetch(row.channelId);
            if (ch?.isTextBased()) {
              const msg = await ch.messages.fetch(row.messageId);
              if (msg) await msg.delete();
            }
          } catch (e) {
            logger.error(`Failed to delete embed message ${row?.messageId}:`, e);
          }
        }

        const result = channel
          ? db
              .prepare(`DELETE FROM executorEmbedStatusChannels WHERE guildId = ? AND channelId = ? AND LOWER(executorName) = ?`)
              .run(interaction.guildId, channel.id, executorName.toLowerCase())
          : db
              .prepare(`DELETE FROM executorEmbedStatusChannels WHERE guildId = ? AND LOWER(executorName) = ?`)
              .run(interaction.guildId, executorName.toLowerCase());

        return interaction.reply({
          content: result.changes
            ? `✅ Embed Status for **${executorName}** has been removed`
            : `❌ No Embed Status configuration found for **${executorName}**`,
          flags: MessageFlags.Ephemeral,
        });
      }

      if (display === "alert") {
        const result = channel
          ? db
              .prepare(`DELETE FROM executorAlerts WHERE guildId = ? AND channelId = ? AND LOWER(executorName) = ?`)
              .run(interaction.guildId, channel.id, executorName.toLowerCase())
          : db
              .prepare(`DELETE FROM executorAlerts WHERE guildId = ? AND LOWER(executorName) = ?`)
              .run(interaction.guildId, executorName.toLowerCase());
        invalidateExecutorAlerts();

        return interaction.reply({
          content: result.changes
            ? `✅ Alerts for **${executorName}** have been removed from Alert Messages`
            : `❌ No Alert Message configuration found for **${executorName}**`,
          flags: MessageFlags.Ephemeral,
        });
      }

      if (display === "voice" || display === "chat") {
        const table = display === "voice" ? "executorStatusChannels" : "executorChatStatusChannels";
        const channelIdField = display === "voice" ? "voiceChannelId" : "channelId";

        const row = db
          .prepare(`SELECT ${channelIdField} FROM ${table} WHERE guildId = ? AND LOWER(executorName) = ?`)
          .get(interaction.guildId, executorName.toLowerCase()) as any;

        if (row?.[channelIdField] && interaction.guild) {
          try {
            const ch = await interaction.guild.channels.fetch(row[channelIdField]);
            if (ch) await ch.delete(`Removed via /ex track remove (${display})`);
          } catch (e) {
            logger.error(`Failed to delete ${display} channel ${row[channelIdField]}:`, e);
          }
        }

        const result = db
          .prepare(`DELETE FROM ${table} WHERE guildId = ? AND LOWER(executorName) = ?`)
          .run(interaction.guildId, executorName.toLowerCase());

        return interaction.reply({
          content: result.changes
            ? `✅ ${display === "voice" ? "Voice" : "Text"} Status for **${executorName}** has been removed`
            : `❌ No ${display === "voice" ? "Voice" : "Text"} Status configuration found for **${executorName}**`,
          flags: MessageFlags.Ephemeral,
        });
      }
    }

    if (sub === "edit") {

      const executorName = interaction.options.getString("executor", true);
      const newContent = interaction.options.getString("content");
      const newIntervalRaw = interaction.options.getString("interval");

      if (newContent === null && newIntervalRaw === null) {
        return interaction.reply({
          content: "❌ Please specify at least one thing to edit (**content** or **interval**)",
          flags: MessageFlags.Ephemeral,
        });
      }

      let newIntervalMs: number | null = null;
      if (newIntervalRaw !== null) {
        const parsed = parseIntervalToMs(newIntervalRaw);
        if (parsed === null) {
          return interaction.reply({
            content: `❌ Invalid **interval** format (valid examples: \`30s\`, \`1m\`, \`5m\`, \`1h\`)`,
            flags: MessageFlags.Ephemeral,
          });
        }
        if (parsed < EMBED_REFRESH_INTERVAL_MIN_MS) {
          return interaction.reply({
            content: `❌ Interval must be at least **${formatIntervalMs(EMBED_REFRESH_INTERVAL_MIN_MS)}**`,
            flags: MessageFlags.Ephemeral,
          });
        }
        if (parsed > EMBED_REFRESH_INTERVAL_MAX_MS) {
          return interaction.reply({
            content: `❌ Interval must be at most **${formatIntervalMs(EMBED_REFRESH_INTERVAL_MAX_MS)}**`,
            flags: MessageFlags.Ephemeral,
          });
        }
        newIntervalMs = parsed;
      }

      let updatedCount = 0;

      const embedRow = db
        .prepare(`SELECT channelId FROM executorEmbedStatusChannels WHERE guildId = ? AND LOWER(executorName) = ?`)
        .get(interaction.guildId, executorName.toLowerCase());

      if (embedRow) {
        if (newContent !== null) {
          db.prepare(`UPDATE executorEmbedStatusChannels SET customContent = ?, updatedAt = ? WHERE guildId = ? AND LOWER(executorName) = ?`)
            .run(newContent, Date.now(), interaction.guildId, executorName.toLowerCase());
        }
        if (newIntervalMs !== null) {
          db.prepare(`UPDATE executorEmbedStatusChannels SET intervalMs = ?, updatedAt = ? WHERE guildId = ? AND LOWER(executorName) = ?`)
            .run(newIntervalMs, Date.now(), interaction.guildId, executorName.toLowerCase());
        }
        updatedCount++;
      }

      const alertRow = db
        .prepare(`SELECT channelId FROM executorAlerts WHERE guildId = ? AND LOWER(executorName) = ?`)
        .get(interaction.guildId, executorName.toLowerCase());

      if (alertRow) {
        if (newContent !== null) {
          db.prepare(`UPDATE executorAlerts SET customContent = ? WHERE guildId = ? AND LOWER(executorName) = ?`)
            .run(newContent, interaction.guildId, executorName.toLowerCase());
        }
        invalidateExecutorAlerts();
        updatedCount++;
      }


      if (updatedCount === 0) {
        return interaction.reply({
          content: `❌ No configuration found for **${executorName}**`,
          flags: MessageFlags.Ephemeral,
        });
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await updateExecutorStatusChannels();

      const intervalNote = newIntervalMs !== null ? ` (auto-updates every **${formatIntervalMs(newIntervalMs)}**)` : "";
      return interaction.editReply(`✅ Settings for **${executorName}** have been updated and embeds/status refreshed${intervalNote}`);
    }

    if (sub === "list") {

      const alerts = db
        .prepare(`SELECT channelId, executorName, displayName FROM executorAlerts WHERE guildId = ? AND enabled = 1`)
        .all(interaction.guildId) as any[];
      const embeds = db
        .prepare(`SELECT channelId, executorName, displayName, intervalMs FROM executorEmbedStatusChannels WHERE guildId = ? AND enabled = 1`)
        .all(interaction.guildId) as any[];
      const voice = db
        .prepare(`SELECT executorName, displayName, categoryId, voiceChannelId FROM executorStatusChannels WHERE guildId = ? AND enabled = 1`)
        .all(interaction.guildId) as any[];
      const chat = db
        .prepare(`SELECT executorName, displayName, categoryId, channelId FROM executorChatStatusChannels WHERE guildId = ? AND enabled = 1`)
        .all(interaction.guildId) as any[];

      if (alerts.length === 0 && embeds.length === 0 && voice.length === 0 && chat.length === 0) {
        return interaction.reply({ content: "_No configurations yet_", flags: MessageFlags.Ephemeral });
      }

      const lines = [];
      if (alerts.length > 0) {
        lines.push("**📢 Alert Messages:**");
        lines.push(...alerts.map((r) => `• **${r.displayName}** (\`${r.executorName}\`) → <#${r.channelId}>`));
      }
      if (embeds.length > 0) {
        if (lines.length > 0) lines.push("");
        lines.push("**📊 Embed Status (Auto-updated):**");
        lines.push(
          ...embeds.map((r) => {
            const interval = formatIntervalMs(r.intervalMs || EMBED_REFRESH_INTERVAL_DEFAULT_MS);
            return `• **${r.displayName}** (\`${r.executorName}\`) → <#${r.channelId}> (\`${interval}\`)`;
          }),
        );
      }
      if (voice.length > 0) {
        if (lines.length > 0) lines.push("");
        lines.push("**🔊 Voice Status:**");
        lines.push(...voice.map((r) => `• **${r.displayName}** (\`${r.executorName}\`) → ${r.voiceChannelId ? `<#${r.voiceChannelId}>` : `Category: \`${r.categoryId}\``}`));
      }
      if (chat.length > 0) {
        if (lines.length > 0) lines.push("");
        lines.push("**💬 Text Status:**");
        lines.push(...chat.map((r) => `• **${r.displayName}** (\`${r.executorName}\`) → ${r.channelId ? `<#${r.channelId}>` : `Category: \`${r.categoryId}\``}`));
      }

      return interaction.reply({ content: lines.join("\n"), flags: MessageFlags.Ephemeral });
    }


    if (sub === "refresh") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await updateExecutorStatusChannels(); // This also updates chat channels
      await forceRefreshEmbeds();
      return interaction.editReply("✅ All Executor statuses have been force-updated");
    }
  }

  // ─── BOTVOICE ───────────────────────────────────────────────────────────
  if (group === "voice") {
    if (sub === "add") {
      const mode = interaction.options.getString("mode", true);
      const displayName = interaction.options.getString("display_name") || "Bot Online";
      const robloxChannel = interaction.options.getString("roblox_channel") || "LIVE";
      const existingChannel = interaction.options.getChannel("channel");
      const category = interaction.options.getChannel("category");

      if (!existingChannel && !category) {
        return interaction.reply({
          content: "❌ Please specify either **channel** (an existing voice channel) or **category** (for the bot to create a new channel)",
          flags: MessageFlags.Ephemeral,
        });
      }

      if (existingChannel) {
        db.prepare(
          `INSERT INTO botVoiceChannels (guildId, categoryId, voiceChannelId, mode, displayName, robloxChannel, enabled, omitPrefix, updatedAt)
           VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
           ON CONFLICT(guildId) DO UPDATE SET
             categoryId = excluded.categoryId,
             mode = excluded.mode,
             displayName = excluded.displayName,
             robloxChannel = excluded.robloxChannel,
             voiceChannelId = excluded.voiceChannelId,
             enabled = 1,
             omitPrefix = excluded.omitPrefix,
             updatedAt = excluded.updatedAt`,
        ).run(
          interaction.guildId,
          (existingChannel as any).parentId || null,
          existingChannel.id,
          mode,
          displayName,
          robloxChannel,
          1,
          Date.now(),
        );

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        await updateBotVoiceChannels();
        const modeText = mode === "custom" ? `Custom name ("${displayName}")` : `Roblox version (${robloxChannel})`;
        return interaction.editReply(`✅ Bot Voice Status in <#${existingChannel.id}> with format **${modeText}** has been set up`);
      }

      db.prepare(
        `INSERT INTO botVoiceChannels (guildId, categoryId, voiceChannelId, mode, displayName, robloxChannel, enabled, omitPrefix, updatedAt)
         VALUES (?, ?, NULL, ?, ?, ?, 1, ?, ?)
         ON CONFLICT(guildId) DO UPDATE SET
           categoryId = excluded.categoryId,
           mode = excluded.mode,
           displayName = excluded.displayName,
           robloxChannel = excluded.robloxChannel,
           voiceChannelId = NULL,
           enabled = 1,
           omitPrefix = excluded.omitPrefix,
           updatedAt = excluded.updatedAt`,
      ).run(interaction.guildId, category!.id, mode, displayName, robloxChannel, 1, Date.now());

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await updateBotVoiceChannels();
      const modeText = mode === "custom" ? `Custom name ("${displayName}")` : `Roblox version (${robloxChannel})`;
      return interaction.editReply(`✅ Bot Voice Status in category \`${category!.id}\` with format **${modeText}** has been set up`);
    }

    if (sub === "remove") {
      try {
        const conn = getVoiceConnection(interaction.guildId);
        if (conn) conn.destroy();
      } catch {}

      const row = db
        .prepare(`SELECT voiceChannelId FROM botVoiceChannels WHERE guildId = ?`)
        .get(interaction.guildId) as { voiceChannelId: string | null } | undefined;

      if (row?.voiceChannelId && interaction.guild) {
        try {
          const ch = await interaction.guild.channels.fetch(row.voiceChannelId);
          if (ch) await ch.delete("Removed via /ex voice remove");
        } catch (e) {
          logger.error(`Failed to delete bot voice channel ${row.voiceChannelId}:`, e);
        }
      }

      const result = db.prepare(`DELETE FROM botVoiceChannels WHERE guildId = ?`).run(interaction.guildId);
      return interaction.reply({
        content: result.changes ? `✅ Bot Voice Status channel has been removed` : `❌ Bot Voice Status is not configured`,
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === "list") {
      const row = db
        .prepare(`SELECT categoryId, voiceChannelId, mode, displayName, robloxChannel FROM botVoiceChannels WHERE guildId = ? AND enabled = 1`)
        .get(interaction.guildId) as { categoryId: string; voiceChannelId: string | null; mode: string; displayName: string; robloxChannel: string } | undefined;

      if (!row) return interaction.reply({ content: "_Not configured_", flags: MessageFlags.Ephemeral });

      const modeDesc = row.mode === "custom" ? `Custom Name ("${row.displayName}")` : `Roblox Version (${row.robloxChannel})`;
      return interaction.reply({
        content: `• **Bot Voice Status** → ${row.voiceChannelId ? `<#${row.voiceChannelId}>` : `Category \`${row.categoryId}\``} (Mode: **${modeDesc}**)`,
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === "refresh") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await updateBotVoiceChannels();
      return interaction.editReply("✅ Bot Voice Status channel name has been refreshed");
    }
  }

  // ─── BOTCHAT ───────────────────────────────────────────────────────────
  if (group === "chat") {
    if (sub === "add") {
      const mode = interaction.options.getString("mode", true);
      const displayName = interaction.options.getString("display_name") || "Bot Online";
      const robloxChannel = interaction.options.getString("roblox_channel") || "LIVE";
      const existingChannel = interaction.options.getChannel("channel");
      const category = interaction.options.getChannel("category");

      if (!existingChannel && !category) {
        return interaction.reply({
          content: "❌ Please specify either **channel** (an existing text channel) or **category** (for the bot to create a new channel)",
          flags: MessageFlags.Ephemeral,
        });
      }

      const categoryId = existingChannel ? (existingChannel as any).parentId || null : category!.id;
      const channelId = existingChannel ? existingChannel.id : null;

      db.prepare(
        `INSERT INTO botChatChannels (guildId, categoryId, channelId, mode, displayName, robloxChannel, enabled, omitPrefix, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, 1, 0, ?)
         ON CONFLICT(guildId) DO UPDATE SET
           categoryId = excluded.categoryId,
           mode = excluded.mode,
           displayName = excluded.displayName,
           robloxChannel = excluded.robloxChannel,
           channelId = excluded.channelId,
           enabled = 1,
           omitPrefix = excluded.omitPrefix,
           updatedAt = excluded.updatedAt`,
      ).run(interaction.guildId, categoryId, channelId, mode, displayName, robloxChannel, Date.now());

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await updateBotChatChannels();
      const modeText = mode === "custom" ? `Custom name ("${displayName}")` : `Roblox version (${robloxChannel})`;
      return interaction.editReply(`✅ Bot Chat Status ${existingChannel ? `in <#${existingChannel.id}>` : "(the bot will create a new channel in the selected category)"} with format **${modeText}** has been set up`);
    }

    if (sub === "remove") {
      const row = db
        .prepare(`SELECT channelId FROM botChatChannels WHERE guildId = ?`)
        .get(interaction.guildId) as { channelId: string | null } | undefined;

      if (row?.channelId && interaction.guild) {
        try {
          const ch = await interaction.guild.channels.fetch(row.channelId);
          if (ch) await ch.delete("Removed via /ex chat remove");
        } catch (e) {
          logger.error(`Failed to delete bot chat channel ${row.channelId}:`, e);
        }
      }

      const result = db.prepare(`DELETE FROM botChatChannels WHERE guildId = ?`).run(interaction.guildId);
      return interaction.reply({
        content: result.changes ? `✅ Bot Chat Status channel has been removed` : `❌ Bot Chat Status is not configured`,
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === "list") {
      const row = db
        .prepare(`SELECT categoryId, channelId, mode, displayName, robloxChannel FROM botChatChannels WHERE guildId = ? AND enabled = 1`)
        .get(interaction.guildId) as { categoryId: string; channelId: string | null; mode: string; displayName: string; robloxChannel: string } | undefined;

      if (!row) return interaction.reply({ content: "_Not configured_", flags: MessageFlags.Ephemeral });

      const modeDesc = row.mode === "custom" ? `Custom Name ("${row.displayName}")` : `Roblox Version (${row.robloxChannel})`;
      return interaction.reply({
        content: `• **Bot Chat Status** → ${row.channelId ? `<#${row.channelId}>` : `Category \`${row.categoryId}\``} (Mode: **${modeDesc}**)`,
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === "refresh") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await updateBotChatChannels();
      return interaction.editReply("✅ Bot Chat Status channel name has been refreshed");
    }
  }
}
