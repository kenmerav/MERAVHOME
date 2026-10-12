import { supabase } from "@/integrations/supabase/client";

export async function setProjectMaterialRemoved(projectId: string, itemId: string, removed: boolean) {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) throw new Error("Sign in to update this project item.");
  const response = await fetch("/api/spec-book-material", {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${data.session.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ project_id: projectId, item_id: itemId, removed }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Could not update this project item.");
}
