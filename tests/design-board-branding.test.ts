import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DesignBoardBranding } from "../src/components/DesignBoardBranding";
import {
  designBoardBranding,
  designBoardDisplayElement,
  designBoardLogoRect,
  DESIGN_BOARD_LOGO,
} from "../src/lib/designBoardBranding";
import { createCanvas, loadImage } from "@napi-rs/canvas";

const heading = {
  type: "text",
  x: 995,
  y: 69,
  width: 422,
  height: 54,
  text: "bathroom 2",
  fontSize: 30,
};
const logo = {
  type: "image",
  x: 52,
  y: 22,
  width: 463,
  height: 104,
  src: "https://example.supabase.co/storage/v1/object/public/design-board-images/47495ef5-39a3-4cea-bf69-5f9cb9778ed5/1781623372042-2ba0fa5c-8de7-4a70-9636-30da22fd73d7-cutout.png",
};

describe("automatic design-board corner branding", () => {
  it("uses a genuinely transparent wordmark without opaque white pixels", async () => {
    const image = await loadImage(
      new URL(`../public${DESIGN_BOARD_LOGO}`, import.meta.url).pathname,
    );
    const canvas = createCanvas(image.width, image.height);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(image, 0, 0);
    const pixels = ctx.getImageData(0, 0, image.width, image.height).data;
    let transparentPixels = 0;
    let opaqueWhitePixels = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index + 3] === 0) transparentPixels++;
      if (
        pixels[index] > 245 &&
        pixels[index + 1] > 245 &&
        pixels[index + 2] > 245 &&
        pixels[index + 3] > 250
      )
        opaqueWhitePixels++;
    }
    expect(transparentPixels).toBeGreaterThan(image.width * image.height * 0.7);
    expect(opaqueWhitePixels).toBe(0);
  });

  it("insets and aligns existing header logos without rewriting saved layers", () => {
    const saved = {
      ...logo,
      rotation: 12,
      productId: null,
      materialItemId: null,
      backgroundRemovedUrl: "/old-logo-cutout.png",
      imageCropZoom: 1.7,
    };
    const before = JSON.stringify(saved);
    const page = { title: "Bathroom", elements: [saved, heading] };
    const display = designBoardDisplayElement(saved, page);
    expect(display.src).toBe(DESIGN_BOARD_LOGO);
    expect(display.backgroundRemovedUrl).toBeNull();
    expect(display.imageCropZoom).toBe(1);
    expect(display.x).toBe(48);
    expect(display.width).toBe(saved.width);
    expect(display.rotation).toBe(0);
    expect(display.y + display.height * (69 / 232)).toBeCloseTo(heading.y + heading.height / 2);
    expect(JSON.stringify(saved)).toBe(before);
    expect(designBoardBranding({ title: "Kitchen", elements: [saved] }).showLogo).toBe(false);
  });

  it("aligns automatic logos with an existing heading or the default room-name line", () => {
    for (const elements of [[], [heading], [{ ...heading, y: 24, height: 72 }]]) {
      const rect = designBoardLogoRect({ title: "Room", elements });
      const titleCenter = elements.length ? elements[0].y + elements[0].height / 2 : 60;
      expect(rect.x).toBe(48);
      expect(rect.y + rect.height * (69 / 232)).toBeCloseTo(titleCenter);
    }
  });

  it("leaves product images and text brand marks unchanged", () => {
    const product = { ...logo, src: "/product/faucet.png", label: "Faucet" };
    const text = { ...heading, text: "MERAV INTERIORS" };
    expect(designBoardDisplayElement(product)).toBe(product);
    expect(designBoardDisplayElement(text)).toBe(text);
  });

  it("recognizes Hacienda's existing logo whose padded frame extends above the page", () => {
    const page = {
      title: "Hallway",
      elements: [
        {
          ...logo,
          x: 2.85,
          y: -70.61,
          width: 393.35,
          height: 279.52,
          src: "/uploads/1787766792729-fca2e12e-1104-49d9-9593-0feb1992acd2-screen-shot.png",
        },
        { ...heading, x: 928, y: 54, text: "foyer + hallway" },
      ],
    };
    expect(designBoardBranding(page)).toMatchObject({ showLogo: false, showTitle: false });
    const html = renderToStaticMarkup(createElement(DesignBoardBranding, { page }));
    expect(html).not.toContain("<img");
    expect(html).not.toContain("data-board-room-name");
  });

  it("adds both corners on a new page using its assigned room", () => {
    expect(designBoardBranding({ title: "Board 2", elements: [] }, "Primary Bathroom")).toEqual({
      showLogo: true,
      showTitle: true,
      title: "Primary Bathroom",
    });
  });

  it("uses the page title for plans and pages without an assigned room", () => {
    expect(designBoardBranding({ title: "Proposed floor plan", elements: [] }).title).toBe(
      "Proposed floor plan",
    );
    expect(designBoardBranding({ title: "", elements: [] }).title).toBe("Design Board");
  });

  it("preserves the existing Carefree bathroom heading instead of duplicating it", () => {
    expect(
      designBoardBranding(
        { title: "Bedroom 2 Bathroom", elements: [heading] },
        "Bedroom 2 Bathroom",
      ),
    ).toMatchObject({ showLogo: true, showTitle: false });
  });

  it("recognizes unlabeled, visually audited legacy cutout and screenshot logos", () => {
    for (const file of [
      "1781623372042-2ba0fa5c-8de7-4a70-9636-30da22fd73d7-cutout.png",
      "1788377660755-7511bdcd-76f3-4d1a-b2c8-2374f7c7ab12-screenshot.png",
      "1787766792729-fca2e12e-1104-49d9-9593-0feb1992acd2-screenshot.png",
      "1786666605292-d9cff610-41d8-4879-92d4-b92fa21ce43c-screenshot.png",
      "1791209619785-3bc606f7-100e-41ff-9bab-dfb2008b52e4-cutout.png",
      "1787075517149-77e2c50b-eec4-43c2-9194-321a5b0484b1-screenshot.png",
      "1784221077309-dce3a655-b466-4e50-bcb2-984c7eb995ba-cutout.png",
      "1781615242302-2c8d2cef-ee37-4bca-b8ca-91913bbd5e48-screenshot.png",
      "1790356581615-ebcd0bcd-739c-42e3-bf04-b1b36a5858f7-merav-finalmainlogo.png",
    ]) {
      expect(
        designBoardBranding({ title: "Kitchen", elements: [{ ...logo, src: `/uploads/${file}` }] })
          .showLogo,
      ).toBe(false);
    }
  });

  it("preserves existing named and text logos independently of the room title", () => {
    for (const element of [
      logo,
      { ...logo, src: DESIGN_BOARD_LOGO },
      { ...heading, x: 32, text: "MERAV INTERIORS" },
    ]) {
      expect(designBoardBranding({ title: "Kitchen", elements: [element] })).toMatchObject({
        showLogo: false,
        showTitle: true,
      });
    }
  });

  it("still adds the corner logo when an old page has only a brand footer", () => {
    expect(
      designBoardBranding({
        title: "Kitchen",
        elements: [{ ...heading, x: 450, y: 850, text: "MERAV INTERIORS" }],
      }).showLogo,
    ).toBe(true);
  });

  it("ignores hidden branding and product images and notes elsewhere on the board", () => {
    expect(
      designBoardBranding({
        title: "Kitchen",
        elements: [
          { ...logo, visible: false },
          { ...heading, visible: false },
          { ...logo, src: "/products/faucet.png" },
          { ...heading, text: "Shiplap wall", y: 460 },
        ],
      }),
    ).toMatchObject({ showLogo: true, showTitle: true });
  });

  it("does not mistake a product caption for the room heading", () => {
    expect(
      designBoardBranding({
        title: "Kitchen",
        elements: [{ ...heading, width: 120, fontSize: 12, text: "Cabinet pull" }],
      }).showTitle,
    ).toBe(true);
  });

  it("does not mutate board layers or add material/product objects on repeat renders", () => {
    const page = { title: "Kitchen", elements: [logo, heading] };
    const before = JSON.stringify(page);
    for (let i = 0; i < 3; i++) designBoardBranding(page, "Kitchen");
    expect(JSON.stringify(page)).toBe(before);
    const html = renderToStaticMarkup(createElement(DesignBoardBranding, { page }));
    expect(html).not.toContain("<img");
    expect(html).not.toContain("data-board-room-name");
  });

  it("renders the supplied logo and the current room name as fixed, noninteractive corners", () => {
    const html = renderToStaticMarkup(
      createElement(DesignBoardBranding, {
        page: { title: "Board 2", elements: [] },
        roomName: "Guest Bathroom",
      }),
    );
    expect(html).toContain(DESIGN_BOARD_LOGO);
    expect(html).toContain("Guest Bathroom");
    expect(html).toContain("pointer-events-none");
    expect(html).toContain("left:48px;");
    expect(html).toContain("justify-end");
  });
});
