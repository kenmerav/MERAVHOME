const IMAGE_MENU_ID = "send-image-to-merav-studio";
const PAGE_MENU_ID = "send-page-to-merav-studio";
const DEFAULT_STUDIO_URL = "https://studio.meravinteriors.com";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: IMAGE_MENU_ID,
      title: "Send to MERAV Studio",
      contexts: ["image"],
    });
    chrome.contextMenus.create({
      id: PAGE_MENU_ID,
      title: "Send current product page to MERAV Studio",
      contexts: ["page"],
    });
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;
  try {
    if (info.menuItemId === IMAGE_MENU_ID) {
      await sendImageToStudio(info, tab);
    } else if (info.menuItemId === PAGE_MENU_ID) {
      await sendCurrentTabToStudio();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not send product.";
    notify("MERAV Studio import failed", message);
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "MERAV_SEND_CURRENT_TAB") return false;
  sendCurrentTabToStudio(message.projectId, message.boardPageId)
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => {
      const message = error instanceof Error ? error.message : "Could not send product.";
      sendResponse({ ok: false, error: message });
    });
  return true;
});

async function sendCurrentTabToStudio(projectIdOverride, boardPageIdOverride) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) {
    throw new Error("Open a product page first.");
  }
  return sendImageToStudio({ pageUrl: tab.url, srcUrl: "" }, tab, projectIdOverride, boardPageIdOverride);
}

async function sendImageToStudio(info, tab, projectIdOverride, boardPageIdOverride) {
  const settings = await chrome.storage.sync.get([
    "studioUrl",
    "projectId",
    "boardPageId",
    "extensionToken",
    "lastStudioProjectId",
  ]);
  const studioUrl = normalizeStudioUrl(settings.studioUrl || DEFAULT_STUDIO_URL);
  const projectId = projectIdOverride || settings.projectId || settings.lastStudioProjectId;
  const boardPageId = boardPageIdOverride || settings.boardPageId || "";
  const extensionToken = settings.extensionToken;

  if (!projectId) {
    throw new Error("Open a MERAV design board once, or set a project ID in extension settings.");
  }
  if (!extensionToken) {
    throw new Error("Add your MERAV extension token in extension settings.");
  }

  const pageExtraction = await extractFromTab(tab.id, {
    clickedImageUrl: info.srcUrl,
    pageUrl: info.pageUrl || tab.url,
  });
  const payload = {
    ...pageExtraction,
    projectId,
    boardPageId,
    imageUrl: pageExtraction.imageUrl || info.srcUrl,
    sourcePageUrl: pageExtraction.sourcePageUrl || info.pageUrl || tab.url,
  };

  if (!payload.imageUrl) throw new Error("Could not find the product image.");
  if (!payload.sourcePageUrl) throw new Error("Could not find the product URL.");

  const imageDataUrl = await imageDataUrlFromUrl(payload.imageUrl);
  if (imageDataUrl) payload.imageDataUrl = imageDataUrl;

  const response = await fetch(`${studioUrl}/api/extension/import-product`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${extensionToken}`,
    },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.error) {
    throw new Error(body.error || `Studio import failed (${response.status}).`);
  }

  const title = body.warning ? "Imported with review needed" : "Sent to MERAV Studio";
  const message = body.warning || "Product added to the active design board page.";
  notify(title, message);
  return body;
}

async function imageDataUrlFromUrl(imageUrl) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    const response = await fetch(imageUrl, { signal: controller.signal, credentials: "include" });
    clearTimeout(timeout);
    if (!response.ok) return "";
    const contentType = response.headers.get("content-type")?.split(";")[0]?.toLowerCase() || "";
    if (!/^image\/(png|jpe?g|webp)$/.test(contentType)) return "";
    const buffer = await response.arrayBuffer();
    if (!buffer.byteLength || buffer.byteLength > 10 * 1024 * 1024) return "";
    return `data:${contentType};base64,${arrayBufferToBase64(buffer)}`;
  } catch {
    return "";
  }
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

async function extractFromTab(tabId, fallback) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: "MERAV_EXTRACT_PRODUCT",
      ...fallback,
    });
    return response || fallback;
  } catch {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: pageFallbackExtraction,
      args: [fallback],
    });
    return result || fallback;
  }
}

function normalizeStudioUrl(value) {
  return String(value || DEFAULT_STUDIO_URL).replace(/\/+$/, "");
}

function notify(title, message) {
  chrome.notifications.create({
    type: "basic",
    iconUrl: "icons/icon-128.svg",
    title,
    message,
  });
}

function pageFallbackExtraction(fallback) {
  const clean = (value) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "");
  const absoluteUrl = (value) => {
    const text = clean(value);
    if (!text) return "";
    try {
      return new URL(text, location.href).toString();
    } catch {
      return "";
    }
  };
  const meta = (name) =>
    clean(
      document.querySelector(`meta[property="${name}"]`)?.getAttribute("content") ||
        document.querySelector(`meta[name="${name}"]`)?.getAttribute("content"),
    );
  const largestImage = () => {
    let best = "";
    let bestArea = 0;
    document.querySelectorAll("img").forEach((img) => {
      const rect = img.getBoundingClientRect();
      const src = absoluteUrl(img.currentSrc || img.src);
      if (!src || rect.width < 80 || rect.height < 80) return;
      const area = rect.width * rect.height;
      if (area > bestArea) {
        best = src;
        bestArea = area;
      }
    });
    return best;
  };
  const imageUrl =
    absoluteUrl(fallback.clickedImageUrl) ||
    absoluteUrl(meta("og:image") || meta("twitter:image")) ||
    largestImage();
  return {
    sourcePageUrl: fallback.pageUrl || location.href,
    imageUrl,
    product: {
      name: meta("og:title") || document.title,
      vendor: meta("og:site_name") || location.hostname.replace(/^www\./, ""),
      description: meta("og:description") || meta("description"),
    },
  };
}
