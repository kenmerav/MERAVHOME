import { randomUUID } from "node:crypto";
import { z } from "zod";
import { start } from "workflow/api";
import { measuredRenderingWorkflow } from "@/workflows/measuredRendering";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  ProjectAccessError,
  boundedJson,
  privateJson,
  accessFailure,
} from "./measuredAccess.server";
import {
  MEASURED_BUCKET,
  measuredContext,
  scopedId,
  scopedAsset,
  scopePath,
  jobPath,
  sceneSignature,
  readStored,
  writeStored,
  listRecords,
  loadScene,
  publicScene,
  signedAsset,
  readAsset,
  imageMime,
  saveCloudScene,
  failCloudJob,
  type CloudJob,
  type CloudScene,
} from "./measuredCloud.server";

export async function measuredApi(request: Request) {
  try {
    const url = new URL(request.url);
    if (url.searchParams.has("local") || url.searchParams.has("asset"))
      throw new ProjectAccessError("Local fixtures are not available on live Studio.", 404);
    const projectId = scopedId.parse(url.searchParams.get("projectId"));
    const roomValue = url.searchParams.get("roomId"),
      roomId = roomValue ? scopedId.parse(roomValue) : undefined;
    const context = await measuredContext(request, projectId, roomId);
    if (request.method === "GET") {
      if (!roomId)
        return privateJson({ projectName: context.projectName, rooms: context.rooms, items: [] });
      const jobId = url.searchParams.get("job");
      if (jobId) {
        const job = await readStored<CloudJob>(jobPath(projectId, roomId, jobId));
        if (!job || job.projectId !== projectId || job.roomId !== roomId)
          throw new ProjectAccessError("Rendering job not found.", 404);
        return privateJson({
          ...job,
          items: undefined,
          prompt: undefined,
          imageUrl: job.imagePath ? await signedAsset(projectId, roomId, job.imagePath) : null,
          scene: job.resultSceneId
            ? await publicScene(
                await loadScene(projectId, roomId, job.resultSceneId),
                context.items,
              )
            : null,
        });
      }
      const id = url.searchParams.get("scene");
      const scenes = await listRecords<CloudScene>(projectId, roomId, "scenes");
      const selected = id ? await loadScene(projectId, roomId, id) : scenes[0];
      const jobs = await listRecords<CloudJob>(projectId, roomId, "jobs");
      return privateJson({
        projectName: context.projectName,
        rooms: context.rooms,
        items: context.items,
        scene: selected ? await publicScene(selected, context.items) : null,
        scenes: scenes.map((s) => ({ id: s.id, name: s.elevation.name, createdAt: s.createdAt })),
        jobs: await Promise.all(
          jobs.map(async (j) => ({
            id: j.id,
            kind: j.kind,
            status: j.status,
            createdAt: j.createdAt,
            error: j.error,
            sceneId: j.sceneId,
            imageUrl: j.imagePath ? await signedAsset(projectId, roomId, j.imagePath) : null,
          })),
        ),
        hasConnection: !!process.env.OPENAI_API_KEY,
      });
    }
    if (!roomId) throw new ProjectAccessError("Choose a room.", 400);
    const body = (await boundedJson(request, 1024 * 1024)) as any;
    if (body.action === "upload") {
      const mime = z
        .enum(["image/png", "image/jpeg", "image/webp", "model/gltf-binary"])
        .parse(body.mime);
      z.number()
        .int()
        .positive()
        .max(15 * 1024 * 1024)
        .parse(body.size);
      const ext =
        mime === "image/jpeg"
          ? "jpg"
          : mime === "image/webp"
            ? "webp"
            : mime === "model/gltf-binary"
              ? "glb"
              : "png";
      const path = `${scopePath(projectId, roomId)}/assets/${randomUUID()}.${ext}`;
      const { data, error } = await supabaseAdmin.storage
        .from(MEASURED_BUCKET)
        .createSignedUploadUrl(path);
      if (error) throw error;
      return privateJson({
        path,
        token: data.token,
        bucket: MEASURED_BUCKET,
        contentType: mime === "model/gltf-binary" ? "application/octet-stream" : mime,
      });
    }
    if (body.action === "save-camera") {
      const scene = await saveCloudScene(
        projectId,
        roomId,
        context.actor.user.id,
        context.items,
        body,
      );
      return privateJson({ scene: await publicScene(scene, context.items) });
    }
    if (body.action === "interpret" || body.action === "photoreal") {
      const id = scopedId.parse(body.operationId);
      const path = jobPath(projectId, roomId, id),
        existing = await readStored<CloudJob>(path);
      if (existing) return privateJson({ jobId: id, status: existing.status });
      const now = new Date().toISOString();
      let job: CloudJob = {
        version: 1,
        id,
        projectId,
        roomId,
        createdBy: context.actor.user.id,
        createdAt: now,
        updatedAt: now,
        kind: body.action,
        roomName: context.rooms.find((r) => r.id === roomId)?.name,
        status: "queued",
      };
      if (body.action === "interpret") {
        const sourcePath = scopedAsset(projectId, roomId, z.string().parse(body.sourcePath));
        imageMime(await readAsset(projectId, roomId, sourcePath));
        const supportPaths = z
          .array(z.string())
          .max(3)
          .parse(body.supportPaths || [])
          .map((p) => scopedAsset(projectId, roomId, p));
        for (const p of supportPaths) imageMime(await readAsset(projectId, roomId, p));
        job = { ...job, sourcePath, supportPaths, items: context.items };
      } else {
        const scene = await loadScene(projectId, roomId, scopedId.parse(body.sceneId));
        if (!scene.basePath)
          throw new ProjectAccessError("Save the measured camera view first.", 400);
        if (scene.signature !== sceneSignature(scene.elevation, context.items))
          throw new ProjectAccessError(
            "Spec Book changed. Rebuild and save the camera before generating this image.",
            409,
          );
        job = { ...job, sceneId: scene.id };
      }
      try {
        await writeStored(path, job);
      } catch (error) {
        if (/already exists|duplicate/i.test(String((error as any)?.message)))
          return privateJson({ jobId: id, status: "queued" });
        throw error;
      }
      try {
        await start(measuredRenderingWorkflow, [projectId, roomId, id]);
      } catch {
        await failCloudJob(
          projectId,
          roomId,
          id,
          "Could not start the shared rendering worker. Please retry.",
        );
        throw new ProjectAccessError("Could not start the rendering worker.", 503);
      }
      return privateJson({ jobId: id, status: "queued" }, 202);
    }
    throw new ProjectAccessError("Unknown rendering action.", 400);
  } catch (error) {
    return accessFailure(error);
  }
}
