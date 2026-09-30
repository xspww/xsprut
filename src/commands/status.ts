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
  .setDescription("🤖 จัดการสถานะของบอท")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand((subcommand) =>
    subcommand
      .setName("add")
      .setDescription("➕ เพิ่มข้อความสถานะของบอท (เพิ่มได้หลายข้อความ ระบบจะสลับวนอัตโนมัติ)")
      .addStringOption((option) =>
        option
          .setName("text")
          .setDescription("ข้อความสถานะที่ต้องการแสดง")
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName("url")
          .setDescription("ลิงก์ Stream URL (ไม่บังคับ)")
          .setRequired(false),
      )
      .addStringOption((option) =>
        option
          .setName("custom")
          .setDescription("ข้อความ Custom Status แสดงบนการ์ดโปรไฟล์ (ไม่บังคับ, ใส่ emoji ได้)")
          .setRequired(false),
      )
      .addStringOption((option) =>
        option
          .setName("interval")
          .setDescription(
            `⏱️ ระยะเวลาที่แสดงข้อความนี้ก่อนสลับไปข้อความถัดไป (เช่น 30s, 1m, 5m; ค่าเริ่มต้น ${formatIntervalMs(STATUS_ROTATION_DEFAULT_INTERVAL_MS)})`,
          )
          .setRequired(false),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("remove")
      .setDescription("🗑️ ล้างข้อความสถานะทั้งหมด — สถานะบอทจะถูกถอดออกถาวรจนกว่าจะใช้ /status add ใหม่"),
  )
  .addSubcommand((subcommand) =>
    subcommand.setName("list").setDescription("📋 ดูข้อความสถานะทั้งหมดที่ตั้งไว้"),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("refresh")
      .setDescription("🔄 บังคับรีเฟรชสถานะบอทให้ตรงกับที่ตั้งไว้ทันที"),
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({
      content: "❌ ต้องมีสิทธิ์ Administrator ถึงจะจัดการสถานะบอทได้",
      flags: MessageFlags.Ephemeral,
    });
  }

  const subcommand = interaction.options.getSubcommand();

  if (subcommand === "add") {
    const text = interaction.options.getString("text", true).trim();
    if (text === "") {
      return interaction.reply({
        content: "❌ กรุณากรอกข้อความสถานะ (text) ด้วย",
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
          content: `❌ รูปแบบ **interval** ไม่ถูกต้อง (ตัวอย่างที่ใช้ได้: \`30s\`, \`1m\`, \`5m\`, \`1h\`)`,
          flags: MessageFlags.Ephemeral,
        });
      }
      if (parsed < STATUS_ROTATION_MIN_INTERVAL_MS) {
        return interaction.reply({
          content: `❌ interval ต้องไม่น้อยกว่า **${formatIntervalMs(STATUS_ROTATION_MIN_INTERVAL_MS)}**`,
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
        ? `\n📋 ตอนนี้มีข้อความสถานะทั้งหมด **${count.c}** ข้อความ — ระบบจะสลับวนอัตโนมัติตามเวลาที่กำหนด`
        : `\n📋 ตอนนี้มีข้อความสถานะ 1 ข้อความ — ใช้ /status add เพิ่มข้อความเพิ่มเพื่อให้สลับอัตโนมัติ`;

    return interaction.reply({
      content:
        `✅ เพิ่มข้อความสถานะแล้ว: \`${text}\`${custom ? `\n💬 Custom Status: \`${custom}\`` : ""}` +
        `\n⏱️ จะแสดงข้อความนี้ **${formatIntervalMs(intervalMs)}** แล้วสลับไปข้อความถัดไป${rotationNote}`,
      flags: MessageFlags.Ephemeral,
    });
  }

  if (subcommand === "remove") {
    resetBotStatus();

    return interaction.reply({
      content: "✅ ล้างข้อความสถานะทั้งหมดแล้ว (สถานะของบอทถูกลบออกแล้ว)",
      flags: MessageFlags.Ephemeral,
    });
  }

  if (subcommand === "refresh") {
    refreshBotStatus();

    return interaction.reply({
      content: "✅ รีเฟรชสถานะบอทเรียบร้อยแล้ว (แสดงตามข้อความที่ตั้งไว้)",
      flags: MessageFlags.Ephemeral,
    });
  }

  // list (เดิมคือ view)
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
      content: "ℹ️ ยังไม่ได้ตั้งค่าข้อความสถานะแบบกำหนดเอง (ใช้ /status add เพื่อเพิ่ม)",
      flags: MessageFlags.Ephemeral,
    });
  }

  const lines = messages.map((m, i) => {
    const num = i < NUMBER_EMOJIS.length ? `${NUMBER_EMOJIS[i]} ` : `${i + 1}. `;
    const interval = formatIntervalMs(m.intervalMs || STATUS_ROTATION_DEFAULT_INTERVAL_MS);
    return (
      `${num}\`${m.activityText}\` (สลับทุก **${interval}**)${
        m.customStatus ? `\n   💬 Custom: \`${m.customStatus}\`` : ""
      }` +
      `\n   🔗 ${m.streamUrl}`
    );
  });

  return interaction.reply({
    content: `📋 ข้อความสถานะที่ตั้งไว้ (**${messages.length}** ข้อความ) — ระบบจะสลับวนอัตโนมัติตามเวลาที่กำหนด:\n${lines.join("\n")}`,
    flags: MessageFlags.Ephemeral,
  });
}
