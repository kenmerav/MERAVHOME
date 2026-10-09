import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  role: "Client",
  showLinks: true,
  materialUrl: "https://www.signaturehardware.com/pressure-balance-tub-and-shower-rough-in-valve/446520.html" as string | null,
  catalogUrl: null as string | null,
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({}),
  useQuery: ({ queryKey }: any) => {
    let data: any = [];
    if (queryKey[0] === "currentUserProfile")
      data = { role: state.role, email: "client@example.test", is_active: true };
    if (["project", "publicSpecProject"].includes(queryKey[0]))
      data = { id: "bella", name: "Bella Vista", client_can_view_spec_book: true,
        client_spec_show_links: state.showLinks };
    if (queryKey[0] === "rooms")
      data = [{ id: "bathroom-3", name: "Bathroom 3", room_type: "Bathroom" }];
    if (queryKey[0] === "materialItems")
      data = [{ id: "valve", room_id: "bathroom-3", project_id: "bella", category: "Plumbing",
        item_label: "Shower rough-in valve", product_url: state.materialUrl,
        product_id: "valve-product", product: { id: "valve-product", name: "SH4001",
          product_url: state.catalogUrl } }];
    return { data, isPending: false };
  },
}));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: any) => ({ options }),
  Link: ({ children, to, params }: any) =>
    React.createElement("a", { href: to.replace("$id", params?.id || "") }, children),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { SpecBookDocument } from "@/routes/specbooks.$id";

const book = (publicView = false) => renderToStaticMarkup(
  React.createElement(SpecBookDocument, { projectId: "bella", publicView }),
);
beforeEach(() => {
  state.role = "Client";
  state.showLinks = true;
  state.materialUrl = "https://www.signaturehardware.com/pressure-balance-tub-and-shower-rough-in-valve/446520.html";
  state.catalogUrl = null;
});
describe("Spec Book product links", () => {
  it.each([false, true])("shows a Bella Vista material-only link in book view (public=%s)", (publicView) => {
    expect(book(publicView)).toContain(`href="${state.materialUrl}"`);
  });
  it("uses the selected material's link instead of an older catalog link", () => {
    state.catalogUrl = "https://example.test/old-variant";
    const html = book();
    expect(html).toContain(`href="${state.materialUrl}"`);
    expect(html).not.toContain(state.catalogUrl);
  });
  it("keeps catalog links working when no material-specific link exists", () => {
    state.materialUrl = null;
    state.catalogUrl = "https://example.test/catalog-product";
    expect(book()).toContain(`href="${state.catalogUrl}"`);
  });
  it("respects the project's client link visibility setting", () => {
    state.showLinks = false;
    expect(book()).not.toContain(state.materialUrl!);
  });
  it("displays vendor instructions without making an invalid link", () => {
    state.materialUrl = "See Vendor";
    const html = book();
    expect(html).toContain("See Vendor");
    expect(html).not.toContain('href="See Vendor"');
  });
});
