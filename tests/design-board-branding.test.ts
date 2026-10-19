import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DesignBoardBranding } from "../src/components/DesignBoardBranding";
import { designBoardBranding, DESIGN_BOARD_LOGO } from "../src/lib/designBoardBranding";

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
    expect(html).toContain("left:32px;top:20px");
    expect(html).toContain("justify-end");
  });
});
