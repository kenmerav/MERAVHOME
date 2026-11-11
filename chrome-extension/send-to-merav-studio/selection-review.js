const REVIEW_QUANTITY_UNITS = [
  "each",
  "sq ft",
  "linear ft",
  "pair",
  "set",
  "box",
  "carton",
  "slab",
  "roll",
  "gallon",
];
const REVIEW_SELLING_UNITS = [...REVIEW_QUANTITY_UNITS, "sheet"];
const REVIEW_PRODUCT_FIELDS = [
  ["name", "Product name"],
  ["vendor", "Vendor"],
  ["manufacturer", "Manufacturer"],
  ["sku", "SKU / model"],
  ["colorFinish", "Color / finish"],
  ["dimensions", "Dimensions", "Actual size and thickness where applicable"],
];
const REVIEW_PURCHASE_FIELDS = [
  ["unitPrice", "Unit price (USD)", "Exact amount"],
  ["priceUnit", "Price per", REVIEW_SELLING_UNITS],
  ["sellingUnit", "Sold by", REVIEW_SELLING_UNITS],
  ["priceType", "Price type", ["Retail", "Trade", "Vendor quote"]],
  ["priceSource", "Price source", "Product page or quote reference"],
  ["availability", "Stock / lead time"],
  ["minimumOrder", "Minimum order, if applicable", "Quantity in the selling unit"],
  ["coverage", "Sq ft per box, carton or sheet"],
  ["wastePercent", "Waste %", "Enter 0 if no waste applies"],
  ["specSheet", "Spec sheet URL, if available"],
];
const REVIEW_TILE_FIELDS = [
  ["location", "Installation area", "Surface, extent and stopping points"],
  ["layout", "Tile lay / pattern", "Include stagger offset if applicable"],
  ["direction", "Direction / starting point", "Or approved drawing detail"],
  ["groutProduct", "Grout brand / product"],
  ["groutColor", "Grout color / code"],
  ["jointWidth", "Grout joint width", "e.g. 1/8 in"],
  [
    "edgeTreatment",
    "Edge treatment",
    ["No exposed edges", "Miter", "Metal trim", "Pencil / bullnose", "Other"],
  ],
  ["edgeProduct", "Edge product / profile"],
  ["edgeFinish", "Edge finish"],
  ["edgeSize", "Edge size"],
  ["suitability", "Manufacturer-listed use", "e.g. Shower floor, verified on spec sheet"],
  ["installationNotes", "Transitions / drawing notes"],
  ["sample", "Sample / shade lot, if needed"],
];

function reviewOptions(control, options) {
  control.add(new Option("Choose", ""));
  for (const option of options) control.add(new Option(option, option));
}

function buildReviewFields(containerId, prefix, fields) {
  const container = document.getElementById(containerId);
  for (const [key, name, options] of fields) {
    const label = document.createElement("label");
    label.textContent = name;
    const control = document.createElement(Array.isArray(options) ? "select" : "input");
    control.id = `${prefix}-${key}`;
    if (Array.isArray(options)) reviewOptions(control, options);
    else {
      control.maxLength = 500;
      control.placeholder = options || "";
    }
    label.append(control);
    container.append(label);
  }
}

function setReviewFields(prefix, fields, values) {
  for (const [key] of fields) {
    const control = document.getElementById(`${prefix}-${key}`);
    control.value = values[key] ?? "";
    if (control instanceof HTMLSelectElement && values[key] && !control.value) {
      control.add(new Option(values[key], values[key], false, true));
    }
  }
}

function reviewFieldValues(prefix, fields) {
  return Object.fromEntries(
    fields.map(([key]) => [key, document.getElementById(`${prefix}-${key}`).value.trim()]),
  );
}

function showSelectionReview(capture, item) {
  const { product, imageUrl, sourcePageUrl } = capture.extraction;
  const image = document.getElementById("reviewImage");
  image.src = imageUrl;
  const link = document.getElementById("reviewSource");
  link.href = sourcePageUrl;
  link.textContent = new URL(sourcePageUrl).hostname.replace(/^www\./, "");
  const warning = document.getElementById("reviewCaptureWarning");
  warning.textContent = capture.extraction.warning || "";
  warning.hidden = !warning.textContent;
  document.getElementById("reviewLocation").value = item?.installationLocation || "";
  setReviewFields("product", REVIEW_PRODUCT_FIELDS, product);
  const itemName = `${item?.label || ""} ${product.name}`;
  const isTile =
    (!/\b(drain|faucet|sconces?|pendants?|chandeliers?|toilets?|wallpaper|vanit(?:y|ies))\b/i.test(
      itemName,
    ) &&
      /\b(tile|tiles|mosaic|zellige|terracotta|porcelain|ceramic)\b/i.test(itemName)) ||
    item?.tile?.surface === "Tile";
  const quantityUnit =
    isTile && (!item?.filled || item?.quantityUnit === "gallon")
      ? "sq ft"
      : item?.quantityUnit || "each";
  document.getElementById("quantityUnitInput").value = quantityUnit;
  document.getElementById("reviewSurface").value = isTile ? "Tile" : item?.tile?.surface || "";
  document.getElementById("tileReview").hidden = !isTile;
  setReviewFields("tile", REVIEW_TILE_FIELDS, {
    ...item?.tile,
    location:
      item?.tile?.location ||
      (isTile && /floor|wall|backsplash|surround/i.test(item?.label || "") ? item.label : ""),
    suitability: "",
    sample: "",
  });
  setReviewFields("purchase", REVIEW_PURCHASE_FIELDS, {
    unitPrice: product.price,
    priceUnit: product.priceUnit,
    priceType: product.price ? "Retail" : "",
    priceSource: product.price ? sourcePageUrl : "",
    availability: product.availability,
    coverage: product.coverage,
    specSheet: product.specSheet,
    wastePercent: item?.wastePercent,
  });
  document.getElementById("selectionConfirmed").checked = false;
  document.getElementById("selectionReview").hidden = false;
}

function selectionReviewValues() {
  const { wastePercent, ...purchase } = reviewFieldValues("purchase", REVIEW_PURCHASE_FIELDS);
  const surface = document.getElementById("reviewSurface").value;
  return {
    product: reviewFieldValues("product", REVIEW_PRODUCT_FIELDS),
    details: {
      installationLocation: document.getElementById("reviewLocation").value.trim(),
      quantityUnit: document.getElementById("quantityUnitInput").value,
      confirmed: document.getElementById("selectionConfirmed").checked,
      wastePercent,
      purchase,
      surface,
      tile: surface === "Tile" ? reviewFieldValues("tile", REVIEW_TILE_FIELDS) : undefined,
    },
  };
}

buildReviewFields("productReviewFields", "product", REVIEW_PRODUCT_FIELDS);
buildReviewFields("purchaseReviewFields", "purchase", REVIEW_PURCHASE_FIELDS);
buildReviewFields("tileReviewFields", "tile", REVIEW_TILE_FIELDS);
reviewOptions(document.getElementById("quantityUnitInput"), REVIEW_QUANTITY_UNITS);
document.getElementById("reviewSurface").addEventListener("change", (event) => {
  document.getElementById("tileReview").hidden = event.target.value !== "Tile";
});
document.getElementById("selectionReview").addEventListener("input", (event) => {
  if (event.target.id !== "selectionConfirmed")
    document.getElementById("selectionConfirmed").checked = false;
});
