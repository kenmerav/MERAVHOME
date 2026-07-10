const IMAGE_MENU_ID = "send-image-to-merav-studio";
const PAGE_MENU_ID = "send-page-to-merav-studio";
const DEFAULT_STUDIO_URL = "https://studio.meravinteriors.com";
let priceQueueProcessing = false;

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
    await updateProgress(0, "", { clearBadge: true });
    notify("MERAV Studio import failed", message);
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "MERAV_SEND_CURRENT_TAB") {
    sendCurrentTabToStudio(message.projectId, message.boardPageId)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => {
        const message = error instanceof Error ? error.message : "Could not send product.";
        sendResponse({ ok: false, error: message });
      });
    return true;
  }
  if (message?.type === "MERAV_START_PRICE_QUEUE") {
    startPriceQueue(message.projectId, message.mode)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "Could not start pricing.",
        }),
      );
    return true;
  }
  if (message?.type === "MERAV_GET_PRICE_QUEUE") {
    chrome.storage.local.get(["priceQueue"], (result) => {
      if (result.priceQueue?.running) void processPriceQueue();
      sendResponse({ ok: true, queue: result.priceQueue || null });
    });
    return true;
  }
  if (message?.type === "MERAV_APPROVE_PRICE_CHANGES") {
    approvePriceChanges(message.projectId, message.changes)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "Could not approve price changes.",
        });
      });
    return true;
  }
  if (message?.type === "MERAV_UPDATE_CURRENT_PRICE") {
    updateCurrentPagePrice(message.projectId)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "Could not update price.",
        }),
      );
    return true;
  }
  return false;
});

async function sendCurrentTabToStudio(projectIdOverride, boardPageIdOverride) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) {
    throw new Error("Open a product page first.");
  }
  return sendImageToStudio(
    { pageUrl: tab.url, srcUrl: "" },
    tab,
    projectIdOverride,
    boardPageIdOverride,
  );
}

async function sendImageToStudio(info, tab, projectIdOverride, boardPageIdOverride) {
  await updateProgress(8, "Starting MERAV import...");
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
    throw new Error("Click the extension icon and connect to MERAV Studio first.");
  }

  await updateProgress(20, "Reading product details...");
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

  let body;
  const shouldSendBrowserImage = needsBrowserImageData(payload.imageUrl);
  if (shouldSendBrowserImage) {
    await updateProgress(42, "Preparing product image...");
    const imageDataUrl = await imageDataUrlFromUrl(payload.imageUrl);
    if (imageDataUrl) payload.imageDataUrl = imageDataUrl;
  }

  await updateProgress(62, "Saving to Studio...");
  try {
    body = await importProduct(studioUrl, extensionToken, payload);
  } catch (error) {
    if (payload.imageDataUrl || !shouldRetryWithBrowserImage(error)) throw error;
    await updateProgress(48, "Retrying product image...");
    const imageDataUrl = await imageDataUrlFromUrl(payload.imageUrl);
    if (!imageDataUrl) throw error;
    body = await importProduct(studioUrl, extensionToken, { ...payload, imageDataUrl });
  }

  const title = body.warning ? "Imported with review needed" : "Sent to MERAV Studio";
  const message =
    body.warning ||
    (body.price
      ? `Product added to the design board with price ${body.price}.`
      : "Product added to the active design board page. Price was not found.");
  await updateProgress(100, message, { done: true });
  notify(title, message);
  setTimeout(() => updateProgress(0, "", { clearBadge: true }), 1600);
  return body;
}

async function importProduct(studioUrl, extensionToken, payload) {
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
  return body;
}

async function getExtensionSettings() {
  const settings = await chrome.storage.sync.get([
    "studioUrl",
    "projectId",
    "extensionToken",
    "lastStudioProjectId",
  ]);
  const projectId = settings.projectId || settings.lastStudioProjectId;
  if (!projectId) throw new Error("Choose a Studio project first.");
  if (!settings.extensionToken) throw new Error("Connect the extension to Studio first.");
  return {
    studioUrl: normalizeStudioUrl(settings.studioUrl || DEFAULT_STUDIO_URL),
    projectId,
    extensionToken: settings.extensionToken,
  };
}

async function extensionPriceRequest(studioUrl, extensionToken, path, options = {}) {
  const response = await fetch(`${studioUrl}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${extensionToken}`,
      ...(options.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.error)
    throw new Error(body.error || `Studio pricing failed (${response.status}).`);
  return body;
}

async function startPriceQueue(projectIdOverride, mode) {
  const settings = await getExtensionSettings();
  const projectId = projectIdOverride || settings.projectId;
  const normalizedMode = mode === "verify" ? "verify" : "missing";
  const body = await extensionPriceRequest(
    settings.studioUrl,
    settings.extensionToken,
    `/api/extension/prices?projectId=${encodeURIComponent(projectId)}&mode=${normalizedMode}`,
  );
  const queue = {
    projectId,
    studioUrl: settings.studioUrl,
    extensionToken: settings.extensionToken,
    mode: normalizedMode,
    items: body.items || [],
    index: 0,
    processed: 0,
    saved: 0,
    matched: 0,
    unresolved: [],
    changes: [],
    running: true,
  };
  await chrome.storage.local.set({ priceQueue: queue });
  broadcastPriceQueue(queue);
  void processPriceQueue();
  return { total: queue.items.length };
}

async function processPriceQueue() {
  if (priceQueueProcessing) return;
  priceQueueProcessing = true;
  const { priceQueue: queue } = await chrome.storage.local.get(["priceQueue"]);
  try {
    if (!queue?.running) return;
    while (queue.index < queue.items.length) {
      const item = queue.items[queue.index];
      broadcastPriceQueue(queue, `Checking ${queue.index + 1} of ${queue.items.length}...`);
      try {
        const tab = await chrome.tabs.create({ url: item.sourcePageUrl, active: false });
        if (!tab.id) throw new Error("Could not open product page.");
        await waitForTabLoad(tab.id);
        const extracted = await extractFromTab(tab.id, {
          pageUrl: item.sourcePageUrl,
          clickedImageUrl: "",
        });
        await chrome.tabs.remove(tab.id).catch(() => undefined);
        const response = await extensionPriceRequest(
          queue.studioUrl,
          queue.extensionToken,
          "/api/extension/prices",
          {
            method: "POST",
            body: JSON.stringify({
              action: "capture",
              mode: queue.mode,
              projectId: queue.projectId,
              materialItemId: item.materialItemId,
              sourcePageUrl: item.sourcePageUrl,
              product: { ...extracted.product, imageUrl: extracted.imageUrl },
            }),
          },
        );
        if (response.status === "changed") {
          queue.changes.push({
            ...item,
            currentPrice: response.currentPrice,
            livePrice: response.livePrice,
          });
        } else if (response.status === "unresolved") {
          queue.unresolved.push({ ...item, reason: "No reliable live price found" });
        } else if (response.status === "match") {
          queue.matched += 1;
        } else {
          queue.saved += 1;
        }
      } catch (error) {
        queue.unresolved.push({
          ...item,
          reason: error instanceof Error ? error.message : "Could not check this page",
        });
      }
      queue.processed += 1;
      queue.index += 1;
      await chrome.storage.local.set({ priceQueue: queue });
    }
    queue.running = false;
    await chrome.storage.local.set({ priceQueue: queue });
    broadcastPriceQueue(
      queue,
      queue.changes.length
        ? `${queue.changes.length} price change${queue.changes.length === 1 ? "" : "s"} ready for approval.`
        : "Price check complete.",
    );
    notify(
      "MERAV Studio pricing complete",
      queue.changes.length
        ? `${queue.changes.length} price changes need approval.`
        : "Pricing queue complete.",
    );
  } finally {
    priceQueueProcessing = false;
  }
}

function waitForTabLoad(tabId) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      reject(new Error("Product page took too long to load."));
    }, 15000);
    const onUpdated = (updatedTabId, changeInfo) => {
      if (updatedTabId !== tabId || changeInfo.status !== "complete") return;
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      setTimeout(resolve, 900);
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

async function approvePriceChanges(projectIdOverride, changes) {
  const settings = await getExtensionSettings();
  const result = await extensionPriceRequest(
    settings.studioUrl,
    settings.extensionToken,
    "/api/extension/prices",
    {
      method: "POST",
      body: JSON.stringify({
        action: "approve",
        projectId: projectIdOverride || settings.projectId,
        changes,
      }),
    },
  );
  const { priceQueue: queue } = await chrome.storage.local.get(["priceQueue"]);
  if (queue) {
    queue.changes = [];
    await chrome.storage.local.set({ priceQueue: queue });
    broadcastPriceQueue(
      queue,
      `${result.updated || 0} price change${result.updated === 1 ? "" : "s"} applied.`,
    );
  }
  return result;
}

async function updateCurrentPagePrice(projectIdOverride) {
  const settings = await getExtensionSettings();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) throw new Error("Open a product page first.");
  const extracted = await extractFromTab(tab.id, { pageUrl: tab.url, clickedImageUrl: "" });
  const projectId = projectIdOverride || settings.projectId;
  const queue = await extensionPriceRequest(
    settings.studioUrl,
    settings.extensionToken,
    `/api/extension/prices?projectId=${encodeURIComponent(projectId)}&mode=verify`,
  );
  const current = (queue.items || []).find(
    (item) => item.sourcePageUrl === (extracted.sourcePageUrl || tab.url),
  );
  if (!current) throw new Error("This product link is not in the selected project's materials.");
  return extensionPriceRequest(
    settings.studioUrl,
    settings.extensionToken,
    "/api/extension/prices",
    {
      method: "POST",
      body: JSON.stringify({
        action: "capture",
        mode: "current",
        projectId,
        materialItemId: current.materialItemId,
        sourcePageUrl: current.sourcePageUrl,
        product: { ...extracted.product, imageUrl: extracted.imageUrl },
      }),
    },
  );
}

function broadcastPriceQueue(queue, message = "") {
  chrome.runtime
    .sendMessage({ type: "MERAV_PRICE_QUEUE_PROGRESS", queue, message })
    .catch(() => {});
}

function needsBrowserImageData(imageUrl) {
  return /^data:image\//i.test(imageUrl || "") || /^(blob|filesystem):/i.test(imageUrl || "");
}

function shouldRetryWithBrowserImage(error) {
  const message = error instanceof Error ? error.message : String(error || "");
  return /download product image|selected image url|product image is required|image url did not return an image/i.test(
    message,
  );
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
    try {
      // Inject the extractor only when the user explicitly invokes the extension on a vendor page.
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["contentScript.js"],
      });
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
}

function normalizeStudioUrl(value) {
  return String(value || DEFAULT_STUDIO_URL).replace(/\/+$/, "");
}

function notify(title, message) {
  chrome.notifications.create({
    type: "basic",
    iconUrl: "icons/icon-128.png",
    title,
    message,
  });
}

async function updateProgress(percent, message, options = {}) {
  const nextPercent = Math.max(0, Math.min(100, Number(percent) || 0));
  const badgeText = options.clearBadge || nextPercent <= 0 ? "" : `${nextPercent}%`;
  await chrome.action.setBadgeBackgroundColor({
    color: nextPercent >= 100 ? "#2f7d46" : "#17130f",
  });
  await chrome.action.setBadgeText({ text: badgeText });
  chrome.runtime
    .sendMessage({
      type: "MERAV_IMPORT_PROGRESS",
      percent: nextPercent,
      message,
      done: Boolean(options.done),
    })
    .catch(() => {});
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
    },
  };
}
