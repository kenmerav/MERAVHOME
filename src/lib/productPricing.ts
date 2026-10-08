// Shared by single-product and materials scraping. Keep ranges out of numeric totals.
const AMOUNT = String.raw`(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?`;
const PRICE = new RegExp(
  String.raw`^\s*\$?\s*(${AMOUNT})(?:\s*(?:-|–|—|to)\s*\$?\s*(${AMOUNT}))?\s*(?:\/\s*(?:sq\.?\s*ft\.?|sf|each|item|box)|per\s+(?:sq\.?\s*ft\.?|square\s+foot|item|box)|each|USD)?\s*$`,
  "i",
);

export function formatProductPrice(value: number) {
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function firstProductPrice(...values: unknown[]) {
  for (const value of values) {
    const text =
      typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
    const match = PRICE.exec(text);
    if (!match) continue;
    const low = Number(match[1].replace(/,/g, ""));
    const high = match[2] ? Number(match[2].replace(/,/g, "")) : low;
    if (!Number.isFinite(low) || !Number.isFinite(high) || low <= 0 || high < low) continue;
    return low === high
      ? formatProductPrice(low)
      : `${formatProductPrice(low)}–${formatProductPrice(high)}`;
  }
  return "";
}

export function exactProductPrice(value: unknown) {
  const price = firstProductPrice(value);
  return price.includes("–") ? "" : price;
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function selectedSkuPriceFromHtml(html: string, sourceUrl: string) {
  let sku = "";
  try {
    sku = new URL(sourceUrl).searchParams.get("sku") ?? "";
  } catch {
    return "";
  }
  if (!/^\d{4,20}$/.test(sku)) return "";
  const start = new RegExp(`"${sku}"\\s*:\\s*\\{\\s*"id"\\s*:\\s*"${sku}"`).exec(html);
  if (!start) return "";
  const offset = html.indexOf("{", start.index);
  let depth = 0;
  let quoted = false;
  let escaped = false;
  // Bound parsing to this SKU object so a neighboring variant cannot supply its price.
  for (let index = offset; index < Math.min(html.length, offset + 100000); index += 1) {
    const char = html[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === "{") depth += 1;
    else if (char === "}" && --depth === 0) {
      try {
        const data = object(JSON.parse(html.slice(offset, index + 1)));
        const price = object(data.price);
        return firstProductPrice(price.sellingPrice, price.regularPrice, price.retailPrice);
      } catch {
        return "";
      }
    }
  }
  return "";
}

function structuredProductPrice(html: string, sourceUrl: string) {
  const products: Record<string, unknown>[] = [];
  const findProducts = (value: unknown) => {
    if (Array.isArray(value)) return value.forEach(findProducts);
    const row = object(value);
    if (!Object.keys(row).length) return;
    const types = Array.isArray(row["@type"]) ? row["@type"] : [row["@type"]];
    if (types.some((type) => /^Product(?:Group)?$/i.test(String(type)))) products.push(row);
    // Only inspect graph roots; never pull prices from recommendations or item lists.
    if (row["@graph"]) findProducts(row["@graph"]);
  };
  for (const script of html.matchAll(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    try {
      findProducts(JSON.parse(script[1]));
    } catch {
      /* Malformed vendor data. */
    }
  }
  let selected: string[] = [];
  let source: URL | undefined;
  try {
    source = new URL(sourceUrl);
    selected = ["sku", "variant", "itemNo", "uid", "piid"]
      .map((key) => source!.searchParams.get(key) ?? "")
      .filter(Boolean);
  } catch {
    /* Invalid URL has no selected option. */
  }
  const matchesSelection = (row: Record<string, unknown>) => {
    const identifiers = [row.sku, row.productID, row.mpn, row["@id"]].map(String);
    if (selected.some((id) => identifiers.includes(id))) return true;
    if (!row.url && !row["@id"]) return false;
    try {
      const url = new URL(String(row.url ?? row["@id"] ?? ""), sourceUrl);
      return (
        selected.length > 0 &&
        selected.some((id) => Array.from(url.searchParams.values()).includes(id))
      );
    } catch {
      return false;
    }
  };
  const selectedProducts = products.filter(matchesSelection);
  const pathProducts = products.filter((row) => {
    try {
      return new URL(String(row.url ?? row["@id"]), sourceUrl).pathname === source?.pathname;
    } catch {
      return false;
    }
  });
  const primary = selectedProducts.length
    ? selectedProducts
    : pathProducts.length
      ? pathProducts
      : products.length === 1
        ? products
        : [];
  const offers: Record<string, unknown>[] = [];
  const addOffer = (value: unknown) => {
    if (Array.isArray(value)) return value.forEach(addOffer);
    const row = object(value);
    if (row.priceCurrency && row.priceCurrency !== "USD") return;
    if (row.price != null || row.lowPrice != null) offers.push(row);
    if (row.price == null && row.lowPrice == null && row.priceSpecification)
      addOffer(row.priceSpecification);
    if (row.offers) addOffer(row.offers);
  };
  primary.forEach((row) => addOffer(row.offers));
  const exactOffers = offers.filter(matchesSelection);
  const eligible = exactOffers.length ? exactOffers : offers;
  // A URL-selected option must not inherit a different option's offer.
  if (
    selected.length &&
    !selectedProducts.length &&
    !exactOffers.length &&
    eligible.some((row) => row.sku || row.url)
  )
    return "";
  const prices = eligible
    .map((row) => firstProductPrice(row.price ?? row.lowPrice))
    .filter(Boolean);
  const highs = eligible
    .map((row) => firstProductPrice(row.highPrice ?? row.price ?? row.lowPrice))
    .filter(Boolean);
  if (!prices.length || !highs.length) return "";
  const low = Math.min(...prices.map((price) => Number(price.replace(/[$,]/g, ""))));
  const high = Math.max(...highs.map((price) => Number(price.replace(/[$,]/g, ""))));
  return firstProductPrice(low === high ? low : `${low}-${high}`);
}

export function productPriceFromPage(markdown = "", html = "", sourceUrl = "") {
  const skuPrice = selectedSkuPriceFromHtml(html, sourceUrl);
  if (skuPrice) return skuPrice;
  // Prefer current/sale price on the rendered page over generic list-price metadata.
  const plainMarkdown = markdown.replace(/[*_~]/g, "");
  const visible =
    plainMarkdown ||
    html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "").replace(/<[^>]+>/g, " ");
  for (const label of ["current price", "sale price", "our price", "price"]) {
    const match = new RegExp(
      String.raw`\b${label}\s*:?\s*(\$?\s*${AMOUNT}(?:\s*(?:-|–|—|to)\s*\$?\s*${AMOUNT})?)`,
      "i",
    ).exec(visible);
    const price = firstProductPrice(match?.[1]);
    if (price) return price;
  }
  const automation = html.match(/data-automation=["']price["'][^>]*>\s*([^<]+)/i);
  const structured = structuredProductPrice(html, sourceUrl);
  const standalone = plainMarkdown.match(
    new RegExp(
      String.raw`(?:^|\n)\s*(?:-\s*)?(\$\s*${AMOUNT}(?:\s*(?:-|–|—|to)\s*\$?\s*${AMOUNT})?)(?:\s*(?:\/\s*sq\.?\s*ft\.?|each))?\s*(?:\n|$)`,
      "i",
    ),
  );
  // Only use price-specific metadata, never arbitrary numbers from descriptions.
  const meta = Array.from(html.matchAll(/<meta\b[^>]*>/gi)).map(([tag]) => {
    const field = /(?:property|name|itemprop)=["']([^"']+)/i.exec(tag)?.[1];
    return /^(?:product:price:amount|og:price:amount|price)$/i.test(field ?? "")
      ? /content=["']([^"']+)/i.exec(tag)?.[1]
      : "";
  });
  return firstProductPrice(automation?.[1], structured, standalone?.[1], ...meta);
}
