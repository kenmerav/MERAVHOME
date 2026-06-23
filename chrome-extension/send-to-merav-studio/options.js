const fields = ["studioUrl", "projectId"];
const DEFAULT_STUDIO_URL = "https://studio.meravinteriors.com";

chrome.storage.sync.get(["studioUrl", "projectId", "extensionToken", "lastStudioProjectId"], (settings) => {
  document.getElementById("studioUrl").value =
    settings.studioUrl || DEFAULT_STUDIO_URL;
  document.getElementById("projectId").value = settings.projectId || settings.lastStudioProjectId || "";
  loadProjects({ quiet: true });
});

document.getElementById("save").addEventListener("click", () => {
  const values = Object.fromEntries(
    fields.map((field) => [field, document.getElementById(field).value.trim()]),
  );
  values.studioUrl = values.studioUrl.replace(/\/+$/, "") || DEFAULT_STUDIO_URL;
  chrome.storage.sync.set(values, () => {
    document.getElementById("status").textContent = "Settings saved.";
  });
});

document.getElementById("loadProjects").addEventListener("click", () => loadProjects());
document.getElementById("projectSelect").addEventListener("change", (event) => {
  document.getElementById("projectId").value = event.target.value;
});
document.getElementById("connect").addEventListener("click", async () => {
  const status = document.getElementById("status");
  status.textContent = "Opening Studio connection...";
  try {
    const connected = await connectToStudio();
    document.getElementById("studioUrl").value = connected.studioUrl;
    status.textContent = "Connected to Studio.";
    await loadProjects();
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "Could not connect to Studio.";
  }
});

async function loadProjects(options = {}) {
  const status = document.getElementById("status");
  const studioUrl = normalizeStudioUrl(document.getElementById("studioUrl").value);
  const { extensionToken: token } = await chrome.storage.sync.get(["extensionToken"]);
  const selectedProjectId = document.getElementById("projectId").value.trim();
  if (!token) {
    if (!options.quiet) status.textContent = "Connect to Studio first, then load projects.";
    return;
  }

  try {
    if (!options.quiet) status.textContent = "Loading projects...";
    const response = await fetch(`${studioUrl}/api/extension/projects`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.error) {
      throw new Error(body.error || `Could not load projects (${response.status}).`);
    }

    renderProjects(body.projects || [], selectedProjectId);
    status.textContent = options.quiet ? "" : "Projects loaded.";
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "Could not load projects.";
  }
}

async function connectToStudio() {
  const studioUrl = normalizeStudioUrl(document.getElementById("studioUrl").value);
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

function renderProjects(projects, selectedProjectId) {
  const select = document.getElementById("projectSelect");
  select.textContent = "";
  const empty = document.createElement("option");
  empty.value = "";
  empty.textContent = projects.length ? "Choose a project" : "No projects found";
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

function normalizeStudioUrl(value) {
  return String(value || DEFAULT_STUDIO_URL).replace(/\/+$/, "") || DEFAULT_STUDIO_URL;
}
