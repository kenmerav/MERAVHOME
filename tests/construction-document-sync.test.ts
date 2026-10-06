import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  tables: {} as Record<string, any[]>,
  files: new Map<string, Blob>(),
  uploads: [] as string[],
  messages: [] as any[],
  failures: new Set<string>(),
  calls: [] as string[],
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from(table: string) {
      const filters: Array<(row: any) => boolean> = [];
      let operation = "read",
        values: any,
        conflict = "",
        single = false,
        limit = Infinity;
      const column = (row: any, key: string) =>
        key.includes("->>") ? (row[key.split("->>")[0]]?.[key.split("->>")[1]] ?? null) : row[key];
      const query: any = {
        select: () => query,
        eq: (key: string, value: any) => {
          filters.push((row) => column(row, key) === value);
          return query;
        },
        neq: (key: string, value: any) => {
          filters.push((row) => column(row, key) !== value);
          return query;
        },
        in: (key: string, value: any[]) => {
          filters.push((row) => value.includes(column(row, key)));
          return query;
        },
        is: (key: string, value: any) => {
          filters.push((row) => column(row, key) === value);
          return query;
        },
        not: (key: string, _op: string, value: any) => {
          filters.push((row) => column(row, key) !== value);
          return query;
        },
        ilike: (key: string, value: string) => {
          filters.push((row) => String(row[key]).toLowerCase() === value.toLowerCase());
          return query;
        },
        contains: (key: string, value: any) => {
          filters.push((row) => Object.entries(value).every(([k, v]) => row[key]?.[k] === v));
          return query;
        },
        order: () => query,
        or: () => query,
        limit: (value: number) => {
          limit = value;
          return query;
        },
        insert: (value: any) => {
          operation = "insert";
          values = value;
          return query;
        },
        update: (value: any) => {
          operation = "update";
          values = value;
          return query;
        },
        upsert: (value: any, options: any) => {
          operation = "upsert";
          values = value;
          conflict = options.onConflict;
          return query;
        },
        single: () => {
          single = true;
          return query;
        },
        maybeSingle: () => {
          single = true;
          return query;
        },
        then(resolve: any, reject: any) {
          const rows = (db.tables[table] ??= []);
          let result = rows.filter((row) => filters.every((filter) => filter(row))).slice(0, limit);
          let error: any = null;
          if (operation === "update") result.forEach((row) => Object.assign(row, values));
          if (operation === "insert" || operation === "upsert") {
            result = [];
            for (const value of Array.isArray(values) ? values : [values]) {
              const keys = conflict
                ? conflict.split(",")
                : table === "marvin_sync_jobs"
                  ? ["idempotency_key"]
                  : [];
              const existing = keys.length
                ? rows.find((row) => keys.every((key) => row[key] === value[key]))
                : null;
              if (existing && operation === "insert") {
                error = { code: "23505" };
                continue;
              }
              const row = existing || { id: `${table}-${rows.length + 1}` };
              Object.assign(row, value);
              if (!existing) rows.push(row);
              result.push(row);
            }
          }
          const enriched = result.map((row) =>
            table === "marvin_sources"
              ? {
                  ...row,
                  marvin_source_projects: (db.tables.marvin_source_projects ?? []).filter(
                    (link) => link.source_id === row.id,
                  ),
                }
              : { ...row },
          );
          return Promise.resolve({ data: single ? enriched[0] || null : enriched, error }).then(
            resolve,
            reject,
          );
        },
      };
      return query;
    },
    storage: {
      from(bucket: string) {
        return {
          async upload(path: string, file: Blob) {
            db.uploads.push(`${bucket}/${path}`);
            db.files.set(`${bucket}/${path}`, file);
            return { error: null };
          },
          async download(path: string) {
            return { data: db.files.get(`${bucket}/${path}`), error: null };
          },
          getPublicUrl(path: string) {
            return { data: { publicUrl: `https://storage.test/${bucket}/${path}` } };
          },
          async remove() {
            return { error: null };
          },
        };
      },
    },
  },
}));

import { encryptCredentials, syncConstructionDocuments } from "../src/lib/marvin.server";

function message(id: string, filenames = ["RINEHART_MI_261006.pdf"]) {
  return {
    id,
    threadId: `thread-${id}`,
    internalDate: String(Date.now()),
    payload: {
      headers: [
        { name: "From", value: "Jessica <jessica@blue-skycreative.com>" },
        { name: "Subject", value: "Re: Rinehart Reno" },
      ],
      parts: filenames.map((filename, index) => ({
        filename,
        mimeType: "application/pdf",
        body: { attachmentId: `${id}-attachment-${index}` },
      })),
    },
  };
}

beforeEach(() => {
  vi.stubEnv("MARVIN_ENCRYPTION_KEY", "11".repeat(32));
  db.tables = {
    projects: [{ id: "rinehart", name: "Rinehart Reno", client_name: "Rinehart" }],
    marvin_integrations: [
      {
        id: "integration",
        provider: "gmail",
        account_email: "marvinbotai@gmail.com",
        status: "connected",
        ...encryptCredentials({ access_token: "test-token", expires_at: Date.now() + 3600_000 }),
      },
    ],
  };
  db.files.clear();
  db.uploads = [];
  db.messages = [];
  db.failures.clear();
  db.calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: any) => {
      const url = String(input);
      db.calls.push(url);
      if (url.includes("oauth2.googleapis.com"))
        return Response.json(
          { error: "invalid_grant", error_description: "Token has been expired or revoked." },
          { status: 400 },
        );
      if (url.includes("/attachments/")) {
        if (db.failures.has(url.split("/").at(-1)!))
          return Response.json({ error: { message: "Download failed" } }, { status: 500 });
        return Response.json({
          data: Buffer.from(`%PDF ${url.split("/").at(-1)}`).toString("base64url"),
        });
      }
      if (url.includes("/messages?"))
        return Response.json({ messages: db.messages.map(({ id }) => ({ id })) });
      if (url.includes("/messages/"))
        return Response.json(db.messages.find(({ id }) => url.includes(`/messages/${id}?`)));
      throw new Error(`Unexpected network dependency: ${url}`);
    }),
  );
});

describe("independent Jessica PDF filing", () => {
  it("files every PDF in a message without AI or Drive and keeps uncertain PDFs for review", async () => {
    db.messages = [
      message("new", ["RINEHART_MI_261006.pdf", "RINEHART_MI_261006_v2.pdf", "AS9356.pdf"]),
    ];
    const result = await syncConstructionDocuments();
    expect(result).toMatchObject({ uploaded: 2, needsReview: 1, failed: 0 });
    expect(db.tables.project_documents).toHaveLength(2);
    expect(
      db.tables.project_documents.every(
        (row) =>
          row.project_id === "rinehart" && !row.visible_to_clients && !row.visible_to_contractors,
      ),
    ).toBe(true);
    expect(db.calls.every((url) => url.startsWith("https://gmail.googleapis.com/"))).toBe(true);
    expect(db.tables.shared_project_todos).toBeUndefined();
    const again = await syncConstructionDocuments();
    expect(again.uploaded).toBe(0);
    expect(db.tables.project_documents).toHaveLength(2);
  });

  it("deduplicates the same bytes sent in different emails", async () => {
    db.messages = [message("a"), message("b")];
    for (const email of db.messages)
      email.payload.parts[0].body = { data: Buffer.from("%PDF identical").toString("base64url") };
    expect(await syncConstructionDocuments()).toMatchObject({ uploaded: 1, duplicates: 1 });
    expect(db.tables.project_documents).toHaveLength(1);
  });

  it("files stored PDFs even when Google is expired and records the need to reconnect", async () => {
    db.tables.marvin_integrations[0] = {
      ...db.tables.marvin_integrations[0],
      ...encryptCredentials({ refresh_token: "expired" }),
    };
    db.tables.marvin_sources = [
      {
        id: "saved",
        external_provider: "gmail_attachment",
        title: "RINEHART_MI_261006.pdf",
        author_email: "jessica@blue-skycreative.com",
        review_status: "pending",
        storage_path: "saved.pdf",
        content_hash: "saved-hash",
        metadata: { account_email: "marvinbotai@gmail.com", blue_sky_construction_candidate: true },
      },
    ];
    db.files.set("marvin-sources/saved.pdf", new Blob(["%PDF saved"]));
    expect(await syncConstructionDocuments()).toMatchObject({ uploaded: 1, needsReconnect: true });
    expect(db.tables.marvin_integrations[0].status).toBe("error");
    expect(db.tables.marvin_sources[0].review_status).toBe("linked");
  });

  it("does not guess between duplicate projects", async () => {
    db.tables.projects = [
      { id: "moore1", name: "Moore Project" },
      { id: "moore2", name: "Moore Project" },
    ];
    db.messages = [message("new", ["MOORE_MI_261006.pdf"])];
    expect(await syncConstructionDocuments()).toMatchObject({ uploaded: 0, needsReview: 1 });
    expect(db.tables.project_documents).toBeUndefined();
  });

  it("preserves a manual dismissal on retry", async () => {
    db.messages = [message("new")];
    db.tables.marvin_sources = [
      {
        id: "dismissed",
        external_provider: "gmail_attachment",
        external_id: "new:new-attachment-0",
        review_status: "dismissed",
        metadata: { account_email: "marvinbotai@gmail.com", blue_sky_construction_candidate: true },
      },
    ];
    expect((await syncConstructionDocuments()).uploaded).toBe(0);
    expect(db.tables.project_documents).toBeUndefined();
  });

  it("continues after a failed PDF and retries it without duplicating the successful PDF", async () => {
    db.messages = [message("new", ["RINEHART_MI_261006.pdf", "RINEHART_MI_261006_v2.pdf"])];
    db.failures.add("new-attachment-0");
    expect(await syncConstructionDocuments()).toMatchObject({
      uploaded: 1,
      failed: 1,
      deferredMessageIds: ["new"],
    });
    db.failures.clear();
    expect((await syncConstructionDocuments()).uploaded).toBe(1);
    expect(db.tables.project_documents).toHaveLength(2);
  });

  it("keeps the rest of the newest-first batch for the next pass", async () => {
    db.messages = [message("new1"), message("new2"), message("new3")];
    expect(await syncConstructionDocuments({ maxMessages: 1 })).toMatchObject({
      uploaded: 1,
      deferredMessageIds: ["new2", "new3"],
    });
  });

  it("stops at its time budget before starting network work", async () => {
    expect(await syncConstructionDocuments({ budgetMs: 0 })).toMatchObject({
      uploaded: 0,
      deferred: 1,
    });
    expect(db.calls).toEqual([]);
  });
});
