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
    clean(jsonLd.width?.value || jsonLd.width) ||
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
      const text = clean(element.textContent || element.getAttribute("aria-label") || element.getAttribute("title"));
      if (text && !/add to cart|quantity|wishlist/i.test(text)) return text;
    }
  }
  return visibleDefinition(labelPattern);
}

function visibleDefinition(labelPattern) {
  const text = clean(document.body.innerText);
  const lines = text.split(/\n| {2,}/).map(clean).filter(Boolean);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!labelPattern.test(line)) continue;
    const inline = line.match(/^[^:]{2,45}:\s*(.+)$/);
    if (inline?.[1]) return clean(inline[1]);
    if (lines[index + 1] && lines[index + 1].length < 120) return lines[index + 1];
  }
  return "";
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
