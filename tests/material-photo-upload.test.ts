import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  upload: vi.fn(),
  update: vi.fn(),
  eq: vi.fn(),
  single: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    storage: {
      from: () => ({
        upload: state.upload,
        getPublicUrl: () => ({ data: { publicUrl: "https://storage.test/item.png" } }),
      }),
    },
    from: () => {
      const query: any = {
        update: state.update,
        eq: state.eq,
        select: () => query,
        single: state.single,
      };
      state.update.mockReturnValue(query);
      state.eq.mockReturnValue(query);
      return query;
    },
  },
}));
import { uploadMaterialPhoto } from "@/lib/materialPhotoUpload";

const projectId = "4333c3b8-995d-47ef-aa82-a72f9f3e3342";
const materialId = "d53ce9f9-051d-484a-92f4-d84d80dc2c8a";
const file = { type: "image/png", size: 100 } as File;
beforeEach(() => {
  vi.clearAllMocks();
  state.upload.mockResolvedValue({ error: null });
  state.single.mockResolvedValue({
    data: { id: materialId, image_url: "https://storage.test/item.png" },
    error: null,
  });
});

describe("Materials photo upload", () => {
  it("saves an item-specific photo without requiring or updating a catalog product", async () => {
    expect(await uploadMaterialPhoto(file, projectId, materialId)).toBe(
      "https://storage.test/item.png",
    );
    expect(state.upload.mock.calls[0][0]).toMatch(
      new RegExp(`^materials/${projectId}/${materialId}/.+\\.png$`),
    );
    expect(state.upload.mock.calls[0][2].upsert).toBe(false);
    expect(state.update).toHaveBeenCalledWith({ image_url: "https://storage.test/item.png" });
    expect(state.eq).toHaveBeenCalledWith("id", materialId);
    expect(state.eq).toHaveBeenCalledWith("project_id", projectId);
  });
  it.each([
    { type: "application/pdf", size: 100 },
    { type: "image/png", size: 11 * 1024 * 1024 },
  ])("rejects unsupported or oversized files before upload", async (invalid) => {
    await expect(uploadMaterialPhoto(invalid as File, projectId, materialId)).rejects.toThrow();
    expect(state.upload).not.toHaveBeenCalled();
    expect(state.update).not.toHaveBeenCalled();
  });
  it("does not change the material when storage rejects an upload", async () => {
    state.upload.mockResolvedValue({ error: new Error("Upload failed") });
    await expect(uploadMaterialPhoto(file, projectId, materialId)).rejects.toThrow("Upload failed");
    expect(state.update).not.toHaveBeenCalled();
  });
  it("reports a failed save instead of presenting an unsaved photo as successful", async () => {
    state.single.mockResolvedValue({ data: null, error: new Error("Save failed") });
    await expect(uploadMaterialPhoto(file, projectId, materialId)).rejects.toThrow("Save failed");
  });
});
