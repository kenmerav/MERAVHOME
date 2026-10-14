import { supabase } from "@/integrations/supabase/client";
import type { BathroomPlanEvidence } from "@/lib/materialSuggestions";

export type MaterialPlanCheck = {
  status: "checking" | "checked" | "no_document" | "unavailable";
  document: { id: string; title: string } | null;
  rooms: BathroomPlanEvidence[];
  message?: string;
};

export async function fetchMaterialPlanCheck(projectId: string, documentId: string) {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) throw new Error("Sign in to review project plans.");
  const response = await fetch("/api/check-material-plans", {
    method: "POST", headers: { Authorization: `Bearer ${data.session.access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ project_id: projectId, document_id: documentId }),
  });
  const result = await response.json();
  if (!response.ok) {
    const error = new Error(result.error || "Could not check construction documents.") as Error & { status: number };
    error.status = response.status;
    throw error;
  }
  return result as MaterialPlanCheck;
}
