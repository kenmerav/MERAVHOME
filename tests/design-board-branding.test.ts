import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DesignBoardBranding } from "../src/components/DesignBoardBranding";
import {
  designBoardBranding,
  designBoardDisplayElement,
  designBoardContentElements,
  designBoardTitleLayout,
  designBoardLogoRect,
  BOARD_TITLE_RECT,
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

  it("replaces legacy headers for display without rewriting saved layers", () => {
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
    expect(designBoardContentElements(page)).toEqual([]);
    expect(JSON.stringify(saved)).toBe(before);
    expect(designBoardBranding(page).title).toBe(heading.text);
  });

  it("uses fixed equal margins and aligns the logo headline with the room-name line", () => {
    const rect = designBoardLogoRect();
    expect(rect.x).toBe(48);
    expect(rect.width).toBe(340);
    expect(1400 - BOARD_TITLE_RECT.x - BOARD_TITLE_RECT.width).toBe(rect.x);
    expect(rect.y + rect.height * (69 / 232)).toBeCloseTo(74);
    expect(designBoardTitleLayout("Kitchen").lines[0]).toMatchObject({ x: 1352, y: 74 });
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
    expect(designBoardContentElements(page)).toEqual([]);
    const html = renderToStaticMarkup(createElement(DesignBoardBranding, { page }));
    expect(html.match(/data-board-logo/g)).toHaveLength(1);
    expect(html.match(/data-board-room-name/g)).toHaveLength(1);
    expect(html).toContain("FOYER + HALLWAY");
  });

  it("adds both corners on a new page using its assigned room", () => {
    expect(designBoardBranding({ title: "Board 2", elements: [] }, "Primary Bathroom")).toEqual({
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
    ).toEqual({ title: "bathroom 2" });
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
      expect(designBoardContentElements({ elements: [{ ...logo, src: `/uploads/${file}` }] })).toEqual([]);
    }
  });

  it("preserves existing named and text logos independently of the room title", () => {
    for (const element of [
      logo,
      { ...logo, src: DESIGN_BOARD_LOGO },
      { ...heading, x: 32, text: "MERAV INTERIORS" },
    ]) {
      expect(designBoardContentElements({ elements: [element] })).toEqual([]);
    }
  });

  it("still adds the corner logo when an old page has only a brand footer", () => {
    const footer = { ...heading, x: 450, y: 850, text: "MERAV INTERIORS" };
    expect(designBoardContentElements({ elements: [footer] })).toEqual([footer]);
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
    ).toEqual({ title: "Kitchen" });
  });

  it("does not mistake a product caption for the room heading", () => {
    expect(
      designBoardBranding({
        title: "Kitchen",
        elements: [{ ...heading, width: 120, fontSize: 12, text: "Cabinet pull" }],
      }).title,
    ).toBe("Kitchen");
  });

  it("does not mutate board layers or add material/product objects on repeat renders", () => {
    const page = { title: "Kitchen", elements: [logo, heading] };
    const before = JSON.stringify(page);
    for (let i = 0; i < 3; i++) designBoardBranding(page, "Kitchen");
    expect(JSON.stringify(page)).toBe(before);
    const html = renderToStaticMarkup(createElement(DesignBoardBranding, { page }));
    expect(html.match(/data-board-logo/g)).toHaveLength(1);
    expect(html.match(/data-board-room-name/g)).toHaveLength(1);
  });

  it("renders the supplied logo and the current room name as fixed, noninteractive corners", () => {
    const html = renderToStaticMarkup(
      createElement(DesignBoardBranding, {
        page: { title: "Board 2", elements: [] },
        roomName: "Guest Bathroom",
      }),
    );
    expect(html).toContain(DESIGN_BOARD_LOGO);
    expect(html).toContain("GUEST BATHROOM");
    expect(html).toContain("pointer-events-none");
    expect(html).toContain('x="48"');
    expect(html).toContain('text-anchor="end"');
    expect(html).toContain('viewBox="0 0 1400 900"');
  });

  it("uses identical header geometry on old boards, new boards, and scaled previews", () => {
    const pages = [
      { title: "Kitchen", elements: [] },
      { title: "Kitchen", elements: [logo, { ...heading, text: "Kitchen" }] },
      { title: "Kitchen", elements: [{ ...logo, width: 600, y: -90 }, { ...heading, text: "Kitchen", y: 130 }] },
    ];
    const markup = pages.map(page => renderToStaticMarkup(createElement(DesignBoardBranding, { page })));
    expect(new Set(markup).size).toBe(1);
  });

  it("uses the room heading when an old template also has a project heading", () => {
    const page = { title: "Kitchen — Design Board 1", elements: [
      { ...heading, x: 300, y: 35, width: 800, text: "TEST DESIGN PROCESS" },
      { ...heading, x: 300, y: 76, width: 800, text: "KITCHEN" },
    ] };
    expect(designBoardBranding(page, "Kitchen").title).toBe("KITCHEN");
    expect(designBoardBranding(page).title).toBe("KITCHEN");
  });

  it("replaces narrow legacy corner headings, including Cambridge and Hacienda rooms", () => {
    for (const text of ["Kitchen", "Pantry", "Hallway 2", "Rec Room"]) {
      const page = { title: text, elements: [{ ...heading, x: 1130, y: 35, width: 181, text }] };
      expect(designBoardContentElements(page)).toEqual([]);
      expect(designBoardBranding(page).title).toBe(text);
    }
  });

  it("replaces slightly off-center legacy room headings", () => {
    const page = { title: "Guest Bedroom", elements: [{ ...heading, x: 540, y: 90, width: 316.28, text: "guest bedroom" }] };
    expect(designBoardContentElements(page)).toEqual([]);
    expect(designBoardBranding(page).title).toBe("guest bedroom");
  });

  it("keeps product content and notes while suppressing every duplicate legacy header", () => {
    const product = { ...logo, src: "/faucet.png", productId: "faucet" };
    const caption = { ...heading, width: 120, fontSize: 12, text: "Cabinet pull" };
    const note = { ...heading, y: 450, text: "Stone detail" };
    const page = { elements: [logo, heading, { ...logo, x: 8 }, { ...heading, y: 10 }, product, caption, note] };
    expect(designBoardContentElements(page)).toEqual([product, caption, note]);
  });

  it("preserves top-of-board annotations, option names, and finish notes", () => {
    const title = { ...heading, x: 805, y: 24, text: "dining room option two" };
    const option = { ...heading, x: 883, y: 68, width: 335, text: '"Rustica"' };
    const annotation = { ...heading, x: 1029, y: 137, width: 40, text: "B" };
    const note = { ...heading, x: 689, y: 85, width: 402, text: "stone on wall of window - from countertop to ceiling" };
    const page = { title: "Dining Room", elements: [note, annotation, option, title] };
    expect(designBoardBranding(page).title).toBe(title.text);
    expect(designBoardContentElements(page)).toEqual([note, annotation, option]);
  });

  it("chooses the same heading for content and branding using the assigned room", () => {
    const project = { ...heading, y: 20, text: "Project name" };
    const room = { ...heading, y: 75, text: "Kitchen" };
    const page = { title: "Board 2", elements: [project, room] };
    expect(designBoardBranding(page, "Kitchen").title).toBe("Kitchen");
    expect(designBoardContentElements(page, "Kitchen")).toEqual([project]);
  });

  it("fits long room names within the same right-aligned header in previews and PDF", () => {
    const title = "PRIMARY BATHROOM SHOWER FIXTURES AND FINISHES";
    const layout = designBoardTitleLayout(title, (text, size) => text.length * size * 0.65);
    expect(layout.lines.length).toBe(2);
    expect(layout.lines.every(line => line.x === 1352)).toBe(true);
    expect((layout.lines[0].y + layout.lines[1].y) / 2).toBe(74);
    expect(layout.lines.map(line => line.text).join(" ")).toBe(title);
  });
});
