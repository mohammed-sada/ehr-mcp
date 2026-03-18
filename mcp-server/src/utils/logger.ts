type LogLevel = "debug" | "info" | "warn" | "error";

const levelOrder: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

const currentLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) || "info";

function shouldLog(level: LogLevel) {
  return levelOrder[level] >= levelOrder[currentLevel];
}

function ts() {
  return new Date().toISOString();
}

export const logger = {
  debug: (msg: string, meta?: unknown) => {
    if (!shouldLog("debug")) return;
    // eslint-disable-next-line no-console
    console.debug(`[${ts()}] DEBUG ${msg}`, meta ?? "");
  },
  info: (msg: string, meta?: unknown) => {
    if (!shouldLog("info")) return;
    // eslint-disable-next-line no-console
    console.info(`[${ts()}] INFO  ${msg}`, meta ?? "");
  },
  warn: (msg: string, meta?: unknown) => {
    if (!shouldLog("warn")) return;
    // eslint-disable-next-line no-console
    console.warn(`[${ts()}] WARN  ${msg}`, meta ?? "");
  },
  error: (msg: string, meta?: unknown) => {
    if (!shouldLog("error")) return;
    // eslint-disable-next-line no-console
    console.error(`[${ts()}] ERROR ${msg}`, meta ?? "");
  }
};

