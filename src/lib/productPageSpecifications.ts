import { cleanProductDetail } from "./productDetails";
import { shopifyFinishEvidence } from "./selectedFinish";

type Data = Record<string, unknown>;
const object = (value: unknown): Data =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Data) : {};
const text = (value: unknown): string =>
  cleanProductDetail(typeof value === "number" ? String(value) : value);
const first = (...values: unknown[]) => values.map(text).find(Boolean) || "";
const list = (value: unknown) => (Array.isArray(value) ? value : value == null ? [] : [value]);
const unique = (values: string[]) => [...new Set(values.filter(Boolean))];
const nominalSize = (value: string) => /^\d+(?:\.\d+)?\s*[x×]\s*\d/i.test(value);
const measurement = (value: string) =>
  /\d\s*(?:["″'′]|\b(?:in|inch(?:es)?|ft|feet|mm|cm|m)\b)/i.test(value);
const decode = (value: string) =>
  value
    .replace(/&quot;|&#34;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&times;|&#215;/g, "×");
const label = (value: unknown) => first(object(value).name, value);

function dimension(value: unknown) {
  const data = object(value);
  const units: Record<string, string> = { INH: "in", CMT: "cm", MMT: "mm", FOT: "ft", MTR: "m" };
  const unit = first(data.unitText, units[text(data.unitCode)]);
  const result = Object.keys(data).length ? `${first(data.value)} ${unit}`.trim() : text(value);
  return measurement(result) ? result : "";
}
function properties(product: Data) {
  return new Map(
    list(product.additionalProperty).map((value) => {
      const entry = object(value);
      return [text(entry.name).toLowerCase(), entry] as const;
    }),
  );
}
function dimensions(product: Data) {
  const props = properties(product);
  const overall = first(
    product.dimensions,
    product.dimension,
    props.get("overall dimensions")?.value,
    props.get("product dimensions")?.value,
  );
  if (measurement(overall)) return overall;
  return ["width", "depth", "height", "length", "diameter"]
    .flatMap((key) => {
      const value =
        product[key] ??
        props.get(`overall ${key}`) ??
        props.get(`product ${key}`) ??
        props.get(key);
      const size = dimension(value);
      return size ? [`${key[0].toUpperCase()}${key.slice(1)}: ${size}`] : [];
    })
    .join(" × ");
}

/** Read labeled product measurements; never promote shipping, cutout or mounting measurements. */
export function publishedProductDimensions(markdown: string, html: string) {
  const readable = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<\/t[dh]>\s*<t[dh][^>]*>/gi, ": ")
    .replace(/<\/(?:tr|li|p|div|h[1-6])>|<br\s*\/?\s*>/gi, "\n")
    .replace(/<[^>]*>/g, " ");
  const lines = decode(`${markdown}\n${readable}`)
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/^\s*[|#*\s]+|[|*\s]+$/g, "")
        .replace(/\s*\|\s*/g, ": ")
        .trim(),
    );
  const found: string[] = [];
  let excludedSection = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^(?:related|recommended|you may also|recently viewed)/i.test(line)) break;
    if (/^(?:shipping|packag(?:ing|e)|carton|box)\b/i.test(line)) excludedSection = true;
    if (
      /^(?:product specifications|product details|specifications|overall dimensions|product dimensions)\b/i.test(
        line,
      )
    )
      excludedSection = false;
    if (
      excludedSection ||
      /shipping|packag|carton|cutout|cut.out|mounting|center.to.center/i.test(line)
    )
      continue;
    const match = line.match(
      /^((?:(?:overall|product|assembled)\s+)?(?:dimensions|width|depth|height|length|diameter))\s*[:–-]\s*(.+)$/i,
    );
    if (match && measurement(match[2]) && match[2].length < 240)
      found.push(`${match[1]}: ${match[2]}`);
    // HTML definition lists and headings often put the value on the following line.
    else if (
      /^(?:(?:overall|product|assembled)\s+)?(?:dimensions|width|depth|height|length|diameter)$/i.test(
        line,
      ) &&
      measurement(lines[i + 1] || "")
    )
      found.push(`${line}: ${lines[++i]}`);
  }
  return unique(found).slice(0, 8).join("; ");
}

export type PageSpecifications = {
  name: string;
  manufacturer: string;
  sku: string;
  color: string;
  finish: string;
  dimensions: string;
  selected_size: string;
  size_options: string[];
  image_url: string;
  unresolvedVariant: boolean;
  color_options: string[];
  surface_finishes: string[];
  color_option_images: Record<string, string>;
};

function attribute(tag: string, name: string) {
  return decode(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i").exec(tag)?.[1] || "");
}
/** Published swatches and size controls, including WooCommerce's custom buttons. */
export function publishedProductOptions(html: string) {
  const productForm =
    /<form\b[^>]*(?:data-product_variations|variations_form)[^>]*>[\s\S]*?<\/form>/i.exec(html);
  if (productForm) html = productForm[0];
  const colors: string[] = [],
    sizes: string[] = [],
    finishes: string[] = [];
  const images: Record<string, string> = {};
  const add = (kind: string, value: string, body = "") => {
    if (!value || /select|choose|default title/i.test(value)) return;
    if (/colou?r|colorway/i.test(kind)) {
      colors.push(value);
      const image = attribute(/<img\b[^>]*>/i.exec(body)?.[0] || "", "src");
      if (/^https?:\/\//i.test(image)) images[value] = image;
    } else if (/size|dimension/i.test(kind)) sizes.push(value);
    else if (/finish|surface/i.test(kind)) finishes.push(value);
  };
  for (const match of html.matchAll(
    /<(?:span|button)\b([^>]*data-parent-id=[^>]*)>([\s\S]*?)<\/(?:span|button)>/gi,
  ))
    add(
      attribute(match[1], "data-parent-id"),
      first(attribute(match[1], "data-text"), attribute(match[1], "aria-label")),
      match[2],
    );
  for (const select of html.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi)) {
    const kind = attribute(select[1], "name");
    if (!/attribute|option|colou?r|finish|size/i.test(kind)) continue;
    for (const option of select[2].matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi))
      if (attribute(option[1], "value"))
        add(kind, decode(option[2].replace(/<[^>]*>/g, "")).trim());
  }
  return {
    color_options: unique(colors),
    size_options: unique(sizes),
    surface_finishes: unique(finishes),
    color_option_images: images,
  };
}

/** Parse published structured data as data only. Select a URL/SKU match, never the first variant. */
export function productPageSpecifications(html: string, sourceUrl: string): PageSpecifications {
  const empty: PageSpecifications = {
    name: "",
    manufacturer: "",
    sku: "",
    color: "",
    finish: "",
    dimensions: "",
    selected_size: "",
    size_options: [],
    image_url: "",
    unresolvedVariant: false,
    color_options: [],
    surface_finishes: [],
    color_option_images: {},
  };
  let url: URL;
  try {
    url = new URL(sourceUrl);
  } catch {
    return empty;
  }
  const selectors = [...url.searchParams.entries()]
    .filter(([key]) =>
      /^(?:variant|sku|uid|itemNo|pid|piid|product_?id|variant_?id|selected_?sku)$/i.test(key),
    )
    .map(([, value]) => value);
  const products: Data[] = [];
  const productObjects = new Set<string>();
  let visited = 0;
  const visit = (value: unknown, depth = 0) => {
    if (depth > 10 || ++visited > 3000) return;
    if (Array.isArray(value)) {
      value.forEach((v) => visit(v, depth + 1));
      return;
    }
    const entry = object(value);
    const types = list(entry["@type"]);
    if (
      types.some((type) => type === "Product" || type === "ProductGroup") ||
      (entry.title && Array.isArray(entry.variants))
    ) {
      const key = JSON.stringify(entry);
      if (!productObjects.has(key)) {
        productObjects.add(key);
        products.push(entry);
      }
    }
    for (const [key, child] of Object.entries(entry)) {
      if (
        /related|recommend|recent|upsell|cross.?sell|itemListElement/i.test(key) ||
        key === "variants" ||
        key === "hasVariant"
      )
        continue;
      if (typeof child === "object") visit(child, depth + 1);
    }
  };
  for (const script of html
    .slice(0, 5_000_000)
    .matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (!/\btype\s*=\s*["']application\/(?:ld\+)?json["']/i.test(script[1])) continue;
    try {
      visit(JSON.parse(script[2]));
    } catch {
      /* A malformed unrelated script cannot discard the other data. */
    }
  }
  const matches = (product: Data) =>
    selectors.some((id) => {
      if (
        [
          product.id,
          product.sku,
          product.mpn,
          product.productID,
          product.variant_id,
          product.variation_id,
          product["@id"],
        ].some((v) => text(v) === id)
      )
        return true;
      try {
        const productUrl = first(product.url, product["@id"]);
        if (!productUrl) return false;
        return [...new URL(productUrl, sourceUrl).searchParams.values()].includes(id);
      } catch {
        return false;
      }
    });
  const samePage = (value: unknown) => {
    try {
      if (!text(value)) return false;
      const parsed = new URL(text(value), url);
      return (
        parsed.hostname === url.hostname &&
        parsed.pathname.replace(/\/$/, "") === url.pathname.replace(/\/$/, "")
      );
    } catch {
      return false;
    }
  };
  const candidate =
    products.find(matches) ??
    products.find(
      (p) =>
        list(p.hasVariant).some((v) => matches(object(v))) ||
        list(p.variants).some((v) => matches(object(v))),
    ) ??
    (products.filter((p) => samePage(p.url)).length === 1
      ? products.find((p) => samePage(p.url))
      : products.length === 1
        ? products[0]
        : undefined);
  const controls = publishedProductOptions(html);
  if (!candidate) {
    const size = controls.size_options.length === 1 ? controls.size_options[0] : "";
    return {
      ...empty,
      ...controls,
      selected_size: size,
      dimensions: measurement(size) || nominalSize(size) ? size : "",
      finish: controls.surface_finishes.length === 1 ? controls.surface_finishes[0] : "",
      color: controls.color_options.length === 1 ? controls.color_options[0] : "",
    };
  }
  const variants = list(candidate.variants ?? candidate.hasVariant).map(object);
  const selected =
    variants.find(matches) ??
    (variants.length === 1 && !selectors.length ? variants[0] : undefined);
  if (selectors.length && variants.length && !selected && !matches(candidate))
    return { ...empty, unresolvedVariant: true };
  const current = selected ? { ...candidate, ...selected } : candidate;
  const options = list(candidate.options).map((option) => ({
    name: first(object(option).name, option),
  }));
  const variantOptions = (variant: Data) =>
    list(variant.options).length
      ? list(variant.options).map(text)
      : [variant.option1, variant.option2, variant.option3].map(text);
  const sizeIndex = options.findIndex((option) =>
    /size|dimensions|width|length|diameter/i.test(option.name),
  );
  const colorIndex = options.findIndex((option) => /colou?r|colorway/i.test(option.name));
  const finishIndex = options.findIndex((option) => /finish|surface/i.test(option.name));
  const variantColors = unique(
    variants.map(
      (variant) => variantOptions(variant)[colorIndex >= 0 ? colorIndex : finishIndex] || "",
    ),
  );
  const sizes = unique([
    ...controls.size_options,
    ...variants.map((variant) =>
      first(sizeIndex >= 0 ? variantOptions(variant)[sizeIndex] : "", variant.size),
    ),
  ]);
  const selectedSize = first(
    selected && sizeIndex >= 0 ? variantOptions(selected)[sizeIndex] : "",
    selected?.size,
    sizes.length === 1 ? sizes[0] : "",
    !variants.length ? current.size : "",
  );
  const finish = shopifyFinishEvidence(
    {
      options,
      variants: variants.map((v) => ({ id: first(v.id, v.sku), options: variantOptions(v) })),
    },
    selected ? first(selected.id, selected.sku) : (selectors[0] ?? null),
  );
  const props = properties(current);
  const differingVariantDimensions =
    unique(variants.map((variant) => dimensions(variant))).length > 1;
  const sizeResolved =
    (sizes.length <= 1 || Boolean(selectedSize)) &&
    (Boolean(selected) || !differingVariantDimensions);
  const image = list(current.image ?? current.featured_image ?? candidate.images)[0];
  return {
    ...controls,
    color_options: controls.color_options.length ? controls.color_options : variantColors,
    name: first(current.name, candidate.title),
    manufacturer: first(label(current.brand), label(current.manufacturer), candidate.vendor),
    sku: first(selected?.sku, !variants.length ? current.sku : ""),
    color: first(
      selected?.color,
      finish.status === "verified" ? finish.color : "",
      !variants.length && controls.color_options.length <= 1 ? current.color : "",
      controls.color_options.length === 1 ? controls.color_options[0] : "",
    ),
    finish: first(
      selected?.finish,
      finish.status === "verified" ? finish.finish : "",
      !variants.length ? current.finish : "",
      !variants.length ? props.get("finish")?.value : "",
      controls.surface_finishes.length === 1 ? controls.surface_finishes[0] : "",
    ),
    dimensions: sizeResolved
      ? first(
          selected ? dimensions(selected) : "",
          measurement(selectedSize) || nominalSize(selectedSize) ? selectedSize : "",
          sizes.length <= 1 ? dimensions(candidate) : "",
        )
      : "",
    selected_size: selectedSize,
    size_options: sizes,
    image_url: first(object(image).url, object(image).src, image),
    unresolvedVariant: false,
  };
}
