import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { cleanUuid } from "./ids";
import { assertFullSpecBudget, FullSpecBudgetError, type FullSpecBudget } from "./fullSpecBudget";
import { startFullSpecBudget, type FullSpecBudgetSnapshot, type FullSpecBudgetStore } from "./fullSpecBudgetStore";
import { randomUUID } from "node:crypto";

const admin = supabaseAdmin as any;
// The authenticated project/actor must be checked by the calling route. The
// $10 limit is fixed by the server and covers OpenAI only.
export async function startProductionFullSpecBudget(projectId: string, ownerId: string) {
  return startFullSpecBudget(productionFullSpecBudgetStore(projectId), randomUUID(), ownerId);
}

export async function assertProductionFullSpecBudget(projectId: string, ownerId: string, runId: string) {
  const budget = (await productionFullSpecBudgetStore(projectId).read()).budget;
  if (!budget) throw new FullSpecBudgetError("The check budget is not available. No provider calls were started.");
  assertFullSpecBudget(budget, ownerId, runId);
  return budget;
}

export function productionFullSpecBudgetStore(projectId: string): FullSpecBudgetStore {
  if (!cleanUuid(projectId)) throw new FullSpecBudgetError("Invalid project.");
  return {
    async read() {
      const { data, error } = await admin.from("spec_completion_reviews").select("report,updated_at").eq("project_id", projectId).maybeSingle();
      if (error) throw new FullSpecBudgetError("The check budget could not be read. No provider call was started.");
      const report = data?.report && typeof data.report === "object" ? data.report : {};
      return { report, updatedAt: data?.updated_at ?? null, budget: (report.full_spec_budget ?? null) as FullSpecBudget | null };
    },
    async compareAndSet(snapshot: FullSpecBudgetSnapshot, budget: FullSpecBudget) {
      const report = { ...snapshot.report, full_spec_budget: budget };
      const updated_at = new Date(Math.max(Date.now(), (Date.parse(snapshot.updatedAt || "") || 0) + 1)).toISOString();
      const result = snapshot.updatedAt === null
        ? await admin.from("spec_completion_reviews").upsert({ project_id: projectId, report, updated_at }, { onConflict: "project_id", ignoreDuplicates: true }).select("project_id").maybeSingle()
        : await admin.from("spec_completion_reviews").update({ report, updated_at }).eq("project_id", projectId).eq("updated_at", snapshot.updatedAt).select("project_id").maybeSingle();
      if (result.error) throw new FullSpecBudgetError("The check budget could not be saved. No provider call was started.");
      return !!result.data;
    },
  };
}
