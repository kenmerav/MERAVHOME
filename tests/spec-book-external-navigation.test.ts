import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ role: "Client", pending: false }));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({}),
  useQuery: ({ queryKey }: any) => {
    if (queryKey[0] === "currentUserProfile")
      return {
        data: state.pending
          ? undefined
          : { role: state.role, email: "external@example.test", is_active: true },
        isPending: state.pending,
      };
    if (queryKey[0] === "project" || queryKey[0] === "publicSpecProject")
      return {
        data: {
          id: "assigned-1",
          name: "Assigned Project",
          client_can_view_spec_book: true,
          contractor_can_view_spec_book: true,
        },
      };
    return { data: [], isPending: false };
  },
}));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: any) => ({ options }),
  Link: ({ children, to, params }: any) =>
    React.createElement("a", { href: to.replace("$id", params?.id || "") }, children),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { SpecBookDocument } from "@/routes/specbooks.$id";

it.each(["Client", "Contractor", "GC", "Builder"])(
  "returns %s to the same project's home page",
  (role) => {
    state.role = role;
    state.pending = false;
    const html = renderToStaticMarkup(
      React.createElement(SpecBookDocument, { projectId: "assigned-1" }),
    );
    expect(html).toContain('href="/projects/assigned-1"');
    expect(html).toContain("Back to project");
    expect(html).not.toContain('href="/projects/assigned-1/materials"');
  },
);
it("keeps the staff Materials back link", () => {
  state.role = "Admin";
  state.pending = false;
  const html = renderToStaticMarkup(
    React.createElement(SpecBookDocument, { projectId: "assigned-1" }),
  );
  expect(html).toContain('href="/projects/assigned-1/materials"');
});
it("waits for the account before rendering a Spec Book", () => {
  state.pending = true;
  const html = renderToStaticMarkup(
    React.createElement(SpecBookDocument, { projectId: "assigned-1" }),
  );
  expect(html).toContain("Loading");
  expect(html).not.toContain("Assigned Project");
});
it("keeps anonymous public Spec Books working without waiting for a login", () => {
  state.pending = true;
  const html = renderToStaticMarkup(
    React.createElement(SpecBookDocument, { projectId: "assigned-1", publicView: true }),
  );
  expect(html).toContain("Assigned Project");
  expect(html).toContain("Public Spec Book");
});
