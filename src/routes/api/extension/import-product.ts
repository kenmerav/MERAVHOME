/* eslint-disable @typescript-eslint/no-explicit-any -- Room Design pilot and design-board tables are server-only until generated Supabase types include their migrations. */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import { inferMaterialCategory, toProductCategory } from "@/lib/roomTemplates";
import { normalizeMoneyInput } from "@/lib/money";
import { parseRoomDesignQuantity } from "@/lib/roomDesignQuantity";
import { extensionOrderEstimate, parseExtensionSelectionReview } from "@/lib/extensionSelectionReview";
import { extensionRoomWorkflow, extensionSelectionRevision } from "@/lib/extensionSelectionRevision.server";
import { extensionImportDestination } from "@/lib/extensionDestination";
import { normalizeExtensionBoardState, type ExtensionBoardState } from "@/lib/extensionBoardState";
import {
  extensionBoardDirectSelection,
  extensionBoardPageRoom,
  placeLinkedExtensionSelection,
  type ExtensionImportLayer,
} from "@/lib/extensionRoomBoardImport";
import {
  mergeExtensionProductIntoRoomDesignWorkflow,
  roomDesignBoardElementId,
  roomDesignRoomNamesMatch,
} from "@/lib/roomDesignWorkflow";

const PRODUCT_IMAGE_BUCKET = "product-images";
const BACKGROUND_REMOVED_BUCKET = "background-removed-images";
const MAX_REMOTE_IMAGE_BYTES = 20 * 1024 * 1024;
const BOARD_WIDTH = 1400;
const BOARD_HEIGHT = 900;

type BoardElement = ExtensionImportLayer;
type BoardState = ExtensionBoardState<BoardElement>;
type Room = { id: string; name: string };

type ExtensionProductPayload = {
  projectId?: string;
  boardPageId?: string;
  destination?: "design_board" | "room_design";
  roomId?: string;
  roomName?: string;
  requiredItemKey?: string;
  quantity?: number | "TBD" | null;
  sourcePageUrl?: string;
  imageUrl?: string;
  imageDataUrl?: string;
  imageWidth?: number;
  imageHeight?: number;
  review?: unknown;
  itemRevision?: string;
  product?: {
    name?: string;
    vendor?: string;
    manufacturer?: string;
    sku?: string;
    price?: string;
    colorFinish?: string;
    dimensions?: string;
    category?: string;
  };
};

function corsHeaders() {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
  };
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: corsHeaders() });
}

function assertExtensionAuth(request: Request) {
  const configuredToken = process.env.MERAV_EXTENSION_TOKEN;
  if (!configuredToken) {
    throw new Error("MERAV_EXTENSION_TOKEN is not configured in Studio.");
  }

  const header = request.headers.get("authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token || token !== configuredToken) {
    return false;
  }
  return true;
}

function cleanText(value: unknown) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function firstText(...values: unknown[]) {
  return values.map(cleanText).find(Boolean) ?? "";
}

function compactObject<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(
    Object.entries(value).filter(([, fieldValue]) => {
      if (fieldValue == null) return false;
      if (typeof fieldValue === "string") return fieldValue.trim().length > 0;
      return true;
    }),
  ) as Partial<T>;
}

function isSafeColorFinish(value: unknown) {
  const text = cleanText(value);
  if (!text || text.length > 80) return false;
  const normalized = text
    .toLowerCase()
    .replace(/[.\s_-]+/g, " ")
    .trim();
  const exactNonColors = new Set([
    "united states",
    "united states of america",
    "usa",
    "us",
    "canada",
    "mexico",
    "australia",
    "new zealand",
    "united kingdom",
    "privacy policy",
    "terms and conditions",
    "customer service",
    "sign in",
    "create account",
    "add to cart",
    "in stock",
    "out of stock",
  ]);
  if (exactNonColors.has(normalized)) return false;
  if (
    /variant\s*filters?|clearvariantfilters|selectedvariant/i.test(normalized.replace(/\s+/g, ""))
  ) {
    return false;
  }
  if (
    /\b(country|currency|language|region|shipping|delivery|pickup|store|zip code|postal code)\b/i.test(
      text,
    )
  ) {
    return false;
  }
  if (
    /\$|sku|item #|model|mpn|qty|quantity|dimensions|overall|width|height|depth|length/i.test(text)
  ) {
    return false;
  }
  if (/\d+\s*(?:"|in\.?|inch|cm|mm|ft)\b/i.test(text)) return false;
  return /[a-z]/i.test(text);
}

function normalizeProductIdentity(value: unknown) {
  return cleanText(value).toLowerCase();
}

function normalizeUrl(value: unknown) {
  const text = cleanText(value);
  if (!text) return "";
  try {
    return new URL(text).toString();
  } catch {
    return "";
  }
}

function parseImageDataUrl(value: unknown) {
  const text = cleanText(value);
  if (!text) return null;
  const match = text.match(/^data:(image\/(?:png|jpe?g|webp));base64,([a-z0-9+/=\s]+)$/i);
  if (!match) return null;
  const buffer = Buffer.from(match[2].replace(/\s+/g, ""), "base64");
  if (!buffer.byteLength || buffer.byteLength > MAX_REMOTE_IMAGE_BYTES) return null;
  return { buffer, contentType: match[1].toLowerCase() };
}

function hostName(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function extensionForContentType(contentType: string) {
  if (/jpe?g/i.test(contentType)) return "jpg";
  if (/webp/i.test(contentType)) return "webp";
  if (/png/i.test(contentType)) return "png";
  return "png";
}

function safeFileName(value: string) {
  return (
    value
      .replace(/\.[^/.]+$/, "")
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase() || "product"
  );
}

async function ensureImageBucket(
  bucket: string,
  allowedMimeTypes: string[] = ["image/png", "image/jpeg", "image/webp"],
) {
  const { data } = await supabaseAdmin.storage.getBucket(bucket);
  if (data) {
    const { error } = await supabaseAdmin.storage.updateBucket(bucket, {
      public: true,
      fileSizeLimit: MAX_REMOTE_IMAGE_BYTES,
      allowedMimeTypes,
    });
    if (error) throw error;
    return;
  }

  const { error } = await supabaseAdmin.storage.createBucket(bucket, {
    public: true,
    fileSizeLimit: MAX_REMOTE_IMAGE_BYTES,
    allowedMimeTypes,
  });
  if (error && !/already exists/i.test(error.message)) throw error;
}

async function downloadImage(imageUrl: string) {
  const response = await fetch(imageUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) MERAV-Studio-Product-Importer/1.0",
      Referer: new URL(imageUrl).origin,
    },
  });
  if (!response.ok) throw new Error(`Could not download product image (${response.status}).`);

  const contentType = response.headers.get("content-type")?.split(";")[0].toLowerCase() ?? "";
  if (!contentType.startsWith("image/")) {
    throw new Error("Selected image URL did not return an image.");
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > MAX_REMOTE_IMAGE_BYTES) {
    throw new Error("Product image is too large to import.");
  }
  return { buffer, contentType };
}

async function uploadPublicImage({
  bucket,
  projectId,
  buffer,
  contentType,
  name,
}: {
  bucket: string;
  projectId: string;
  buffer: Buffer;
  contentType: string;
  name: string;
}) {
  await ensureImageBucket(bucket, bucket === BACKGROUND_REMOVED_BUCKET ? ["image/png"] : undefined);
  const extension = extensionForContentType(contentType);
  const path = `${projectId}/${Date.now()}-${crypto.randomUUID()}-${safeFileName(name)}.${extension}`;
  const { error } = await supabaseAdmin.storage.from(bucket).upload(path, buffer, {
    contentType,
    cacheControl: "31536000",
    upsert: false,
  });
  if (error) throw error;
  const { data } = supabaseAdmin.storage.from(bucket).getPublicUrl(path);
  return { publicUrl: data.publicUrl, path };
}

function dataUrlFromBuffer(buffer: Buffer, contentType: string) {
  return `data:${contentType};base64,${buffer.toString("base64")}`;
}

async function tryFreeBackgroundRemoval(buffer: Buffer, contentType: string) {
  try {
    const { removeBackground } = await import("@imgly/background-removal");
    const result = await removeBackground(dataUrlFromBuffer(buffer, contentType), {
      device: "cpu",
      model: "isnet_fp16",
      output: {
        format: "image/png",
        quality: 1,
        type: "foreground",
      },
    });
    return Buffer.from(await result.arrayBuffer());
  } catch (error) {
    console.error("[Extension Import] Background removal failed", error);
    return null;
  }
}

function nextBoardPlacement(elements: BoardElement[], width: number, height: number) {
  const margin = 40;
  const step = 28;
  const maxX = BOARD_WIDTH - width - margin;
  const maxY = BOARD_HEIGHT - height - margin;
  for (let y = margin; y <= maxY; y += step) {
    for (let x = BOARD_WIDTH - width - margin; x >= margin; x -= step) {
      const overlaps = elements.some((element) => {
        if (element.visible === false) return false;
        return !(
          x + width < element.x ||
          x > element.x + element.width ||
          y + height < element.y ||
          y > element.y + element.height
        );
      });
      if (!overlaps) return { x, y };
    }
  }
  return {
    x: Math.max(margin, maxX),
    y: Math.max(margin, Math.min(maxY, margin + elements.length * step)),
  };
}

function fitBoardImage(width?: number, height?: number) {
  const naturalWidth = width && width > 0 ? width : 800;
  const naturalHeight = height && height > 0 ? height : 800;
  const maxWidth = 280;
  const maxHeight = 260;
  const scale = Math.min(maxWidth / naturalWidth, maxHeight / naturalHeight, 1);
  return {
    width: Math.round(naturalWidth * scale),
    height: Math.round(naturalHeight * scale),
  };
}

async function saveBoardWithRetry(projectId: string, updater: (state: BoardState) => BoardState) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { data: existing, error } = await supabaseAdmin
      .from("design_boards" as any)
      .select("*")
      .eq("project_id", projectId)
      .maybeSingle();
    if (error) throw error;

    const state = normalizeExtensionBoardState<BoardElement>((existing as any)?.board_state);
    const nextState = updater(state);

    if (!existing) {
      const { data, error: insertError } = await supabaseAdmin
        .from("design_boards" as any)
        .insert({ project_id: projectId, board_state: nextState } as any)
        .select()
        .single();
      if (insertError && /duplicate key|already exists/i.test(insertError.message)) continue;
      if (insertError) throw insertError;
      return data;
    }

    const { data, error: updateError } = await supabaseAdmin
      .from("design_boards" as any)
      .update({ board_state: nextState } as any)
      .eq("project_id", projectId)
      .eq("updated_at", (existing as any).updated_at)
      .select()
      .maybeSingle();
    if (updateError) throw updateError;
    if (data) return data;
  }
  throw new Error("Could not save design board because it changed at the same time. Try again.");
}

class ExtensionSelectionConflict extends Error {
  constructor() {
    super("This item changed in Studio. Reopen the extension and review the latest selection.");
  }
}

async function readExtensionBoard(projectId: string) {
  const { data, error } = await supabaseAdmin.from("design_boards" as any)
    .select("board_state,updated_at").eq("project_id", projectId).maybeSingle();
  if (error) throw error;
  return {
    state: normalizeExtensionBoardState<BoardElement>((data as any)?.board_state),
    updatedAt: (data as any)?.updated_at ?? null,
  };
}

async function saveLinkedExtensionImport({
  projectId,
  projectName,
  room,
  rooms,
  requiredItemKey,
  pageId,
  itemRevision,
  product,
  layer,
}: {
  projectId: string;
  projectName: string;
  room: Room;
  rooms: Room[];
  requiredItemKey: string;
  pageId?: string;
  itemRevision?: string;
  product: Parameters<typeof mergeExtensionProductIntoRoomDesignWorkflow>[0]["product"];
  layer: Omit<BoardElement, "id" | "x" | "y" | "zIndex">;
}) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const [board, { data: workflow, error }] = await Promise.all([
      readExtensionBoard(projectId),
      supabaseAdmin.from("room_design_workflows" as any).select("state,updated_at")
        .eq("project_id", projectId).eq("room_id", room.id).maybeSingle(),
    ]);
    if (error) throw error;

    const state = extensionRoomWorkflow(room.name, (workflow as any)?.state);
    if (itemRevision && extensionSelectionRevision(state, requiredItemKey) !== itemRevision)
      throw new ExtensionSelectionConflict();
    const reviewed = pageId ? null : mergeExtensionProductIntoRoomDesignWorkflow({
      state, itemKey: requiredItemKey, product,
    });
    const merged = reviewed ? { ...reviewed, itemKey: reviewed.item.id } : extensionBoardDirectSelection({
      state, product, materialCategory: layer.materialCategory || "", roomId: room.id,
      board: board.state, pageId: pageId!,
    });
    const selection = merged.selection;
    const boardImport = placeLinkedExtensionSelection({
      board: board.state, room, rooms, projectName, pageId, selection,
      layer: {
        ...layer,
        productName: selection.productName,
        vendor: selection.vendor || null,
        finish: selection.finish === "Finish needs review" ? null : selection.finish,
        price: selection.price || null,
        link: selection.url,
        sku: selection.sku || null,
        materialFinish: selection.finish === "Finish needs review" ? null : selection.finish,
        materialDimensions: selection.dimensions || null,
      },
      placement: (elements) => nextBoardPlacement(elements, layer.width, layer.height),
    });
    const layerIds = new Set(boardImport.board.pages.flatMap((page) => page.elements.map(({ id }) => id)));
    const boardReady = merged.state.selections.every((item) =>
      item.state === "draft" || layerIds.has(roomDesignBoardElementId(room.id, item.id)),
    );
    const { error: saveError } = await supabaseAdmin.rpc("save_extension_room_and_board", {
      p_project_id: projectId,
      p_room_id: room.id,
      p_board_updated_at: board.updatedAt,
      p_room_updated_at: (workflow as any)?.updated_at ?? null,
      p_board_state: boardImport.board as Json,
      p_room_state: { ...merged.state, boardReady },
      p_event_details: {
        requiredItemKey: merged.itemKey,
        requiredItemLabel: selection.category,
        productId: product.id,
        replaced: reviewed?.replaced ?? false,
        boardPageId: boardImport.page.id,
        boardLayerId: boardImport.layerId,
      },
    });
    if (saveError?.code === "40001") continue;
    if (saveError) throw new Error(saveError.message);

    return { ...boardImport, itemKey: merged.itemKey, selection, reviewed };
  }
  throw new Error("The board or room changed during import. Open the extension and try again.");
}

export const Route = createFileRoute("/api/extension/import-product")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders() }),
      POST: async ({ request }) => {
        try {
          if (!assertExtensionAuth(request)) {
            return json({ error: "Extension import is not authorized." }, 401);
          }

          const payload = (await request.json()) as ExtensionProductPayload;
          const projectId = cleanText(payload.projectId);
          const boardPageId = cleanText(payload.boardPageId);
          const roomId = cleanText(payload.roomId);
          const roomName = cleanText(payload.roomName);
          const requiredItemKey = cleanText(payload.requiredItemKey);
          let quantity: number | null;
          try { quantity = parseRoomDesignQuantity(payload.quantity); }
          catch { return json({ error: "Enter a positive quantity or TBD." }, 400); }
          const sourcePageUrl = normalizeUrl(payload.sourcePageUrl);
          const imageUrl = normalizeUrl(payload.imageUrl);
          const imageData = parseImageDataUrl(payload.imageDataUrl);
          if (!projectId)
            return json({ error: "Choose a Studio project in the extension settings." }, 400);
          if (!sourcePageUrl) return json({ error: "Product URL is required." }, 400);
          if (!imageUrl && !imageData) return json({ error: "Product image is required." }, 400);

          const { data: project } = await supabaseAdmin
            .from("projects")
            .select("id,name")
            .eq("id", projectId)
            .maybeSingle();
          if (!project) return json({ error: "Studio project was not found." }, 404);
          const {data: enrollment,error: enrollmentError} = await supabaseAdmin
            .from("room_design_projects" as any).select("project_id").eq("project_id",projectId).maybeSingle();
          if (enrollmentError) throw enrollmentError;
          let destination: "room_design" | "design_board";
          try {
            destination = extensionImportDestination({ destination: payload.destination, roomId, requiredItemKey },
              Boolean(enrollment));
          } catch (error) {
            return json({ error: error instanceof Error ? error.message : "Choose an import destination." }, 400);
          }
          if (destination === "room_design" && !roomId)
            return json({ error: "Choose a room before adding the product." }, 400);
          if (destination === "room_design" && !requiredItemKey)
            return json({ error: "Choose a product type before adding the product." }, 400);

          let linkedRoom: Room | undefined;
          let rooms: Room[] = [];
          let linkedBoardPageId: string | undefined;
          if (enrollment) {
            const [{ data: featureFlag, error: flagError }, { data: projectRooms, error: roomsError }] =
              await Promise.all([
                supabaseAdmin.from("studio_feature_flags" as any).select("enabled")
                  .eq("key", "room_design_v2").maybeSingle(),
                supabaseAdmin.from("rooms").select("id,name").eq("project_id", projectId),
              ]);
            if (flagError || roomsError) throw flagError || roomsError;
            if ((featureFlag as any)?.enabled === true) {
              rooms = projectRooms ?? [];
              if (destination === "room_design") {
                linkedRoom = rooms.find((room) => room.id === roomId);
                if (!linkedRoom)
                  return json({ error: "That room does not belong to the selected project." }, 400);
                if (!roomDesignRoomNamesMatch(roomName, linkedRoom.name))
                  return json({ error: "The room changed. Reopen the extension and select the room again." }, 409);
              } else {
                const { state: board } = await readExtensionBoard(projectId);
                const page = board.pages.find((page) => page.id === (boardPageId || board.selectedPageId));
                if (!page) return json({ error: "That board page changed. Select a page again in the extension." }, 409);
                linkedRoom = extensionBoardPageRoom(page, rooms);
                if (!linkedRoom)
                  return json({ error: "Assign this board page to a room in Studio, or use Room Design Selections to choose a room." }, 400);
                linkedBoardPageId = page.id;
              }
            }
          }
          if (destination === "room_design" && !linkedRoom)
            return json({ error: "This project is not using the new Room Design process." }, 400);

          let review: ReturnType<typeof parseExtensionSelectionReview> | undefined;
          let itemRevision: string | undefined;
          if (destination === "room_design" && payload.review !== undefined) {
            itemRevision = cleanText(payload.itemRevision);
            if (!/^[a-f\d]{64}$/.test(itemRevision))
              return json({ error: "Reload the room before reviewing this selection." }, 400);
            try {
              review = parseExtensionSelectionReview(payload.review, quantity);
            } catch (error) {
              return json({ error: error instanceof Error ? error.message : "Check the selection details." }, 400);
            }
          }
          if (linkedRoom && review) {
            const { data: workflow, error: workflowError } = await supabaseAdmin
              .from("room_design_workflows" as any)
              .select("state")
              .eq("project_id", projectId)
              .eq("room_id", roomId)
              .maybeSingle();
            if (workflowError) throw workflowError;
            const state = extensionRoomWorkflow(linkedRoom.name, (workflow as any)?.state);
            if (extensionSelectionRevision(state, requiredItemKey) !== itemRevision)
              throw new ExtensionSelectionConflict();
            if (state.selections.some((item) => item.id === `link-${requiredItemKey}` && item.accuracySource))
              return json({ error: "Review this versioned selection in Room Design before replacing it." }, 409);
          }

          const productData = payload.product ?? {};
          const productName =
            firstText(productData.name) || firstText(hostName(sourcePageUrl), "Imported product");
          const vendor = firstText(
            productData.vendor,
            productData.manufacturer,
            hostName(sourcePageUrl),
          );
          const rawFinish = firstText(productData.colorFinish);
          const finish = isSafeColorFinish(rawFinish) ? rawFinish : "";
          const dimensions = firstText(productData.dimensions);
          const sku = firstText(productData.sku);
          const price = review
            ? review.confirmed && review.purchase.priceType === "Retail" &&
              ["sq ft", "each"].includes(review.purchase.priceUnit)
              ? review.purchase.unitPrice || null
              : null
            : normalizeMoneyInput(firstText(productData.price));
          const materialCategory = inferMaterialCategory(
            `${productName} ${productData.category ?? ""}`,
            sourcePageUrl,
          );
          const category = toProductCategory(materialCategory);

          const downloadedImage = imageData ?? (await downloadImage(imageUrl));
          const originalUpload = await uploadPublicImage({
            bucket: PRODUCT_IMAGE_BUCKET,
            projectId,
            buffer: downloadedImage.buffer,
            contentType: downloadedImage.contentType,
            name: productName,
          });

          const cutoutBuffer = await tryFreeBackgroundRemoval(
            downloadedImage.buffer,
            downloadedImage.contentType,
          );
          let backgroundRemovedUrl: string | null = null;
          if (cutoutBuffer) {
            const cutoutUpload = await uploadPublicImage({
              bucket: BACKGROUND_REMOVED_BUCKET,
              projectId,
              buffer: cutoutBuffer,
              contentType: "image/png",
              name: `${productName}-cutout`,
            });
            backgroundRemovedUrl = cutoutUpload.publicUrl;
          }

          const imageForProduct = backgroundRemovedUrl || originalUpload.publicUrl;

          const { data: existingProducts } = await supabaseAdmin
            .from("products")
            .select("*")
            .eq("product_url", sourcePageUrl)
            .limit(25);
          const normalizedProductName = normalizeProductIdentity(productName);
          const normalizedFinish = normalizeProductIdentity(finish);
          const normalizedDimensions = normalizeProductIdentity(dimensions);
          const normalizedSku = normalizeProductIdentity(sku);
          const existingProduct =
            (existingProducts ?? []).find((candidate: any) => {
              if (normalizeProductIdentity(candidate.name) !== normalizedProductName) return false;
              const candidateSku = normalizeProductIdentity(candidate.sku);
              if (review && candidateSku !== normalizedSku) return false;
              const candidateFinish = normalizeProductIdentity(candidate.finish);
              if (normalizedFinish && candidateFinish && candidateFinish !== normalizedFinish) {
                return false;
              }

              const candidateDimensions = normalizeProductIdentity(candidate.dimensions);
              if (
                normalizedDimensions &&
                candidateDimensions &&
                candidateDimensions !== normalizedDimensions
              ) {
                return false;
              }

              return true;
            }) ?? null;

          const productInsert = {
            name: productName,
            category,
            subcategory: null,
            vendor: vendor || null,
            product_url: sourcePageUrl,
            image_url: imageForProduct,
            finish: finish || null,
            sku: sku || null,
            dimensions: dimensions || null,
            price,
            ...(review && price ? { price_unit: review.purchase.priceUnit === "sq ft" ? "sq_ft" : "unit" } : {}),
            description: null,
            notes: null,
          };
          const productUpdate = compactObject({
            name: productName,
            vendor,
            product_url: sourcePageUrl,
            finish,
            sku,
            dimensions,
            price: review ? null : price,
          });

          const { data: product, error: productError } = existingProduct
            ? await supabaseAdmin
                .from("products")
                .update(productUpdate as any)
                .eq("id", (existingProduct as any).id)
                .select()
                .single()
            : await supabaseAdmin
                .from("products")
                .insert(productInsert as any)
                .select()
                .single();
          if (productError || !product) {
            throw productError ?? new Error("Could not create product.");
          }

          const colorWarning =
            rawFinish && !finish
              ? `Product imported, but Studio skipped "${rawFinish}" because it did not look like a real color/finish.`
              : !finish
                ? "Product imported. Color/finish was not detected, so review it in Room Design or Board Tools."
                : null;

          const imageSize = fitBoardImage(payload.imageWidth, payload.imageHeight);
          const layer: Omit<BoardElement, "id" | "x" | "y" | "zIndex"> = {
            type: "image",
            src: imageForProduct,
            originalSrc: originalUpload.publicUrl,
            backgroundRemovedUrl,
            autoRemoveBackground: !backgroundRemovedUrl,
            backgroundRemovalStatus: backgroundRemovedUrl ? "complete" : "pending",
            label: productName,
            notes: "",
            link: sourcePageUrl,
            productId: (product as any).id,
            productName,
            vendor: vendor || null,
            price: price || null,
            finish: finish || null,
            materialCategory,
            materialQuantity: null,
            materialQuantityTbd: true,
            materialFinish: finish || null,
            materialDimensions: dimensions || null,
            ...imageSize,
            visible: true,
          };
          if (linkedRoom) {
            const merged = await saveLinkedExtensionImport({
              projectId,
              projectName: project.name,
              room: linkedRoom,
              rooms,
              requiredItemKey,
              pageId: linkedBoardPageId,
              itemRevision,
              layer,
              product: {
                id: (product as any).id,
                name: productName,
                vendor: vendor || "",
                manufacturer: firstText(productData.manufacturer),
                finish,
                sourcePageUrl,
                imageUrl: imageForProduct,
                originalImageUrl: originalUpload.publicUrl,
                price: price || "",
                sku,
                dimensions,
                sizeOptions: (product as any).size_options || undefined,
                selectedSize: (product as any).selected_size || undefined,
                quantity,
                review,
              },
            });
            return json({
              ok: true,
              destination,
              productId: (product as any).id,
              roomId: linkedRoom.id,
              roomName: linkedRoom.name,
              requiredItemKey: merged.itemKey,
              requiredItemLabel: merged.selection.category,
              nextItemId: merged.reviewed?.nextItem?.id || null,
              nextItemLabel: merged.reviewed?.nextItem?.category || null,
              replaced: merged.reviewed?.replaced ?? false,
              layerId: merged.layerId,
              pageId: merged.page.id,
              boardPageTitle: merged.page.title,
              imageUrl: imageForProduct,
              originalImageUrl: originalUpload.publicUrl,
              backgroundRemovedUrl,
              price: price || null,
              warning: colorWarning,
              reviewed: merged.selection.state === "locked",
              issues: merged.reviewed?.issues || [],
              orderEstimate: extensionOrderEstimate(merged.selection),
              message: `${productName} saved to ${merged.page.title} and ${linkedRoom.name} room selections.`,
              openUrl: `/projects/${projectId}/room-design?roomId=${linkedRoom.id}`,
            });
          }

          const layerId = crypto.randomUUID();
          let addedPageId = "";
          await saveBoardWithRetry(projectId, (state) => {
            const selectedPageId = state.pages.some((page) => page.id === boardPageId)
              ? boardPageId
              : state.selectedPageId;
            return {
              ...state,
              pages: state.pages.map((page) => {
                if (page.id !== selectedPageId) return page;
                addedPageId = page.id;
                const placement = nextBoardPlacement(
                  page.elements,
                  imageSize.width,
                  imageSize.height,
                );
                const maxZ = Math.max(0, ...page.elements.map((element) => element.zIndex ?? 0));
                const element: BoardElement = {
                  ...layer,
                  id: layerId,
                  x: placement.x,
                  y: placement.y,
                  zIndex: maxZ + 1,
                };
                return { ...page, elements: [...page.elements, element] };
              }),
            };
          });

          // Keep extension responses compatible with existing callers without
          // creating Supabase image transformation URLs. Stored derivative files
          // can replace these later, but dynamic transforms are too expensive
          // for design-board-heavy workflows.
          const thumbnailUrl = imageForProduct;
          const previewUrl = imageForProduct;
          return json({
            ok: true,
            destination,
            productId: (product as any).id,
            layerId,
            pageId: addedPageId,
            imageUrl: imageForProduct,
            originalImageUrl: originalUpload.publicUrl,
            backgroundRemovedUrl,
            thumbnailUrl,
            previewUrl,
            autoRemoveBackground: !backgroundRemovedUrl,
            price: price || null,
            warning: colorWarning,
          });
        } catch (error) {
          if (error instanceof ExtensionSelectionConflict) return json({ error: error.message }, 409);
          const message = error instanceof Error ? error.message : "Could not import product.";
          console.error("[Extension Import] Failed", error);
          return json({ error: message }, 500);
        }
      },
    },
  },
});
