const fields = ["studioUrl", "projectId", "extensionToken"];
const DEFAULT_STUDIO_URL = "https://studio.meravinteriors.com";

chrome.storage.sync.get(["studioUrl", "projectId", "extensionToken", "lastStudioProjectId"], (settings) => {
  document.getElementById("studioUrl").value =
    settings.studioUrl || DEFAULT_STUDIO_URL;
  document.getElementById("projectId").value = settings.projectId || settings.lastStudioProjectId || "";
  document.getElementById("extensionToken").value = settings.extensionToken || "";
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

async function loadProjects(options = {}) {
  const status = document.getElementById("status");
  const studioUrl = normalizeStudioUrl(document.getElementById("studioUrl").value);
  const token = document.getElementById("extensionToken").value.trim();
  const selectedProjectId = document.getElementById("projectId").value.trim();
  if (!token) {
    if (!options.quiet) status.textContent = "Paste the extension token first, then load projects.";
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
