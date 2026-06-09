import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { inferMaterialCategory, toProductCategory } from "@/lib/roomTemplates";

const PRODUCT_IMAGE_BUCKET = "product-images";
const BACKGROUND_REMOVED_BUCKET = "background-removed-images";
const MAX_REMOTE_IMAGE_BYTES = 20 * 1024 * 1024;
const BOARD_WIDTH = 1400;
const BOARD_HEIGHT = 900;

type BoardElement = {
  id: string;
  type: "image" | "text" | "shape";
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  zIndex: number;
  src?: string;
  originalSrc?: string;
  backgroundRemovedUrl?: string | null;
  autoRemoveBackground?: boolean;
  backgroundRemovalStatus?: "pending" | "processing" | "complete" | "failed";
  label?: string;
  notes?: string;
  link?: string;
  productId?: string | null;
  productName?: string | null;
  vendor?: string | null;
  price?: string | null;
  finish?: string | null;
  materialCategory?: string | null;
  materialQuantity?: number | null;
  materialFinish?: string | null;
  materialDimensions?: string | null;
  visible?: boolean;
};

type BoardPage = {
  id: string;
  title: string;
  roomId: string | null;
  elements: BoardElement[];
};

type BoardState = {
  pages: BoardPage[];
  selectedPageId: string;
  comments?: unknown[];
  versions?: unknown[];
};

type ExtensionProductPayload = {
  projectId?: string;
  boardPageId?: string;
  sourcePageUrl?: string;
  imageUrl?: string;
  imageDataUrl?: string;
  imageWidth?: number;
  imageHeight?: number;
  product?: {
    name?: string;
    vendor?: string;
    manufacturer?: string;
    sku?: string;
    price?: string;
    colorFinish?: string;
    dimensions?: string;
    description?: string;
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

function transformUrl(src: string, width: number, height: number, quality: number) {
  try {
    const url = new URL(src);
    const marker = "/storage/v1/object/public/";
    const index = url.pathname.indexOf(marker);
    if (index === -1) return src;
    url.pathname =
      url.pathname.slice(0, index) +
      "/storage/v1/render/image/public/" +
      url.pathname.slice(index + marker.length);
    url.search = "";
    url.searchParams.set("width", String(width));
    url.searchParams.set("height", String(height));
    url.searchParams.set("resize", "contain");
    url.searchParams.set("quality", String(quality));
    return url.toString();
  } catch {
    return src;
  }
}

function normalizeBoardState(value: unknown): BoardState {
  const candidate = value && typeof value === "object" ? (value as Partial<BoardState>) : {};
  const pages = Array.isArray(candidate.pages)
    ? candidate.pages
        .map((page, index) => {
          if (!page || typeof page !== "object") return null;
          const typed = page as Partial<BoardPage>;
          return {
            id: typeof typed.id === "string" && typed.id ? typed.id : crypto.randomUUID(),
            title: typeof typed.title === "string" ? typed.title : `Design Board ${index + 1}`,
            roomId: typeof typed.roomId === "string" && typed.roomId ? typed.roomId : null,
            elements: Array.isArray(typed.elements)
              ? typed.elements.filter((element) => element && typeof element === "object") as BoardElement[]
              : [],
          };
        })
        .filter((page): page is BoardPage => Boolean(page))
    : [];

  const safePages = pages.length
    ? pages
    : [{ id: "board-1", title: "Design Board 1", roomId: null, elements: [] }];
  const selectedPageId =
    typeof candidate.selectedPageId === "string" &&
    safePages.some((page) => page.id === candidate.selectedPageId)
      ? candidate.selectedPageId
      : safePages[0].id;
  return {
    pages: safePages,
    selectedPageId,
    comments: Array.isArray(candidate.comments) ? candidate.comments : [],
    versions: Array.isArray(candidate.versions) ? candidate.versions : [],
  };
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

    const state = normalizeBoardState((existing as any)?.board_state);
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
          const sourcePageUrl = normalizeUrl(payload.sourcePageUrl);
          const imageUrl = normalizeUrl(payload.imageUrl);
          const imageData = parseImageDataUrl(payload.imageDataUrl);
          if (!projectId) return json({ error: "Choose a Studio project in the extension settings." }, 400);
          if (!sourcePageUrl) return json({ error: "Product URL is required." }, 400);
          if (!imageUrl && !imageData) return json({ error: "Product image is required." }, 400);

          const { data: project } = await supabaseAdmin
            .from("projects")
            .select("id")
            .eq("id", projectId)
            .maybeSingle();
          if (!project) return json({ error: "Studio project was not found." }, 404);

          const productData = payload.product ?? {};
          const productName =
            firstText(productData.name) || firstText(hostName(sourcePageUrl), "Imported product");
          const vendor = firstText(productData.vendor, productData.manufacturer, hostName(sourcePageUrl));
          const finish = firstText(productData.colorFinish);
          const dimensions = firstText(productData.dimensions);
          const manufacturer = firstText(productData.manufacturer);
          const sku = firstText(productData.sku);
          const price = firstText(productData.price);
          const description = firstText(productData.description);
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
          const reviewNotes = [
            manufacturer ? `Manufacturer: ${manufacturer}` : "",
            `Original product page: ${sourcePageUrl}`,
            imageUrl ? `Original image URL: ${imageUrl}` : "",
            `Original image file: ${originalUpload.publicUrl}`,
            backgroundRemovedUrl
              ? `Background removed image: ${backgroundRemovedUrl}`
              : "Background removal queued for Studio design board.",
          ]
            .filter(Boolean)
            .join("\n");

          const { data: existingProduct } = await supabaseAdmin
            .from("products")
            .select("*")
            .eq("product_url", sourcePageUrl)
            .maybeSingle();

          const productPatch = {
            name: productName,
            category,
            subcategory: null,
            vendor: vendor || null,
            product_url: sourcePageUrl,
            image_url: imageForProduct,
            finish: finish || null,
            sku: sku || null,
            dimensions: dimensions || null,
            price: price || null,
            description: description || null,
            notes: reviewNotes,
          };

          const { data: product, error: productError } = existingProduct
            ? await supabaseAdmin
                .from("products")
                .update(productPatch as any)
                .eq("id", (existingProduct as any).id)
                .select()
                .single()
            : await supabaseAdmin.from("products").insert(productPatch as any).select().single();
          if (productError || !product) {
            throw productError ?? new Error("Could not create product.");
          }

          const imageSize = fitBoardImage(payload.imageWidth, payload.imageHeight);
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
                const placement = nextBoardPlacement(page.elements, imageSize.width, imageSize.height);
                const maxZ = Math.max(0, ...page.elements.map((element) => element.zIndex ?? 0));
                const layer: BoardElement = {
                  id: layerId,
                  type: "image",
                  src: imageForProduct,
                  originalSrc: originalUpload.publicUrl,
                  backgroundRemovedUrl,
                  autoRemoveBackground: !backgroundRemovedUrl,
                  backgroundRemovalStatus: backgroundRemovedUrl ? "complete" : "pending",
                  label: productName,
                  notes: [description, dimensions ? `Dimensions: ${dimensions}` : ""]
                    .filter(Boolean)
                    .join("\n"),
                  link: sourcePageUrl,
                  productId: (product as any).id,
                  productName,
                  vendor: vendor || null,
                  price: price || null,
                  finish: finish || null,
                  materialCategory,
                  materialQuantity: 1,
                  materialFinish: finish || null,
                  materialDimensions: dimensions || null,
                  x: placement.x,
                  y: placement.y,
                  width: imageSize.width,
                  height: imageSize.height,
                  zIndex: maxZ + 1,
                  visible: true,
                };
                return { ...page, elements: [...page.elements, layer] };
              }),
            };
          });

          const thumbnailUrl = transformUrl(imageForProduct, 240, 240, 72);
          const previewUrl = transformUrl(imageForProduct, BOARD_WIDTH, BOARD_HEIGHT, 82);
          return json({
            ok: true,
            productId: (product as any).id,
            layerId,
            pageId: addedPageId,
            imageUrl: imageForProduct,
            originalImageUrl: originalUpload.publicUrl,
            backgroundRemovedUrl,
            thumbnailUrl,
            previewUrl,
            autoRemoveBackground: !backgroundRemovedUrl,
            warning: null,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Could not import product.";
          console.error("[Extension Import] Failed", error);
          return json({ error: message }, 500);
        }
      },
    },
  },
});
