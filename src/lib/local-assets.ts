import heroKitchen from "@/assets/spanish-kitchen-hero.jpg";
import sketchupKitchen from "@/assets/spanish-kitchen-sketchup.jpg";

// Maps the seed-data "/src-assets/<file>" paths to bundled asset URLs.
const map: Record<string, string> = {
  "/src-assets/spanish-kitchen-hero.jpg": heroKitchen,
  "/src-assets/spanish-kitchen-sketchup.jpg": sketchupKitchen,
};

export function normalizeSupabaseImageUrl(url: string | null | undefined): string {
  if (!url) return "";

  try {
    const parsed = new URL(url);
    const marker = "/storage/v1/render/image/public/";
    const markerIndex = parsed.pathname.indexOf(marker);

    if (markerIndex === -1) return url;

    const prefix = parsed.pathname.slice(0, markerIndex);
    const objectPath = parsed.pathname.slice(markerIndex + marker.length);
    return `${parsed.origin}${prefix}/storage/v1/object/public/${objectPath}`;
  } catch {
    return url;
  }
}

export function resolveImage(url: string | null | undefined): string {
  if (!url) return "";
  if (url.startsWith("/src-assets/")) return map[url] ?? "";
  return normalizeSupabaseImageUrl(url);
}
