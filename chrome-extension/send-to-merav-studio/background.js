const MENU_ID = "send-to-merav-studio";
const DEFAULT_STUDIO_URL = "https://studio.meravinteriors.com";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: "Send to MERAV Studio",
    contexts: ["image"],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID || !tab?.id) return;
  try {
    await sendImageToStudio(info, tab);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not send product.";
    notify("MERAV Studio import failed", message);
    chrome.runtime.openOptionsPage();
  }
});

async function sendImageToStudio(info, tab) {
  const settings = await chrome.storage.sync.get([
    "studioUrl",
    "projectId",
    "extensionToken",
    "lastStudioProjectId",
  ]);
  const studioUrl = normalizeStudioUrl(settings.studioUrl || DEFAULT_STUDIO_URL);
  const projectId = settings.projectId || settings.lastStudioProjectId;
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
    imageUrl: pageExtraction.imageUrl || info.srcUrl,
    sourcePageUrl: pageExtraction.sourcePageUrl || info.pageUrl || tab.url,
  };

  if (!payload.imageUrl) throw new Error("Could not find the product image.");
  if (!payload.sourcePageUrl) throw new Error("Could not find the product URL.");

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
  return {
    sourcePageUrl: fallback.pageUrl || location.href,
    imageUrl: fallback.clickedImageUrl,
    product: {
      name: document.title,
      vendor: location.hostname.replace(/^www\./, ""),
    },
  };
}
