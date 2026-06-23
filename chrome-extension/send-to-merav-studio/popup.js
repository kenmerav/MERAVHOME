const DEFAULT_STUDIO_URL = "https://studio.meravinteriors.com";

let settings = {};

document.addEventListener("DOMContentLoaded", async () => {
  settings = await chrome.storage.sync.get([
    "studioUrl",
    "projectId",
    "boardPageId",
    "boardPageByProject",
    "extensionToken",
    "lastStudioProjectId",
  ]);
  await loadProjects();
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== "MERAV_IMPORT_PROGRESS") return;
  setProgress(message.percent, message.message);
  if (message.done) {
    window.setTimeout(() => setProgress(0, "", false), 1400);
  }
});

document.getElementById("projectSelect").addEventListener("change", async (event) => {
  const projectId = event.target.value;
  await chrome.storage.sync.set({ projectId });
  settings.projectId = projectId;
  await loadBoardPages(projectId);
});

document.getElementById("boardPageSelect").addEventListener("change", async (event) => {
  const boardPageId = event.target.value;
  const projectId = document.getElementById("projectSelect").value;
  const boardPageByProject = { ...(settings.boardPageByProject || {}) };
  if (projectId) boardPageByProject[projectId] = boardPageId;
  await chrome.storage.sync.set({ boardPageId, boardPageByProject });
  settings.boardPageId = boardPageId;
  settings.boardPageByProject = boardPageByProject;
});

document.getElementById("send").addEventListener("click", async () => {
  const projectId = document.getElementById("projectSelect").value;
  const boardPageId = document.getElementById("boardPageSelect").value;
  const status = document.getElementById("status");
  if (!projectId) {
    setStatus("Choose a project first.", true);
    return;
  }
  if (!boardPageId) {
    setStatus("Choose a board page first.", true);
    return;
  }

  setSending(true);
  setProgress(8, "Starting import...");
  try {
    const response = await chrome.runtime.sendMessage({
      type: "MERAV_SEND_CURRENT_TAB",
      projectId,
      boardPageId,
    });
    if (!response?.ok) throw new Error(response?.error || "Could not send product.");
    status.classList.remove("error");
    setProgress(100, response.warning || "Product sent to the design board.", true);
  } catch (error) {
    setProgress(0, "", false);
    setStatus(error instanceof Error ? error.message : "Could not send product.", true);
  } finally {
    setSending(false);
  }
});

document.getElementById("options").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

document.getElementById("connect").addEventListener("click", async () => {
  setStatus("Opening Studio connection...");
  try {
    const connected = await connectToStudio();
    settings = { ...settings, ...connected };
    setConnectionVisible(false);
    setStatus("Connected to Studio.");
    await loadProjects();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Could not connect to Studio.", true);
  }
});

async function loadProjects() {
  const token = settings.extensionToken;
  if (!token) {
    setConnectionVisible(true);
    renderSelect([], "");
    renderBoardPageSelect([], "");
    setStatus("Connect to Studio first.", true);
    return;
  }
  setConnectionVisible(false);

  try {
    const studioUrl = normalizeStudioUrl(settings.studioUrl);
    const response = await fetch(`${studioUrl}/api/extension/projects`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.error) {
      throw new Error(body.error || `Could not load projects (${response.status}).`);
    }

    const selectedProjectId = settings.projectId || settings.lastStudioProjectId || "";
    renderSelect(body.projects || [], selectedProjectId);
    const loadedPages = await loadBoardPages(selectedProjectId);
    if (loadedPages !== false) setStatus("");
  } catch (error) {
    renderSelect([], "");
    renderBoardPageSelect([], "");
    setStatus(error instanceof Error ? error.message : "Could not load projects.", true);
  }
}

async function connectToStudio() {
  const studioUrl = normalizeStudioUrl(settings.studioUrl);
  const redirectUrl = chrome.identity.getRedirectURL("studio-connect");
  const authUrl = `${studioUrl}/extension/connect?redirect=${encodeURIComponent(redirectUrl)}`;
  const responseUrl = await launchWebAuthFlow({ url: authUrl, interactive: true });
  const response = new URL(responseUrl);
  const params = new URLSearchParams(response.hash.replace(/^#/, ""));
  const token = params.get("token") || "";
  const returnedStudioUrl = normalizeStudioUrl(params.get("studioUrl") || studioUrl);
  if (!token) {
    throw new Error("Studio did not return a connection token. Make sure you are signed into Studio.");
  }
  const values = { extensionToken: token, studioUrl: returnedStudioUrl };
  await chrome.storage.sync.set(values);
  return values;
}

function launchWebAuthFlow(details) {
  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow(details, (responseUrl) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message || "Studio connection was cancelled."));
        return;
      }
      if (!responseUrl) {
        reject(new Error("Studio connection was cancelled."));
        return;
      }
      resolve(responseUrl);
    });
  });
}

function setConnectionVisible(isVisible) {
  document.getElementById("connection").classList.toggle("visible", isVisible);
}

function renderSelect(projects, selectedProjectId) {
  const select = document.getElementById("projectSelect");
  select.textContent = "";
  const empty = document.createElement("option");
  empty.value = "";
  empty.textContent = projects.length ? "Choose a project" : "No projects available";
  select.appendChild(empty);

  projects.forEach((project) => {
    const option = document.createElement("option");
    option.value = project.id;
    const client = project.clientName ? `${project.clientName} · ` : "";
    const archived = project.archived ? " · Archived" : "";
    option.textContent = `${client}${project.name}${archived}`;
    select.appendChild(option);
  });

  if (selectedProjectId && projects.some((project) => project.id === selectedProjectId)) {
    select.value = selectedProjectId;
  }
}

async function loadBoardPages(projectId) {
  if (!projectId) {
    renderBoardPageSelect([], "");
    return true;
  }

  const token = settings.extensionToken;
  if (!token) {
    renderBoardPageSelect([], "");
    return true;
  }

  try {
    const studioUrl = normalizeStudioUrl(settings.studioUrl);
    const response = await fetch(
      `${studioUrl}/api/extension/board-pages?projectId=${encodeURIComponent(projectId)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.error) {
      throw new Error(body.error || `Could not load board pages (${response.status}).`);
    }

    const rememberedPageId = settings.boardPageByProject?.[projectId] || settings.boardPageId || "";
    const selectedPageId =
      rememberedPageId && (body.pages || []).some((page) => page.id === rememberedPageId)
        ? rememberedPageId
        : body.selectedPageId || "";
    renderBoardPageSelect(body.pages || [], selectedPageId);

    if (selectedPageId) {
      const boardPageByProject = { ...(settings.boardPageByProject || {}), [projectId]: selectedPageId };
      await chrome.storage.sync.set({ boardPageId: selectedPageId, boardPageByProject });
      settings.boardPageId = selectedPageId;
      settings.boardPageByProject = boardPageByProject;
    }
    return true;
  } catch (error) {
    renderBoardPageSelect([], "");
    setStatus(error instanceof Error ? error.message : "Could not load board pages.", true);
    return false;
  }
}

function renderBoardPageSelect(pages, selectedPageId) {
  const select = document.getElementById("boardPageSelect");
  select.textContent = "";
  const empty = document.createElement("option");
  empty.value = "";
  empty.textContent = pages.length ? "Choose a board page" : "No board pages yet";
  select.appendChild(empty);

  pages.forEach((page, index) => {
    const option = document.createElement("option");
    option.value = page.id;
    const count = typeof page.itemCount === "number" ? ` · ${page.itemCount} items` : "";
    option.textContent = `${index + 1}. ${page.title}${count}`;
    select.appendChild(option);
  });

  if (selectedPageId && pages.some((page) => page.id === selectedPageId)) {
    select.value = selectedPageId;
  }
}

function setStatus(message, isError = false) {
  const status = document.getElementById("status");
  status.textContent = message;
  status.classList.toggle("error", isError);
}

function setProgress(percent, message, done = false) {
  const progress = document.getElementById("progress");
  const progressBar = document.getElementById("progressBar");
  const nextPercent = Math.max(0, Math.min(100, Number(percent) || 0));
  progress.hidden = nextPercent <= 0;
  progressBar.style.width = `${nextPercent}%`;
  if (message) setStatus(message, false);
  if (done) progressBar.style.width = "100%";
}

function setSending(isSending) {
  document.getElementById("send").disabled = isSending;
}

function normalizeStudioUrl(value) {
  return String(value || DEFAULT_STUDIO_URL).replace(/\/+$/, "") || DEFAULT_STUDIO_URL;
}
