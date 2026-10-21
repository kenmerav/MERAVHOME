import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  profile: { email: "ken@meravinteriors.com", role: "Admin", is_active: true } as any,
  pending: false,
  images: [] as any[],
  generationWorkspace: vi.fn(),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: any) => ({
    isPending: queryKey[0] === "currentUserProfile" && state.pending,
    data: (
      {
        currentUserProfile: state.profile,
        project: { id: "project", name: "Spec K", client_name: "MERAV" },
        rooms: [{ id: "kitchen", name: "Kitchen" }],
        projectRoomImages: state.images,
        designBoard: { board_state: {} },
        renderingStudioElevations: [],
      } as any
    )[queryKey[0]],
  }),
  useQueryClient: () => ({}),
}));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: any) => ({
    options,
    useParams: () => ({ id: "project" }),
    useSearch: () => ({}),
  }),
  Link: ({ children, to }: any) => React.createElement("a", { href: to }, children),
}));
vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children }: any) => React.createElement("main", null, children),
}));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/local-assets", () => ({ normalizeSupabaseImageUrl: (url: string) => url }));
vi.mock("@/lib/renderingJobs", () => ({ resolveStaleRenderingJobs: (images: any) => images }));
vi.mock("@/components/MeasuredRenderingWorkspace", () => ({
  MeasuredRenderingWorkspace: () => {
    state.generationWorkspace();
    return null;
  },
}));
vi.mock("@/components/CodexRenderingBatch", () => ({
  CodexRenderingBatch: () => {
    state.generationWorkspace();
    return null;
  },
}));
vi.mock("@/components/ImportRenderingPackageDialog", () => ({
  ImportRenderingPackageDialog: () =>
    React.createElement("button", null, "Import Rendering Package"),
}));
vi.mock("@/components/ImportRenderingPdfDialog", () => ({
  ImportRenderingPdfDialog: () => React.createElement("button", null, "Import Rendering PDF"),
}));

import { Route } from "../src/routes/projects.$id.renderings";
const render = () => renderToStaticMarkup(React.createElement((Route as any).options.component));
beforeEach(() => {
  state.profile = { email: "ken@meravinteriors.com", role: "Admin", is_active: true };
  state.pending = false;
  state.generationWorkspace.mockClear();
  state.images = [
    {
      id: "sketch",
      room_id: "kitchen",
      kind: "sketchup",
      url: "/sketch.png",
      caption: "Range wall",
    },
    {
      id: "linked",
      room_id: "kitchen",
      kind: "rendering",
      linked_sketchup_id: "sketch",
      url: "/linked.png",
      status: "complete",
      is_approved: true,
    },
    {
      id: "uploaded",
      room_id: "kitchen",
      kind: "rendering",
      url: "/uploaded.png",
      status: "complete",
      is_approved: true,
    },
    {
      id: "orphan",
      room_id: "kitchen",
      kind: "rendering",
      linked_sketchup_id: "deleted-sketch",
      url: "/orphan.png",
      status: "complete",
      is_approved: true,
    },
  ];
});

it("restores the Renderings route without a redirect", () => {
  expect((Route as any).options.beforeLoad).toBeUndefined();
  const html = render();
  expect(html).toContain(">Renderings</h1>");
  expect(html).toContain("Add SketchUp");
  expect(html).toContain("Add External Rendering");
  expect(html).toContain("Import Rendering PDF");
  expect(html).toContain("Project presentation");
  for (const image of ["sketch", "linked", "uploaded", "orphan"])
    expect(html).toContain(`src="/${image}.png"`);
  expect(html).toContain("Presentation page 2");
  expect(html).not.toMatch(
    /Generate All|Regenerate|Create Revision|Rendering fidelity|Codex batch/,
  );
  expect(state.generationWorkspace).not.toHaveBeenCalled();
});

it("keeps the upload library available to active team members while Studio stays private", () => {
  state.profile = { email: "katie@meravinteriors.com", role: "Employee", is_active: true };
  const html = render();
  expect(html).toContain("Add External Rendering");
  expect(html).not.toContain('href="/projects/$id/rendering-studio"');
  expect(state.generationWorkspace).not.toHaveBeenCalled();
});

it.each(["Client", "Contractor"])("does not mount upload tools for %s accounts", (role) => {
  state.profile = { email: "external@example.com", role, is_active: true };
  expect(render()).toContain("unavailable for this account");
  expect(render()).not.toContain("Add External Rendering");
});

it("waits for access and rejects inactive accounts", () => {
  state.pending = true;
  expect(render()).toContain("Loading");
  expect(render()).not.toContain("Add External Rendering");
  state.pending = false;
  state.profile.is_active = false;
  expect(render()).toContain("unavailable for this account");
});
