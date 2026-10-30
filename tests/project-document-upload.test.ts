import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mocks.from } }));

import { db, type ProjectDocument } from "../src/lib/db";

const input: Omit<ProjectDocument, "id" | "created_at" | "updated_at"> = {
  project_id: "2b31849c-b94a-4b78-9bf0-e263bbfce6a0",
  title: "Construction Set",
  document_type: "Construction Doc",
  file_url: "https://storage.example/carefree.pdf",
  file_name: "carefree.pdf",
  file_size: 6624988,
  mime_type: "application/pdf",
  visible_to_contractors: true,
  visible_to_clients: true,
  created_by: null,
};

beforeEach(() => {
  vi.resetAllMocks();
});

function saveAndRead(saveError: unknown = null, readError: unknown = null, empty = false) {
  let inserted: Record<string, unknown>;
  // An insert with RETURNING fails under the deployed read policy. The
  // separate insert is deliberately a terminal request, with no select chain.
  const insert = vi.fn(async (value: Record<string, unknown>) => {
    inserted = value;
    return { data: null, error: saveError };
  });
  const single = vi.fn(async () => ({
    data: empty ? null : { ...inserted, created_at: "2026-10-30T17:00:00Z" },
    error: readError,
  }));
  const read = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), single };
  mocks.from.mockReturnValueOnce({ insert }).mockReturnValueOnce(read);
  return { insert, read };
}

describe("construction document upload persistence", () => {
  it("reads the saved document in a separate request using its generated ID and project", async () => {
    const { insert, read } = saveAndRead();
    const saved = await db.createProjectDocument(input);
    expect(saved.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(insert).toHaveBeenCalledWith({ ...input, id: saved.id });
    expect(read.eq).toHaveBeenCalledWith("id", saved.id);
    expect(read.eq).toHaveBeenCalledWith("project_id", input.project_id);
    expect(mocks.from).toHaveBeenCalledTimes(2);
  });

  it("rejects a failed database insert instead of resolving a false upload success", async () => {
    const { read } = saveAndRead({ message: "Permission denied" });
    await expect(db.createProjectDocument(input)).rejects.toThrow("Permission denied");
    expect(read.single).not.toHaveBeenCalled();
    expect(mocks.from).toHaveBeenCalledTimes(1);
  });

  it("explains that the file is saved if its follow-up read fails", async () => {
    saveAndRead(null, { message: "Connection lost" });
    await expect(db.createProjectDocument(input)).rejects.toThrow("Refresh Construction Docs before uploading again");
  });

  it("never resolves success without a saved record", async () => {
    saveAndRead(null, null, true);
    await expect(db.createProjectDocument(input)).rejects.toThrow("could not be loaded");
  });

});
