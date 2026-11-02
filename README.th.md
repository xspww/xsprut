<p align="center">
  <img src="img/White.png" width="110" alt="โลโก้ xsprut Project">
</p>

<h1 align="center">xsprut Project</h1>

<p align="center">Discord bot ที่ติดตามการอัปเดต client ของ Roblox และการปล่อย executor</p>

<p align="center">
  <img src="https://img.shields.io/badge/node-20%2B-green" alt="node">
  <img src="https://img.shields.io/badge/discord.js-14-blue" alt="discord.js">
  <img src="https://img.shields.io/badge/platform-Windows-lightgrey" alt="platform">
</p>

https://github.com/user-attachments/assets/7a14de45-8027-463f-bef6-8e32f8b06c3c

---

> เวอร์ชันภาษาอังกฤษ: [README.md](README.md)

## ฟีเจอร์

- **การแจ้งเตือนอัปเดต** — โพสต์ไปยังช่องเมื่อ Roblox ปล่อย client version ใหม่
- **ติดตาม executor** — ติดตามการอัปเดต executor พร้อมการ์ดกิจกรรม voice และ chat
- **ความปลอดภัยของเซิร์ฟเวอร์** — ป้องกันห้อง รายการอนุญาตผู้ใช้ และการยืนยันการเข้าร่วม
- **การ์ดสถานะ** — embed สดพร้อม presence แบบ Streaming/Online และรีเฟรชอัตโนมัติ
- **การควบคุมการเข้าถึง** — รายการอนุญาตคำสั่ง cooldown ต่อผู้ใช้ และรายงานข้อผิดพลาดผ่าน webhook
- **รองรับการโฮสต์เอง** — จัดเก็บด้วย SQLite ใช้ PM2 ได้ตามต้องการ และบันทึก log เป็นไฟล์

## ความต้องการ

- Node.js 20 ขึ้นไป
- Discord bot ที่มี token, application ID และ server ID
- Windows, macOS หรือ Linux

## การตั้งค่า

```bash
git clone https://github.com/xsprut/robloxupdatetracker.git
cd robloxupdatetracker
npm install
```

คัดลอก template ของ environment แล้วใส่ข้อมูลรับรอง:

```bash
# Windows
copy .env.example .env

# macOS / Linux
cp .env.example .env
```

| ตัวแปร | จำเป็น | คำอธิบาย |
| --- | --- | --- |
| `DISCORD_BOT_TOKEN` | ใช่ | token สำหรับ login ของ bot |
| `DISCORD_CLIENT_ID` | ใช่ | Application ID จาก Discord Developer Portal |
| `DISCORD_GUILD_ID` | ใช่ | ID ของเซิร์ฟเวอร์เป้าหมาย ใช้ comma-separated list สำหรับหลายเซิร์ฟเวอร์ |
| `ALLOWED_USER_IDS` | ไม่ | จำกัดคำสั่งให้เฉพาะ user ID กลุ่มนี้ ถ้าว่างจะอนุญาตทุกคนที่มี Administrator |
| `ERROR_WEBHOOK_URL` | ไม่ | webhook ที่รับการแจ้งเตือนเมื่อเกิด crash |
| `COMMAND_COOLDOWN_MS` | ไม่ | cooldown คำสั่งต่อผู้ใช้เป็น ms `0` คือปิด |

รายการทั้งหมดพร้อมค่าเริ่มต้นอยู่ใน [`.env.example`](.env.example) อย่า commit ไฟล์ `.env` ของคุณ

ลงทะเบียน slash commands แล้วเริ่ม bot:

```bash
npm run register-commands
npm run build
npm start
```

บน Windows ไฟล์ `register-commands.bat` และ `start-bot.bat` ทำแบบเดียวกันโดยไม่ต้องพิมพ์คำสั่ง

> ถ้าไม่ได้ตั้งค่า `DISCORD_GUILD_ID` Discord ก็อาจใช้เวลาถึงหนึ่งชั่วโมงกว่าจะเผยแพร่ commands

พิมพ์ `/help` ใน Discord เพื่อดูทุกคำสั่ง `/help` และ `/ver` เป็นวิธีที่เร็วที่สุดในการตรวจสอบว่าตั้งค่าถูกต้อง

## คำสั่ง

| กลุ่ม | คำสั่ง |
| --- | --- |
| การอัปเดต Roblox | `/robloxalert add\|remove\|list`, `/ver` |
| Executor | `/ex track\|voice\|chat` — `add`, `edit`, `remove`, `list`, `refresh` |
| ความปลอดภัย | `/protectroom setup\|edit\|remove\|view`, `/whitelist add\|remove\|list`, `/verify setup\|remove` |
| อื่น ๆ | `/status`, `/joinalert`, `/cleanup run\|preview`, `/config`, `/test`, `/help` |

ทุกคำสั่งต้องการสิทธิ์ **Administrator** พิมพ์ `/help` ใน Discord เพื่อดูรายละเอียดการใช้งานครบ

### คำสั่ง prefix (ไม่ต้องใช้ slash)

ทุกคนใช้ได้ใน text channel ปกติโดยพิมพ์ตรง ๆ
คำสั่งเหล่านี้ใช้ไม่ได้ในห้องที่ป้องกัน ในโหมดยืนยัน **Code** คำสั่ง `?inv`
ต้องการ role ที่ยืนยันแล้ว, Administrator หรือเจ้าของเซิร์ฟเวอร์

| คำสั่ง | การทำงาน |
| --- | --- |
| `?ver` / `?ver ZBeta` | แสดง Roblox version ปัจจุบัน (cache 30 วินาที, WEAO fallback สำหรับ LIVE) |
| `?inv` | สร้าง invite link ใช้ได้ครั้งเดียวสำหรับช่อง (หมดอายุใน 30 นาที, ลบอัตโนมัติหลัง 30 วินาที) ในโหมดยืนยัน **Code** คำตอบจะมี code แบบใช้ครั้งเดียว `XXXX-XXX-XXXX` ที่สร้างสำหรับ invite นั้นด้วย |

`?inv` ต้องการให้ bot มีสิทธิ์ `Create Instant Invite`
ทั้งสองคำสั่งใช้ cooldown ต่อผู้ใช้ร่วมกับ slash commands

### โหมดการยืนยัน

`/verify setup` รองรับสองโหมด เลือกด้วย option `mode` ที่จำเป็น:

- **Captcha** — ผู้ใช้กด **Verify** แล้วแก้ captcha ภาพ 4 หลัก
- **Code** — ผู้ใช้กด **Enter code** แล้วส่ง code ที่มากับ invite ของตน
  ในโหมดนี้ `?inv` สร้าง code สุ่มแบบเข้ารหัสครั้งเดียวต่อ invite
  code ถูกสร้างสำหรับ invite นั้น หมดอายุหลัง 30 นาที และใช้ได้ครั้งเดียว
  ถือเป็นโค้ดใช้ครั้งเดียว: ใครก็ตามที่มี code สามารถใช้ได้
  ดังนั้นส่งให้เฉพาะผู้ใช้ที่ได้รับ invite เท่านั้น
  เฉพาะสมาชิกที่มี role ยืนยันแล้ว (หรือ admin/เจ้าของเซิร์ฟเวอร์)
  เท่านั้นที่สร้าง invite + code ได้ในโหมดนี้
  ผู้ใช้ที่ยังไม่ยืนยันจึงสร้าง code ให้ตัวเองไม่ได้
  เพราะ `?inv` เป็นคำสั่ง prefix คำตอบของมัน (รวมถึง code) จะมองเห็นได้ในช่องนั้น
  เป็นเวลา 30 วินาที รันในที่ที่มีแต่สมาชิกที่ไว้ใจได้เท่านั้น
  แล้วส่งต่อ code แบบส่วนตัว

## สคริปต์

| คำสั่ง | การทำงาน |
| --- | --- |
| `npm run dev` | watch mode สำหรับพัฒนาในเครื่อง |
| `npm run build` | compile TypeScript ไปยัง `dist/` |
| `npm run typecheck` | type-check source และ tests โดยไม่ emit |
| `npm start` | รัน bot ที่ compile แล้ว |
| `npm run register-commands` | ลงทะเบียน slash commands กับ Discord |
| `npm test` | รัน test suite |
| `npm run refresh-cards` | รีเฟรช Embed Status card ทุกใบที่เปิดใช้งานครั้งเดียว |
| `npm run pm2:start` | รันภายใต้ PM2 สำหรับโฮสต์แบบเปิดตลอด |

## โฮสต์ด้วย PM2

`npm run pm2:start` อ่าน `ecosystem.config.js` ซึ่ง **ไม่ได้** commit
(เพราะเก็บการตั้งค่าเฉพาะเครื่อง) สร้างขึ้นหนึ่งครั้ง:

```bash
# Windows
copy ecosystem.config.example.js ecosystem.config.js

# macOS / Linux
cp ecosystem.config.example.js ecosystem.config.js
```

แก้ไขสำเนาถ้าต้องการชื่อแอปหรือ path ของ log ที่ต่างออกไป แล้วรัน:

```bash
npm run build
npm run pm2:start
```

## การพัฒนา

- `npm test` รัน suite ด้วย test runner ในตัวของ Node ผ่าน `tsx`
  (`tests/*.test.ts`) การทดสอบใช้ฐานข้อมูล SQLite ในหน่วยความจำ
  จึงไม่แตะต้อง `data.db` จริงของคุณ
- CI (`.github/workflows/build.yml`) รัน `npm run build`, `npm run typecheck`
  และ `npm test` บน Node 20 และ 22 สำหรับทุก push และ pull request
- พฤติกรรมฝั่ง Discord (gateway events, permissions, embeds, ขั้นตอน captcha)
  ไม่ครอบคลุมโดย unit tests ให้ใช้
  [`docs/test-guild-checklist.md`](docs/test-guild-checklist.md) ก่อน release

## License

เผยแพร่ภายใต้ [MIT License](LICENSE)