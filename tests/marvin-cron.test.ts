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

  it("schedules inbox, processing, and draft stages separately", () => {
    const config = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8")) as {
      crons: Array<{ path: string; schedule: string }>;
    };
    const paths = new Set(config.crons.map((job) => job.path));
    for (const path of [
      "/api/marvin-cron",
      "/api/marvin-cron/fathom",
      "/api/marvin-cron/drive",
      "/api/marvin-cron/matching",
      "/api/marvin-cron/actions",
      "/api/marvin-cron/drafts",
      "/api/marvin-cron/review",
    ]) {
      expect(paths.has(path)).toBe(true);
    }
    const schedulesFor = (path: string) =>
      config.crons.filter((job) => job.path === path).map((job) => job.schedule);
    for (const path of ["/api/marvin-cron", "/api/marvin-cron/fathom", "/api/marvin-cron/review"]) {
      expect(schedulesFor(path)).toEqual(["0 14 * * *", "0 19 * * *"]);
    }
    for (const path of [
      "/api/marvin-cron/drive",
      "/api/marvin-cron/matching",
      "/api/marvin-cron/actions",
    ]) {
      expect(schedulesFor(path)).toEqual(["0 15 * * *", "0 20 * * *"]);
    }
    expect(schedulesFor("/api/marvin-cron/drafts")).toEqual(["0 16 * * *", "0 21 * * *"]);
    for (const owner of ["ken", "katie", "brynn"]) {
      expect(schedulesFor(`/api/marvin-cron/briefing-${owner}`)).toEqual(["0 16 * * *"]);
    }
    expect(config.crons).toHaveLength(17);
  });
});
