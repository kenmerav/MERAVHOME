const KNOWN_VENDOR_HOSTS: Record<string, string> = {
  "amazon.com": "Amazon",
  "anasazistone.com": "Anasazi Stone",
  "arizonatile.com": "Arizona Tile",
  "artwalktile.com": "Art Walk Tile",
  "bedrosians.com": "Bedrosians",
  "benjaminmoore.com": "Benjamin Moore",
  "build.com": "Build.com",
  "cambriausa.com": "Cambria",
  "cb2.com": "CB2",
  "crateandbarrel.com": "Crate & Barrel",
  "etsy.com": "Etsy",
  "ferguson.com": "Ferguson",
  "fergusonhome.com": "Ferguson Home",
  "flooranddecor.com": "Floor & Decor",
  "homedepot.com": "The Home Depot",
  "kohler.com": "Kohler",
  "lampsplus.com": "Lamps Plus",
  "jossandmain.com": "Joss & Main",
  "kathykuohome.com": "Kathy Kuo Home",
  "lightology.com": "Lightology",
  "lightopia.com": "Lightopia",
  "lumens.com": "Lumens",
  "myknobs.com": "MyKnobs",
  "perigold.com": "Perigold",
  "portolapaints.com": "Portola Paints",
  "potterybarn.com": "Pottery Barn",
  "reginaandrew.com": "Regina Andrew",
  "rejuvenation.com": "Rejuvenation",
  "roguefitness.com": "Rogue Fitness",
  "sandbergwallpaper.com": "Sandberg Wallpaper",
  "schumacher.com": "Schumacher",
  "shadesoflight.com": "Shades of Light",
  "sherwin-williams.com": "Sherwin-Williams",
  "signaturehardware.com": "Signature Hardware",
  "sollidcabinetry.com": "Sollid Cabinetry",
  "stoneandtileshoppe.com": "Stone & Tile Shoppe",
  "stonecollection.com": "The Stone Collection",
  "tilebar.com": "TileBar",
  "tilesofezra.com": "Tiles of Ezra",
  "urbanfloor.com": "Urbanfloor",
  "vintagetub.com": "Vintage Tub & Bath",
  "visualcomfort.com": "Visual Comfort",
  "wayfair.com": "Wayfair",
  "westelm.com": "West Elm",
  "zianatural.com": "Zia Tile",
  "ziatile.com": "Zia Tile",
};

function baseHost(hostname: string) {
  const parts = hostname
    .toLowerCase()
    .replace(/^www\./, "")
    .split(".")
    .filter(Boolean);
  if (parts.length <= 2) return parts.join(".");
  return parts.slice(-2).join(".");
}

function titleCaseDomain(value: string) {
  return value
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim();
}

export function inferVendorFromUrl(value: string | null | undefined) {
  if (!value) return "";
  try {
    const url = new URL(value.trim());
    const host = baseHost(url.hostname);
    if (KNOWN_VENDOR_HOSTS[host]) return KNOWN_VENDOR_HOSTS[host];
    const label = host.split(".")[0];
    return titleCaseDomain(label);
  } catch {
    return "";
  }
}
