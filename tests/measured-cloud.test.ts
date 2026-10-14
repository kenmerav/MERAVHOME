import { beforeEach, describe, expect, it, vi } from "vitest";
const fake = vi.hoisted(() => ({
  files: new Map<string, Uint8Array>(),
  images: new Map<string, any>(),
  saveError: false,
  profile: {
    id: "11111111-1111-4111-8111-111111111111",
    role: "Admin",
    is_active: true,
    is_owner: true,
    can_view_all_projects: true,
  },
  start: vi.fn(async () => ({ runId: "test-run" })),
  generate: vi.fn(),
  interpret: vi.fn(),
  retrieve: vi.fn(),
}));
const project = "22222222-2222-4222-8222-222222222222",
  room = "33333333-3333-4333-8333-333333333333",
  selection = "44444444-4444-4444-8444-444444444444",
  product = "55555555-5555-4555-8555-555555555555";
const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
vi.mock("../src/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    auth: {
      getUser: vi.fn(async (token: string) =>
        token === "test-token"
          ? { data: { user: { id: fake.profile.id } }, error: null }
          : { data: { user: null }, error: new Error("invalid") },
      ),
    },
    from: (table: string) => {
      const filters: Array<[string, unknown]> = [];
      const builder: any = {
        select: () => builder,
        eq: (key: string, value: unknown) => {
          filters.push([key, value]);
          return builder;
        },
        in: () => builder,
        order: () => builder,
      };
      const rows = () =>
        table === "user_profiles"
          ? [fake.profile]
          : table === "projects"
            ? [{ id: "22222222-2222-4222-8222-222222222222", name: "Project" }]
            : table === "rooms"
              ? [
                  {
                    id: "33333333-3333-4333-8333-333333333333",
                    name: "Primary Bathroom",
                    project_id: "22222222-2222-4222-8222-222222222222",
                  },
                ]
              : table === "project_documents"
                ? [
                    {
                      id: "88888888-8888-4888-8888-888888888888",
                      project_id: "22222222-2222-4222-8222-222222222222",
                      document_type: "Construction Doc",
                      title: "Project drawings",
                      updated_at: "2026-10-14T12:00:00Z",
                      file_size: 1000,
                      file_url:
                        "https://storage.test/storage/v1/object/public/project-files/22222222-2222-4222-8222-222222222222/construction-docs/source.pdf",
                    },
                  ]
                : table === "material_items"
                  ? [
                      {
                        id: "44444444-4444-4444-8444-444444444444",
                        room_id: "33333333-3333-4333-8333-333333333333",
                        project_id: "22222222-2222-4222-8222-222222222222",
                        item_label: "Mirror",
                        category: "Mirrors",
                        cad_label: null,
                        quantity: "3",
                        color: "Polished Nickel",
                        notes: null,
                        product_id: "55555555-5555-4555-8555-555555555555",
                        not_needed: false,
                        image_url: "https://example.com/mirror.png",
                        product_url: "https://example.com/mirror",
                        product: {
                          name: "Selected mirror",
                          dimensions: '20" W x 30" H x 1.5" D',
                          finish: "Polished Nickel",
                          image_url: "https://example.com/mirror.png",
                          product_url: "https://example.com/mirror",
                        },
                      },
                    ]
                  : table === "room_images"
                    ? [...fake.images.values()]
                    : [];
      const result = () => ({
        data: rows().filter((r: any) => filters.every(([k, v]) => r[k] === v)),
        error: null,
      });
      builder.maybeSingle = async () => ({ ...result(), data: result().data[0] || null });
      builder.single = builder.maybeSingle;
      builder.upsert = async (row: any) => {
        if (fake.saveError) return { error: new Error("Save interrupted") };
        if (!fake.images.has(row.id)) fake.images.set(row.id, row);
        return { data: null, error: null };
      };
      builder.then = (resolve: any) => Promise.resolve(result()).then(resolve);
      return builder;
    },
    storage: {
      from: () => ({
        download: async (path: string) =>
          fake.files.has(path)
            ? { data: new Blob([fake.files.get(path)!]), error: null }
            : { data: null, error: { message: "Object not found" } },
        upload: async (path: string, bytes: any, options: any) => {
          if (fake.files.has(path) && !options?.upsert)
            return { error: { message: "already exists" } };
          fake.files.set(path, new Uint8Array(bytes));
          return { error: null };
        },
        createSignedUrl: async (path: string) => ({
          data: { signedUrl: "https://storage.test/" + path },
          error: null,
        }),
        getPublicUrl: (path: string) => ({
          data: { publicUrl: "https://storage.test/public/" + path },
        }),
        createSignedUploadUrl: async (path: string) => ({
          data: { path, token: "signed-test-token" },
          error: null,
        }),
        list: async (prefix: string) => ({
          data: Array.from(fake.files.keys())
            .filter((path) => path.startsWith(prefix + "/"))
            .map((path) => ({ name: path.slice(prefix.length + 1) })),
          error: null,
        }),
      }),
    },
  },
}));
vi.mock("workflow/api", () => ({ start: fake.start }));
vi.mock("../src/lib/measuredImage.server", () => ({
  safeImageBuffer: async () => ({
    buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]),
    contentType: "image/png",
  }),
}));
vi.mock("../src/lib/measuredPhotoreal.server", () => ({
  generateMeasuredPhotoreal: fake.generate,
}));
vi.mock("../src/lib/measuredInterpret.server", () => ({
  interpretMeasuredElevation: fake.interpret,
  parseMeasuredInterpretation: (body: any) => ({
    elevation: body.elevation,
    usage: body.usage,
    model: body.model,
  }),
}));
vi.mock("../src/lib/specReviewAI.server", () => ({
  retrieveSpecReview: fake.retrieve,
  fetchSpecReview: vi.fn(),
}));
import { measuredApi } from "../src/lib/measuredRendering.server";
import {
  scopedAsset,
  scopePath,
  saveCloudScene,
  scenePath,
  jobPath,
  writeStored,
  readStored,
  processCloudJob,
  collectCloudInterpretation,
  type CloudJob,
} from "../src/lib/measuredCloud.server";
import { specSelectionSchema, type MeasuredElevation } from "../src/lib/measuredRendering";
import { runMeasuredRenderingStep } from "../src/workflows/measuredRendering";
const item = specSelectionSchema.parse({
  id: selection,
  label: "Mirror",
  name: "Selected mirror",
  category: "Mirrors",
  productId: product,
  dimensions: '20" W x 30" H x 1.5" D',
  imageUrl: "https://example.com/mirror.png",
  productUrl: "https://example.com/mirror",
  finish: "Polished Nickel",
  sku: null,
  vendor: null,
  quantity: "3",
  notes: null,
  cadLabel: null,
});
const elevation: MeasuredElevation = {
  name: "Elevation 1",
  source: "ID2.8",
  width: 100,
  height: 100,
  depth: null,
  elements: [
    {
      id: "mirror",
      name: "Vanity mirror",
      kind: "mirror",
      x: 31,
      y: 48,
      z: 1,
      width: 24,
      height: 36,
      depth: 1,
      specId: selection,
      dimensionEvidence: "Written size",
      inferredAxes: ["depth"],
      color: "#aabbcc",
      front: "solid",
    },
  ],
  questions: [],
};
const source = `${scopePath(project, room)}/assets/66666666-6666-4666-8666-666666666666.png`,
  base = `${scopePath(project, room)}/assets/77777777-7777-4777-8777-777777777777.png`;
const request = (body?: unknown, auth = true) =>
  new Request(`https://studio.test/api/measured-rendering?projectId=${project}&roomId=${room}`, {
    method: body ? "POST" : "GET",
    headers: auth ? { Authorization: "Bearer test-token", "Content-Type": "application/json" } : {},
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
beforeEach(() => {
  vi.stubEnv("SUPABASE_URL", "https://storage.test");
  fake.files.clear();
  fake.images.clear();
  fake.saveError = false;
  fake.files.set(source, png);
  fake.files.set(base, png);
  fake.profile.role = "Admin";
  fake.profile.is_active = true;
  fake.profile.can_view_all_projects = true;
  fake.start.mockClear();
  fake.generate.mockReset().mockResolvedValue({
    bytes: Buffer.from(png),
    prompt: "locked prompt",
    model: "gpt-image-2.5-sunburst",
    usage: {},
  });
  fake.interpret.mockReset().mockResolvedValue({ elevation, model: "gpt-6-astra", usage: {} });
  fake.retrieve.mockReset();
});
async function scene() {
  return saveCloudScene(project, room, fake.profile.id, [item], {
    elevation,
    sourcePath: source,
    basePath: base,
    models: [],
    camera: { type: "elevation", position: [50, 50, 500], target: [50, 46, 0] },
  });
}
const originalPhoto = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const revisedPhoto = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
async function finishedPhoto() {
  const saved = await scene();
  await writeStored(jobPath(project, room, originalPhoto), {
    version: 1,
    id: originalPhoto,
    projectId: project,
    roomId: room,
    createdBy: fake.profile.id,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    kind: "photoreal",
    status: "complete",
    sceneId: saved.id,
    imagePath: `${scopePath(project, room)}/assets/${originalPhoto}.png`,
  });
  fake.files.set(`${scopePath(project, room)}/assets/${originalPhoto}.png`, png);
  return saved;
}
describe("Save finished images and make requested adjustments", () => {
  it("saves original bytes as a draft without a paid call and reopens its saved gallery status", async () => {
    await finishedPhoto();
    const response = await measuredApi(
      request({
        action: "save-rendering",
        jobId: originalPhoto,
        caption: "Vanity view",
        approve: false,
      }),
    );
    expect(response.status).toBe(200);
    expect(fake.images.get(originalPhoto)).toMatchObject({
      id: originalPhoto,
      room_id: room,
      caption: "Vanity view",
      status: "complete",
      is_approved: false,
      review_status: "draft",
    });
    expect(fake.files.get(`${room}/rendering/measured-${originalPhoto}.png`)).toEqual(png);
    const reopened = await (await measuredApi(request())).json();
    expect(reopened.jobs.find((j: any) => j.id === originalPhoto).savedRendering.caption).toBe(
      "Vanity view",
    );
    expect(fake.start).not.toHaveBeenCalled();
    expect(fake.generate).not.toHaveBeenCalled();
    expect(fake.interpret).not.toHaveBeenCalled();
  });
  it("requires explicit approval for presentations and cannot overwrite approval or rename on retry", async () => {
    await finishedPhoto();
    const body = {
      action: "save-rendering",
      jobId: originalPhoto,
      caption: "Approved vanity",
      approve: true,
    };
    await Promise.all([measuredApi(request(body)), measuredApi(request(body))]);
    expect(fake.images.size).toBe(1);
    expect(fake.images.get(originalPhoto)).toMatchObject({
      is_approved: true,
      review_status: "approved",
      presentation_visible: true,
    });
    const edited = {
      ...fake.images.get(originalPhoto),
      caption: "Manual edit",
      is_approved: false,
      review_status: "draft",
    };
    fake.images.set(originalPhoto, edited);
    const retry = await (await measuredApi(request(body))).json();
    expect(retry.alreadySaved).toBe(true);
    expect(fake.images.get(originalPhoto)).toEqual(edited);
  });
  it("recovers if uploading succeeded but the gallery save failed", async () => {
    await finishedPhoto();
    fake.saveError = true;
    const body = {
      action: "save-rendering",
      jobId: originalPhoto,
      caption: "Vanity",
      approve: false,
    };
    expect((await measuredApi(request(body))).status).toBe(500);
    fake.saveError = false;
    expect((await measuredApi(request(body))).status).toBe(200);
    expect(fake.images.size).toBe(1);
    expect(fake.generate).not.toHaveBeenCalled();
  });
  it("rejects unauthorized saves and revision requests", async () => {
    const save = {
      action: "save-rendering",
      jobId: originalPhoto,
      caption: "Vanity",
      approve: true,
    };
    expect((await measuredApi(request(save, false))).status).toBe(401);
    fake.profile.role = "Client";
    expect((await measuredApi(request(save))).status).toBe(403);
    expect(
      (
        await measuredApi(
          request({
            action: "photoreal",
            operationId: revisedPhoto,
            parentJobId: originalPhoto,
            revisionNotes: "Warm the wood",
          }),
        )
      ).status,
    ).toBe(403);
    expect(fake.images.size).toBe(0);
    expect(fake.start).not.toHaveBeenCalled();
  });
  it("rejects missing, unfinished, or cross-room images before copying or revising", async () => {
    await finishedPhoto();
    const path = jobPath(project, room, originalPhoto);
    const job = (await readStored<CloudJob>(path))!;
    const save = {
      action: "save-rendering",
      jobId: originalPhoto,
      caption: "Vanity",
      approve: false,
    };
    await writeStored(path, { ...job, status: "failed" }, true);
    expect((await measuredApi(request(save))).status).toBe(409);
    await writeStored(path, { ...job, roomId: selection }, true);
    expect((await measuredApi(request(save))).status).toBe(404);
    await writeStored(path, { ...job, imagePath: job.imagePath!.replace(room, selection) }, true);
    expect((await measuredApi(request(save))).status).toBe(403);
    expect(fake.images.size).toBe(0);
    expect(fake.start).not.toHaveBeenCalled();
  });
  it("pins revisions to the selected image's camera and saves requested notes and original bytes", async () => {
    const saved = await finishedPhoto();
    const body = {
      action: "photoreal",
      operationId: revisedPhoto,
      parentJobId: originalPhoto,
      sceneId: selection,
      revisionNotes: "Make the wood warmer; keep everything else.",
    };
    expect((await measuredApi(request(body))).status).toBe(202);
    expect((await measuredApi(request(body))).status).toBe(200);
    expect(fake.start).toHaveBeenCalledTimes(1);
    expect(await readStored(jobPath(project, room, revisedPhoto))).toMatchObject({
      parentJobId: originalPhoto,
      revisionNotes: body.revisionNotes,
      revisionNumber: 2,
      sceneId: saved.id,
    });
    expect(await processCloudJob(project, room, revisedPhoto)).toBe("complete");
    expect(fake.generate).toHaveBeenCalledTimes(1);
    const call = fake.generate.mock.calls[0];
    expect(call[2][0]).toMatchObject({
      bytes: Buffer.from(png),
      role: expect.stringContaining("Previous finished image"),
    });
    expect(call[2][1].role).toContain("Measured 3D");
    expect(call[2][2].role).toContain("Construction");
    expect(call[4]).toBe(body.revisionNotes);
    expect(fake.interpret).not.toHaveBeenCalled();
    expect(await readStored(jobPath(project, room, originalPhoto))).toMatchObject({
      status: "complete",
    });
    await measuredApi(
      request({
        action: "save-rendering",
        jobId: originalPhoto,
        caption: "Original",
        approve: true,
      }),
    );
    await measuredApi(
      request({
        action: "save-rendering",
        jobId: revisedPhoto,
        caption: "Warmer wood",
        approve: false,
      }),
    );
    expect(fake.images.get(revisedPhoto)).toMatchObject({
      revision_parent_id: originalPhoto,
      revision_number: 2,
      revision_notes: body.revisionNotes,
      is_approved: false,
    });
    expect(fake.images.get(originalPhoto).is_approved).toBe(true);
  });
  it("validates adjustment length and requires a completed previous image", async () => {
    await finishedPhoto();
    const body = { action: "photoreal", operationId: revisedPhoto, parentJobId: originalPhoto };
    for (const revisionNotes of ["", " ", "x".repeat(4001)])
      expect((await measuredApi(request({ ...body, revisionNotes }))).status).toBe(400);
    expect(
      (
        await measuredApi(
          request({ ...body, parentJobId: selection, revisionNotes: "Warm the wood" }),
        )
      ).status,
    ).toBe(404);
    expect(fake.start).not.toHaveBeenCalled();
  });
  it("blocks a revision when the selected image's saved Spec Book is stale", async () => {
    const saved = await finishedPhoto();
    await writeStored(
      scenePath(project, room, saved.id),
      { ...saved, signature: "old-spec" },
      true,
    );
    expect(
      (
        await measuredApi(
          request({
            action: "photoreal",
            operationId: revisedPhoto,
            parentJobId: originalPhoto,
            revisionNotes: "Warmer wood",
          }),
        )
      ).status,
    ).toBe(409);
    expect(fake.start).not.toHaveBeenCalled();
  });
});
describe("Shared measured rendering boundary and persistence", () => {
  it("returns the saved start time and status without launching another drawing read", async () => {
    const body = {
      action: "interpret",
      operationId: "99999999-9999-4999-8999-999999999999",
      sourcePath: source,
    };
    const created = await (await measuredApi(request(body))).json();
    const repeated = await (await measuredApi(request(body))).json();
    expect(repeated.createdAt).toBe(created.createdAt);
    expect(fake.start).toHaveBeenCalledTimes(1);
    const get = new Request(request().url + `&job=${created.jobId}`, {
      headers: { Authorization: "Bearer test-token" },
    });
    const status = await (await measuredApi(get)).json();
    expect(status).toMatchObject({
      status: "queued",
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
    });
    expect(fake.start).toHaveBeenCalledTimes(1);
    expect(fake.interpret).not.toHaveBeenCalled();
    expect(fake.generate).not.toHaveBeenCalled();
  });
  it("saves an incomplete result privately and reports failure without another generation", async () => {
    const response = await measuredApi(
      request({
        action: "interpret",
        operationId: "99999999-9999-4999-8999-999999999999",
        sourcePath: source,
      }),
    );
    const { jobId } = await response.json();
    fake.interpret.mockResolvedValueOnce({
      responseId: "resp_saved",
      elevation: undefined,
      model: "gpt-6.1-sol",
    });
    await processCloudJob(project, room, jobId);
    fake.retrieve.mockResolvedValueOnce(
      Response.json({
        status: "incomplete",
        incomplete_details: { reason: "max_output_tokens" },
        output: [],
        model: "gpt-6.1-sol",
      }),
    );
    expect(await collectCloudInterpretation(project, room, jobId)).toBe("failed");
    expect((await readStored<CloudJob>(jobPath(project, room, jobId)))?.error).toContain(
      "response limit",
    );
    expect(
      await readStored(`${scopePath(project, room)}/jobs/${jobId}-response.json`),
    ).toMatchObject({ status: "incomplete" });
    expect(fake.interpret).toHaveBeenCalledTimes(1);
  });
  it("collects a slow drawing response without sending another paid interpretation", async () => {
    const response = await measuredApi(
      request({
        action: "interpret",
        operationId: "99999999-9999-4999-8999-999999999999",
        sourcePath: source,
      }),
    );
    const { jobId } = await response.json();
    fake.interpret.mockResolvedValueOnce({
      responseId: "resp_saved",
      elevation: undefined,
      model: "gpt-6-astra",
    });
    expect(await processCloudJob(project, room, jobId)).toBe("processing");
    fake.retrieve.mockResolvedValueOnce(Response.json({ status: "in_progress" }));
    expect(await collectCloudInterpretation(project, room, jobId)).toBe("processing");
    fake.retrieve.mockResolvedValueOnce(
      Response.json({ status: "completed", elevation, usage: {}, model: "gpt-6-astra" }),
    );
    expect(await collectCloudInterpretation(project, room, jobId)).toBe("complete");
    expect(fake.interpret).toHaveBeenCalledTimes(1);
    const job = await readStored<CloudJob>(jobPath(project, room, jobId));
    expect(job?.resultSceneId).toBe(jobId);
    expect(await readStored(scenePath(project, room, jobId))).toMatchObject({ sourcePath: source });
  });
  it("shares one document view scan across repeated requests", async () => {
    const body = { action: "index-drawings", documentId: "88888888-8888-4888-8888-888888888888" };
    expect((await measuredApi(request(body))).status).toBe(202);
    expect((await measuredApi(request(body))).status).toBe(200);
    expect(fake.start).toHaveBeenCalledTimes(1);
    expect(fake.generate).not.toHaveBeenCalled();
  });
  it("rejects construction documents outside this project before dispatch", async () => {
    expect(
      (
        await measuredApi(
          request({ action: "index-drawings", documentId: "99999999-9999-4999-8999-999999999999" }),
        )
      ).status,
    ).toBe(404);
    expect(fake.start).not.toHaveBeenCalled();
  });
  it("requires sign-in before any storage read", async () => {
    const result = await measuredApi(request(undefined, false));
    expect(result.status).toBe(401);
    expect(fake.start).not.toHaveBeenCalled();
  });
  it("denies client generation and inactive accounts", async () => {
    fake.profile.role = "Client";
    expect((await measuredApi(request())).status).toBe(403);
    fake.profile.role = "Admin";
    fake.profile.is_active = false;
    expect((await measuredApi(request())).status).toBe(403);
  });
  it("rejects cross-project files and path traversal", () => {
    expect(() =>
      scopedAsset(project, room, source.replace(project, "88888888-8888-4888-8888-888888888888")),
    ).toThrow("does not belong");
    expect(() =>
      scopedAsset(project, room, `${scopePath(project, room)}/assets/../scene.json`),
    ).toThrow("does not belong");
  });
  it("saves an immutable measured-camera version with spec precedence", async () => {
    const saved = await scene();
    expect(fake.files.has(scenePath(project, room, saved.id))).toBe(true);
    expect(saved.elevation.elements[0].width).toBe(24);
    expect(saved.signature).toBeTruthy();
    const { reconcileElevation } = await import("../src/lib/measuredRendering");
    expect(reconcileElevation(saved.elevation, saved.items).elements[0].width).toBe(20);
  });
  it("resumes the same operation without dispatching or charging twice", async () => {
    const operationId = "99999999-9999-4999-8999-999999999999";
    const body = { action: "interpret", operationId, sourcePath: source };
    expect((await measuredApi(request(body))).status).toBe(202);
    expect((await measuredApi(request(body))).status).toBe(200);
    expect(fake.start).toHaveBeenCalledTimes(1);
  });
  it("rejects stale spec dimensions before dispatching a photograph", async () => {
    const saved = await saveCloudScene(
      project,
      room,
      fake.profile.id,
      [{ ...item, dimensions: '24" W x 36" H x 1" D' }],
      {
        elevation,
        sourcePath: source,
        basePath: base,
        models: [],
        camera: { type: "elevation", position: [50, 50, 500], target: [50, 46, 0] },
      },
    );
    const response = await measuredApi(
      request({
        action: "photoreal",
        operationId: "99999999-9999-4999-8999-999999999999",
        sceneId: saved.id,
      }),
    );
    expect(response.status).toBe(409);
    expect(fake.start).not.toHaveBeenCalled();
  });
  it("pins the measured view, drawing and mapped photos into one paid generation and saves its image", async () => {
    const saved = await scene();
    const id = "99999999-9999-4999-8999-999999999999";
    const job: CloudJob = {
      version: 1,
      id,
      projectId: project,
      roomId: room,
      createdBy: fake.profile.id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      kind: "photoreal",
      status: "queued",
      sceneId: saved.id,
    };
    await writeStored(jobPath(project, room, id), job);
    expect(await processCloudJob(project, room, id)).toBe("complete");
    expect(await processCloudJob(project, room, id)).toBe("complete");
    expect(fake.generate).toHaveBeenCalledTimes(1);
    const inputs = fake.generate.mock.calls[0][2];
    expect(inputs[0].role).toContain("Measured 3D");
    expect(inputs[1].role).toContain("Construction");
    expect(inputs[2].role).toContain("Selected mirror");
    expect((await readStored<CloudJob>(jobPath(project, room, id)))?.imagePath).toContain(
      id + ".png",
    );
  });
  it("records exhausted credits as failed without retrying a paid step", async () => {
    const saved = await scene();
    const id = "99999999-9999-4999-8999-999999999999";
    await writeStored(jobPath(project, room, id), {
      version: 1,
      id,
      projectId: project,
      roomId: room,
      createdBy: fake.profile.id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      kind: "photoreal",
      status: "queued",
      sceneId: saved.id,
    });
    fake.generate.mockRejectedValue(new Error("No credits remaining"));
    expect(await processCloudJob(project, room, id)).toBe("failed");
    expect(await processCloudJob(project, room, id)).toBe("failed");
    expect(fake.generate).toHaveBeenCalledTimes(1);
    expect(runMeasuredRenderingStep.maxRetries).toBe(0);
    expect((await readStored<CloudJob>(jobPath(project, room, id)))?.error).toBe(
      "No credits remaining",
    );
  });
});
