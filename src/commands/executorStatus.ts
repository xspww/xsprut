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
  .setDescription("🎛️ จัดการระบบติดตาม Executor และสถานะ")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)

  // ─── /ex track ─────────────────────────────────────────────────────────
  .addSubcommandGroup((group) =>
    group
      .setName("track")
      .setDescription("📡 ระบบติดตามสถานะและการอัปเดตของ Executor")
      .addSubcommand((sub) =>
        sub
          .setName("add")
          .setDescription("➕ เพิ่มระบบติดตาม Executor")
          .addStringOption((o) =>
            o
              .setName("display")
              .setDescription("🎨 รูปแบบการแสดงผล")
              .setRequired(true)
              .addChoices(
                { name: "🔊 Voice Channel — เปลี่ยนชื่อห้องตามสถานะ", value: "voice" },
                { name: "💬 Text Channel — เปลี่ยนชื่อห้องตามสถานะ", value: "chat" },
                { name: "📊 Embed Status — สร้าง Embed แสดงสถานะและอัปเดตทุก 1 นาที", value: "embed" },
                { name: "📢 Alert Message — ส่งข้อความแจ้งเตือนเมื่อมีการอัปเดต", value: "alert" },
              ),
          )
          .addStringOption((o) =>
            o
              .setName("executor")
              .setDescription("🔍 ชื่อ Executor (พิมพ์เพื่อค้นหา)")
              .setRequired(true)
              .setAutocomplete(true),
          )
          .addChannelOption((o) =>
            o
              .setName("channel")
              .setDescription("📨 ห้องข้อความ (สำหรับโหมด Alert Message / Embed Status)")
              .setRequired(false)
              .addChannelTypes(ChannelType.GuildText),
          )
          .addStringOption((o) =>
            o
              .setName("content")
              .setDescription("💬 ข้อความ ก่อน Embed (ไม่บังคับ)")
              .setRequired(false),
          )
          .addChannelOption((o) =>
            o
              .setName("category")
              .setDescription("📁 หมวดหมู่/Category (สำหรับโหมด Voice/Text Channel เพื่อสร้างห้องย่อย)")
              .setRequired(false)
              .addChannelTypes(ChannelType.GuildCategory),
          )
          .addStringOption((o) =>
            o
              .setName("interval")
              .setDescription("⏱️ ความถี่ Auto-updated ของ Embed (เช่น 30s, 1m, 5m; min 10s, max 1h)")
              .setRequired(false),
          ),
      )
      .addSubcommand((sub) =>
        sub
          .setName("remove")
          .setDescription("🗑️ ลบระบบติดตาม Executor")
          .addStringOption((o) =>
            o
              .setName("display")
              .setDescription("🎨 รูปแบบการแสดงผลที่ต้องการลบ")
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
              .setDescription("🔍 ชื่อ Executor (พิมพ์เพื่อค้นหา)")
              .setRequired(true)
              .setAutocomplete(true),
          )
          .addChannelOption((o) =>
            o
              .setName("channel")
              .setDescription("📨 ห้องข้อความ (สำหรับโหมด Alert Message / Embed Status)")
              .setRequired(false)
              .addChannelTypes(ChannelType.GuildText),
          ),
      )
      .addSubcommand((sub) =>
        sub
          .setName("edit")
          .setDescription("✏️ แก้ไขข้อความหรือความถี่การอัปเดตของ Embed Status / Alert")
          .addStringOption((o) =>
            o
              .setName("executor")
              .setDescription("🔍 ชื่อ Executor (พิมพ์เพื่อค้นหา)")
              .setRequired(true)
              .setAutocomplete(true),
          )
          .addStringOption((o) =>
            o
              .setName("content")
              .setDescription("💬 ข้อความก่อน Embed ใหม่ (ไม่บังคับ)")
              .setRequired(false),
          )
          .addStringOption((o) =>
            o
              .setName("interval")
              .setDescription("⏱️ ความถี่ Auto-updated ใหม่ของ Embed (เช่น 30s, 1m, 5m)")
              .setRequired(false),
          ),
      )
      .addSubcommand((sub) =>
        sub.setName("list").setDescription("📋 ดูรายการ Executor ที่ตั้งค่าไว้ทั้งหมด (แยกตามรูปแบบ)"),
      )
      .addSubcommand((sub) =>
        sub.setName("refresh").setDescription("🔄 บังคับอัปเดตสถานะและ Embed ทุกระบบทันที"),
      ),
  )

  // ─── /ex voice ─────────────────────────────────────────────────────
  .addSubcommandGroup((group) =>
    group
      .setName("voice")
      .setDescription("🔊 ห้อง Voice ที่บอทเข้าอยู่ตลอด 24/7 พร้อมแสดงสถานะ")
      .addSubcommand((sub) =>
        sub
          .setName("add")
          .setDescription("➕ ตั้งค่าห้อง Voice ให้บอทเข้าอยู่")
          .addStringOption((o) =>
            o
              .setName("mode")
              .setDescription("🎨 รูปแบบชื่อห้อง")
              .setRequired(true)
              .addChoices(
                { name: "✏️ Custom — ตั้งชื่อห้องเอง", value: "custom" },
                { name: "🎮 Roblox Version — แสดงเวอร์ชัน Roblox", value: "roblox-version" },
              ),
          )
          .addChannelOption((o) =>
            o
              .setName("channel")
              .setDescription("🔊 เลือกห้อง Voice ที่มีอยู่แล้ว")
              .setRequired(false)
              .addChannelTypes(ChannelType.GuildVoice),
          )
          .addChannelOption((o) =>
            o
              .setName("category")
              .setDescription("📁 หรือเลือก Category เพื่อให้บอทสร้างห้องใหม่")
              .setRequired(false)
              .addChannelTypes(ChannelType.GuildCategory),
          )
          .addStringOption((o) =>
            o
              .setName("display_name")
              .setDescription("✏️ ชื่อห้องที่ต้องการ (สำหรับโหมด Custom)")
              .setRequired(false),
          )
          .addStringOption((o) =>
            o
              .setName("roblox_channel")
              .setDescription("📡 เลือกช่อง Roblox (สำหรับโหมด Roblox Version)")
              .setRequired(false)
              .addChoices(
                { name: "🟢 LIVE", value: "LIVE" },
                { name: "🟡 ZBeta", value: "ZBeta" },
              ),
          ),
      )
      .addSubcommand((sub) =>
        sub.setName("remove").setDescription("🗑️ ลบห้อง Voice ของบอท"),
      )
      .addSubcommand((sub) =>
        sub.setName("list").setDescription("📋 ดูการตั้งค่าห้อง Voice ของบอทปัจจุบัน"),
      )
      .addSubcommand((sub) =>
        sub.setName("refresh").setDescription("🔄 บังคับอัปเดตห้อง Voice ของบอททันที"),
      ),
  )

  // ─── /ex chat ─────────────────────────────────────────────────────
  .addSubcommandGroup((group) =>
    group
      .setName("chat")
      .setDescription("💬 ห้อง Chat ที่เปลี่ยนชื่อตาม Roblox Version อัตโนมัติ")
      .addSubcommand((sub) =>
        sub
          .setName("add")
          .setDescription("➕ ตั้งค่าห้อง Chat ให้เปลี่ยนชื่อตาม Roblox Version")
          .addStringOption((o) =>
            o
              .setName("mode")
              .setDescription("🎨 รูปแบบชื่อห้อง")
              .setRequired(true)
              .addChoices(
                { name: "✏️ Custom — ตั้งชื่อห้องเอง", value: "custom" },
                { name: "🎮 Roblox Version — แสดงเวอร์ชัน Roblox", value: "roblox-version" },
              ),
          )
          .addChannelOption((o) =>
            o
              .setName("channel")
              .setDescription("💬 เลือกห้องข้อความที่มีอยู่แล้ว")
              .setRequired(false)
              .addChannelTypes(ChannelType.GuildText),
          )
          .addChannelOption((o) =>
            o
              .setName("category")
              .setDescription("📁 หรือเลือก Category เพื่อให้บอทสร้างห้องใหม่")
              .setRequired(false)
              .addChannelTypes(ChannelType.GuildCategory),
          )
          .addStringOption((o) =>
            o
              .setName("display_name")
              .setDescription("✏️ ชื่อห้องที่ต้องการ (สำหรับโหมด Custom)")
              .setRequired(false),
          )
          .addStringOption((o) =>
            o
              .setName("roblox_channel")
              .setDescription("📡 เลือกช่อง Roblox (สำหรับโหมด Roblox Version)")
              .setRequired(false)
              .addChoices(
                { name: "🟢 LIVE", value: "LIVE" },
                { name: "🟡 ZBeta", value: "ZBeta" },
              ),
          ),
      )
      .addSubcommand((sub) =>
        sub.setName("remove").setDescription("🗑️ ลบห้อง Chat ของบอท"),
      )
      .addSubcommand((sub) =>
        sub.setName("list").setDescription("📋 ดูการตั้งค่าห้อง Chat ของบอทปัจจุบัน"),
      )
      .addSubcommand((sub) =>
        sub.setName("refresh").setDescription("🔄 บังคับอัปเดตชื่อห้อง Chat ของบอททันที"),
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
      content: "❌ ต้องมีสิทธิ์ Administrator",
      flags: MessageFlags.Ephemeral,
    });
  }

  if (!interaction.guildId) {
    return interaction.reply({
      content: "❌ ใช้คำสั่งนี้ได้เฉพาะใน Server เท่านั้น",
      flags: MessageFlags.Ephemeral,
    });
  }

  const group = interaction.options.getSubcommandGroup(true);
  const sub = interaction.options.getSubcommand(true);

  // ─── TRACK ──────────────────────────────────────────────────────────────
  if (group === "track") {
    if (sub === "add") {
      const display = interaction.options.getString("display", true);
      // ใช้ชื่อ executor (จาก WEAO) เป็นชื่อที่แสดงโดยตรง — ไม่ต้องกรอก display_name
      const executorName = interaction.options.getString("executor", true);
      const channel = interaction.options.getChannel("channel", false);
      const category = interaction.options.getChannel("category", false);

      if (display === "alert") {
        if (!channel) {
          return interaction.reply({
            content: "❌ กรุณาระบุ **channel** (ห้องข้อความ) สำหรับการแจ้งเตือน",
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
          content: `✅ ตั้งค่า Alert Message สำหรับ **${executorName}** ลงห้อง <#${channel.id}> เรียบร้อยแล้ว`,
          flags: MessageFlags.Ephemeral,
        });
      }

      if (display === "embed") {
        if (!channel) {
          return interaction.reply({
            content: "❌ กรุณาระบุ **channel** (ห้องข้อความ) สำหรับ Embed Status",
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
              content: `❌ รูปแบบ **interval** ไม่ถูกต้อง (ตัวอย่างที่ใช้ได้: \`30s\`, \`1m\`, \`5m\`, \`1h\`)`,
              flags: MessageFlags.Ephemeral,
            });
          }
          if (parsed < EMBED_REFRESH_INTERVAL_MIN_MS) {
            return interaction.reply({
              content: `❌ interval ต้องไม่น้อยกว่า **${formatIntervalMs(EMBED_REFRESH_INTERVAL_MIN_MS)}**`,
              flags: MessageFlags.Ephemeral,
            });
          }
          if (parsed > EMBED_REFRESH_INTERVAL_MAX_MS) {
            return interaction.reply({
              content: `❌ interval ต้องไม่มากกว่า **${formatIntervalMs(EMBED_REFRESH_INTERVAL_MAX_MS)}**`,
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
          `✅ ตั้งค่า Status Embed สำหรับ **${executorName}** ลงห้อง <#${channel.id}> เรียบร้อยแล้ว (Auto-updated ทุก **${formatIntervalMs(intervalMs)}**)`,
        );
      }

      if (display === "voice" || display === "chat") {
        if (!category) {
          return interaction.reply({
            content: "❌ กรุณาระบุ **category** (หมวดหมู่) สำหรับให้บอทสร้างห้อง",
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
          `✅ ตั้งค่า ${display === "voice" ? "Voice" : "Text"} Status สำหรับ **${executorName}** ใน Category \`${category.id}\` เรียบร้อยแล้ว`,
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
            ? `✅ ลบ Embed Status ของ **${executorName}** เรียบร้อยแล้ว`
            : `❌ ไม่พบการตั้งค่า Embed Status สำหรับ **${executorName}**`,
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
            ? `✅ ลบการแจ้งเตือน **${executorName}** ออกจาก Alert Message เรียบร้อยแล้ว`
            : `❌ ไม่พบการตั้งค่า Alert Message สำหรับ **${executorName}**`,
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
            ? `✅ ลบ ${display === "voice" ? "Voice" : "Text"} Status ของ **${executorName}** เรียบร้อยแล้ว`
            : `❌ ไม่พบการตั้งค่า ${display === "voice" ? "Voice" : "Text"} Status สำหรับ **${executorName}**`,
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
          content: "❌ กรุณาระบุข้อมูลอย่างน้อย 1 อย่างที่ต้องการแก้ไข (**content** หรือ **interval**)",
          flags: MessageFlags.Ephemeral,
        });
      }

      let newIntervalMs: number | null = null;
      if (newIntervalRaw !== null) {
        const parsed = parseIntervalToMs(newIntervalRaw);
        if (parsed === null) {
          return interaction.reply({
            content: `❌ รูปแบบ **interval** ไม่ถูกต้อง (ตัวอย่างที่ใช้ได้: \`30s\`, \`1m\`, \`5m\`, \`1h\`)`,
            flags: MessageFlags.Ephemeral,
          });
        }
        if (parsed < EMBED_REFRESH_INTERVAL_MIN_MS) {
          return interaction.reply({
            content: `❌ interval ต้องไม่น้อยกว่า **${formatIntervalMs(EMBED_REFRESH_INTERVAL_MIN_MS)}**`,
            flags: MessageFlags.Ephemeral,
          });
        }
        if (parsed > EMBED_REFRESH_INTERVAL_MAX_MS) {
          return interaction.reply({
            content: `❌ interval ต้องไม่มากกว่า **${formatIntervalMs(EMBED_REFRESH_INTERVAL_MAX_MS)}**`,
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
          content: `❌ ไม่พบการตั้งค่าสำหรับ **${executorName}** ในระบบ`,
          flags: MessageFlags.Ephemeral,
        });
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await updateExecutorStatusChannels();

      const intervalNote = newIntervalMs !== null ? ` (Auto-updated ทุก **${formatIntervalMs(newIntervalMs)}**)` : "";
      return interaction.editReply(`✅ แก้ไขการตั้งค่าสำหรับ **${executorName}** และรีเฟรช Embed / Status เรียบร้อยแล้ว${intervalNote}`);
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
        return interaction.reply({ content: "_ยังไม่มีการตั้งค่าใดๆ_", flags: MessageFlags.Ephemeral });
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
      return interaction.editReply("✅ บังคับอัปเดตสถานะ Executor ทุกระบบเรียบร้อยแล้ว");
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
          content: "❌ กรุณาระบุ **channel** (เลือกห้องเสียงที่มีอยู่แล้ว) หรือ **category** (ให้บอทสร้างห้องใหม่) อย่างใดอย่างหนึ่ง",
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
        const modeText = mode === "custom" ? `ตั้งชื่อเอง ("${displayName}")` : `เวอร์ชัน Roblox (${robloxChannel})`;
        return interaction.editReply(`✅ ตั้งค่า Bot Voice Status ที่ห้อง <#${existingChannel.id}> รูปแบบ: **${modeText}** เรียบร้อยแล้ว`);
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
      const modeText = mode === "custom" ? `ตั้งชื่อเอง ("${displayName}")` : `เวอร์ชัน Roblox (${robloxChannel})`;
      return interaction.editReply(`✅ ตั้งค่า Bot Voice Status ใน Category \`${category!.id}\` รูปแบบ: **${modeText}** เรียบร้อยแล้ว`);
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
        content: result.changes ? `✅ ลบห้อง Bot Voice Status ออกเรียบร้อยแล้ว` : `❌ ยังไม่ได้ตั้งค่า Bot Voice Status`,
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === "list") {
      const row = db
        .prepare(`SELECT categoryId, voiceChannelId, mode, displayName, robloxChannel FROM botVoiceChannels WHERE guildId = ? AND enabled = 1`)
        .get(interaction.guildId) as { categoryId: string; voiceChannelId: string | null; mode: string; displayName: string; robloxChannel: string } | undefined;

      if (!row) return interaction.reply({ content: "_ยังไม่ได้ตั้งค่า_", flags: MessageFlags.Ephemeral });

      const modeDesc = row.mode === "custom" ? `Custom Name ("${row.displayName}")` : `Roblox Version (${row.robloxChannel})`;
      return interaction.reply({
        content: `• **Bot Voice Status** → ${row.voiceChannelId ? `<#${row.voiceChannelId}>` : `Category \`${row.categoryId}\``} (โหมด: **${modeDesc}**)`,
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === "refresh") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await updateBotVoiceChannels();
      return interaction.editReply("✅ รีเฟรชชื่อห้อง Bot Voice Status เรียบร้อยแล้ว");
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
          content: "❌ กรุณาระบุ **channel** (เลือกห้องข้อความที่มีอยู่แล้ว) หรือ **category** (ให้บอทสร้างห้องใหม่) อย่างใดอย่างหนึ่ง",
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
      const modeText = mode === "custom" ? `ตั้งชื่อเอง ("${displayName}")` : `เวอร์ชัน Roblox (${robloxChannel})`;
      return interaction.editReply(`✅ ตั้งค่า Bot Chat Status ${existingChannel ? `ที่ห้อง <#${existingChannel.id}>` : "(บอทจะสร้างห้องใหม่ใน Category ที่เลือก)"} รูปแบบ: **${modeText}** เรียบร้อยแล้ว`);
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
        content: result.changes ? `✅ ลบห้อง Bot Chat Status ออกเรียบร้อยแล้ว` : `❌ ยังไม่ได้ตั้งค่า Bot Chat Status`,
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === "list") {
      const row = db
        .prepare(`SELECT categoryId, channelId, mode, displayName, robloxChannel FROM botChatChannels WHERE guildId = ? AND enabled = 1`)
        .get(interaction.guildId) as { categoryId: string; channelId: string | null; mode: string; displayName: string; robloxChannel: string } | undefined;

      if (!row) return interaction.reply({ content: "_ยังไม่ได้ตั้งค่า_", flags: MessageFlags.Ephemeral });

      const modeDesc = row.mode === "custom" ? `Custom Name ("${row.displayName}")` : `Roblox Version (${row.robloxChannel})`;
      return interaction.reply({
        content: `• **Bot Chat Status** → ${row.channelId ? `<#${row.channelId}>` : `Category \`${row.categoryId}\``} (โหมด: **${modeDesc}**)`,
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === "refresh") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await updateBotChatChannels();
      return interaction.editReply("✅ รีเฟรชชื่อห้อง Bot Chat Status เรียบร้อยแล้ว");
    }
  }
}
