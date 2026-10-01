import { afterEach, describe, expect, it, vi } from "vitest";
import { createDesignBoardExportImageLoader } from "../src/lib/designBoardExportImages";

const src = "https://example.supabase.co/storage/v1/object/public/boards/living-room.png";
const dataUrl = "data:image/png;base64,AAAA";

function mockImages(fail: (url: string) => boolean = () => false) {
  const requested: { src: string; crossOrigin: string | null }[] = [];
  vi.stubGlobal(
    "Image",
    class {
      crossOrigin: string | null = null;
      naturalWidth = 100;
      naturalHeight = 100;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(value: string) {
        requested.push({ src: value, crossOrigin: this.crossOrigin });
        if (value) queueMicrotask(() => (fail(value) ? this.onerror?.() : this.onload?.()));
      }
    },
  );
  vi.stubGlobal("window", { location: { href: "https://studio.meravinteriors.com/" } });
  return requested;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("design board export images", () => {
  it("loads public originals with CORS before assigning src, without the server proxy", async () => {
    const requested = mockImages();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await createDesignBoardExportImageLoader()(src);
    expect(requested).toEqual([{ src, crossOrigin: "anonymous" }]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses the same original for legacy transformed URLs and duplicate elements", async () => {
    const requested = mockImages();
    const load = createDesignBoardExportImageLoader();
    const transformed = src.replace("/object/public/", "/render/image/public/") + "?width=400";
    const [first, second] = await Promise.all([load(transformed), load(src)]);
    expect(first).toBe(second);
    expect(requested).toEqual([{ src, crossOrigin: "anonymous" }]);
  });

  it("recovers when the first download fails or a retailer denies CORS", async () => {
    const requested = mockImages((url) => url === src);
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ image: dataUrl })));
    vi.stubGlobal("fetch", fetchMock);
    await createDesignBoardExportImageLoader()(src);
    expect(requested).toEqual([
      { src, crossOrigin: "anonymous" },
      { src: dataUrl, crossOrigin: null },
    ]);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ imageUrl: src });
  });

  it("rejects a missing image instead of allowing a placeholder and permits a later retry", async () => {
    mockImages((url) => url === src);
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ error: "Could not download image." }), { status: 500 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const load = createDesignBoardExportImageLoader();
    await expect(load(src)).rejects.toThrow("Could not download image.");
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ image: dataUrl })));
    await expect(load(src)).resolves.toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("times out a stalled direct image and tries the server download", async () => {
    vi.useFakeTimers();
    const requested = mockImages();
    vi.stubGlobal(
      "Image",
      class {
        onload = null;
        onerror = null;
        set src(value: string) {
          requested.push({ src: value, crossOrigin: null });
        }
      },
    );
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ error: "Image unavailable" }), { status: 500 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const result = expect(createDesignBoardExportImageLoader()(src)).rejects.toThrow(
      "Image unavailable",
    );
    await vi.advanceTimersByTimeAsync(15_000);
    await result;
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("loads local uploaded data images without a network request", async () => {
    const requested = mockImages();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await createDesignBoardExportImageLoader()(dataUrl);
    expect(requested).toEqual([{ src: dataUrl, crossOrigin: null }]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
