import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ profile: null as any, pending: false, mount: vi.fn() }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: state.profile, isPending: state.pending }),
}));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: any) => ({
    options,
    useParams: () => ({ id: "project" }),
    useSearch: () => ({}),
  }),
  Link: ({ children }: any) => React.createElement("a", null, children),
}));
vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children }: any) => React.createElement("main", null, children),
}));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/components/ProjectRenderingStudio", () => ({
  ProjectRenderingStudio: () => {
    state.mount();
    return React.createElement("div", null, "Private rendering workspace");
  },
}));
import { Route } from "../src/routes/projects.$id.rendering-studio";
const render = () => renderToStaticMarkup(React.createElement((Route as any).options.component));
beforeEach(() => {
  state.profile = null;
  state.pending = false;
  state.mount.mockClear();
});

it("does not mount the workspace before account access is known", () => {
  state.pending = true;
  expect(render()).toContain("Loading");
  expect(state.mount).not.toHaveBeenCalled();
});
it.each(["Admin", "Employee", "Client", "Contractor"])(
  "blocks a direct page link for another %s account",
  (role) => {
    state.profile = { email: "katie@meravinteriors.com", role, is_active: true };
    const html = render();
    expect(html).toContain("temporarily unavailable");
    expect(html).not.toContain("Private rendering workspace");
    expect(state.mount).not.toHaveBeenCalled();
  },
);
it("blocks missing and inactive profiles", () => {
  expect(render()).toContain("temporarily unavailable");
  state.profile = { email: "ken@meravinteriors.com", role: "Admin", is_active: false };
  expect(render()).toContain("temporarily unavailable");
  expect(state.mount).not.toHaveBeenCalled();
});
it("mounts the workspace for Ken", () => {
  state.profile = { email: "ken@meravinteriors.com", role: "Admin", is_active: true };
  expect(render()).toContain("Private rendering workspace");
  expect(state.mount).toHaveBeenCalledOnce();
});
