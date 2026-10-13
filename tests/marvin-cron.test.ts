import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MARVIN_SCHEDULED_GMAIL_BATCH_SIZE,
  orderGmailMessageIds,
  takeScheduledGmailBatch,
} from "../src/lib/marvinCron";

describe("scheduled Marvin work", () => {
  it("limits each inbox pass without dropping unprocessed messages", () => {
    const messages = Array.from({ length: 55 }, (_, index) => `message-${index}`);
    const first = takeScheduledGmailBatch(messages, MARVIN_SCHEDULED_GMAIL_BATCH_SIZE);
    expect(first.selected).toHaveLength(12);
    expect(first.deferred).toHaveLength(43);
    expect([...first.selected, ...first.deferred]).toEqual(messages);
  });

  it("does not let failed messages starve new mail and deferred backlog", () => {
    const ordered = orderGmailMessageIds(
      Array.from({ length: 19 }, (_, index) => `retry-${index}`),
      Array.from({ length: 20 }, (_, index) => `deferred-${index}`),
      Array.from({ length: 20 }, (_, index) => `new-${index}`),
    );
    const first = takeScheduledGmailBatch(ordered, MARVIN_SCHEDULED_GMAIL_BATCH_SIZE);
    expect(first.selected).toEqual([
      "retry-0",
      "retry-1",
      "retry-2",
      "new-0",
      "new-1",
      "new-2",
      "new-3",
      "new-4",
      "deferred-0",
      "deferred-1",
      "deferred-2",
      "deferred-3",
    ]);
    expect(first.deferred).toContain("deferred-4");
    expect(first.deferred).toContain("retry-18");
  });

  it("keeps the larger manual refresh limit", () => {
    const messages = Array.from({ length: 155 }, (_, index) => `message-${index}`);
    expect(takeScheduledGmailBatch(messages).selected).toHaveLength(150);
    expect(takeScheduledGmailBatch(messages).deferred).toHaveLength(5);
  });

  it("schedules only construction uploads at 7 AM and noon Phoenix time", () => {
    const config = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8")) as {
      crons: Array<{ path: string; schedule: string }>;
    };
    expect(config.crons).toEqual([
      { path: "/api/marvin-cron/construction-docs", schedule: "0 14 * * *" },
      { path: "/api/marvin-cron/construction-docs", schedule: "0 19 * * *" },
    ]);
  });
});
