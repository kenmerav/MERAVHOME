import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ role: "Admin", active: true }));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({}),
  useQuery: () => ({ data: { role: state.role, is_active: state.active } }),
}));
vi.mock("@tanstack/react-router", () => ({ createFileRoute: () => (options: any) => ({ options }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: any) => open ? React.createElement("div", {}, children) : null,
  DialogContent: ({ children }: any) => React.createElement("div", {}, children),
  DialogHeader: ({ children }: any) => React.createElement("div", {}, children),
  DialogTitle: ({ children }: any) => React.createElement("h2", {}, children),
}));
import { SpecProductEditDialog } from "@/routes/specbooks.$id";

const html = () => renderToStaticMarkup(React.createElement(SpecProductEditDialog, {
  open: true, onOpenChange: () => {}, projectId: "project",
  item: { id: "item", item_label: "Shower rough-in valve", category: "Plumbing" } as any,
  product: { id: "product", name: "SH4001", category: "Plumbing", subcategory: "Faucets" } as any,
}));
it.each(["Admin", "Employee"])("shows removal alongside Save Product for %s", (role) => {
  state.role = role; state.active = true;
  const markup = html();
  expect(markup).toContain("Remove from Project");
  expect(markup).toContain("Save Product");
});
it.each(["Client", "Contractor", "GC", "Builder"])("keeps removal out of the %s editor", (role) => {
  state.role = role; state.active = true;
  expect(html()).not.toContain("Remove from Project");
});
it("does not show removal for an inactive account", () => {
  state.role = "Admin"; state.active = false;
  expect(html()).not.toContain("Remove from Project");
});
