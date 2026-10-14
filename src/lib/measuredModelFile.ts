/** Reject external references before either the browser or Blender opens a model. */
export function inspectGlb(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    bytes.length < 20 ||
    view.getUint32(0, true) !== 0x46546c67 ||
    view.getUint32(4, true) !== 2 ||
    view.getUint32(8, true) !== bytes.length
  )
    throw new Error("Choose a valid GLB 2.0 file exported from SketchUp or your modeling app.");
  const length = view.getUint32(12, true);
  if (view.getUint32(16, true) !== 0x4e4f534a || length > bytes.length - 20)
    throw new Error("The model has an invalid GLB header.");
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + length)));
  for (const entry of [...(json.buffers || []), ...(json.images || [])]) {
    if (entry.uri && !/^data:/i.test(entry.uri))
      throw new Error(
        "Export a self-contained GLB with embedded textures; external files are not supported.",
      );
  }
  if (
    (json.extensionsRequired || []).some((x: string) =>
      ["KHR_draco_mesh_compression", "EXT_meshopt_compression", "KHR_texture_basisu"].includes(x),
    )
  )
    throw new Error("Export an uncompressed GLB; this model requires an unsupported decoder.");
  return json;
}
