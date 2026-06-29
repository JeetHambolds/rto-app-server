export function createRequestLogger(requestId, options = {}) {
  const logs = [];
  const onEntry = options.onEntry;

  async function add(level, message, meta = {}) {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...meta,
    };
    logs.push(entry);
    if (onEntry) {
      await onEntry(entry);
    }

    const prefix = `[${requestId}]`;
    const detail = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
    if (level === "error") {
      console.error(`${prefix} ${message}${detail}`);
    } else if (level === "warn") {
      console.warn(`${prefix} ${message}${detail}`);
    } else {
      console.log(`${prefix} ${message}${detail}`);
    }
  }

  return {
    info: (message, meta) => add("info", message, meta),
    warn: (message, meta) => add("warn", message, meta),
    error: (message, meta) => add("error", message, meta),
    getLogs: () => logs,
    tick: () => new Promise((resolve) => setImmediate(resolve)),
  };
}
