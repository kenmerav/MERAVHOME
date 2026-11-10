import { authorizeCompletionProject } from "./specCompletion.server";
import { canRunPaidSpecCheck } from "./specCheckAccess";
import { cleanUuid } from "./ids";
import { FullSpecBudgetError } from "./fullSpecBudget";
import { productionFullSpecBudgetStore, startProductionFullSpecBudget } from "./fullSpecBudget.server";
import { closeFullSpecBudget } from "./fullSpecBudgetStore";

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
// Only Ken with access to this project can create or inspect a spending run.
// The browser cannot set the cost limit or provider prices.
export async function fullSpecBudgetRequest(request: Request) {
  const access = await authorizeCompletionProject(request, ["project_id", "action", "run_id"]);
  if (access instanceof Response) return access;
  if (!canRunPaidSpecCheck(access.user, access.profile)) return json({ error: "Only Ken can run the full project check." }, 403);
  const { projectId, userId, body } = access;
  if (!["start", "status", "close"].includes(body.action) ||
    Object.keys(body).some(key => !["project_id", "action", ...(body.action === "close" ? ["run_id"] : [])].includes(key)))
    return json({ error: "Choose a valid check budget action." }, 400);
  try {
    const store = productionFullSpecBudgetStore(projectId);
    if (body.action === "close") {
      const runId = cleanUuid(body.run_id);
      if (!runId) return json({ error: "Choose a valid check." }, 400);
      await closeFullSpecBudget(store, userId, runId);
      return json({ active: false });
    }
    const budget = body.action === "start" ? await startProductionFullSpecBudget(projectId, userId) : (await store.read()).budget;
    if (!budget || budget.status !== "active" || budget.ownerId !== userId) return json({ active: false });
    return json({ active: true, runId: budget.runId, limitCents: budget.limitCents, reservedCents: budget.reservedCents,
      pendingCount: budget.claims.filter(claim => claim.status === "pending").length });
  } catch (error) {
    if (error instanceof FullSpecBudgetError) return json({ error: error.message }, 409);
    return json({ error: "Could not confirm the check budget. No new paid work was started." }, 503);
  }
}
