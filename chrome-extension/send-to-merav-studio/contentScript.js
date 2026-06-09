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
  const colorFinish = productColorFinish(jsonLd);
  const dimensions = productDimensions(jsonLd);
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
  return visibleDefinition(/sku|item #|item number|model|mpn/i, isPlausibleProductAttribute);
}

function productColorFinish(jsonLd) {
  const properties = jsonLdProperties(jsonLd);
  return firstValid(
    [
      queryVariantValue(),
      clean(jsonLd.color),
      propertyValue(properties, /color|colour|finish|fabric|material|upholstery|variant/i),
      selectedOptionValue(/color|colour|finish|fabric|material|upholstery|variant/i, isPlausibleColorFinish),
      visibleLabeledSpec(/color|colour|finish|fabric|material|upholstery|variant/i, isPlausibleColorFinish),
      visibleDefinition(/color|colour|finish|fabric|material|upholstery|variant/i, isPlausibleColorFinish),
    ],
    isPlausibleColorFinish,
  );
}

function queryVariantValue() {
  const params = new URLSearchParams(location.search);
  const candidateKeys = [
    "color",
    "colour",
    "finish",
    "fabric",
    "material",
    "upholstery",
    "AttrValue1",
    "variant",
  ];
  for (const key of candidateKeys) {
    const value = cleanProductAttribute(params.get(key), /color|colour|finish|fabric|material|upholstery|variant/i);
    if (isPlausibleColorFinish(value)) return value;
  }
  const attrValues = [];
  for (const [key, value] of params.entries()) {
    const normalizedValue = cleanProductAttribute(value, /color|colour|finish|fabric|material|upholstery|variant/i);
    if (!normalizedValue || !isPlausibleColorFinish(normalizedValue)) continue;
    if (/color|colour|finish|fabric|material|upholstery|variant/i.test(key)) {
      return normalizedValue;
    }
    if (/^attrvalue\d*$/i.test(key) || /option|attribute/i.test(key)) attrValues.push(normalizedValue);
  }
  const colorLike = attrValues.find((value) => !isLikelySizeOnly(value));
  if (colorLike) return colorLike;
  return "";
}

function productDimensions(jsonLd) {
  const properties = jsonLdProperties(jsonLd);
  return firstValid(
    [
      dimensionsFromProperties(properties),
      jsonLdDimensions(jsonLd),
      visibleLabeledSpec(/dimensions|overall|size|width|height|depth|length/i, isPlausibleDimension),
      visibleDimensions(),
      visibleDefinition(/dimensions|overall|size|width|height|depth|length/i, isPlausibleDimension),
    ],
    isPlausibleDimension,
  );
}

function firstValid(values, validator) {
  for (const value of values) {
    const text = clean(value);
    if (validator(text)) return text;
  }
  return "";
}

function jsonLdProperties(jsonLd) {
  const properties = [];
  const queue = [jsonLd];
  const seen = new Set();
  while (queue.length) {
    const value = queue.shift();
    if (!value || typeof value !== "object" || seen.has(value)) continue;
    seen.add(value);

    const additionalProperty = value.additionalProperty || value.additionalProperties;
    const items = Array.isArray(additionalProperty) ? additionalProperty : [additionalProperty].filter(Boolean);
    items.forEach((property) => {
      if (!property || typeof property !== "object") return;
      const name = clean(property.name || property.propertyID || property["@type"]);
      const propertyValueText = clean(
        property.value ||
          property.valueReference?.name ||
          property.valueReference?.value ||
          property.description ||
          property.name,
      );
      if (name && propertyValueText) properties.push({ name, value: propertyValueText });
    });

    ["hasVariant", "isVariantOf", "model", "offers"].forEach((key) => {
      const next = value[key];
      if (Array.isArray(next)) queue.push(...next);
      else if (next && typeof next === "object") queue.push(next);
    });
  }
  return properties;
}

function propertyValue(properties, labelPattern) {
  for (const property of properties) {
    if (!labelPattern.test(property.name)) continue;
    const value = cleanProductAttribute(property.value, labelPattern);
    if (value) return value;
  }
  return "";
}

function dimensionsFromProperties(properties) {
  const direct = propertyValue(properties, /dimensions|overall|size/i);
  if (isPlausibleDimension(direct)) return direct;

  const width = propertyValue(properties, /^width$/i);
  const depth = propertyValue(properties, /^(depth|diameter)$/i);
  const height = propertyValue(properties, /^height$/i);
  if (width && depth && height) return `${width} W x ${depth} D x ${height} H`;
  return "";
}

function selectedOptionValue(labelPattern, validator) {
  const optionSelectors = [
    "[aria-checked=true]",
    "[aria-selected=true]",
    "input:checked",
    "select option:checked",
    "[class*=selected]",
    "[class*=active]",
    "[data-selected=true]",
  ];
  for (const selector of optionSelectors) {
    for (const element of document.querySelectorAll(selector)) {
      const context = selectedOptionContext(element);
      const contextMatches = labelPattern.test(context);
      for (const rawText of elementTextCandidates(element)) {
        const attributeMatches = labelPattern.test(rawText);
        const text = cleanProductAttribute(rawText, labelPattern);
        if ((contextMatches || attributeMatches) && validator(text)) return text;
      }
    }
  }
  return "";
}

function selectedOptionContext(element) {
  const contextElement = element.closest(
    "fieldset,[role=radiogroup],[aria-label],[data-testid],section,form,li,div",
  );
  const legend = clean(contextElement?.querySelector("legend")?.textContent);
  return clean(
    [
      legend,
      contextElement?.getAttribute("aria-label"),
      contextElement?.getAttribute("data-testid"),
      contextElement?.getAttribute("class"),
      contextElement?.textContent,
      element.parentElement?.textContent,
    ]
      .filter(Boolean)
      .join(" "),
  );
}

function elementTextCandidates(element) {
  const candidates = [
    element.textContent,
    element.getAttribute("aria-label"),
    element.getAttribute("title"),
    element.getAttribute("alt"),
    element.getAttribute("value"),
    element.getAttribute("data-value"),
    element.getAttribute("data-color"),
    element.getAttribute("data-colour"),
    element.getAttribute("data-finish"),
    element.getAttribute("data-fabric"),
    element.getAttribute("data-material"),
    element.getAttribute("data-option"),
    element.getAttribute("data-option-value"),
    associatedLabelText(element),
    element.closest("label")?.textContent,
  ];
  return candidates.map(clean).filter(Boolean);
}

function associatedLabelText(element) {
  const id = element.getAttribute("id");
  if (!id) return "";
  try {
    return clean(document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent);
  } catch {
    return "";
  }
}

function visibleLabeledSpec(labelPattern, validator) {
  const selectors = [
    "tr",
    "dl",
    "[role=row]",
    "[class*=spec]",
    "[class*=detail]",
    "[class*=attribute]",
    "[data-testid*=spec]",
    "[data-testid*=detail]",
  ];
  for (const selector of selectors) {
    for (const element of document.querySelectorAll(selector)) {
      const text = clean(element.textContent);
      if (!labelPattern.test(text)) continue;
      const cells = Array.from(element.querySelectorAll("th,td,dt,dd,[role=cell]")).map((cell) =>
        clean(cell.textContent),
      );
      if (cells.length >= 2) {
        const label = cells[0];
        const value = cells.slice(1).join(" ");
        const candidate = cleanProductAttribute(value, labelPattern);
        if (labelPattern.test(label) && validator(candidate)) return candidate;
      }
      const inline = text.match(/^[^:]{2,60}:\s*(.+)$/);
      const candidate = cleanProductAttribute(inline?.[1], labelPattern);
      if (validator(candidate)) return candidate;
    }
  }
  return "";
}

function visibleDefinition(labelPattern, validator = isPlausibleProductAttribute) {
  const rawText = document.body?.innerText || "";
  const lines = rawText.split(/\n| {2,}/).map(clean).filter(Boolean);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!labelPattern.test(line)) continue;
    const inline = line.match(/^[^:]{2,45}:\s*(.+)$/);
    const inlineValue = cleanProductAttribute(inline?.[1], labelPattern);
    if (validator(inlineValue)) return inlineValue;
    const nextLine = cleanProductAttribute(lines[index + 1], labelPattern);
    if (validator(nextLine)) return nextLine;
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
  text = text.replace(/([a-z])([A-Z])/g, "$1 $2");
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
  if (/clear\s*variant\s*filters|variant\s*filters|clear filters|reset filters/i.test(text)) return false;
  if (/^[a-z]+(?:[A-Z][a-z0-9]*){1,}$/.test(text)) return false;
  if (
    /add to cart|quantity|wishlist|shipping|delivery|pickup|zip|sale|clearance|review|star|view all|shop now|image|photo|carousel|room view|button|submit|drawer|modal|toggle|filter/i.test(
      text,
    )
  ) {
    return false;
  }
  return /[a-z0-9]/i.test(text);
}

function isPlausibleColorFinish(value) {
  const text = clean(value);
  if (!isPlausibleProductAttribute(text)) return false;
  if (text.length > 80) return false;
  if (isLikelySizeOnly(text)) return false;
  if (/\$|sku|item #|model|mpn|qty|quantity|dimensions|overall|width|height|depth|length|\d+\s*(?:"|in\.?|inch|cm|mm|ft)/i.test(text)) {
    return false;
  }
  if (/select|selected option|available|swatch|fabric type|color family|see more|learn more/i.test(text)) {
    return false;
  }
  return /[a-z]/i.test(text);
}

function isLikelySizeOnly(value) {
  const text = clean(value).toLowerCase();
  return /^(xs|s|m|l|xl|xxl|small|medium|large|extra small|extra large|twin|full|queen|king|cal king|standard|short|tall)$/i.test(text);
}

function isPlausibleDimension(value) {
  const text = clean(value);
  if (!text || text.length > 140) return false;
  if (/add to cart|wishlist|shipping|delivery|review|shop now|image|photo/i.test(text)) return false;
  return (
    /\d+(?:\.\d+)?\s*(?:"|in\.?|inch(?:es)?|cm|mm|ft|feet)\b/i.test(text) ||
    /\d+(?:\.\d+)?\s*[wdhl]\b/i.test(text) ||
    /\b(width|height|depth|diameter|length|overall)\b/i.test(text)
  );
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
