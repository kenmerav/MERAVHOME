import heroKitchen from "@/assets/spanish-kitchen-hero.jpg";
import sketchupKitchen from "@/assets/spanish-kitchen-sketchup.jpg";

// Maps the seed-data "/src-assets/<file>" paths to bundled asset URLs.
const map: Record<string, string> = {
  "/src-assets/spanish-kitchen-hero.jpg": heroKitchen,
  "/src-assets/spanish-kitchen-sketchup.jpg": sketchupKitchen,
};

export function resolveImage(url: string | null | undefined): string {
  if (!url) return "";
  if (url.startsWith("/src-assets/")) return map[url] ?? "";
  return url;
}
