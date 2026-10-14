import { authorizeCompletionProject } from "@/lib/specCompletion.server";
import { cleanUuid } from "@/lib/ids";
import { isCompletionIssueStatus } from "@/lib/savedSpecCompletion";
import { readSavedCompletionReview, setCompletionIssueStatus, attachCompletionSaveWorker, CompletionStorageUnavailable, CompletionReviewConflict } from "@/lib/savedSpecCompletion.server";
import { saveCompletionDetailForStaff, CompletionDetailInputError } from "@/lib/specCompletionEdit.server";
import { startCompletionSaveWorker } from "@/lib/specCompletionBackground.server";

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
export async function savedSpecCompletionRequest(request: Request) {
  const access = await authorizeCompletionProject(request, ["project_id", "action", "issue_key", "status", "expected_updated_at", "value", "price_unit",
    "expected_material_updated_at", "expected_product_id", "expected_product_updated_at"]);
  if (access instanceof Response) return access;
  const { projectId, userId, body } = access;
  if (body.action === "load" && Object.keys(body).some(key => !["project_id", "action"].includes(key)))
    return json({ error: "Invalid review request." }, 400);
  if (!["load", "status", "detail"].includes(body.action)) return json({ error: "Choose a review action." }, 400);
  const timestamp = (value: unknown) => typeof value === "string" && value.length < 100 && Number.isFinite(Date.parse(value));
  if (body.action === "detail" && (Object.keys(body).some(key => !["project_id", "action", "issue_key", "expected_updated_at", "value", "price_unit",
    "expected_material_updated_at", "expected_product_id", "expected_product_updated_at"].includes(key)) ||
    !/^[a-f0-9]{64}$/.test(body.issue_key ?? "") || !(body.expected_updated_at === null || timestamp(body.expected_updated_at)) ||
    !timestamp(body.expected_material_updated_at) || !(body.expected_product_id === null || cleanUuid(body.expected_product_id)) ||
    !(body.expected_product_updated_at === null || timestamp(body.expected_product_updated_at)) ||
    typeof body.value !== "string" || body.value.length > 200 ||
    (body.price_unit !== undefined && !["", "unit", "sq_ft"].includes(body.price_unit))))
    return json({ error: "Choose a valid detail and current selection." }, 400);
  if (body.action === "status" && (!/^[a-f0-9]{64}$/.test(body.issue_key ?? "") || !isCompletionIssueStatus(body.status) ||
    !(body.expected_updated_at === null || (typeof body.expected_updated_at === "string" &&
      body.expected_updated_at.length < 100 && Number.isFinite(Date.parse(body.expected_updated_at))))))
    return json({ error: "Choose a valid issue and status." }, 400);
  try {
    if (body.action === "detail") return json(await saveCompletionDetailForStaff(projectId, userId, body));
    if (body.action === "status") {
      if (!cleanUuid(userId)) throw new Error("Invalid staff session");
      await setCompletionIssueStatus(projectId, userId, body.issue_key, body.status, body.expected_updated_at);
    }
    const saved = await readSavedCompletionReview(projectId);
    const job = saved?.report.plan_job;
    // Resume an already-paid pending check from an older deployment. Staff
    // access was checked above; no PDF refresh, scraping or AI generation runs.
    if (body.action === "load" && saved?.report.plan_status === "checking" && job && !job.worker_run_id) {
      const runId = await startCompletionSaveWorker(projectId, job.request_id);
      await attachCompletionSaveWorker(projectId, job.request_id, runId);
      job.worker_run_id = runId;
    }
    return json(saved);
  } catch (error) {
    if (error instanceof CompletionStorageUnavailable) return json({ error: error.message }, 503);
    if (error instanceof CompletionReviewConflict) return json({ error: error.message }, 409);
    if (error instanceof CompletionDetailInputError) return json({ error: error.message }, 400);
    return json({ error: "Could not save or load the review. Your change has not been confirmed; reopen the saved review." }, 500);
  }
}
