import { expect, it, vi } from "vitest";
import { immutableSpecImages } from "@/lib/immutableSpecImages.server";
import type { safeImageBuffer } from "@/lib/measuredImage.server";

it("freezes each source into immutable bytes while keeping a single aggregate count", async () => {
  const loader = vi.fn(async (url: string) => ({ buffer: Buffer.from(url), contentType: "image/png" })) as unknown as typeof safeImageBuffer;
  const frozen = await immutableSpecImages(["one", "two"], 2, loader);
  expect(frozen.bytes).toBe(8);
  expect(frozen.images).toEqual(["data:image/png;base64,b25l", "data:image/png;base64,dHdv"]);
  expect(loader).toHaveBeenCalledTimes(2);
});
it("rejects unsupported images, empty data, excessive aggregate size and too many options", async () => {
  const loader = (result: { buffer: Buffer; contentType: string }) => vi.fn(async () => result) as unknown as typeof safeImageBuffer;
  await expect(immutableSpecImages(["one"], 0, loader({ buffer: Buffer.alloc(0), contentType: "image/png" }))).rejects.toThrow(/verified/);
  await expect(immutableSpecImages(["one"], 0, loader({ buffer: Buffer.from("x"), contentType: "text/html" }))).rejects.toThrow(/verified/);
  await expect(immutableSpecImages(["one"], 12 * 1024 * 1024 - 1, loader({ buffer: Buffer.from("xx"), contentType: "image/jpeg" }))).rejects.toThrow(/12 MB/);
  await expect(immutableSpecImages(Array(12).fill("image"), 0, loader({ buffer: Buffer.from("x"), contentType: "image/png" }))).rejects.toThrow(/safely/);
});
