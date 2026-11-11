import { supabase } from "@/integrations/supabase/client";
import { db } from "@/lib/db";
import { planMaterialBoardLink } from "./materialBoardLink";

/** Mirror only the committed material link, using the board's version check. */
export async function syncMaterialLinkToBoard(materialId: string, previousLink: string, nextLink: string) {
  const { data: session } = await supabase.auth.getSession();
  const author = session.session?.user.id;
  if (!author) throw new Error("Sign in to update the linked design board.");
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: material, error: materialError } = await supabase.from("material_items")
      .select("id,project_id,room_id,product_url,source_board_id,source_board_page_id,source_board_element_id")
      .eq("id", materialId).maybeSingle();
    if (materialError) throw materialError;
    if (!material || (material.product_url?.trim() || "") !== nextLink.trim()) {
      throw new Error("The product link changed again before the board could be updated.");
    }
    const board = await db.getDesignBoard(material.project_id);
    if (!board) return { changed: 0, conflicts: 0 };
    const plan = planMaterialBoardLink(board.board_state, material.project_id, material, previousLink, nextLink);
    if (!plan.changed) return plan;
    const data = await db.updateDesignBoardIfFresh(material.project_id, plan.board, board.updated_at, author);
    if (data) return { changed: plan.changed, conflicts: plan.conflicts };
  }
  throw new Error("The board changed while updating the product link.");
}
