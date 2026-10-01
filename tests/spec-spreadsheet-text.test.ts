import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SpecSpreadsheetTextValue, SpecSpreadsheetWrapContext } from "../src/components/SpecSpreadsheetTextValue";

const longName = "Panel-integrated refrigerator columns — final size and model still undecided";
const render = (value: string, wrap?: boolean, canEdit = false) => {
  const cell = createElement(SpecSpreadsheetTextValue, { value, canEdit });
  return renderToStaticMarkup(
    wrap === undefined ? cell : createElement(SpecSpreadsheetWrapContext.Provider, { value: wrap }, cell),
  );
};

describe("Spec Book spreadsheet full-text display", () => {
  it("defaults to wrapping the entire value without an ellipsis", () => {
    const html = render(longName);
    expect(html).toContain(longName);
    expect(html).toContain("whitespace-pre-wrap");
    expect(html).toContain("[overflow-wrap:anywhere]");
    expect(html).not.toContain("truncate");
  });

  it("keeps the full hover title and accessible value in compact view", () => {
    const html = render(longName, false, true);
    expect(html).toContain("truncate");
    expect(html).toContain(`title="${longName}"`);
    expect(html).toContain(`aria-label="Edit ${longName}"`);
    expect(html).toContain(longName);
  });

  it("makes read-only cells focusable without an editing control", () => {
    const html = render(longName, false);
    expect(html).toContain('tabindex="0"');
    expect(html).toContain(`title="${longName}"`);
    expect(html).not.toContain("<button");
    expect(html).not.toContain("Edit ");
  });

  it("prints complete text even when the on-screen view is compact", () => {
    const html = render(longName, false);
    expect(html).toContain("print:whitespace-pre-wrap");
    expect(html).toContain("print:overflow-visible");
    expect(html).not.toContain("spec-sheet-compact-print");
  });

  it("preserves note line breaks and safely escapes markup", () => {
    const html = render("Finish undecided\nConfirm size <before> ordering", true);
    expect(html).toContain("Finish undecided\nConfirm size &lt;before&gt; ordering");
    expect(html).not.toContain("<before>");
  });

  it("does not invent values or create a focusable blank preview", () => {
    const html = render("");
    expect(html).toContain("—");
    expect(html).not.toContain("tabindex");
    expect(html).not.toContain("title=");
  });

  it("gives long notes room to wrap without forcing a wide compact or printed column", () => {
    const cell = createElement(SpecSpreadsheetTextValue, { value: longName, wide: true });
    expect(renderToStaticMarkup(cell)).toContain("w-[480px]");
    const compact = renderToStaticMarkup(
      createElement(SpecSpreadsheetWrapContext.Provider, { value: false }, cell),
    );
    expect(compact).not.toContain("w-[480px]");
    expect(compact).toContain("print:w-auto");
  });
});
