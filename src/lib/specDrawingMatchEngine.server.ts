import { PDFDocument } from "pdf-lib";
import { SPEC_REVIEW_MODEL, reviewCostCeiling, retrieveSpecReview } from "./specReviewAI.server";
import { responseJson } from "./specDrawingEvidence";
import {
  cleanDrawingMatchChunk,
  drawingMatchPageGroups,
  drawingMatchReport,
  DRAWING_MATCH_INSTRUCTIONS,
  nativeDrawingMatches,
  drawingMatchesWithRoomFallback,
  drawingRoomLabelPages,
  drawingChunkCandidates,
  drawingMatchRoomRefs,
  type DrawingMatchJob,
  type DrawingMatchChunkResult,
} from "./specDrawingMatches";

export type DrawingMatchStore = {
  read<T>(path: string): Promise<T | null>;
  write(path: string, value: unknown, exclusive?: boolean): Promise<boolean>;
  readBytes(path: string): Promise<Uint8Array>;
  writeBytes(path: string, value: Uint8Array): Promise<void>;
  sourceBytes(job: DrawingMatchJob): Promise<Uint8Array>;
  current(job: DrawingMatchJob): Promise<boolean>;
};
const path = (key: string, name: string) => `${key}/${name}`;
const statePath = (key: string, index: number) => path(key, `chunk-${index}-request.json`);
type ChunkState = { startedAt: string; responseId?: string; error?: string };

export function drawingMatchRequest(job: DrawingMatchJob, bytes: Uint8Array, index: number) {
  const refs = job.candidateRefs?.[index];
  const roomRefs = drawingMatchRoomRefs(job.items);
  const items = job.items
    .filter((item) => !refs || refs.includes(item.ref))
    .map((item) => [
      item.ref,
      roomRefs.get(item.roomId),
      item.label.slice(0, 160),
      item.name.slice(0, 200),
      item.sku.slice(0, 120),
      item.vendor.slice(0, 100),
      item.finish.slice(0, 160),
      item.dimensions.slice(0, 160),
      item.cad.slice(0, 100),
    ]);
  return {
    model: SPEC_REVIEW_MODEL,
    reasoning: { effort: "high" },
    instructions: DRAWING_MATCH_INSTRUCTIONS,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: JSON.stringify({
              items,
              catalogColumns: [
                "ref",
                "roomRef",
                "itemLabel",
                "productName",
                "sku",
                "vendor",
                "finish",
                "dimensions",
                "CAD tag",
              ],
              rooms: [...roomRefs.entries()].map(([id, ref]) => [
                ref,
                job.items.find((item) => item.roomId === id)!.room,
              ]),
              originalPhysicalPages: job.chunks![index],
              knownExactMatches: (job.nativeMatches || [])
                .filter(
                  (match) => job.chunks![index].includes(match.page) && match.kind === "product",
                )
                .map((match) => ({
                  item: job.items.find((item) => item.id === match.itemId)!.ref,
                  page: job.chunks![index].indexOf(match.page) + 1,
                  evidence: match.evidence.slice(0, 180),
                })),
              note: "Output local page numbers 1 through the number of pages in this chunk; the server maps them to the original document.",
            }),
          },
          {
            type: "input_file",
            filename: `construction-pages-${index + 1}.pdf`,
            file_data: `data:application/pdf;base64,${Buffer.from(bytes).toString("base64")}`,
            detail: job.pageDetail?.[index] || "high",
          },
        ],
      },
    ],
  };
}
const headers = () => {
  if (!process.env.OPENAI_API_KEY) throw Error("Studio’s OpenAI connection is unavailable.");
  return {
    Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    "Content-Type": "application/json",
  };
};
async function cost(request: unknown, fetcher: typeof fetch, outputLimit: number) {
  const response = await fetcher("https://api.openai.com/v1/responses/input_tokens", {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(45000),
  });
  const value = await response.json().catch(() => null);
  if (!response.ok)
    throw Error("Could not confirm the scan cost. No matching requests were started.");
  return reviewCostCeiling(value?.input_tokens, "dimensions", outputLimit).ceilingUsd;
}
export async function prepareDrawingMatchScan(
  store: DrawingMatchStore,
  key: string,
  fetcher: typeof fetch = fetch,
) {
  let job = await store.read<DrawingMatchJob>(path(key, "job.json"));
  if (!job) throw Error("Drawing scan not found.");
  if (job.status === "complete" && job.mode !== "ai") return 0;
  if (job.status === "ready") return job.chunks!.length;
  if (job.status === "failed") throw Error(job.error || "Drawing scan stopped.");
  if (!(await store.current(job)))
    throw Error(
      "The construction document or selections changed. Start a check using the current version.",
    );
  job = { ...job, status: "preparing" };
  await store.write(path(key, "job.json"), job);
  try {
    const bytes = await store.sourceBytes(job);
    if (!bytes.length || bytes.length > 50 * 1024 * 1024)
      throw Error("Use a construction PDF under 50 MB.");
    const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
    job = { ...job, pages: pdf.getPageCount(), chunks: drawingMatchPageGroups(pdf.getPageCount()) };
    if (job.items.length > 1500)
      throw Error("Split projects with more than 1,500 selections before matching drawings.");
    const { extractDrawingPageText } = await import("./specDrawingText.server");
    const textPages = await extractDrawingPageText(bytes, job.pages!);
    if (job.mode !== "ai") {
      const directMatches = nativeDrawingMatches(textPages, job.items);
      job = { ...job, nativeMatches: directMatches, textIndexed: true };
      await store.write(path(key, "job.json"), job);
      const pages = drawingRoomLabelPages(textPages, job.items, directMatches);
      const { readDrawingRoomLabels } = await import("./specDrawingRoomLabels.server");
      const roomReading = await readDrawingRoomLabels(
        bytes,
        pages,
        job.items,
        async (labels, pagesRead) => {
          job = {
            ...job!,
            roomLabels: labels,
            roomLabelPagesRead: pagesRead,
            nativeMatches: drawingMatchesWithRoomFallback(
              textPages,
              job!.items,
              nativeDrawingMatches(textPages, job!.items, labels),
              labels,
            ),
          };
          await store.write(path(key, "job.json"), job);
        },
      );
      await store.write(path(key, "job.json"), {
        ...job,
        mode: "direct",
        status: "complete",
        chunks: [],
        nativeMatches: drawingMatchesWithRoomFallback(
          textPages,
          job.items,
          nativeDrawingMatches(textPages, job.items, roomReading.labels),
          roomReading.labels,
        ),
        roomLabels: roomReading.labels,
        roomLabelPagesRead: roomReading.pagesRead,
        roomLabelWarning: roomReading.warning,
        textIndexed: true,
        ceilingUsd: 0,
      } satisfies DrawingMatchJob);
      return 0;
    }
    const candidates = job.chunks!.map((pages) =>
      drawingChunkCandidates(
        textPages.filter((page) => pages.includes(page.page)),
        job!.items,
      ),
    );
    job = {
      ...job,
      nativeMatches: nativeDrawingMatches(textPages, job.items),
      textIndexed: true,
      candidateRefs: candidates.map((items) => items.map((item) => item.ref)),
      outputLimits: candidates.map((items) => (items.length > 100 ? 24000 : 12000)),
      pageDetail: job.chunks!.map((pages) =>
        pages.every(
          (number) => (textPages.find((page) => page.page === number)?.text.length || 0) >= 100,
        )
          ? "low"
          : "high",
      ),
    };
    await store.write(path(key, "job.json"), job);
    let total = 0;
    for (let offset = 0; offset < job.chunks!.length; offset += 3) {
      const costs = await Promise.all(
        job.chunks!.slice(offset, offset + 3).map(async (pages, within) => {
          const index = offset + within,
            chunk = await PDFDocument.create();
          (
            await chunk.copyPages(
              pdf,
              pages.map((page) => page - 1),
            )
          ).forEach((page) => chunk.addPage(page));
          const part = await chunk.save();
          await store.writeBytes(path(key, `chunk-${index}.pdf`), part);
          return cost(drawingMatchRequest(job!, part, index), fetcher, job!.outputLimits![index]);
        }),
      );
      total = Math.round((total + costs.reduce((sum, value) => sum + value, 0)) * 100) / 100;
      if (total > Math.min(5, job.budgetLimitUsd || 5))
        throw Error(
          "This scan’s estimated total exceeds its remaining budget. No matching requests were started. Exact text matches are saved; use a smaller drawing set for visual review.",
        );
    }
    job = { ...job, status: "ready", ceilingUsd: total };
    await store.write(path(key, "job.json"), job);
    return job.chunks!.length;
  } catch (error) {
    await store.write(path(key, "job.json"), {
      ...job,
      status: "failed",
      error: error instanceof Error ? error.message : "Could not prepare the drawing scan.",
    });
    throw error;
  }
}

async function saveResult(
  store: DrawingMatchStore,
  job: DrawingMatchJob,
  index: number,
  value: any,
) {
  const result = cleanDrawingMatchChunk(responseJson(value), job.chunks![index], job.items);
  result.usage = value.usage;
  await store.write(path(job.key, `chunk-${index}-result.json`), result);
}
export async function startDrawingMatchChunk(
  store: DrawingMatchStore,
  key: string,
  index: number,
  fetcher: typeof fetch = fetch,
) {
  const job = await store.read<DrawingMatchJob>(path(key, "job.json"));
  if (job && job.mode !== "ai") throw Error("This drawing scan uses direct PDF matching only.");
  if (!job || job.status !== "ready" || !job.chunks?.[index])
    throw Error("Drawing scan is not prepared.");
  if (await store.read(path(key, `chunk-${index}-result.json`))) return "complete";
  if (!(await store.current(job)))
    throw Error(
      "The construction document or selections changed. Saved matches are retained with their original source.",
    );
  const startedAt = new Date().toISOString();
  // Atomic, permanent claim before the only paid generation for this page group.
  if (!(await store.write(statePath(key, index), { startedAt }, true))) return "checking";
  try {
    const request = drawingMatchRequest(
      job,
      await store.readBytes(path(key, `chunk-${index}.pdf`)),
      index,
    );
    const response = await fetcher("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        ...request,
        service_tier: "default",
        background: true,
        store: false,
        max_output_tokens: job.outputLimits?.[index] || 12000,
      }),
      signal: AbortSignal.timeout(60000),
    });
    const value = await response.json().catch(() => null);
    if (!response.ok)
      throw Error(
        ["insufficient_quota", "credit_balance_exhausted"].includes(value?.error?.code)
          ? "Studio’s OpenAI credits are unavailable."
          : "The drawing match request failed. No automatic retry was made.",
      );
    if (value.status === "completed") {
      await saveResult(store, job, index, value);
      return "complete";
    }
    if (
      !["queued", "in_progress"].includes(value.status) ||
      !/^resp_[a-zA-Z0-9_-]{1,200}$/.test(value.id)
    )
      throw Error("The drawing match did not return a collectable result.");
    await store.write(statePath(key, index), { startedAt, responseId: value.id });
    return "checking";
  } catch (error) {
    await store.write(statePath(key, index), {
      startedAt,
      error: error instanceof Error ? error.message : "The drawing scan stopped.",
    });
    return "failed";
  }
}
export async function collectDrawingMatchChunk(
  store: DrawingMatchStore,
  key: string,
  index: number,
  retrieve = retrieveSpecReview,
) {
  if (await store.read(path(key, `chunk-${index}-result.json`))) return "complete";
  const [job, state] = await Promise.all([
    store.read<DrawingMatchJob>(path(key, "job.json")),
    store.read<ChunkState>(statePath(key, index)),
  ]);
  if (!job || !job.chunks?.[index] || !state) throw Error("Drawing scan not found.");
  if (state.error) return "failed";
  if (!state.responseId) {
    if (Date.now() - Date.parse(state.startedAt) < 180000) return "checking";
    await store.write(statePath(key, index), {
      ...state,
      error: "The request stopped before its response was saved. No automatic retry was made.",
    });
    return "failed";
  }
  const response = await retrieve(state.responseId),
    value = await response.json().catch(() => null);
  if (
    response.ok &&
    ["queued", "in_progress"].includes(value?.status) &&
    Date.now() - Date.parse(state.startedAt) < 30 * 60_000
  )
    return "checking";
  if (!response.ok && response.status !== 404)
    throw Error("Could not retrieve the existing match result. No new AI request was made.");
  try {
    if (!response.ok || value?.status !== "completed")
      throw Error(
        value?.incomplete_details?.reason === "max_output_tokens"
          ? "This page group reached its response-size limit. Exact text matches remain saved; no automatic retry was made."
          : "This page group did not finish or its temporary result expired. No automatic retry was made.",
      );
    await saveResult(store, job, index, value);
    return "complete";
  } catch (error) {
    await store.write(statePath(key, index), {
      ...state,
      error:
        error instanceof Error ? error.message : "The returned page group could not be verified.",
    });
    return "failed";
  }
}
export async function loadDrawingMatchReport(store: DrawingMatchStore, key: string) {
  const job = await store.read<DrawingMatchJob>(path(key, "job.json"));
  if (!job) return null;
  const groups = await Promise.all(
    (job.chunks || []).map(async (_, index) => ({
      result: await store.read<DrawingMatchChunkResult>(path(key, `chunk-${index}-result.json`)),
      state: await store.read<ChunkState>(statePath(key, index)),
    })),
  );
  return drawingMatchReport(
    job,
    groups.map((g) => g.result),
    groups.map((g) => g.state?.error || "").filter(Boolean),
  );
}
export async function failDrawingMatchJob(
  store: DrawingMatchStore,
  key: string,
  message = "The drawing scan stopped. Finished page groups are saved; no automatic retry or new AI charge was made.",
) {
  const job = await store.read<DrawingMatchJob>(path(key, "job.json"));
  if (job)
    await store.write(path(key, "job.json"), {
      ...job,
      status: "failed",
      error: job.error || message,
    });
}
