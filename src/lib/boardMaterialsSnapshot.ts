// Shared with the board editor's send-to-materials tracking format.
export function createBoardMaterialsSnapshot(page: any) {
  return {
    version: 1 as const, title: page.title, roomId: page.roomId ?? null,
    hidden: page.hidden === true, roomApprovalStatus: page.roomApprovalStatus ?? null,
    materialImages: page.elements.filter((element: any) => element.type === "image").map((element: any) => ({
      id: element.id, src: element.src ?? null, label: element.label ?? null, notes: element.notes ?? null,
      link: element.link ?? null, materialLinkCleared: element.materialLinkCleared === true,
      productId: element.productId ?? null, productName: element.productName ?? null, finish: element.finish ?? null,
      materialRoomId: element.materialRoomId ?? null, materialCategory: element.materialCategory ?? null,
      materialQuantity: element.materialQuantity ?? null, materialFinish: element.materialFinish ?? null,
      materialDimensions: element.materialDimensions ?? null, materialInfoNotNeeded: element.materialInfoNotNeeded === true,
      materialInfoSkipApproved: element.materialInfoSkipApproved === true,
      materialExcludeFromMaterials: element.materialExcludeFromMaterials === true,
    })).sort((left: any, right: any) => left.id.localeCompare(right.id)),
  };
}
export function boardMaterialsFingerprint(snapshot: ReturnType<typeof createBoardMaterialsSnapshot>) {
  const value = JSON.stringify({ title: snapshot.title, roomId: snapshot.roomId, hidden: snapshot.hidden,
    roomApprovalStatus: snapshot.roomApprovalStatus, materialImages: snapshot.materialImages });
  let first = 0x811c9dc5, second = 0x9e3779b9;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193); second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return `v1:${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0).toString(16).padStart(8, "0")}`;
}
