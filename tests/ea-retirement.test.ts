import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  getUser: vi.fn(),
  upload: vi.fn(),
  authorize: vi.fn(),
  oauth: vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
}));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: mocks.from, auth: { getUser: mocks.getUser } },
}));
vi.mock("@/lib/eaOperator.server", () => ({ runEaOperatingReview: vi.fn() }));
vi.mock("@/lib/marvin.server", () => ({
  json: (value: unknown, status = 200) => Response.json(value, { status }),
  MARVIN_SHARED_GMAIL: "marvinbotai@gmail.com",
  syncConstructionDocuments: mocks.upload,
  requireMarvinUser: mocks.authorize,
  gmailAuthorizationUrl: mocks.oauth,
}));

import { runMarvinCronStage, MARVIN_CRON_STAGES } from "../src/lib/marvinCron.server";
import {
  requireConstructionUploadAccess,
  loadConstructionUploadStatus,
  refreshConstructionUploads,
} from "../src/lib/constructionUploads.server";
import { Route as marvin } from "../src/routes/api/marvin";
import { Route as webhook } from "../src/routes/api/marvin-fathom-webhook";
import { Route as workspace } from "../src/routes/api/ea-workspace";
import { Route as calendar } from "../src/routes/api/ea-calendar";
import { Route as agentUpload } from "../src/routes/api/marvin-upload";
const handlers = (route: any) => route.options.server.handlers;

describe("EA retirement and independent document controls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  it("does no database or AI work for every retired cron stage", async () => {
    for (const stage of MARVIN_CRON_STAGES.filter((stage) => stage !== "construction-docs")) {
      expect(await runMarvinCronStage(stage)).toMatchObject({
        skipped: true,
        reason: "EA retired",
      });
    }
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it("blocks the workspace, EA calendar and agent uploads before any work", async () => {
    for (const route of [workspace, calendar, agentUpload]) {
      for (const method of ["GET", "POST"]) {
        if (!handlers(route)[method]) continue;
        const res = await handlers(route)[method]({
          request: new Request("https://studio.test/api/retired", { method }),
        });
        expect(res.status).toBe(410);
      }
    }
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.authorize).not.toHaveBeenCalled();
  });
  it("still runs the construction-documents scheduled stage", async () => {
    const query: any = {
      update: () => query,
      in: () => query,
      eq: () => query,
      lt: () => query,
      insert: () => query,
      then: (resolve: any) => resolve({ error: null }),
    };
    mocks.from.mockReturnValue(query);
    mocks.upload.mockResolvedValue({
      uploaded: 1,
      failed: 0,
      deferred: 0,
      needsReconnect: false,
      error: null,
    });
    expect(await runMarvinCronStage("construction-docs")).toMatchObject({
      status: "complete",
      result: { uploaded: 1 },
    });
    expect(mocks.upload).toHaveBeenCalledTimes(1);
  });
  it("acknowledges Fathom without ingesting or writing records", async () => {
    const response = await handlers(webhook).POST({
      request: new Request("https://studio.test/api/marvin-fathom-webhook", { method: "POST" }),
    });
    expect(await response.json()).toMatchObject({ ignored: true });
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it("blocks the old chat, sync, draft and briefing actions", async () => {
    mocks.authorize.mockResolvedValue({
      user: { id: "ken" },
      profile: { email: "ken@meravinteriors.com", role: "Admin", is_active: true },
    });
    for (const action of [
      "chat",
      "sync_now",
      "run_briefing",
      "approve_suggestion",
      "connect_fathom",
      "disconnect",
    ]) {
      const res = await handlers(marvin).POST({
        request: new Request("https://studio.test/api/marvin", {
          method: "POST",
          body: JSON.stringify({ action }),
        }),
      });
      expect(res.status).toBe(410);
    }
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it("keeps only Ken's shared mailbox reconnection available", async () => {
    for (const [email, role, expected] of [
      ["ken@meravinteriors.com", "Admin", 200],
      ["katie@meravinteriors.com", "Admin", 403],
      ["brynn@meravinteriors.com", "Employee", 403],
      ["ken@meravinteriors.com", "Client", 403],
    ] as const) {
      mocks.authorize.mockResolvedValue({
        user: { id: "user" },
        profile: { email, role, is_active: true },
      });
      mocks.oauth.mockReturnValue("https://accounts.google.com/test");
      const res = await handlers(marvin).POST({
        request: new Request("https://studio.test/api/marvin", {
          method: "POST",
          body: JSON.stringify({ action: "gmail_connect", account_email: "marvinbotai@gmail.com" }),
        }),
      });
      expect(res.status).toBe(expected);
    }
    expect(mocks.oauth).toHaveBeenCalledTimes(1);
  });
  it("rejects unsigned and external upload control access", async () => {
    const request = new Request("https://studio.test/api/construction-uploads");
    expect(((await requireConstructionUploadAccess(request)) as any).error.status).toBe(401);
    mocks.getUser.mockResolvedValue({ data: { user: { id: "user" } } });
    const profile = { email: "ken@meravinteriors.com", role: "Client", is_active: true };
    const query: any = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      maybeSingle: vi.fn(async () => ({ data: profile })),
    };
    mocks.from.mockReturnValue(query);
    expect(
      (
        (await requireConstructionUploadAccess(
          new Request(request, { headers: { Authorization: "Bearer token" } }),
        )) as any
      ).error.status,
    ).toBe(403);
    for (const email of ["ken", "katie", "brynn"]) {
      Object.assign(profile, { email: `${email}@meravinteriors.com`, role: "Employee" });
      expect(
        await requireConstructionUploadAccess(
          new Request(request, { headers: { Authorization: "Bearer token" } }),
        ),
      ).toHaveProperty("user.id", "user");
    }
  });
  it("returns operational counts without exposing credentials or source metadata", async () => {
    const selects: string[] = [];
    let jobs = 0;
    mocks.from.mockImplementation((table: string) => {
      const data =
        table === "marvin_integrations"
          ? { account_email: "marvinbotai@gmail.com", status: "connected", last_error: null }
          : ++jobs === 1
            ? {
                status: "complete",
                finished_at: "2026-10-13T14:51:52Z",
                progress: { uploaded: 2, deferredMessageIds: ["private"] },
              }
            : { finished_at: "2026-10-13T14:51:52Z" };
      const query: any = {
        select: (cols: string) => {
          selects.push(cols);
          return query;
        },
        eq: () => query,
        in: () => query,
        order: () => query,
        limit: () => query,
        maybeSingle: async () => ({ data }),
      };
      return query;
    });
    const result = await loadConstructionUploadStatus();
    expect(result.latestCheck?.uploaded).toBe(2);
    expect(JSON.stringify(result)).not.toContain("private");
    expect(selects).not.toContain("*");
  });
  it("manual refresh calls only document filing and records its result", async () => {
    const query: any = {
      insert: vi.fn(() => query),
      update: vi.fn(() => query),
      eq: vi.fn(() => query),
      then: (resolve: any) => resolve({ error: null }),
    };
    mocks.from.mockReturnValue(query);
    mocks.upload.mockResolvedValue({
      uploaded: 3,
      failed: 0,
      deferred: 0,
      needsReconnect: false,
      error: null,
    });
    expect(await refreshConstructionUploads("ken")).toMatchObject({ uploaded: 3 });
    expect(mocks.upload).toHaveBeenCalledTimes(1);
    expect(query.update).toHaveBeenCalledWith(expect.objectContaining({ status: "complete" }));
    expect(mocks.from.mock.calls.every((call) => call[0] === "marvin_sync_jobs")).toBe(true);
  });
  it("records project spec-refresh progress separately from global upload cursors", async () => {
    const query: any = {
      insert: vi.fn(() => query),
      update: vi.fn(() => query),
      eq: vi.fn(() => query),
      then: (resolve: any) => resolve({ error: null }),
    };
    mocks.from.mockReturnValue(query);
    mocks.upload.mockResolvedValue({
      uploaded: 0,
      failed: 0,
      deferred: 1,
      needsReconnect: false,
      error: null,
    });
    await refreshConstructionUploads("ken", { projectId: "project", budgetMs: 45000 });
    expect(mocks.upload).toHaveBeenCalledWith({ projectId: "project", budgetMs: 45000 });
    expect(query.insert).toHaveBeenCalledWith(
      expect.objectContaining({ job_type: "spec_construction_docs" }),
    );
    expect(query.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "partial",
        progress: expect.objectContaining({ projectId: "project" }),
      }),
    );
  });
});
