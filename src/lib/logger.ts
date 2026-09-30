import fs from "node:fs";
import path from "node:path";
import config from "./config";

// ANSI color codes
const colors = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  fg: {
    cyan: "\x1b[36m",
    yellow: "\x1b[33m",
    red: "\x1b[31m",
    green: "\x1b[32m",
  },
};

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

function timestamp(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

// ─── Optional file sink (LOG_TO_FILE / LOG_FILE) ───────────────────────────
// Every log line is also appended to a plain-text log file so a crash, PM2
// log rotation, or a lost terminal can never destroy the record.
let logStream: fs.WriteStream | null = null;

function getStream(): fs.WriteStream | null {
  if (logStream) return logStream;
  try {
    fs.mkdirSync(path.dirname(config.LOG_FILE), { recursive: true });
    logStream = fs.createWriteStream(config.LOG_FILE, { flags: "a" });
    logStream.on("error", () => {
      logStream = null;
    });
  } catch {
    logStream = null;
  }
  return logStream;
}

function writeToFile(line: string) {
  if (!config.LOG_TO_FILE) return;
  const stream = getStream();
  if (stream) stream.write(line + "\n");
}

type Level = "INFO" | "WARN" | "ERROR" | "OK";

function format(level: Level, message: string): string {
  const emojiMap: Record<Level, string> = {
    INFO: "ℹ️",
    WARN: "⚠️",
    ERROR: "❌",
    OK: "✅",
  };
  const colorMap: Record<Level, string> = {
    INFO: colors.fg.cyan,
    WARN: colors.fg.yellow,
    ERROR: colors.fg.red,
    OK: colors.fg.green,
  };
  const levelPadded = level.padEnd(5, " ");
  return `${colors.dim}[${timestamp()}]${colors.reset} ${colorMap[level]}[${emojiMap[level]} ${levelPadded}]${colors.reset} ${message}`;
}

const logger = {
  info(msg: string, ...optionalParams: any[]) {
    console.log(format("INFO", msg), ...optionalParams);
    writeToFile(`[INFO] ${timestamp()} ${msg}${optionalParams.length ? " " + optionalParams.map(String).join(" ") : ""}`);
  },
  warn(msg: string, ...optionalParams: any[]) {
    console.warn(format("WARN", msg), ...optionalParams);
    writeToFile(`[WARN] ${timestamp()} ${msg}${optionalParams.length ? " " + optionalParams.map(String).join(" ") : ""}`);
  },
  error(msg: string, ...optionalParams: any[]) {
    console.error(format("ERROR", msg), ...optionalParams);
    writeToFile(`[ERROR] ${timestamp()} ${msg}${optionalParams.length ? " " + optionalParams.map(String).join(" ") : ""}`);
  },
  ok(msg: string, ...optionalParams: any[]) {
    console.log(format("OK", msg), ...optionalParams);
    writeToFile(`[OK] ${timestamp()} ${msg}${optionalParams.length ? " " + optionalParams.map(String).join(" ") : ""}`);
  },
};
export default logger;
