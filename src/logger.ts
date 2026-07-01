export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(component: string, event: string, fields?: LogFields): void;
}

export const noopLogger: Logger = {
  debug: () => undefined,
};

export interface CreateLoggerOptions {
  enabled: boolean;
  write?: (line: string) => void;
}

const REDACTED = "[redacted]";
const SENSITIVE_FIELD = /token|secret|password|credential|key|body|content/i;

export function createLogger(opts: CreateLoggerOptions): Logger {
  if (!opts.enabled) return noopLogger;
  const write = opts.write ?? ((line: string) => process.stderr.write(line));

  return {
    debug(component: string, event: string, fields: LogFields = {}): void {
      try {
        const payload = {
          ts: new Date().toISOString(),
          pid: process.pid,
          component,
          event,
          ...sanitizeFields(fields),
        };
        write(`[hypermail-mcp] debug ${JSON.stringify(payload)}\n`);
      } catch {
        // Logging must never affect runtime behavior.
      }
    },
  };
}

function sanitizeFields(fields: LogFields): LogFields {
  const sanitized: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    sanitized[key] = sanitizeValue(key, value, 0);
  }
  return sanitized;
}

function sanitizeValue(key: string, value: unknown, depth: number): unknown {
  if (SENSITIVE_FIELD.test(key)) return REDACTED;
  if (value === null || value === undefined) return value;

  const valueType = typeof value;
  if (valueType === "string" || valueType === "number" || valueType === "boolean") {
    return value;
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    if (depth >= 2) return `[array:${value.length}]`;
    return value.map((item) => sanitizeValue(key, item, depth + 1));
  }
  if (valueType === "object") {
    if (depth >= 2) return "[object]";
    const out: LogFields = {};
    for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
      out[childKey] = sanitizeValue(childKey, childValue, depth + 1);
    }
    return out;
  }

  return String(value);
}
