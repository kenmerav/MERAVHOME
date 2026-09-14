import { describe, expect, it } from "vitest";
import { supabaseImageTransformUrl } from "@/lib/local-assets";

describe("supabaseImageTransformUrl", () => {
  it("uses a print-sized public Storage transformation", () => {
    const source =
      "https://project.supabase.co/storage/v1/object/public/design-board-images/project/product.png";

    expect(
      supabaseImageTransformUrl(source, {
        width: 240,
        height: 240,
        quality: 65,
        resize: "contain",
      }),
    ).toBe(
      "https://project.supabase.co/storage/v1/render/image/public/design-board-images/project/product.png?width=240&height=240&resize=contain&quality=65",
    );
  });

  it("keeps non-Supabase image URLs unchanged", () => {
    const source = "https://example.com/product.jpg";

    expect(supabaseImageTransformUrl(source, { width: 240 })).toBe(source);
  });
});
