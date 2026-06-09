chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "MERAV_EXTRACT_PRODUCT") return false;
  try {
    sendResponse(extractProduct(message.clickedImageUrl, message.pageUrl));
  } catch (error) {
    sendResponse({
      sourcePageUrl: message.pageUrl || location.href,
      imageUrl: message.clickedImageUrl,
      product: {
        name: document.title,
        vendor: location.hostname.replace(/^www\./, ""),
      },
      error: error instanceof Error ? error.message : "Extraction failed.",
    });
  }
  return true;
});

window.addEventListener("message", (event) => {
  if (event.source !== window || event.data?.type !== "MERAV_STUDIO_BOARD_DESTINATION") return;
  const projectId = clean(event.data.projectId);
  const boardPageId = clean(event.data.boardPageId);
  if (!projectId || !boardPageId) return;
  const boardPageByProject = { [projectId]: boardPageId };
  chrome.storage.sync.get(["boardPageByProject"], (settings) => {
    chrome.storage.sync.set({
      studioUrl: location.origin,
      projectId,
      boardPageId,
      lastStudioProjectId: projectId,
      boardPageByProject: { ...(settings.boardPageByProject || {}), ...boardPageByProject },
    });
  });
});

if (location.hostname === "studio.meravinteriors.com" || location.hostname.endsWith(".vercel.app")) {
  const match = location.pathname.match(/\/projects\/([^/]+)\/design-boards/);
  if (match?.[1]) {
    chrome.storage.sync.set({ lastStudioProjectId: match[1], studioUrl: location.origin });
  }
}

function extractProduct(clickedImageUrl, pageUrl) {
  const jsonLdProducts = getJsonLdProducts();
  const jsonLd = jsonLdProducts[0] || {};
  const offers = firstOffer(jsonLd.offers);
  const selectedImage = absoluteUrl(clickedImageUrl) || firstImage(jsonLd.image) || metaImage() || largestVisibleImage();
  const sourcePageUrl = absoluteUrl(pageUrl || location.href) || location.href;
  const productName =
    clean(jsonLd.name) ||
    meta("og:title") ||
    meta("twitter:title") ||
    productHeading() ||
    clean(document.title);
  const vendor =
    brandName(jsonLd.brand) ||
    clean(jsonLd.manufacturer?.name) ||
    meta("og:site_name") ||
    location.hostname.replace(/^www\./, "");
  const manufacturer = brandName(jsonLd.manufacturer) || vendor;
  const price = priceText(offers?.price, offers?.priceCurrency) || visiblePrice();
  const sku = clean(jsonLd.sku) || clean(jsonLd.mpn) || visibleSku();
  const colorFinish =
    clean(jsonLd.color) ||
    visibleOption(/color|finish|fabric|material|variant/i) ||
    visibleDefinition(/color|finish|fabric|material/i);
  const dimensions =
    jsonLdDimensions(jsonLd) ||
    visibleDimensions() ||
    visibleDefinition(/dimensions|overall|size|width|height|depth/i);
  const description =
    clean(jsonLd.description) ||
    meta("og:description") ||
    meta("description") ||
    visibleDescription();

  return {
    sourcePageUrl,
    imageUrl: selectedImage,
    imageWidth: naturalImageSize(selectedImage).width,
    imageHeight: naturalImageSize(selectedImage).height,
    product: {
      name: productName,
      vendor,
      manufacturer,
      sku,
      price,
      colorFinish,
      dimensions,
      description,
    },
  };
}

function getJsonLdProducts() {
  const products = [];
  document.querySelectorAll('script[type="application/ld+json"]').forEach((script) => {
    try {
      const parsed = JSON.parse(script.textContent || "null");
      collectProducts(parsed, products);
    } catch {
      // Ignore malformed structured data.
    }
  });
  return products;
}

function collectProducts(value, products) {
  if (!value) return;
  if (Array.isArray(value)) {
    value.forEach((item) => collectProducts(item, products));
    return;
  }
  if (typeof value !== "object") return;
  const type = value["@type"];
  const types = Array.isArray(type) ? type : [type];
  if (types.some((item) => String(item).toLowerCase() === "product")) products.push(value);
  if (Array.isArray(value["@graph"])) collectProducts(value["@graph"], products);
}

function firstOffer(offers) {
  if (Array.isArray(offers)) return offers[0] || null;
  return offers && typeof offers === "object" ? offers : null;
}

function firstImage(value) {
  if (Array.isArray(value)) return absoluteUrl(value[0]);
  if (value && typeof value === "object") return absoluteUrl(value.url || value.contentUrl);
  return absoluteUrl(value);
}

function metaImage() {
  return absoluteUrl(meta("og:image") || meta("twitter:image") || meta("image"));
}

function meta(name) {
  const escaped = CSS.escape(name);
  return clean(
    document.querySelector(`meta[property="${escaped}"]`)?.getAttribute("content") ||
      document.querySelector(`meta[name="${escaped}"]`)?.getAttribute("content"),
  );
}

function productHeading() {
  const selectors = ["h1", "[data-testid*=product][data-testid*=title]", "[class*=product][class*=title]"];
  for (const selector of selectors) {
    const text = clean(document.querySelector(selector)?.textContent);
    if (text) return text;
  }
  return "";
}

function brandName(value) {
  if (!value) return "";
  if (typeof value === "string") return clean(value);
  if (typeof value === "object") return clean(value.name);
  return "";
}

function priceText(price, currency) {
  const value = clean(price);
  if (!value) return "";
  if (value.startsWith("$")) return value;
  return currency === "USD" || !currency ? `$${value}` : `${currency} ${value}`;
}

function visiblePrice() {
  const candidates = [
    "[itemprop=price]",
    "[class*=price]",
    "[data-testid*=price]",
    "[aria-label*=price i]",
  ];
  for (const selector of candidates) {
    const text = clean(document.querySelector(selector)?.textContent);
    const match = text.match(/\$ ?\d[\d,]*(?:\.\d{2})?/);
    if (match) return match[0].replace(/\s+/g, "");
  }
  const bodyMatch = clean(document.body.innerText).match(/\$ ?\d[\d,]*(?:\.\d{2})?/);
  return bodyMatch ? bodyMatch[0].replace(/\s+/g, "") : "";
}

function visibleSku() {
  return visibleDefinition(/sku|item #|item number|model|mpn/i);
}

function visibleOption(labelPattern) {
  const optionSelectors = [
    "[aria-checked=true]",
    "[aria-selected=true]",
    "select option:checked",
    "[class*=selected]",
    "[data-selected=true]",
  ];
  for (const selector of optionSelectors) {
    for (const element of document.querySelectorAll(selector)) {
      const rawText = clean(
        element.textContent ||
          element.getAttribute("aria-label") ||
          element.getAttribute("title") ||
          element.getAttribute("value"),
      );
      const text = cleanProductAttribute(rawText, labelPattern);
      const context = clean(
        element.closest("fieldset,section,form,li,div")?.textContent ||
          element.parentElement?.textContent ||
          "",
      );
      const contextMatches = labelPattern.test(context);
      const attributeMatches = labelPattern.test(rawText);
      if ((contextMatches || attributeMatches) && isPlausibleProductAttribute(text)) return text;
    }
  }
  return visibleDefinition(labelPattern);
}

function visibleDefinition(labelPattern) {
  const rawText = document.body?.innerText || "";
  const lines = rawText.split(/\n| {2,}/).map(clean).filter(Boolean);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!labelPattern.test(line)) continue;
    const inline = line.match(/^[^:]{2,45}:\s*(.+)$/);
    const inlineValue = cleanProductAttribute(inline?.[1], labelPattern);
    if (isPlausibleProductAttribute(inlineValue)) return inlineValue;
    const nextLine = cleanProductAttribute(lines[index + 1], labelPattern);
    if (isPlausibleProductAttribute(nextLine)) return nextLine;
  }
  return "";
}

function jsonLdDimensions(jsonLd) {
  const width = clean(jsonLd.width?.value || jsonLd.width);
  const depth = clean(jsonLd.depth?.value || jsonLd.depth);
  const height = clean(jsonLd.height?.value || jsonLd.height);
  if (width && depth && height) return `${width} W x ${depth} D x ${height} H`;
  return clean(jsonLd.size || jsonLd.dimensions);
}

function visibleDimensions() {
  const rawText = document.body?.innerText || "";
  const compact = clean(rawText);
  const patterns = [
    /\b\d+(?:\.\d+)?\s*(?:"|in\.?|inch(?:es)?)?\s*w\s*[x×]\s*\d+(?:\.\d+)?\s*(?:"|in\.?|inch(?:es)?)?\s*d\s*[x×]\s*\d+(?:\.\d+)?\s*(?:"|in\.?|inch(?:es)?)?\s*h\b/i,
    /\b\d+(?:\.\d+)?\s*(?:"|in\.?|inch(?:es)?)?\s*width\s*[x×, ]+\s*\d+(?:\.\d+)?\s*(?:"|in\.?|inch(?:es)?)?\s*depth\s*[x×, ]+\s*\d+(?:\.\d+)?\s*(?:"|in\.?|inch(?:es)?)?\s*height\b/i,
  ];
  for (const pattern of patterns) {
    const match = compact.match(pattern);
    if (match?.[0]) return clean(match[0]);
  }
  return "";
}

function cleanProductAttribute(value, labelPattern) {
  let text = clean(value);
  if (!text) return "";
  text = text
    .replace(/^(color|finish|fabric|material|variant|dimensions|overall|size|width|height|depth)\s*:?\s*/i, "")
    .replace(/\b(selected|selection|choose|view all|more options|details|shop now)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  if (labelPattern?.test(text) && text.length < 18) return "";
  return text;
}

function isPlausibleProductAttribute(value) {
  const text = clean(value);
  if (!text || text.length > 120) return false;
  if (/add to cart|quantity|wishlist|shipping|delivery|pickup|zip|sale|clearance|review|star|view all|shop now|image|photo|carousel|room view/i.test(text)) {
    return false;
  }
  return /[a-z0-9]/i.test(text);
}

function visibleDescription() {
  const selectors = [
    "[itemprop=description]",
    "[class*=description]",
    "[data-testid*=description]",
    "section",
  ];
  for (const selector of selectors) {
    const text = clean(document.querySelector(selector)?.textContent);
    if (text && text.length > 40 && text.length < 1200) return text;
  }
  return "";
}

function largestVisibleImage() {
  let best = null;
  let bestArea = 0;
  document.querySelectorAll("img").forEach((img) => {
    const rect = img.getBoundingClientRect();
    const src = absoluteUrl(img.currentSrc || img.src);
    if (!src || rect.width < 80 || rect.height < 80) return;
    const area = rect.width * rect.height;
    if (area > bestArea) {
      best = src;
      bestArea = area;
    }
  });
  return best || "";
}

function naturalImageSize(src) {
  for (const img of document.images) {
    if (absoluteUrl(img.currentSrc || img.src) === src) {
      return { width: img.naturalWidth || 0, height: img.naturalHeight || 0 };
    }
  }
  return { width: 0, height: 0 };
}

function absoluteUrl(value) {
  const text = clean(value);
  if (!text) return "";
  try {
    return new URL(text, location.href).toString();
  } catch {
    return "";
  }
}

function clean(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}
