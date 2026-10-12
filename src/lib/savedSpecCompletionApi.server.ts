import { authorizeCompletionProject } from "@/lib/specCompletion.server";
import { cleanUuid } from "@/lib/ids";
import { isCompletionIssueStatus } from "@/lib/savedSpecCompletion";
import { readSavedCompletionReview, setCompletionIssueStatus, CompletionStorageUnavailable, CompletionReviewConflict } from "@/lib/savedSpecCompletion.server";

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
export async function savedSpecCompletionRequest(request: Request) {
  const access = await authorizeCompletionProject(request, ["project_id", "action", "issue_key", "status", "expected_updated_at"]);
  if (access instanceof Response) return access;
  const { projectId, userId, body } = access;
  if (body.action === "load" && Object.keys(body).some(key => !["project_id", "action"].includes(key)))
    return json({ error: "Invalid review request." }, 400);
  if (body.action !== "load" && body.action !== "status") return json({ error: "Choose a review action." }, 400);
  if (body.action === "status" && (!/^[a-f0-9]{64}$/.test(body.issue_key ?? "") || !isCompletionIssueStatus(body.status) ||
    !(body.expected_updated_at === null || (typeof body.expected_updated_at === "string" &&
      body.expected_updated_at.length < 100 && Number.isFinite(Date.parse(body.expected_updated_at))))))
    return json({ error: "Choose a valid issue and status." }, 400);
  try {
    if (body.action === "status") {
      if (!cleanUuid(userId)) throw new Error("Invalid staff session");
      await setCompletionIssueStatus(projectId, userId, body.issue_key, body.status, body.expected_updated_at);
    }
    return json(await readSavedCompletionReview(projectId));
  } catch (error) {
    if (error instanceof CompletionStorageUnavailable) return json({ error: error.message }, 503);
    if (error instanceof CompletionReviewConflict) return json({ error: error.message }, 409);
    return json({ error: "Could not save or load the review. Your change has not been confirmed; reopen the saved review." }, 500);
  }
}
