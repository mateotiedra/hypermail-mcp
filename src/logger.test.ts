import { describe, expect, it } from "vitest";

import { createLogger } from "./logger.js";

describe("logger", () => {
  it("writes nothing when disabled", () => {
    const lines: string[] = [];
    const logger = createLogger({ enabled: false, write: (line) => lines.push(line) });

    logger.debug("test", "event", { value: 1 });

    expect(lines).toEqual([]);
  });

  it("writes structured debug output when enabled", () => {
    const lines: string[] = [];
    const logger = createLogger({ enabled: true, write: (line) => lines.push(line) });

    logger.debug("test", "event", {
      value: 1,
      token: "secret-token",
    });

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^\[hypermail-mcp\] debug /);
    const payload = JSON.parse(lines[0]!.replace(/^\[hypermail-mcp\] debug /, "")) as Record<string, unknown>;
    expect(payload).toMatchObject({
      component: "test",
      event: "event",
      value: 1,
      token: "[redacted]",
    });
    expect(typeof payload.ts).toBe("string");
    expect(payload.pid).toBe(process.pid);
  });
});
