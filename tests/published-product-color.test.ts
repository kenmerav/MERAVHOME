import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { PublishedProductColorInput } from "@/components/PublishedProductColorInput";

it("offers the manufacturer's eight Flash Bars colors without choosing the initial Ivory photo", () => {
  const options = [
    "Blush",
    "Cobalt",
    "Cool Grey",
    "Graphite",
    "Ivory",
    "Lead",
    "Light Blue",
    "White",
  ].map((color) => `${color} / Glossy`);
  const html = renderToStaticMarkup(
    createElement(PublishedProductColorInput, {
      value: "",
      options,
      label: "Selected color / stain",
      onChange: () => {},
    }),
  );
  for (const color of options) expect(html).toContain(`value="${color}"`);
  expect(html).toContain('selected="">Choose a published color');
  expect(html).not.toContain('value="Ivory / Glossy" selected');
  expect(html).toContain("Another approved color / finish");
});
