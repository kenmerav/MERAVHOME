function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function resizeImageDataUrl(src: string, maxDimension: number) {
  return new Promise<string>((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const width = image.naturalWidth || image.width;
      const height = image.naturalHeight || image.height;
      const scale = Math.min(1, maxDimension / Math.max(width, height));
      if (scale === 1) {
        resolve(src);
        return;
      }
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      const context = canvas.getContext("2d");
      if (!context) {
        resolve(src);
        return;
      }
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/webp", 0.88));
    };
    image.onerror = () => reject(new Error("Could not prepare the product image."));
    image.src = src;
  });
}

export async function removeProductImageBackground(
  imageUrl: string,
  options: { authorization?: string; projectId?: string; roomId?: string } = {},
) {
  const response = await fetch("/api/room-design-image-source", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(options.authorization ? { Authorization: options.authorization } : {}),
    },
    body: JSON.stringify({
      imageUrl,
      projectId: options.projectId,
      roomId: options.roomId,
    }),
  });
  const result = (await response.json()) as { error?: string; sourceDataUrl?: string };
  if (!response.ok || !result.sourceDataUrl) {
    throw new Error(result.error || "Background removal failed.");
  }

  const { removeBackground } = await import("@imgly/background-removal");
  const workingImage = await resizeImageDataUrl(result.sourceDataUrl, 768);
  const cutout = await removeBackground(workingImage, {
    device: "cpu",
    model: "isnet_fp16",
    output: {
      format: "image/png",
      quality: 1,
    },
  });
  return blobToDataUrl(cutout);
}
