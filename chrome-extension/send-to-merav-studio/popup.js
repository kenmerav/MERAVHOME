const DEFAULT_STUDIO_URL = "https://studio.meravinteriors.com";
const LOCAL_ROOM_DESIGN_PREVIEW =
  /^https?:$/.test(window.location.protocol) &&
  new URLSearchParams(window.location.search).get("preview") === "room-design";

let settings = {};
let projects = [];
let roomDesignData = null;

document.addEventListener("DOMContentLoaded", async () => {
  if (LOCAL_ROOM_DESIGN_PREVIEW) {
    renderLocalRoomDesignPreview();
    return;
  }
  const [syncedSettings, localRoomSettings] = await Promise.all([
    chrome.storage.sync.get([
      "studioUrl",
      "projectId",
      "boardPageId",
      "boardPageByProject",
      "extensionToken",
      "lastStudioProjectId",
      "destinationByProject",
      "roomByProject",
      "roomNameByProject",
      "itemByRoom",
      "quantityByItem",
    ]),
    chrome.storage.local.get(["roomByProject", "roomNameByProject"]),
  ]);
  settings = {
    ...syncedSettings,
    roomByProject: {
      ...(syncedSettings.roomByProject || {}),
      ...(localRoomSettings.roomByProject || {}),
    },
    roomNameByProject: {
      ...(syncedSettings.roomNameByProject || {}),
      ...(localRoomSettings.roomNameByProject || {}),
    },
  };
  await loadProjects();
  await loadPriceQueue();
});

if (!LOCAL_ROOM_DESIGN_PREVIEW) {
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "MERAV_IMPORT_PROGRESS") {
      setProgress(message.percent, message.message);
      if (message.done) {
        window.setTimeout(() => setProgress(0, "", false), 1400);
      }
    }
    if (message?.type === "MERAV_PRICE_QUEUE_PROGRESS") {
      renderPriceQueue(message.queue, message.message);
    }
  });
}

function renderLocalRoomDesignPreview() {
  const previewProject = {
    id: "preview-project",
    name: "TEST DESIGN PROCESS",
    clientName: "Local preview",
    roomDesignV2: true,
  };
  projects = [previewProject];
  settings = {
    projectId: previewProject.id,
    destinationByProject: { [previewProject.id]: "room_design" },
    roomByProject: { [previewProject.id]: "preview-kitchen" },
    itemByRoom: { "preview-kitchen": "island-pendants" },
  };
  roomDesignData = {
    selectedRoomId: "preview-kitchen",
    rooms: [
      { id: "preview-kitchen", name: "Kitchen" },
      { id: "preview-primary-bath", name: "Primary Bathroom" },
      { id: "preview-great-room", name: "Great Room" },
    ],
    items: [
      { id: "flooring", label: "Flooring", filled: true, productName: "European Oak" },
      { id: "transitions", label: "Transitions", filled: false, productName: "" },
      { id: "wall-finish", label: "Wall finish", filled: false, productName: "" },
      { id: "ceiling-finish", label: "Ceiling finish", filled: false, productName: "" },
      { id: "baseboard", label: "Baseboard", filled: false, productName: "" },
      { id: "casing", label: "Casing", filled: false, productName: "" },
      { id: "doors", label: "Doors", filled: false, productName: "" },
      { id: "door-hardware", label: "Door hardware", filled: false, productName: "" },
      { id: "general-lighting", label: "General lighting", filled: false, productName: "" },
      { id: "recessed-lighting", label: "Recessed lighting", filled: false, productName: "" },
      { id: "switches", label: "Switches", filled: false, productName: "" },
      { id: "outlets", label: "Outlets", filled: false, productName: "" },
      { id: "wall-plates", label: "Wall plates", filled: false, productName: "" },
      { id: "cabinet-layout", label: "Cabinet layout", filled: false, productName: "" },
      { id: "appliance-layout", label: "Appliance layout", filled: false, productName: "" },
      {
        id: "cabinet-construction-and-door-style",
        label: "Cabinet construction + door style",
        filled: false,
        productName: "",
      },
      { id: "cabinet-finish", label: "Cabinet finish", filled: false, productName: "" },
      { id: "cabinet-hardware", label: "Cabinet hardware", filled: false, productName: "" },
      {
        id: "countertop",
        label: "Countertop",
        filled: true,
        productName: "Taj Mahal Quartzite",
      },
      { id: "backsplash", label: "Backsplash", filled: false, productName: "" },
      { id: "sink", label: "Sink", filled: false, productName: "" },
      { id: "faucet", label: "Faucet", filled: false, productName: "" },
      { id: "sink-drain", label: "Sink drain", filled: false, productName: "" },
      { id: "garbage-disposal", label: "Garbage disposal", filled: false, productName: "" },
      { id: "sink-flange", label: "Sink flange", filled: false, productName: "" },
      { id: "air-switch", label: "Air switch", filled: false, productName: "" },
      { id: "dishwasher", label: "Dishwasher", filled: false, productName: "" },
      { id: "range-cooktop", label: "Range / cooktop", filled: false, productName: "" },
      { id: "wall-oven-s", label: "Wall oven(s)", filled: false, productName: "" },
      { id: "hood-insert", label: "Hood insert", filled: false, productName: "" },
      {
        id: "decorative-hood-shell",
        label: "Decorative hood shell",
        filled: false,
        productName: "",
      },
      { id: "refrigerator", label: "Refrigerator", filled: false, productName: "" },
      { id: "freezer", label: "Freezer", filled: false, productName: "" },
      {
        id: "microwave-drawer",
        label: "Microwave / drawer",
        filled: false,
        productName: "",
      },
      {
        id: "specialty-appliances",
        label: "Specialty appliances",
        filled: false,
        productName: "",
      },
      { id: "pot-filler", label: "Pot filler", filled: false, productName: "" },
      { id: "open-shelving", label: "Open shelving", filled: false, productName: "" },
      { id: "shelf-rails", label: "Shelf rails", filled: false, productName: "" },
      { id: "island-pendants", label: "Island pendants", filled: false, productName: "" },
      { id: "sconces", label: "Sconces", filled: false, productName: "" },
      { id: "accent-lighting", label: "Accent lighting", filled: false, productName: "" },
      {
        id: "under-cabinet-lighting",
        label: "Under-cabinet lighting",
        filled: false,
        productName: "",
      },
      {
        id: "cabinet-interior-lighting",
        label: "Cabinet interior lighting",
        filled: false,
        productName: "",
      },
      { id: "countertop-power", label: "Countertop power", filled: false, productName: "" },
      { id: "island-power", label: "Island power", filled: false, productName: "" },
    ],
  };
  roomDesignData.itemsByRoom = {
    "preview-kitchen": roomDesignData.items,
    "preview-primary-bath": localPreviewItems([
      "Flooring",
      "Transitions",
      "Wall finish",
      "Ceiling finish",
      "Baseboard",
      "Casing",
      "Doors",
      "Door hardware",
      "Vanity layout",
      "Vanity construction + door style",
      "Vanity finish",
      "Vanity hardware",
      "Countertop",
      "Backsplash",
      "Sink(s)",
      "Faucet(s)",
      "Sink drain(s)",
      "Shower wall tile",
      "Shower floor tile",
      "Shower system",
      "Shower drain",
      "Tub",
      "Tub filler",
      "Toilet",
      "Mirror(s)",
      "Vanity sconces",
      "Decorative ceiling lighting",
      "Bath accessories",
      "Hooks",
      "Switches",
      "Outlets",
      "Wall plates",
    ]),
    "preview-great-room": localPreviewItems([
      "Flooring",
      "Transitions",
      "Wall finish",
      "Ceiling finish",
      "Lighting",
      "Window treatments",
      "Furniture",
      "Fixtures",
      "Hardware",
      "Accessories",
    ]),
  };
  setConnectionVisible(false);
  renderSelect(projects, previewProject.id);
  renderDestinationSelect(true, "room_design");
  document.getElementById("roomDesignFields").hidden = false;
  document.getElementById("boardFields").hidden = true;
  document.getElementById("send").textContent = "Add to Room Selections";
  renderRoomSelect(roomDesignData.rooms, roomDesignData.selectedRoomId);
  renderRequiredItems(roomDesignData.items, "island-pendants");
  restoreQuantity(roomDesignData.selectedRoomId, "island-pendants");
  document.querySelectorAll("button").forEach((button) => {
    button.disabled = !button.hasAttribute("data-preview-enabled");
  });
  setStatus("Local preview only — no Studio data will be changed.");
}

function localPreviewItems(labels) {
  return labels.map((label) => ({
    id: label
      .toLowerCase()
      .replace(/\+/g, " and ")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, ""),
    label,
    filled: false,
    productName: "",
  }));
}

document.getElementById("projectSelect").addEventListener("change", async (event) => {
  if (LOCAL_ROOM_DESIGN_PREVIEW) return;
  const projectId = event.target.value;
  await chrome.storage.sync.set({ projectId });
  settings.projectId = projectId;
  await configureProject(projectId);
});

document.getElementById("destinationSelect").addEventListener("change", async (event) => {
  if (LOCAL_ROOM_DESIGN_PREVIEW) return;
  const projectId = document.getElementById("projectSelect").value;
  const destination = event.target.value;
  const destinationByProject = { ...(settings.destinationByProject || {}) };
  if (projectId) destinationByProject[projectId] = destination;
  settings.destinationByProject = destinationByProject;
  await chrome.storage.sync.set({ destinationByProject });
  await showDestination(projectId, destination);
});

document.getElementById("roomSelect").addEventListener("change", async (event) => {
  if (LOCAL_ROOM_DESIGN_PREVIEW) {
    roomDesignData.selectedRoomId = event.target.value;
    roomDesignData.items = roomDesignData.itemsByRoom?.[event.target.value] || [];
    const selectedItemId = roomDesignData.items.find((item) => !item.filled)?.id || "";
    renderRequiredItems(roomDesignData.items, selectedItemId);
    restoreQuantity(event.target.value, selectedItemId);
    return;
  }
  const projectId = document.getElementById("projectSelect").value;
  const roomId = event.target.value;
  const roomName = event.target.selectedOptions?.[0]?.textContent?.trim() || "";
  const roomByProject = { ...(settings.roomByProject || {}) };
  const roomNameByProject = { ...(settings.roomNameByProject || {}) };
  if (projectId) roomByProject[projectId] = roomId;
  if (projectId) roomNameByProject[projectId] = roomName;
  settings.roomByProject = roomByProject;
  settings.roomNameByProject = roomNameByProject;
  roomDesignData = null;
  renderRequiredItems([], "");
  setStatus(`Loading ${roomName}...`);
  await Promise.all([
    chrome.storage.sync.set({ roomByProject, roomNameByProject }),
    chrome.storage.local.set({ roomByProject, roomNameByProject }),
  ]);
  await loadRoomDesign(projectId, roomId);
});

document.getElementById("requiredItemSelect").addEventListener("change", async (event) => {
  if (LOCAL_ROOM_DESIGN_PREVIEW) return;
  const roomId = document.getElementById("roomSelect").value;
  const itemByRoom = { ...(settings.itemByRoom || {}) };
  if (roomId) itemByRoom[roomId] = event.target.value;
  settings.itemByRoom = itemByRoom;
  await chrome.storage.sync.set({ itemByRoom });
  restoreQuantity(roomId, event.target.value);
});

document.getElementById("showAddProductType").addEventListener("click", () => {
  const fields = document.getElementById("addProductTypeFields");
  fields.hidden = false;
  document.getElementById("newProductTypeInput").focus();
});

document.getElementById("cancelProductType").addEventListener("click", () => {
  hideAddProductType();
});

document.getElementById("saveProductType").addEventListener("click", addProductType);
document.getElementById("newProductTypeInput").addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    addProductType();
  }
  if (event.key === "Escape") hideAddProductType();
});

document.getElementById("quantityInput").addEventListener("change", async (event) => {
  if (LOCAL_ROOM_DESIGN_PREVIEW) return;
  const roomId = document.getElementById("roomSelect").value;
  const itemId = document.getElementById("requiredItemSelect").value;
  if (!roomId || !itemId) return;
  const quantity = Math.max(0.01, Number(event.target.value) || 1);
  event.target.value = String(quantity);
  const quantityByItem = {
    ...(settings.quantityByItem || {}),
    [`${roomId}:${itemId}`]: quantity,
  };
  settings.quantityByItem = quantityByItem;
  await chrome.storage.sync.set({ quantityByItem });
});

document.getElementById("boardPageSelect").addEventListener("change", async (event) => {
  if (LOCAL_ROOM_DESIGN_PREVIEW) return;
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
  const destination = document.getElementById("destinationSelect").value;
  const boardPageId = document.getElementById("boardPageSelect").value;
  const roomId = document.getElementById("roomSelect").value;
  const roomName =
    document.getElementById("roomSelect").selectedOptions?.[0]?.textContent?.trim() || "";
  const requiredItemKey = document.getElementById("requiredItemSelect").value;
  const quantity = Number(document.getElementById("quantityInput").value) || 1;
  const colorFinish = document.getElementById("colorFinishInput").value.trim();
  const status = document.getElementById("status");
  if (!projectId) {
    setStatus("Choose a project first.", true);
    return;
  }
  if (destination === "design_board" && !boardPageId) {
    setStatus("Choose a board page first.", true);
    return;
  }
  if (destination === "room_design" && !roomId) {
    setStatus("Choose a room first.", true);
    return;
  }
  if (destination === "room_design" && roomDesignData?.selectedRoomId !== roomId) {
    setStatus("That room is still loading. Wait a moment and try again.", true);
    return;
  }
  if (destination === "room_design" && !requiredItemKey) {
    setStatus("Choose a product type first.", true);
    return;
  }

  setSending(true);
  setProgress(8, "Starting import...");
  try {
    const response = await chrome.runtime.sendMessage({
      type: "MERAV_SEND_CURRENT_TAB",
      projectId,
      boardPageId,
      destination,
      roomId,
      roomName,
      requiredItemKey,
      quantity,
      colorFinish,
    });
    if (!response?.ok) throw new Error(response?.error || "Could not send product.");
    status.classList.remove("error");
    setProgress(
      100,
      response.warning ||
        response.message ||
        (destination === "room_design"
          ? "Product added to the room selections."
          : "Product sent to the design board."),
      true,
    );
    if (destination === "room_design") {
      document.getElementById("colorFinishInput").value = "";
      document.getElementById("openRoom").hidden = false;
      await loadRoomDesign(projectId, roomId, response.nextItemId || "");
    }
  } catch (error) {
    setProgress(0, "", false);
    setStatus(error instanceof Error ? error.message : "Could not send product.", true);
  } finally {
    setSending(false);
  }
});

document.getElementById("openRoom").addEventListener("click", async () => {
  if (!roomDesignData?.openUrl) return;
  const studioUrl = normalizeStudioUrl(settings.studioUrl);
  await chrome.tabs.create({ url: `${studioUrl}${roomDesignData.openUrl}` });
});

document.getElementById("fillMissing").addEventListener("click", () => startPriceQueue("missing"));
document.getElementById("verifyPrices").addEventListener("click", () => startPriceQueue("verify"));
document.getElementById("updateCurrentPrice").addEventListener("click", updateCurrentPagePrice);
document.getElementById("approveChanges").addEventListener("click", approveSelectedPriceChanges);

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
    renderRoomSelect([], "");
    renderRequiredItems([], "");
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

    projects = body.projects || [];
    const selectedProjectId = settings.projectId || settings.lastStudioProjectId || "";
    renderSelect(projects, selectedProjectId);
    const configured = await configureProject(selectedProjectId);
    if (configured !== false) setStatus("");
  } catch (error) {
    projects = [];
    renderSelect([], "");
    renderBoardPageSelect([], "");
    renderRoomSelect([], "");
    renderRequiredItems([], "");
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
    throw new Error(
      "Studio did not return a connection token. Make sure you are signed into Studio.",
    );
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

async function configureProject(projectId) {
  const project = projects.find((candidate) => candidate.id === projectId);
  const remembered = settings.destinationByProject?.[projectId];
  const destination = project?.roomDesignV2
    ? remembered === "design_board"
      ? "design_board"
      : "room_design"
    : "design_board";
  renderDestinationSelect(Boolean(project?.roomDesignV2), destination);
  if (projectId) {
    const destinationByProject = {
      ...(settings.destinationByProject || {}),
      [projectId]: destination,
    };
    settings.destinationByProject = destinationByProject;
    await chrome.storage.sync.set({ destinationByProject });
  }
  return showDestination(projectId, destination);
}

function renderDestinationSelect(hasRoomDesign, selectedDestination) {
  const select = document.getElementById("destinationSelect");
  select.textContent = "";
  if (hasRoomDesign) {
    const roomDesign = document.createElement("option");
    roomDesign.value = "room_design";
    roomDesign.textContent = "Room Design Selections *NEW*";
    select.appendChild(roomDesign);
  }
  const board = document.createElement("option");
  board.value = "design_board";
  board.textContent = "Design Board Direct";
  select.appendChild(board);
  select.value = hasRoomDesign ? selectedDestination : "design_board";
}

async function showDestination(projectId, destination) {
  const roomDesign = destination === "room_design";
  document.getElementById("roomDesignFields").hidden = !roomDesign;
  document.getElementById("boardFields").hidden = roomDesign;
  document.getElementById("openRoom").hidden = true;
  document.getElementById("send").textContent = roomDesign
    ? "Add to Room Selections"
    : "Send Current Product";
  if (!projectId) {
    renderBoardPageSelect([], "");
    renderRoomSelect([], "");
    renderRequiredItems([], "");
    return true;
  }
  return roomDesign ? loadRoomDesign(projectId) : loadBoardPages(projectId);
}

async function loadRoomDesign(projectId, requestedRoomId = "", preferredItemId = "") {
  if (!projectId || !settings.extensionToken) {
    renderRoomSelect([], "");
    renderRequiredItems([], "");
    return true;
  }
  try {
    const rememberedRoomId = requestedRoomId || settings.roomByProject?.[projectId] || "";
    const studioUrl = normalizeStudioUrl(settings.studioUrl);
    const params = new URLSearchParams({ projectId });
    if (rememberedRoomId) params.set("roomId", rememberedRoomId);
    const response = await fetch(`${studioUrl}/api/extension/room-design?${params}`, {
      headers: { Authorization: `Bearer ${settings.extensionToken}` },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.error) {
      throw new Error(body.error || `Could not load Room Design (${response.status}).`);
    }
    roomDesignData = body;
    const roomId = body.selectedRoomId || "";
    renderRoomSelect(body.rooms || [], roomId);
    const rememberedItemId = preferredItemId || settings.itemByRoom?.[roomId] || "";
    const selectedItemId = (body.items || []).some((item) => item.id === rememberedItemId)
      ? rememberedItemId
      : (body.items || []).find((item) => !item.filled)?.id || body.items?.[0]?.id || "";
    renderRequiredItems(body.items || [], selectedItemId);
    const selectedRoomName =
      (body.rooms || []).find((room) => room.id === roomId)?.name || body.selectedRoomName || "";
    const roomByProject = { ...(settings.roomByProject || {}), [projectId]: roomId };
    const roomNameByProject = {
      ...(settings.roomNameByProject || {}),
      [projectId]: selectedRoomName,
    };
    const itemByRoom = { ...(settings.itemByRoom || {}), [roomId]: selectedItemId };
    settings.roomByProject = roomByProject;
    settings.roomNameByProject = roomNameByProject;
    settings.itemByRoom = itemByRoom;
    await Promise.all([
      chrome.storage.sync.set({ roomByProject, roomNameByProject, itemByRoom }),
      chrome.storage.local.set({ roomByProject, roomNameByProject }),
    ]);
    restoreQuantity(roomId, selectedItemId);
    return true;
  } catch (error) {
    roomDesignData = null;
    renderRoomSelect([], "");
    renderRequiredItems([], "");
    setStatus(error instanceof Error ? error.message : "Could not load Room Design.", true);
    return false;
  }
}

function renderRoomSelect(rooms, selectedRoomId) {
  const select = document.getElementById("roomSelect");
  select.textContent = "";
  const empty = document.createElement("option");
  empty.value = "";
  empty.textContent = rooms.length ? "Choose a room" : "No rooms available";
  select.appendChild(empty);
  rooms.forEach((room) => {
    const option = document.createElement("option");
    option.value = room.id;
    option.textContent = room.name;
    select.appendChild(option);
  });
  if (rooms.some((room) => room.id === selectedRoomId)) select.value = selectedRoomId;
}

function renderRequiredItems(items, selectedItemId) {
  const select = document.getElementById("requiredItemSelect");
  select.textContent = "";
  const empty = document.createElement("option");
  empty.value = "";
  empty.textContent = items.length ? "Choose a product type" : "No product types available";
  select.appendChild(empty);
  items.forEach((item) => {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = item.filled
      ? `${item.label} · ${item.productName || "Filled"}`
      : item.label;
    select.appendChild(option);
  });
  if (items.some((item) => item.id === selectedItemId)) select.value = selectedItemId;
}

function restoreQuantity(roomId, itemId) {
  const item = roomDesignData?.items?.find((candidate) => candidate.id === itemId);
  const remembered = settings.quantityByItem?.[`${roomId}:${itemId}`];
  document.getElementById("quantityInput").value = String(remembered || item?.quantity || 1);
}

function hideAddProductType() {
  document.getElementById("addProductTypeFields").hidden = true;
  document.getElementById("newProductTypeInput").value = "";
}

async function addProductType() {
  const projectId = document.getElementById("projectSelect").value;
  const roomId = document.getElementById("roomSelect").value;
  const roomName =
    document.getElementById("roomSelect").selectedOptions?.[0]?.textContent?.trim() || "";
  const label = document.getElementById("newProductTypeInput").value.trim();
  if (!roomId) return setStatus("Choose a room first.", true);
  if (!LOCAL_ROOM_DESIGN_PREVIEW && roomDesignData?.selectedRoomId !== roomId) {
    return setStatus("That room is still loading. Wait a moment and try again.", true);
  }
  if (!label) return setStatus("Enter a product type name.", true);

  const existing = roomDesignData?.items?.find(
    (item) => item.label.trim().toLowerCase() === label.toLowerCase(),
  );
  if (existing) {
    renderRequiredItems(roomDesignData.items, existing.id);
    restoreQuantity(roomId, existing.id);
    hideAddProductType();
    return setStatus(`${existing.label} is already in this room.`);
  }

  if (LOCAL_ROOM_DESIGN_PREVIEW) {
    const item = {
      id: `custom-preview-${Date.now()}`,
      label,
      filled: false,
      productName: "",
      quantity: 1,
    };
    roomDesignData.items.push(item);
    roomDesignData.itemsByRoom[roomId] = roomDesignData.items;
    renderRequiredItems(roomDesignData.items, item.id);
    restoreQuantity(roomId, item.id);
    hideAddProductType();
    return setStatus(`${label} added to this preview room.`);
  }

  if (!projectId) return setStatus("Choose a project first.", true);
  const saveButton = document.getElementById("saveProductType");
  saveButton.disabled = true;
  setStatus("Adding product type...");
  try {
    const studioUrl = normalizeStudioUrl(settings.studioUrl);
    const response = await fetch(`${studioUrl}/api/extension/room-design`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.extensionToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ projectId, roomId, roomName, productTypeLabel: label }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.error) {
      throw new Error(body.error || `Could not add product type (${response.status}).`);
    }
    hideAddProductType();
    await loadRoomDesign(projectId, roomId, body.item?.id || "");
    setStatus(
      body.added
        ? `${body.item.label} added to ${body.roomName || roomName}.`
        : `${body.item.label} is already in ${body.roomName || roomName}.`,
    );
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Could not add the product type.", true);
  } finally {
    saveButton.disabled = false;
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
      const boardPageByProject = {
        ...(settings.boardPageByProject || {}),
        [projectId]: selectedPageId,
      };
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

async function requestVendorAccess() {
  const granted = await chrome.permissions.request({ origins: ["https://*/*", "http://*/*"] });
  if (!granted)
    throw new Error("Allow vendor-site access so the extension can check prices automatically.");
}

async function startPriceQueue(mode) {
  const projectId = document.getElementById("projectSelect").value;
  if (!projectId) return setStatus("Choose a project first.", true);
  try {
    await requestVendorAccess();
    setPriceButtons(true);
    const response = await chrome.runtime.sendMessage({
      type: "MERAV_START_PRICE_QUEUE",
      projectId,
      mode,
    });
    if (!response?.ok) throw new Error(response?.error || "Could not start pricing.");
    setStatus(
      response.total
        ? `Starting ${response.total} product${response.total === 1 ? "" : "s"}...`
        : "No linked products need this check.",
    );
  } catch (error) {
    setPriceButtons(false);
    setStatus(error instanceof Error ? error.message : "Could not start pricing.", true);
  }
}

async function updateCurrentPagePrice() {
  const projectId = document.getElementById("projectSelect").value;
  if (!projectId) return setStatus("Choose a project first.", true);
  try {
    await requestVendorAccess();
    const response = await chrome.runtime.sendMessage({
      type: "MERAV_UPDATE_CURRENT_PRICE",
      projectId,
    });
    if (!response?.ok) throw new Error(response?.error || "Could not update price.");
    setStatus(
      response.status === "unresolved"
        ? "No reliable price found on this page."
        : "Current page price updated in Studio.",
    );
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Could not update price.", true);
  }
}

async function loadPriceQueue() {
  const response = await chrome.runtime.sendMessage({ type: "MERAV_GET_PRICE_QUEUE" });
  if (response?.ok) renderPriceQueue(response.queue);
}

function renderPriceQueue(queue, message = "") {
  const summary = document.getElementById("queueSummary");
  const review = document.getElementById("priceReview");
  const approveButton = document.getElementById("approveChanges");
  if (!queue) {
    summary.textContent = "";
    review.textContent = "";
    approveButton.hidden = true;
    setPriceButtons(false);
    return;
  }
  const total = queue.items?.length || 0;
  summary.textContent =
    message ||
    (queue.running
      ? `Checking ${queue.processed || 0} of ${total} products...`
      : `Checked ${queue.processed || 0} products. ${queue.saved || 0} saved, ${queue.matched || 0} matched, ${(queue.unresolved || []).length} need review.`);
  review.textContent = "";
  (queue.changes || []).forEach((change, index) => {
    const row = document.createElement("div");
    row.className = "price-change";
    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = true;
    checkbox.dataset.index = String(index);
    label.append(
      checkbox,
      ` ${change.label || "Product"}: ${change.currentPrice} -> ${change.livePrice}`,
    );
    const link = document.createElement("a");
    link.href = change.sourcePageUrl;
    link.target = "_blank";
    link.textContent = change.sourcePageUrl;
    row.append(label, link);
    review.appendChild(row);
  });
  approveButton.hidden = !(queue.changes || []).length;
  setPriceButtons(Boolean(queue.running));
}

async function approveSelectedPriceChanges() {
  const projectId = document.getElementById("projectSelect").value;
  const response = await chrome.runtime.sendMessage({ type: "MERAV_GET_PRICE_QUEUE" });
  const changes = response?.queue?.changes || [];
  const selected = Array.from(document.querySelectorAll("#priceReview input:checked"))
    .map((input) => changes[Number(input.dataset.index)])
    .filter(Boolean)
    .map((change) => ({
      materialItemId: change.materialItemId,
      price: change.livePrice,
      sourcePageUrl: change.sourcePageUrl,
    }));
  if (!selected.length) return setStatus("Select at least one changed price.", true);
  try {
    const saved = await chrome.runtime.sendMessage({
      type: "MERAV_APPROVE_PRICE_CHANGES",
      projectId,
      changes: selected,
    });
    if (!saved?.ok) throw new Error(saved?.error || "Could not apply price changes.");
    setStatus(`${saved.updated || 0} price change${saved.updated === 1 ? "" : "s"} applied.`);
    await loadPriceQueue();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Could not apply price changes.", true);
  }
}

function setPriceButtons(disabled) {
  ["fillMissing", "verifyPrices", "updateCurrentPrice"].forEach((id) => {
    document.getElementById(id).disabled = disabled;
  });
}

function normalizeStudioUrl(value) {
  return String(value || DEFAULT_STUDIO_URL).replace(/\/+$/, "") || DEFAULT_STUDIO_URL;
}
