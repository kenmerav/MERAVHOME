const fields = ["studioUrl", "projectId", "extensionToken"];

chrome.storage.sync.get(["studioUrl", "projectId", "extensionToken", "lastStudioProjectId"], (settings) => {
  document.getElementById("studioUrl").value =
    settings.studioUrl || "https://studio.meravinteriors.com";
  document.getElementById("projectId").value = settings.projectId || settings.lastStudioProjectId || "";
  document.getElementById("extensionToken").value = settings.extensionToken || "";
});

document.getElementById("save").addEventListener("click", () => {
  const values = Object.fromEntries(
    fields.map((field) => [field, document.getElementById(field).value.trim()]),
  );
  values.studioUrl = values.studioUrl.replace(/\/+$/, "") || "https://studio.meravinteriors.com";
  chrome.storage.sync.set(values, () => {
    document.getElementById("status").textContent = "Settings saved.";
  });
});
