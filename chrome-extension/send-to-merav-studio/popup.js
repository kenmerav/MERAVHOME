const DEFAULT_STUDIO_URL = "https://studio.meravinteriors.com";

let settings = {};

document.addEventListener("DOMContentLoaded", async () => {
  settings = await chrome.storage.sync.get([
    "studioUrl",
    "projectId",
    "extensionToken",
    "lastStudioProjectId",
  ]);
  await loadProjects();
});

document.getElementById("projectSelect").addEventListener("change", async (event) => {
  const projectId = event.target.value;
  await chrome.storage.sync.set({ projectId });
  settings.projectId = projectId;
});

document.getElementById("send").addEventListener("click", async () => {
  const projectId = document.getElementById("projectSelect").value;
  const status = document.getElementById("status");
  if (!projectId) {
    setStatus("Choose a project first.", true);
    return;
  }

  setSending(true);
  setStatus("Sending product to Studio...");
  try {
    const response = await chrome.runtime.sendMessage({
      type: "MERAV_SEND_CURRENT_TAB",
      projectId,
    });
    if (!response?.ok) throw new Error(response?.error || "Could not send product.");
    status.classList.remove("error");
    status.textContent = response.warning || "Product sent to the design board.";
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Could not send product.", true);
  } finally {
    setSending(false);
  }
});

document.getElementById("options").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

async function loadProjects() {
  const token = settings.extensionToken;
  if (!token) {
    renderSelect([], "");
    setStatus("Open Settings and paste the extension token first.", true);
    return;
  }

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
    setStatus("");
  } catch (error) {
    renderSelect([], "");
    setStatus(error instanceof Error ? error.message : "Could not load projects.", true);
  }
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

function setStatus(message, isError = false) {
  const status = document.getElementById("status");
  status.textContent = message;
  status.classList.toggle("error", isError);
}

function setSending(isSending) {
  document.getElementById("send").disabled = isSending;
}

function normalizeStudioUrl(value) {
  return String(value || DEFAULT_STUDIO_URL).replace(/\/+$/, "") || DEFAULT_STUDIO_URL;
}
