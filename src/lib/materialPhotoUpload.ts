import { supabase } from "@/integrations/supabase/client";
import { isUuid } from "@/lib/ids";

const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export async function uploadMaterialPhoto(file: File, projectId: string, materialId: string) {
  const extension = IMAGE_EXTENSIONS[file.type];
  if (!extension) throw new Error("Choose a JPG, PNG, or WebP picture.");
  if (file.size > 10 * 1024 * 1024) throw new Error("Picture must be smaller than 10MB.");
  if (!isUuid(projectId) || !isUuid(materialId))
    throw new Error("Could not find this material item.");

  // A material-specific path and URL preserve other rooms' and catalog images.
  const storage = supabase.storage.from("product-images");
  const path = `materials/${projectId}/${materialId}/${crypto.randomUUID()}.${extension}`;
  const { error: uploadError } = await storage.upload(path, file, {
    contentType: file.type,
    cacheControl: "31536000",
    upsert: false,
  });
  if (uploadError) throw uploadError;
  const { data: image } = storage.getPublicUrl(path);
  const { data: saved, error: saveError } = await supabase
    .from("material_items")
    .update({ image_url: image.publicUrl })
    .eq("id", materialId)
    .eq("project_id", projectId)
    .select("id, image_url")
    .single();
  if (saveError) throw saveError;
  if (saved?.image_url !== image.publicUrl)
    throw new Error("The picture uploaded but could not be saved to this item. Please try again.");
  return image.publicUrl;
}
