import { join } from "node:path";
import { z } from "zod";
import {
  applyAccuracyCommand,
  accuracyOutputs,
  accuracyProgress,
  createAccuracyState,
  reconcileAccuracyRooms,
  type AccuracyState,
  type AccuracyCommand,
} from "./designAccuracy";
import { accuracyMutationSchema } from "./designAccuracySchema";
import { ACCURACY_FIXTURE_ID } from "./designAccuracyFixtures";
import { AccuracyConflict, LocalAccuracyStore } from "./designAccuracyStore.server";

const localStore = new LocalAccuracyStore(join(process.cwd(), ".local", "accuracy"));
const response = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
export function localAccuracyAllowed(request: Request) {
  const url = new URL(request.url);
  return (
    process.env.ENABLE_LOCAL_DESIGN_ACCURACY === "1" &&
    process.env.NODE_ENV !== "production" &&
    ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) &&
    (!request.headers.get("origin") || request.headers.get("origin") === url.origin) &&
    !request.headers.has("x-forwarded-host")
  );
}
async function body(request: Request) {
  if (Number(request.headers.get("content-length") || 0) > 1_000_000)
    throw new Error("Request is too large. Save a smaller group of decisions.");
  const raw = await request.text();
  if (raw.length > 1_000_000)
    throw new Error("Request is too large. Save a smaller group of decisions.");
  return JSON.parse(raw);
}
function publicState(state: AccuracyState) {
  return {
    enabled: true,
    state,
    progress: accuracyProgress(state),
    outputs: accuracyOutputs(state),
  };
}

export async function designAccuracyApi(request: Request) {
  try {
    const url = new URL(request.url),
      projectId = url.searchParams.get("projectId") || "";
    if (projectId === ACCURACY_FIXTURE_ID) {
      if (!localAccuracyAllowed(request))
        return response({ error: "Local test fixtures are disabled." }, 404);
      if (request.method === "GET")
        return response({ ...publicState(await localStore.read()), fixture: true });
      const payload = accuracyMutationSchema.parse(await body(request));
      const state = await localStore.mutate(payload.expectedRevision, (current) =>
        payload.commands.reduce(
          (s, c) => applyAccuracyCommand(s, c, "Local test designer", new Date().toISOString()),
          current,
        ),
      );
      return response({ ...publicState(state), fixture: true });
    }
    if (!z.string().uuid().safeParse(projectId).success)
      return response({ error: "Choose a project." }, 400);
    const { requireRoomDesignPilotAccess } = await import("./roomDesignAuth.server");
    const access = await requireRoomDesignPilotAccess(request, { projectId });
    if (access.error) return access.error;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Server-only writes keep confirmed decisions behind authorization and revision checks.
    const admin = supabaseAdmin as unknown as import("@supabase/supabase-js").SupabaseClient;
    const { data: record, error } = await admin
      .from("design_accuracy_projects")
      .select("state,revision")
      .eq("project_id", projectId)
      .maybeSingle();
    if (error)
      return response(
        {
          error:
            "Design accuracy setup is unavailable. Ask a Studio administrator to finish project setup before enabling required product details.",
        },
        503,
      );
    const rooms = await readAccuracyRooms(admin, projectId);
    if (record) {
      record.state = reconcileAccuracyRooms(record.state as AccuracyState, rooms);
      const current = record.state as AccuracyState;
      const documentIds = [
        ...new Set(current.sources.flatMap((s) => (s.documentId ? [s.documentId] : []))),
      ];
      if (documentIds.length) {
        const { data: documents, error: documentError } = await admin
          .from("project_documents")
          .select("id,updated_at")
          .eq("project_id", projectId)
          .in("id", documentIds);
        if (documentError) throw documentError;
        current.documentRevisions = Object.fromEntries(
          (documents ?? []).map((d) => [d.id, d.updated_at]),
        );
      }
    }
    if (request.method === "GET")
      return response(record ? publicState(record.state as AccuracyState) : { enabled: false });
    const input = await body(request);
    let next: AccuracyState;
    let expected: number;
    if (input?.action === "enable") {
      if (record) throw new AccuracyConflict("This project is already opted in. Reload it.");
      next = createAccuracyState(projectId, rooms ?? [], access.user!.id, new Date().toISOString());
      expected = -1;
    } else {
      if (!record)
        return response({ error: "Opt this project in before recording decisions." }, 409);
      const current = record.state as AccuracyState;
      if (input?.action === "extraction") return extraction(request, admin, current, input);
      const payload = accuracyMutationSchema.parse(input);
      expected = payload.expectedRevision;
      if (expected !== record.revision)
        throw new AccuracyConflict("A newer version is saved. Reload before confirming.");
      // Automated evidence can only enter via a server extraction adapter. Manual checks stay labeled manual.
      if (payload.commands.some((c) => c.type === "check" && c.check.mode !== "manual"))
        return response({ error: "Automated checks require server evidence." }, 403);
      for (const command of payload.commands) {
        if ("roomId" in command && !rooms?.some((r) => r.id === command.roomId))
          return response({ error: "Room is outside your project." }, 403);
        if (command.type === "bind" && command.materialId) {
          const { data: material } = await admin
            .from("material_items")
            .select("id")
            .eq("id", command.materialId)
            .eq("project_id", projectId)
            .eq("room_id", command.roomId)
            .maybeSingle();
          if (!material)
            return response({ error: "Material is outside this project and room." }, 403);
        }
        const source =
          "source" in command
            ? command.source
            : command.type === "check"
              ? command.check.source
              : command.type === "companion"
                ? command.companion.source
                : undefined;
        if (source?.documentId) {
          const { data: document } = await admin
            .from("project_documents")
            .select("id,updated_at")
            .eq("project_id", projectId)
            .eq("id", source.documentId)
            .maybeSingle();
          if (!document || document.updated_at !== source.revision)
            throw new AccuracyConflict(
              "Drawing revision changed or is outside this project. Select its current revision.",
            );
          current.documentRevisions = {
            ...current.documentRevisions,
            [document.id]: document.updated_at,
          };
        }
      }
      next = payload.commands.reduce(
        (state, command) =>
          applyAccuracyCommand(state, command, access.user!.id, new Date().toISOString()),
        current,
      );
    }
    const { data: saved, error: saveError } = await admin.rpc("save_design_accuracy", {
      p_project_id: projectId,
      p_expected_revision: expected,
      p_state: next,
      p_projection: { rows: accuracyOutputs(next), progress: accuracyProgress(next) },
      p_actor: access.user!.id,
    });
    if (saveError) throw saveError;
    if (!saved)
      throw new AccuracyConflict(
        "Another designer saved a newer version. Reload before confirming.",
      );
    return response(publicState(next));
  } catch (error) {
    if (error instanceof AccuracyConflict) return response({ error: error.message }, 409);
    if (error instanceof z.ZodError)
      return response(
        {
          error: "Invalid decision request. Reload and try again.",
          fields: error.issues.map((i) => i.path.join(".")),
        },
        400,
      );
    return response(
      { error: error instanceof Error ? error.message : "Could not save design decisions." },
      400,
    );
  }
}

async function extraction(
  request: Request,
  admin: import("@supabase/supabase-js").SupabaseClient,
  state: AccuracyState,
  input: unknown,
) {
  const payload = z
    .object({
      action: z.literal("extraction"),
      sourceId: z.string(),
      start: z.boolean(),
      retry: z.boolean().optional(),
      cancel: z.boolean().optional(),
    })
    .strict()
    .parse(input);
  const source = state.sources.find((s) => s.id === payload.sourceId && s.documentId);
  if (!source) return response({ error: "Select a governing document and revision first." }, 400);
  const { data: document } = await admin
    .from("project_documents")
    .select("id,title,updated_at,file_url,file_size")
    .eq("project_id", state.projectId)
    .eq("id", source.documentId)
    .maybeSingle();
  if (!document || document.updated_at !== source.revision)
    throw new AccuracyConflict("Select the current document revision before extracting.");
  // Existing extraction is bounded to 100 rooms / 120 requirements. Expose that limit, never a completion claim.
  if (state.rooms.length > 100)
    return response({
      status: "incomplete",
      processedRooms: [],
      unprocessedRooms: state.rooms.map((r) => r.id),
      message:
        "This extraction service supports up to 100 rooms per document job. Use manually cited checks until chunked extraction is available.",
    });
  if (!process.env.OPENAI_API_KEY)
    return response({
      status: "unavailable",
      message:
        "Drawing extraction credentials are not configured locally. Manual cited checks remain available.",
      unprocessedRooms: state.rooms.map((r) => r.id),
    });
  const { loadCatalogDocumentFit, cancelCatalogDocumentFit } =
    await import("./materialCatalogFit.server");
  if (payload.cancel)
    return response(
      await cancelCatalogDocumentFit(
        state.projectId,
        document,
        state.rooms.map((r) => ({ id: r.id, name: r.name })),
      ),
    );
  const result = await loadCatalogDocumentFit(
    state.projectId,
    document,
    state.rooms.map((r) => ({ id: r.id, name: r.name })),
    payload.start,
    payload.retry,
  );
  return response({
    status: result?.status ?? "unavailable",
    source,
    candidates: result?.room_requirements ?? {},
    pages: result?.pages ?? null,
    message: `${result?.message || "No extracted evidence yet."} Candidate facts require an exact item association and review. Extraction alone does not establish full page coverage or fit.`,
    coverageConfirmed: false,
    requirementLimit: 120,
  });
}

export async function readAccuracyRooms(
  admin: import("@supabase/supabase-js").SupabaseClient,
  projectId: string,
) {
  const rooms: { id: string; name: string }[] = [];
  for (let offset = 0; offset < 25000; offset += 1000) {
    const { data, error } = await admin
      .from("rooms")
      .select("id,name")
      .eq("project_id", projectId)
      .order("id")
      .range(offset, offset + 999);
    if (error) throw error;
    rooms.push(...(data ?? []));
    if (!data || data.length < 1000) return rooms;
  }
  throw new Error(
    "Room scope exceeds 25,000 rows. Coverage is incomplete; split the project scope before approval.",
  );
}
