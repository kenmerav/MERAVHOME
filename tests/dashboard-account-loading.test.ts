import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ pending: true, profile: null as any }));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({}),
  useQuery: ({ queryKey }: any) => {
    if (queryKey[0] === "currentUserProfile")
      return { data: state.profile, isPending: state.pending };
    if (queryKey[0] === "projects")
      return {
        data: [
          {
            id: "previous-account-project",
            name: "Other account private project",
            status: "Design",
          },
        ],
        isLoading: false,
      };
    return { data: [], isLoading: false };
  },
}));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: any) => ({ options }),
  Link: ({ children }: any) => React.createElement("a", null, children),
  useNavigate: () => () => {},
}));
vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children }: any) => React.createElement("main", null, children),
}));
vi.mock("@/components/ServiceInvoiceCreator", () => ({ ServiceInvoiceCreator: () => null }));
vi.mock("@/components/TimelineCreator", () => ({ TimelineCreator: () => null }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { Route } from "@/routes/index";

it("renders only a neutral loader when project data arrives before the account role", () => {
  state.pending = true;
  state.profile = null;
  const html = renderToStaticMarkup(React.createElement((Route as any).options.component));
  expect(html).toContain("Loading your projects");
  expect(html).not.toContain("Other account private project");
  expect(html).not.toContain("Active Projects");
  expect(html).not.toContain("New Project");
});
it("never falls back to the staff dashboard for an inactive login", () => {
  state.pending = false;
  state.profile = { is_active: false, role: "Client" };
  const html = renderToStaticMarkup(React.createElement((Route as any).options.component));
  expect(html).toContain("Loading your projects");
  expect(html).not.toContain("Other account private project");
  expect(html).not.toContain("Active Projects");
});
