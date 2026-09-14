import { describe, expect, it } from "vitest";
import {
  normalizedEaTaskSignature,
  responsibilityForTask,
  summarizeEaResponsibilities,
} from "../src/lib/eaOperatingSystem";

describe("EA operating system", () => {
  it("routes work into the human EA responsibility areas", () => {
    expect(
      responsibilityForTask({
        title: "Check Delta flight",
        status: "open",
        source_type: "ea_email",
      }),
    ).toBe("travel_admin");
    expect(
      responsibilityForTask({
        title: "Follow up on cabinet approval",
        status: "waiting",
        waiting_on: "client",
      }),
    ).toBe("client_followup");
    expect(
      responsibilityForTask({
        title: "Review approved materials not ordered",
        status: "ready",
        source_key: "ea-agent:procurement:kaufman",
      }),
    ).toBe("procurement");
  });

  it("counts due and waiting work without counting completed items", () => {
    const summary = summarizeEaResponsibilities(
      [
        {
          title: "Client approval",
          status: "waiting",
          waiting_on: "client",
          next_follow_up_date: "2026-09-10",
        },
        {
          title: "Old complete client approval",
          status: "complete",
          waiting_on: "client",
          next_follow_up_date: "2026-09-01",
        },
      ],
      "2026-09-10",
    );
    const client = summary.find((item) => item.key === "client_followup");
    expect(client).toMatchObject({ openCount: 1, dueCount: 1, waitingCount: 1 });
  });

  it("normalizes duplicate task signatures", () => {
    expect(normalizedEaTaskSignature("project-1", "Confirm  Cabinet Order! ")).toBe(
      "project-1:confirm cabinet order",
    );
  });
});
