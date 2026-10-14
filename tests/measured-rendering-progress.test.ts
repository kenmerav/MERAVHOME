import { afterEach, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { elapsedJobTime, MeasuredRenderingProgress } from "@/components/MeasuredRenderingProgress";
const now = Date.parse("2026-10-14T20:47:00Z");
const job = {
  id: "saved-job",
  kind: "interpret",
  status: "processing",
  createdAt: "2026-10-14T20:39:00Z",
};
const props = {
  job,
  busy: "interpret",
  startedAt: "2026-10-14T20:46:59Z",
  lastCheckedAt: "2026-10-14T20:46:58Z",
  checking: false,
  statusError: "",
  previousView: false,
  onCheck: vi.fn(),
};
afterEach(() => vi.restoreAllMocks());
it("resumes the saved start time rather than resetting elapsed time after reopening", () => {
  vi.spyOn(Date, "now").mockReturnValue(now);
  const html = renderToStaticMarkup(createElement(MeasuredRenderingProgress, props));
  expect(html).toContain("Elapsed 8m 00s");
  expect(html).toContain("Check status");
  expect(html).toContain("Last checked just now");
  expect(html).toContain("exact finish time or percentage");
  expect(html).toContain("continues in the background");
  expect(html).not.toContain("disabled=");
});
it("shows loss of connection independently of the saved job, with a usable status check", () => {
  vi.spyOn(Date, "now").mockReturnValue(now);
  const html = renderToStaticMarkup(
    createElement(MeasuredRenderingProgress, {
      ...props,
      statusError: "Could not update saved status",
    }),
  );
  expect(html).toContain("Could not update saved status");
  expect(html).toContain("Check status");
  expect(html).toContain("Reading dimensions");
  expect(html).not.toContain("disabled=");
});
it("labels an older preview while a new drawing is processing", () => {
  const html = renderToStaticMarkup(
    createElement(MeasuredRenderingProgress, { ...props, previousView: true }),
  );
  expect(html).toContain("previous saved view");
});
it("lets staff use a saved camera while the new drawing continues in the background", () => {
  const html = renderToStaticMarkup(createElement(MeasuredRenderingProgress, { ...props, previousView: true, onUseSavedCamera: vi.fn() }));
  expect(html).toContain("Use previous saved camera"); expect(html).toContain("continues in the background");
});
it("offers the next step only when the drawing has completed", () => {
  const ready = {
    ...props,
    busy: "",
    job: { ...job, status: "complete" },
    onNext: vi.fn(),
    nextLabel: "Build & save camera view",
  };
  const html = renderToStaticMarkup(createElement(MeasuredRenderingProgress, ready));
  expect(html).toContain("Drawing ready for review");
  expect(html).toContain("Build &amp; save camera view");
  expect(
    renderToStaticMarkup(
      createElement(MeasuredRenderingProgress, { ...ready, busy: "interpret", job }),
    ),
  ).not.toContain("Build &amp; save camera view");
});
it("explains an unconfirmed start without presenting it as a working reader", () => {
  const html = renderToStaticMarkup(
    createElement(MeasuredRenderingProgress, {
      ...props,
      busy: "",
      job: { ...job, status: "unknown" },
    }),
  );
  expect(html).toContain("start could not be confirmed");
  expect(html).toContain("Check status");
  expect(html).not.toContain("Saved status: In progress");
});
it("handles absent timestamps and clock skew without negative or invalid time", () => {
  expect(elapsedJobTime(undefined, now)).toBe("Starting…");
  expect(elapsedJobTime("2026-10-14T20:48:00Z", now)).toBe("0m 00s");
});
