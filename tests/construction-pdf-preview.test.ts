import { afterEach, describe, expect, it, vi } from "vitest";
import { previewConstructionPage } from "../src/lib/constructionPdfPreview";

afterEach(() => vi.unstubAllGlobals());
function fixture(pending = false) {
  const canvas = { width: 0, height: 0, getContext: () => ({}) };
  vi.stubGlobal("document", { createElement: () => canvas });
  let reject: (reason?: unknown) => void = () => {};
  const cancel = vi.fn(() => reject(new DOMException("Cancelled", "AbortError")));
  const render = vi.fn(() => ({
    promise: pending
      ? new Promise<void>((_resolve, rejectPromise) => {
          reject = rejectPromise;
        })
      : Promise.resolve(),
    cancel,
  }));
  const getPage = vi.fn(async () => ({
    getViewport: ({ scale }: { scale: number }) => ({ width: 1200 * scale, height: 800 * scale }),
    render,
  }));
  return { canvas, cancel, render, getPage, pdf: { getPage } as any };
}
describe("Selected construction PDF page rendering", () => {
  it("renders only the requested late page at the original preview resolution", async () => {
    const f = fixture();
    expect(await previewConstructionPage(f.pdf, 29)).toBe(f.canvas);
    expect(f.getPage).toHaveBeenCalledExactlyOnceWith(29);
    expect(f.render).toHaveBeenCalledTimes(1);
    expect(f.canvas.width).toBe(3200);
    expect(f.canvas.height).toBeGreaterThan(2100);
  });
  it("cancels a superseded page render so rapid browsing cannot keep rendering old pages", async () => {
    const f = fixture(true),
      controller = new AbortController();
    const result = previewConstructionPage(f.pdf, 16, controller.signal);
    await Promise.resolve();
    controller.abort();
    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    expect(f.cancel).toHaveBeenCalledTimes(1);
  });
  it("does not start a render when the page selection was already replaced", async () => {
    const f = fixture(),
      controller = new AbortController();
    controller.abort();
    await expect(previewConstructionPage(f.pdf, 16, controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(f.render).not.toHaveBeenCalled();
  });
});
