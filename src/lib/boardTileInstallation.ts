import { roomDesignBoardDisplayLabel } from "./roomDesignWorkflow";
import { roomDesignTileRequiredDetails, roomDesignTileSurface } from "./roomDesignTile";

type TileLayer = {
  id: string;
  type: string;
  label?: string | null;
  productName?: string | null;
  materialCategory?: string | null;
  materialExcludeFromMaterials?: boolean;
  notes?: string | null;
};

type TileProduct = { name?: string | null; category?: string | null };

const tileIssueLabels = {
  grout: "grout color / joint width",
  layout: "tile layout",
  direction: "tile lay direction",
};

export function isBoardTileSelection(layer: TileLayer, product?: TileProduct | null) {
  if (layer.type !== "image" || layer.materialExcludeFromMaterials) return false;
  return roomDesignTileSurface({
    category: roomDesignBoardDisplayLabel(layer) || layer.materialCategory || "",
    productName: layer.productName || product?.name || "",
    materialCategory: layer.materialCategory || product?.category,
    notes: layer.notes || "",
  }) === "tile";
}

export function boardTileInstallationIssues(layer: TileLayer, product?: TileProduct | null) {
  if (!isBoardTileSelection(layer, product)) return [];
  return roomDesignTileRequiredDetails(layer.notes || "").map(({ field }) => tileIssueLabels[field]);
}

export function hasBoardTileInstallationIssue(issues: readonly string[]) {
  return Object.values(tileIssueLabels).some((label) => issues.includes(label));
}
