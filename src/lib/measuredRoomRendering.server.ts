import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { ProjectAccessError } from "./measuredAccess.server";
import { loadFinishedPhoto, readAsset, imageMime } from "./measuredCloud.server";
import { ROOM_IMAGE_BUCKET } from "./roomImageStorage.server";

// One stable gallery record per generated image. A retry cannot duplicate an
// image or overwrite approval/name changes subsequently made in the gallery.
export async function saveMeasuredRoomRendering(
  projectId: string,
  roomId: string,
  jobId: string,
  caption: string,
  approve: boolean,
) {
  const job = await loadFinishedPhoto(projectId, roomId, jobId);
  const path = `${roomId}/rendering/measured-${job.id}.png`;
  const { data: asset } = supabaseAdmin.storage.from(ROOM_IMAGE_BUCKET).getPublicUrl(path);
  const existing = await supabaseAdmin
    .from("room_images")
    .select("*")
    .eq("id", job.id)
    .maybeSingle();
  if (existing.error) throw existing.error;
  const verify = (record: NonNullable<typeof existing.data>) => {
    if (record.room_id !== roomId || record.kind !== "rendering" || record.url !== asset.publicUrl)
      throw new ProjectAccessError("This saved rendering does not match the selected image.", 409);
    return record;
  };
  if (existing.data) return { rendering: verify(existing.data), alreadySaved: true };
  const bytes = await readAsset(projectId, roomId, job.imagePath!, 20 * 1024 * 1024);
  if (imageMime(bytes) !== "image/png")
    throw new ProjectAccessError("The completed image is not a PNG.", 400);
  const { error } = await supabaseAdmin.storage.from(ROOM_IMAGE_BUCKET).upload(path, bytes, {
    contentType: "image/png",
    cacheControl: "31536000",
    upsert: false,
  });
  if (error && !/already exists|duplicate/i.test(error.message)) throw error;
  const parent = job.parentJobId
    ? await supabaseAdmin
        .from("room_images")
        .select("id")
        .eq("id", job.parentJobId)
        .eq("room_id", roomId)
        .eq("kind", "rendering")
        .maybeSingle()
    : null;
  if (parent?.error) throw parent.error;
  const result = await supabaseAdmin.from("room_images").upsert(
    {
      id: job.id,
      room_id: roomId,
      kind: "rendering",
      url: asset.publicUrl,
      caption,
      status: "complete",
      is_approved: approve,
      review_status: approve ? "approved" : "draft",
      presentation_visible: true,
      revision_parent_id: parent?.data?.id || null,
      revision_number: job.revisionNumber || 1,
      revision_notes: job.revisionNotes || null,
    },
    { onConflict: "id", ignoreDuplicates: true },
  );
  if (result.error) throw result.error;
  const saved = await supabaseAdmin.from("room_images").select("*").eq("id", job.id).single();
  if (saved.error) throw saved.error;
  return { rendering: verify(saved.data), alreadySaved: false };
}
