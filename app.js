(() => {
  const DB_NAME = 'herdlook';
  const DB_VERSION = 1;
  const STORE_NAME = 'appdata';
  const STORE_KEY = 'main';

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'key' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function dbSave(data) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put({ key: STORE_KEY, ...data });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function dbLoad() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(STORE_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async function dbClear() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function hashPin(pin) {
    const encoder = new TextEncoder();
    const data = encoder.encode(pin);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }


  // ===== BETA LIMITS =====
  const BETA_LIMITS = {
    maxAnimals: 2,
    maxLocations: 1,
    maxDocuments: 1,
    isBeta: true
  };

  const betaOverLimit = (type, current) => {
    const limits = { animals: BETA_LIMITS.maxAnimals, locations: BETA_LIMITS.maxLocations, documents: BETA_LIMITS.maxDocuments };
    const max = limits[type];
    if (current >= max) {
      alert(`Beta limit: ${max} ${type === 'animals' ? (max === 1 ? 'animal' : 'animals') : type === 'documents' ? (max === 1 ? 'document' : 'documents') : (max === 1 ? 'location' : 'locations')} max. Upgrade to the full version for unlimited ${type}.`);
      return true;
    }
    return false;
  };
  const state = {
    animals: [],
    records: [],
    documents: [],
    locations: [],
    profile: {},
    security: { pin: "" },
    locked: false,
    view: "dashboard",
    selectedAnimalId: null,
    tempPhotos: []
  };

  const $ = (id) => document.getElementById(id);

  const save = async () => {
    try {
      await dbSave({
        animals: state.animals,
        records: state.records,
        documents: state.documents,
        locations: state.locations,
        profile: state.profile,
        security: state.security
      });
    } catch (e) {
      console.error('Failed to save to IndexedDB:', e);
    }
  };

  const load = async () => {
    try {
      const result = await dbLoad();
      if (!result) return;
      const data = result;
      state.animals = Array.isArray(data.animals) ? data.animals : [];
      state.records = Array.isArray(data.records) ? data.records : [];
      state.documents = Array.isArray(data.documents) ? data.documents : [];
      state.locations = Array.isArray(data.locations) ? data.locations : [];
      state.profile = data.profile && typeof data.profile === "object" ? data.profile : {};
      state.security = data.security && typeof data.security === "object" ? data.security : { pin: "" };
    } catch {
      state.animals = [];
      state.records = [];
    }
  };

  const uid = () => crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random());

  const today = () => new Date().toISOString().slice(0, 10);

  const animalLabel = (a) => [a.code, a.name].filter(Boolean).join(" — ") || "Unnamed animal";

  const escapeHtml = (s = "") => String(s).replace(/[&<>"']/g, (m) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[m]));

  function setView(view) {
    state.view = view;
    document.querySelectorAll(".view").forEach(v => v.classList.add("hidden"));
    $(view + "View").classList.remove("hidden");

    document.querySelectorAll("#nav button").forEach(b => {
      b.classList.toggle("active", b.dataset.view === view);
    });

    const titles = {
      dashboard: ["Dashboard", "Manage animal profiles, photos, camera lookup, and herd records."],
      herd: ["Herd", "Search, edit, and review all animal profiles."],
      photoGuide: ["Photo Guide", "Capture the right animal reference photos for better lookup results."],
      lookup: ["Camera Lookup", "Take or upload a photo and confirm the suggested animal."],
      records: ["Records", "Health, weight, breeding, movement, vaccination, deworming, dehorning, AI, notes, and sale history."],
      documents: ["Documents", "Store vet papers, receipts, registration, test results, and other files."],
      locations: ["Map/Locations", "Track pastures, barns, pens, gates, and water points."],
      profile: ["Owner/Farm", "Owner, farm, ranch, vet, and emergency operation information."],
      instructions: ["How To", "Step-by-step instructions for using HerdLook beta."],
      privacy: ["Data/Privacy", "Local-only storage, backup, restore, and privacy information."],
      reports: ["Reports", "Export CSV files and print a herd report."],
      settings: ["Settings", "Manage beta data and next build steps."]
    };

    $("pageTitle").textContent = titles[view][0];
    $("pageSubtitle").textContent = titles[view][1];
    render();
  }

  function openModal(id) { $(id).classList.add("open"); }
  function closeModal(id) { $(id).classList.remove("open"); }

  async function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }

  function imageToCanvas(src, size = 32) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        const c = document.createElement("canvas");
        c.width = size;
        c.height = size;
        const ctx = c.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, size, size);
        resolve({ canvas: c, ctx });
      };
      img.onerror = reject;
      img.src = src;
    });
  }

  async function buildImageSignature(src) {
    const { ctx } = await imageToCanvas(src, 32);
    const data = ctx.getImageData(0, 0, 32, 32).data;

    let gray = [];
    let sum = 0;
    let hist = new Array(24).fill(0);

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const y = (r * 0.299 + g * 0.587 + b * 0.114);
      gray.push(y);
      sum += y;

      hist[Math.min(7, Math.floor(r / 32))]++;
      hist[8 + Math.min(7, Math.floor(g / 32))]++;
      hist[16 + Math.min(7, Math.floor(b / 32))]++;
    }

    const avg = sum / gray.length;
    const hash = gray.map(v => v >= avg ? "1" : "0").join("");
    const total = gray.length;
    hist = hist.map(v => v / total);

    return { hash, hist };
  }

  function compareSignatures(a, b) {
    if (!a || !b || !a.hash || !b.hash) return 0;

    let same = 0;
    const n = Math.min(a.hash.length, b.hash.length);
    for (let i = 0; i < n; i++) if (a.hash[i] === b.hash[i]) same++;

    const hashScore = same / n;

    let dist = 0;
    for (let i = 0; i < Math.min(a.hist.length, b.hist.length); i++) {
      dist += Math.abs(a.hist[i] - b.hist[i]);
    }

    const histScore = Math.max(0, 1 - dist / 6);
    return Math.round(((hashScore * 0.65) + (histScore * 0.35)) * 100);
  }

  function primaryPhoto(a) {
    return a.photos && a.photos[0] ? a.photos[0].src : "";
  }

  function renderDashboard() {
    const photoCount = state.animals.reduce((n, a) => n + (a.photos?.length || 0), 0);
    const dueSoon = state.records.filter(r => {
      if (!r.followUp) return false;
      const diff = (new Date(r.followUp) - new Date(today())) / (1000 * 60 * 60 * 24);
      return diff >= 0 && diff <= 14;
    }).length;

    // Beta limits banner
    const betaBanner = $("betaBanner");
    if (betaBanner) {
      const animalCount = state.animals.length;
      const locationCount = state.locations.length;
      betaBanner.innerHTML = `<strong>Beta Testing</strong> — Limited to ${BETA_LIMITS.maxAnimals} animals, ${BETA_LIMITS.maxLocations} location, and ${BETA_LIMITS.maxDocuments} document. You have used ${animalCount}/${BETA_LIMITS.maxAnimals} animals, ${locationCount}/${BETA_LIMITS.maxLocations} location, and ${state.documents.length}/${BETA_LIMITS.maxDocuments} document.`;
    }

    $("statAnimals").textContent = state.animals.length;
    $("statPhotos").textContent = photoCount;
    $("statRecords").textContent = state.records.length;
    $("statDue").textContent = dueSoon;

    $("recentAnimals").innerHTML = state.animals.slice(-5).reverse().map(a => `
      <div class="record">
        <strong>${escapeHtml(animalLabel(a))}</strong>
        <small>${escapeHtml(a.species || "")} • ${escapeHtml(a.location || "No location")} • ${escapeHtml(a.tag || "No tag/RFID")}</small>
      </div>
    `).join("") || `<div class="empty">No animals yet. Add your first animal profile.</div>`;

    $("recentRecords").innerHTML = state.records.slice(-5).reverse().map(r => {
      const a = state.animals.find(x => x.id === r.animalId);
      return `
        <div class="record">
          <strong>${escapeHtml(r.type)} — ${escapeHtml(a ? animalLabel(a) : "Unknown animal")}</strong>
          <small>${escapeHtml(r.date)}${r.followUp ? " • Follow-up: " + escapeHtml(r.followUp) : ""}</small>
          <p class="muted" style="margin:6px 0 0;">${escapeHtml(r.details)}</p>
        </div>
      `;
    }).join("") || `<div class="empty">No records yet.</div>`;
  }

  function renderHerd() {
    const q = $("herdSearch").value.trim().toLowerCase();
    const sp = $("speciesFilter").value;

    let animals = state.animals.filter(a => {
      const hay = [a.code, a.name, a.species, a.breed, a.sex, a.dob, a.tag, a.location, a.markings].join(" ").toLowerCase();
      return (!q || hay.includes(q)) && (!sp || a.species === sp);
    });

    $("animalList").innerHTML = animals.map(a => `
      <article class="card animal-card">
        <div class="animal-photo">
          ${primaryPhoto(a) ? `<img src="${primaryPhoto(a)}" alt="">` : `No photo`}
        </div>
        <div class="animal-body">
          <div class="row">
            <div>
              <strong>${escapeHtml(animalLabel(a))}</strong>
              <div class="muted">${escapeHtml(a.breed || "Breed not set")}</div>
            </div>
            <span class="pill">${escapeHtml(a.species)}</span>
          </div>
          <p class="muted">${escapeHtml(a.location || "No location")} • ${escapeHtml(a.tag || "No tag/RFID")}</p>
          <div class="actions">
            <button class="btn" onclick="HerdLook.openProfile('${a.id}')">Open</button>
            <button class="btn" onclick="HerdLook.editAnimal('${a.id}')">Edit</button>
            <button class="btn primary" onclick="HerdLook.addRecordFor('${a.id}')">Add Record</button>
          </div>
        </div>
      </article>
    `).join("") || `<div class="empty">No matching animals. Add a new profile or change your search.</div>`;
  }

  function renderRecordAnimalSelect() {
    $("recordAnimal").innerHTML = state.animals.map(a => `<option value="${a.id}">${escapeHtml(animalLabel(a))}</option>`).join("");
  }

  function renderRecords() {
    const q = $("recordSearch").value.trim().toLowerCase();
    const type = $("recordTypeFilter").value;

    const rows = state.records.slice().reverse().filter(r => {
      const a = state.animals.find(x => x.id === r.animalId);
      const hay = [r.type, r.date, r.followUp, r.details, a ? animalLabel(a) : ""].join(" ").toLowerCase();
      return (!q || hay.includes(q)) && (!type || r.type === type);
    });

    $("allRecords").innerHTML = rows.map(r => {
      const a = state.animals.find(x => x.id === r.animalId);
      return `
        <div class="record">
          <div class="row">
            <div>
              <strong>${escapeHtml(r.type)} — ${escapeHtml(a ? animalLabel(a) : "Unknown animal")}</strong>
              <small>${escapeHtml(r.date)}${r.followUp ? " • Follow-up: " + escapeHtml(r.followUp) : ""}</small>
            </div>
            <button class="btn danger" onclick="HerdLook.deleteRecord('${r.id}')">Delete</button>
          </div>
          <p>${escapeHtml(r.details)}</p>
        </div>
      `;
    }).join("") || `<div class="empty">No records found.</div>`;
  }


  function renderOwnerFarmSummary() {
    const p = state.profile || {};
    $("ownerFarmSummary").innerHTML = `
      <div class="summary-box"><small>Owner</small>${escapeHtml(p.ownerName || "Not set")}</div>
      <div class="summary-box"><small>Farm/Ranch</small>${escapeHtml(p.farmName || "Not set")}</div>
      <div class="summary-box"><small>Contact</small>${escapeHtml([p.ownerPhone, p.ownerEmail].filter(Boolean).join(" • ") || "Not set")}</div>
      <div class="summary-box"><small>Vet / Emergency</small>${escapeHtml(p.vetInfo || "Not set")}</div>
    `;
  }

  function renderProfileForm() {
    const p = state.profile || {};
    $("ownerName").value = p.ownerName || "";
    $("farmName").value = p.farmName || "";
    $("ownerPhone").value = p.ownerPhone || "";
    $("ownerEmail").value = p.ownerEmail || "";
    $("farmAddress").value = p.farmAddress || "";
    $("farmType").value = p.farmType || "";
    $("vetInfo").value = p.vetInfo || "";
    $("farmNotes").value = p.farmNotes || "";
  }

  function renderDocumentAnimalSelect() {
    const options = [`<option value="">General farm/ranch document</option>`]
      .concat(state.animals.map(a => `<option value="${a.id}">${escapeHtml(animalLabel(a))}</option>`));
    $("documentAnimal").innerHTML = options.join("");
  }

  function renderDocuments() {
    renderDocumentAnimalSelect();
    $("documentList").innerHTML = state.documents.slice().reverse().map(d => {
      const a = state.animals.find(x => x.id === d.animalId);
      return `
        <div class="doc-item">
          <div class="row">
            <div>
              <a href="${d.src}" download="${escapeHtml(d.fileName || d.title)}">${escapeHtml(d.title)}</a>
              <div class="muted">${escapeHtml(d.type || "")} • ${escapeHtml(a ? animalLabel(a) : "General farm/ranch")} • ${escapeHtml(d.fileName || "")}</div>
            </div>
            <button class="btn danger" onclick="HerdLook.deleteDocument('${d.id}')">Delete</button>
          </div>
          ${d.notes ? `<p>${escapeHtml(d.notes)}</p>` : ""}
        </div>
      `;
    }).join("") || `<div class="empty">No documents stored yet.</div>`;
  }

  function renderLocations() {
    const box = $("mapBox");
    const pins = state.locations.map((l, i) => {
      const x = 18 + ((i * 23) % 68);
      const y = 28 + ((i * 17) % 58);
      return `<span class="map-pin" style="left:${x}%;top:${y}%;">${escapeHtml(l.name)}</span>`;
    }).join("");

    box.innerHTML = `
      <div>
        <strong>Beta field map</strong>
        <p style="margin:6px 0 0;">${state.locations.length ? "Locations are shown as planning pins." : "Add a location to place a pin."}</p>
      </div>
      ${pins}
    `;

    $("locationList").innerHTML = state.locations.map(l => `
      <div class="location-item">
        <div class="row">
          <div>
            <strong>${escapeHtml(l.name)}</strong>
            <div class="muted">${escapeHtml(l.type || "")}${l.lat || l.lng ? " • GPS: " + escapeHtml([l.lat, l.lng].filter(Boolean).join(", ")) : ""}</div>
          </div>
          <button class="btn danger" onclick="HerdLook.deleteLocation('${l.id}')">Delete</button>
        </div>
        ${l.notes ? `<p>${escapeHtml(l.notes)}</p>` : ""}
      </div>
    `).join("") || `<div class="empty">No locations yet. Add pastures, barns, gates, pens, and water points.</div>`;
  }

  function renderLockState() {
    if (state.security?.pin && state.locked) {
      $("lockScreen").classList.add("active");
      $("unlockPin").focus();
    } else {
      $("lockScreen").classList.remove("active");
    }
  }

  function renderReports() {
    const herdRows = state.animals.map(a => `
      <tr>
        <td>${escapeHtml(animalLabel(a))}</td>
        <td>${escapeHtml(a.species)}</td>
        <td>${escapeHtml(a.breed || "")}</td>
        <td>${escapeHtml(a.tag || "")}</td>
        <td>${escapeHtml(a.location || "")}</td>
      </tr>
    `).join("");

    const recRows = state.records.slice(-10).reverse().map(r => {
      const a = state.animals.find(x => x.id === r.animalId);
      return `
        <tr>
          <td>${escapeHtml(r.date)}</td>
          <td>${escapeHtml(r.type)}</td>
          <td>${escapeHtml(a ? animalLabel(a) : "")}</td>
          <td>${escapeHtml(r.details)}</td>
        </tr>
      `;
    }).join("");

    const p = state.profile || {};
    $("reportPreview").innerHTML = `
      <h4>Owner / Farm</h4>
      <p><strong>${escapeHtml(p.farmName || "Farm/Ranch not set")}</strong><br>
      Owner: ${escapeHtml(p.ownerName || "Not set")}<br>
      Contact: ${escapeHtml([p.ownerPhone, p.ownerEmail].filter(Boolean).join(" • ") || "Not set")}<br>
      Address: ${escapeHtml(p.farmAddress || "Not set")}<br>
      Vet: ${escapeHtml(p.vetInfo || "Not set")}</p>

      <h4>Herd Summary</h4>
      <table style="width:100%;border-collapse:collapse;" border="1" cellpadding="8">
        <thead><tr><th>Animal</th><th>Species</th><th>Breed</th><th>Tag/RFID</th><th>Location</th></tr></thead>
        <tbody>${herdRows || `<tr><td colspan="5">No animals</td></tr>`}</tbody>
      </table>

      <h4>Recent Records</h4>
      <table style="width:100%;border-collapse:collapse;" border="1" cellpadding="8">
        <thead><tr><th>Date</th><th>Type</th><th>Animal</th><th>Details</th></tr></thead>
        <tbody>${recRows || `<tr><td colspan="4">No records</td></tr>`}</tbody>
      </table>
    `;
  }

  function renderAnimalPhotoPreview() {
    const count = state.tempPhotos.length;
    const status = count >= 6
      ? "Good reference set: 6+ photos saved."
      : count >= 3
        ? "Minimum beta set reached. Add 3 more photos for better lookup."
        : `Add at least ${3 - count} more photo${3 - count === 1 ? "" : "s"} before relying on camera lookup.`;
    $("photoCountHint").textContent = `${count} reference photo${count === 1 ? "" : "s"} added. ${status}`;
    $("animalPhotoPreview").innerHTML = state.tempPhotos.map(p => `
      <div class="photo-thumb">
        <img src="${p.src}" alt="">
        <small>${escapeHtml(p.angle || "Reference")}</small>
      </div>
    `).join("");
  }

  function renderProfile(tab = "overview") {
    const a = state.animals.find(x => x.id === state.selectedAnimalId);
    if (!a) return;

    $("profileTitle").textContent = animalLabel(a);
    $("profileSub").textContent = `${a.species || ""} • ${a.breed || "Breed not set"} • ${a.location || "No location"}`;

    document.querySelectorAll("[data-profile-tab]").forEach(b => {
      b.classList.toggle("active", b.dataset.profileTab === tab);
    });

    if (tab === "overview") {
      $("profileContent").innerHTML = `
        <div class="grid two">
          <div class="animal-photo" style="height:320px;border-radius:18px;">
            ${primaryPhoto(a) ? `<img src="${primaryPhoto(a)}" alt="">` : "No photo"}
          </div>
          <div class="card" style="box-shadow:none;">
            <h3 style="margin-top:0;">Profile</h3>
            <p><strong>Species:</strong> ${escapeHtml(a.species || "")}</p>
            <p><strong>Breed:</strong> ${escapeHtml(a.breed || "")}</p>
            <p><strong>Sex:</strong> ${escapeHtml(a.sex || "")}</p>
            <p><strong>Date of birth / age:</strong> ${escapeHtml(a.dob || "")}</p>
            <p><strong>Tag / RFID / microchip:</strong> ${escapeHtml(a.tag || "")}</p>
            <p><strong>Location:</strong> ${escapeHtml(a.location || "")}</p>
            <p><strong>Markings:</strong> ${escapeHtml(a.markings || "")}</p>
            <div class="actions">
              <button class="btn" onclick="HerdLook.editAnimal('${a.id}')">Edit Profile</button>
              <button class="btn primary" onclick="HerdLook.addRecordFor('${a.id}')">Add Record</button>
            </div>
          </div>
        </div>
      `;
    }

    if (tab === "photos") {
      $("profileContent").innerHTML = `
        <div class="photo-grid">
          ${(a.photos || []).map(p => `
            <div class="photo-thumb" style="height:180px;">
              <img src="${p.src}" alt="">
              <small>${escapeHtml(p.angle || "Reference")}</small>
            </div>
          `).join("") || `<div class="empty">No reference photos yet.</div>`}
        </div>
      `;
    }

    if (tab === "records") {
      const records = state.records.filter(r => r.animalId === a.id).slice().reverse();
      $("profileContent").innerHTML = `
        <div class="records">
          ${records.map(r => `
            <div class="record">
              <strong>${escapeHtml(r.type)} — ${escapeHtml(r.date)}</strong>
              <small>${r.followUp ? "Follow-up: " + escapeHtml(r.followUp) : ""}</small>
              <p>${escapeHtml(r.details)}</p>
            </div>
          `).join("") || `<div class="empty">No records yet for this animal.</div>`}
        </div>
      `;
    }
  }

  function render() {
    renderOwnerFarmSummary();
    renderProfileForm();
    renderDashboard();
    renderHerd();
    renderRecordAnimalSelect();
    renderDocumentAnimalSelect();
    renderDocuments();
    renderLocations();
    renderRecords();
    renderReports();
    renderLockState();
  }

  function resetAnimalForm() {
    $("animalForm").reset();
    $("animalId").value = "";
    $("deleteAnimalBtn").classList.add("hidden");
    $("animalModalTitle").textContent = "Add Animal";
    state.tempPhotos = [];
    renderAnimalPhotoPreview();
  }

  function editAnimal(id) {
    const a = state.animals.find(x => x.id === id);
    if (!a) return;
    $("animalId").value = a.id;
    $("animalCode").value = a.code || "";
    $("animalName").value = a.name || "";
    $("animalSpecies").value = a.species || "Cattle";
    $("animalBreed").value = a.breed || "";
    $("animalSex").value = a.sex || "";
    $("animalDob").value = a.dob || "";
    $("animalTag").value = a.tag || "";
    $("animalLocation").value = a.location || "";
    $("animalMarkings").value = a.markings || "";
    state.tempPhotos = a.photos ? structuredClone(a.photos) : [];
    $("deleteAnimalBtn").classList.remove("hidden");
    $("animalModalTitle").textContent = "Edit Animal";
    renderAnimalPhotoPreview();
    openModal("animalModal");
  }

  async function handleAnimalPhotos(files) {
    for (const file of files) {
      const src = await fileToDataUrl(file);
      const signature = await buildImageSignature(src);
      state.tempPhotos.push({
        id: uid(),
        src,
        angle: "Reference",
        signature,
        createdAt: new Date().toISOString()
      });
    }
    renderAnimalPhotoPreview();
  }

  async function handleLookup(file) {
    if (!file) return;
    const src = await fileToDataUrl(file);
    $("lookupPreview").innerHTML = `<img src="${src}" alt="">`;
    $("matchResults").innerHTML = `<div class="empty">Scanning saved reference photos...</div>`;

    const sig = await buildImageSignature(src);
    const matches = state.animals.map(a => {
      const scores = (a.photos || []).map(p => compareSignatures(sig, p.signature));
      const best = scores.length ? Math.max(...scores) : 0;
      return { animal: a, score: best };
    }).filter(m => m.score > 0).sort((a, b) => b.score - a.score).slice(0, 3);

    if (!matches.length) {
      $("matchResults").innerHTML = `<div class="empty">No reference photos found. Add animal photos first.</div>`;
      return;
    }

    $("matchResults").innerHTML = matches.map(m => `
      <div class="match-card">
        ${primaryPhoto(m.animal) ? `<img src="${primaryPhoto(m.animal)}" alt="">` : `<div class="animal-photo">No photo</div>`}
        <div>
          <strong>${escapeHtml(animalLabel(m.animal))}</strong>
          <div class="muted">${escapeHtml(m.animal.species)} • ${escapeHtml(m.animal.location || "No location")} • ${escapeHtml(m.animal.tag || "No tag/RFID")}</div>
          <div class="progress"><span style="width:${m.score}%"></span></div>
          <small class="muted">${m.score}% suggested match. Please confirm.</small>
        </div>
        <button class="btn primary" onclick="HerdLook.confirmMatch('${m.animal.id}')">Confirm & Open</button>
      </div>
    `).join("");
  }

  function confirmMatch(id) {
    openProfile(id);
    setView("herd");
  }

  function openProfile(id) {
    state.selectedAnimalId = id;
    renderProfile("overview");
    openModal("profileModal");
  }

  function addRecordFor(id) {
    if (!state.animals.length) {
      alert("Add an animal first.");
      return;
    }
    $("recordForm").reset();
    $("recordDate").value = today();
    $("recordAnimal").value = id || state.animals[0].id;
    openModal("recordModal");
  }

  function csvDownload(filename, rows) {
    const csv = rows.map(row => row.map(v => {
      const s = String(v ?? "");
      return `"${s.replace(/"/g, '""')}"`;
    }).join(",")).join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }


  function fullBackupObject() {
    return {
      app: "HerdLook",
      version: "LV-1.2-local",
      exportedAt: new Date().toISOString(),
      storageMode: "local-only",
      cloudStorage: false,
      note: "This backup contains local HerdLook data. Store it safely.",
      data: {
        animals: state.animals,
        records: state.records,
        documents: state.documents,
        locations: state.locations,
        profile: state.profile,
        security: state.security
      }
    };
  }

  function exportFullBackup() {
    const stamp = new Date().toISOString().slice(0, 10);
    const backup = JSON.stringify(fullBackupObject(), null, 2);
    const blob = new Blob([backup], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `herdlook-local-backup-${stamp}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function importFullBackup(file) {
    if (BETA_LIMITS.isBeta) {
      alert("Backup import is disabled in the beta version. Upgrade to the full version to import backups.");
      return;
    }
    if (!file) {
      alert("Choose a HerdLook backup JSON file first.");
      return;
    }

    const text = await file.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      alert("This does not look like a valid JSON backup file.");
      return;
    }

    const data = parsed.data || parsed;
    const looksValid =
      Array.isArray(data.animals || []) &&
      Array.isArray(data.records || []);

    if (!looksValid) {
      alert("This does not look like a HerdLook backup file.");
      return;
    }

    if (!confirm("Import this backup? It will replace the current local HerdLook data in this browser.")) return;

    state.animals = Array.isArray(data.animals) ? data.animals : [];
    state.records = Array.isArray(data.records) ? data.records : [];
    state.documents = Array.isArray(data.documents) ? data.documents : [];
    state.locations = Array.isArray(data.locations) ? data.locations : [];
    state.profile = data.profile && typeof data.profile === "object" ? data.profile : {};
    state.security = data.security && typeof data.security === "object" ? data.security : { pin: "" };
    state.locked = false;

    await save();
    render();
    alert("Backup imported successfully.");
  }

  async function seedDemo(skipConfirm = false) {
    if (!skipConfirm && !confirm("Load demo herd data? This adds sample profiles and records.")) return;

    const bullId = uid();
    const cowId = uid();

    state.animals.push(
      {
        id: bullId,
        code: "Thunder",
        name: "Thunder",
        species: "Cattle",
        breed: "Black Angus",
        sex: "Male",
        dob: "2022-03-15",
        tag: "RFID-TAG-001",
        location: "North Pasture",
        markings: "Solid black Angus bull with a small white star on forehead.",
        photos: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      {
        id: cowId,
        code: "Midnight",
        name: "Midnight",
        species: "Cattle",
        breed: "Black Angus",
        sex: "Female",
        dob: "2023-06-20",
        tag: "RFID-TAG-002",
        location: "North Pasture",
        markings: "Solid black Angus cow with white socks on hind legs.",
        photos: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    );

    state.profile = {
      ownerName: "John Doe",
      farmName: "Happyland Ranch",
      ownerPhone: "(555) 000-0000",
      ownerEmail: "john@happylandranch.com",
      farmAddress: "000 Happyland Road, Nowhere USA",
      farmType: "Cattle ranch",
      vetInfo: "Happyland Veterinary Clinic — Dr. Smith (555) 000-1234",
      farmNotes: "Sample farm data for demonstration purposes."
    };

    const todayStr = today();

    state.locations.push(
      { id: uid(), name: "North Pasture", type: "Pasture", lat: "", lng: "", notes: "Primary cattle pasture with water trough and shade.", createdAt: new Date().toISOString() }
    );

    state.records.push(
      { id: uid(), animalId: bullId, type: "Health", date: todayStr, followUp: "", details: "Routine health check. No issues noted.", createdAt: new Date().toISOString() },
      { id: uid(), animalId: cowId, type: "Weight", date: todayStr, followUp: "", details: "Estimated 1,100 lb by tape. Good body condition score 6.", createdAt: new Date().toISOString() },
      { id: uid(), animalId: cowId, type: "Breeding", date: todayStr, followUp: "", details: "Bred to Thunder via AI. Confirmed pregnant via ultrasound.", createdAt: new Date().toISOString() },
      { id: uid(), animalId: bullId, type: "Movement", date: todayStr, followUp: "", details: "Moved from Barn 1 to North Pasture for spring grazing.", createdAt: new Date().toISOString() },
      { id: uid(), animalId: cowId, type: "Note", date: todayStr, followUp: "", details: "Mild limping observed on front left. Monitoring.", createdAt: new Date().toISOString() },
      { id: uid(), animalId: bullId, type: "Sale/Transfer", date: todayStr, followUp: "", details: "Potential buyer inquiry from Wilson Farm. No deal yet.", createdAt: new Date().toISOString() },
      { id: uid(), animalId: bullId, type: "Vaccination", date: todayStr, followUp: "", details: "Clostridial vaccine (8-way) administered. Next dose in 12 months.", createdAt: new Date().toISOString() },
      { id: uid(), animalId: cowId, type: "Dewormed", date: todayStr, followUp: "", details: "Ivermectin pour-on administered. Repeat in 6 months.", createdAt: new Date().toISOString() },
      { id: uid(), animalId: bullId, type: "Dehorned", date: todayStr, followUp: "", details: "Disbudded at 3 weeks of age. No horn regrowth.", createdAt: new Date().toISOString() },
      { id: uid(), animalId: cowId, type: "AI", date: todayStr, followUp: todayStr.replace(/-\d{2}$/, (m) => { const d = new Date(todayStr); d.setDate(d.getDate() + 283); return '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); }), details: "Artificial insemination performed. Expected calving date in approximately 283 days.", createdAt: new Date().toISOString() },
      { id: uid(), animalId: bullId, type: "Other", date: todayStr, followUp: "", details: "Trailer inspection completed before transport. All checks passed.", createdAt: new Date().toISOString() }
    );

    await save();
    render();
  }

  async function clearData() {
    if (!confirm("Clear all HerdLook data from this browser? This will remove all animals, records, documents, locations, and owner info.")) return;
    await dbClear();
    state.animals = [];
    state.records = [];
    state.documents = [];
    state.locations = [];
    state.profile = {};
    state.security = { pin: "" };
    state.locked = false;
    render();
  }

  document.querySelectorAll("#nav button").forEach(btn => {
    btn.addEventListener("click", () => setView(btn.dataset.view));
  });

  document.querySelectorAll("[data-go]").forEach(btn => {
    btn.addEventListener("click", () => setView(btn.dataset.go));
  });

  document.querySelectorAll("[data-close]").forEach(btn => {
    btn.addEventListener("click", () => closeModal(btn.dataset.close));
  });

  $("addAnimalBtn").addEventListener("click", () => { resetAnimalForm(); openModal("animalModal"); });
  $("addAnimalBtn2").addEventListener("click", () => { resetAnimalForm(); openModal("animalModal"); });
  $("quickLookupBtn").addEventListener("click", () => setView("lookup"));
  $("addRecordBtn").addEventListener("click", () => addRecordFor());
  $("herdSearch").addEventListener("input", renderHerd);
  $("speciesFilter").addEventListener("change", renderHerd);
  $("recordSearch").addEventListener("input", renderRecords);
  $("recordTypeFilter").addEventListener("change", renderRecords);
  $("seedDemoBtn").addEventListener("click", seedDemo);
  $("clearDataBtn").addEventListener("click", clearData);
  $("exportFullBackupBtn").addEventListener("click", exportFullBackup);
  $("exportFullBackupBtn2").addEventListener("click", exportFullBackup);
  $("importBackupBtn").addEventListener("click", () => importFullBackup($("importBackupFile").files[0]));

  $("profileForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    state.profile = {
      ownerName: $("ownerName").value.trim(),
      farmName: $("farmName").value.trim(),
      ownerPhone: $("ownerPhone").value.trim(),
      ownerEmail: $("ownerEmail").value.trim(),
      farmAddress: $("farmAddress").value.trim(),
      farmType: $("farmType").value.trim(),
      vetInfo: $("vetInfo").value.trim(),
      farmNotes: $("farmNotes").value.trim(),
      updatedAt: new Date().toISOString()
    };
    await save();
    render();
    alert("Owner/Farm info saved.");
  });

  $("documentForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (betaOverLimit("documents", state.documents.length)) return;
    const file = $("documentFile").files[0];
    if (!file) return;
    const src = await fileToDataUrl(file);
    state.documents.push({
      id: uid(),
      title: $("documentTitle").value.trim(),
      type: $("documentType").value,
      animalId: $("documentAnimal").value,
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      src,
      notes: $("documentNotes").value.trim(),
      createdAt: new Date().toISOString()
    });
    $("documentForm").reset();
    await save();
    render();
  });

  $("locationForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    // Beta limit: block adding new locations past the limit
    if (betaOverLimit("locations", state.locations.length)) return;
    state.locations.push({
      id: uid(),
      name: $("locationName").value.trim(),
      type: $("locationType").value,
      lat: $("locationLat").value.trim(),
      lng: $("locationLng").value.trim(),
      notes: $("locationNotes").value.trim(),
      createdAt: new Date().toISOString()
    });
    $("locationForm").reset();
    await save();
    render();
  });

  $("pinForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const pin = $("newPin").value;
    const confirmPin = $("confirmPin").value;
    if (!pin || pin.length < 4) {
      alert("Use at least 4 characters for the PIN/password.");
      return;
    }
    if (pin !== confirmPin) {
      alert("PIN/password confirmation does not match.");
      return;
    }
    const hash = await hashPin(pin);
    state.security = { pin: hash };
    $("pinForm").reset();
    await save();
    alert("PIN lock saved.");
  });

  $("lockNowBtn").addEventListener("click", async () => {
    if (!state.security?.pin) {
      alert("Set a PIN/password first.");
      return;
    }
    state.locked = true;
    renderLockState();
  });

  $("removePinBtn").addEventListener("click", async () => {
    if (!confirm("Remove the local PIN lock?")) return;
    state.security = { pin: "" };
    state.locked = false;
    await save();
    renderLockState();
  });

  $("unlockBtn").addEventListener("click", async () => {
    const inputHash = await hashPin($("unlockPin").value);
    if (inputHash === state.security?.pin) {
      state.locked = false;
      $("unlockPin").value = "";
      $("unlockError").style.display = "none";
      renderLockState();
    } else {
      $("unlockError").style.display = "block";
    }
  });

  $("unlockPin").addEventListener("keydown", (e) => {
    if (e.key === "Enter") $("unlockBtn").click();
  });

  $("animalPhotos").addEventListener("change", async (e) => {
    await handleAnimalPhotos(e.target.files);
    e.target.value = "";
  });

  $("lookupPhoto").addEventListener("change", async (e) => {
    await handleLookup(e.target.files[0]);
  });

  $("animalForm").addEventListener("submit", async (e) => {
    e.preventDefault();

    // Beta limit: block adding new animals past the limit
    const editId = $("animalId").value;
    if (!editId && betaOverLimit("animals", state.animals.length)) return;

    const id = editId || uid();
    const existing = state.animals.find(a => a.id === id);

    const animal = {
      id,
      code: $("animalCode").value.trim(),
      name: $("animalName").value.trim(),
      species: $("animalSpecies").value,
      breed: $("animalBreed").value.trim(),
      sex: $("animalSex").value,
      dob: $("animalDob").value.trim(),
      tag: $("animalTag").value.trim(),
      location: $("animalLocation").value.trim(),
      markings: $("animalMarkings").value.trim(),
      photos: state.tempPhotos,
      createdAt: existing?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    if (existing) {
      Object.assign(existing, animal);
    } else {
      state.animals.push(animal);
    }

    await save();
    closeModal("animalModal");
    render();
  });

  $("deleteAnimalBtn").addEventListener("click", async () => {
    const id = $("animalId").value;
    if (!id) return;
    if (!confirm("Delete this animal and its records?")) return;
    state.animals = state.animals.filter(a => a.id !== id);
    state.records = state.records.filter(r => r.animalId !== id);
    await save();
    closeModal("animalModal");
    render();
  });

  $("recordForm").addEventListener("submit", async (e) => {
    e.preventDefault();

    state.records.push({
      id: uid(),
      animalId: $("recordAnimal").value,
      type: $("recordType").value,
      date: $("recordDate").value,
      followUp: $("recordFollowUp").value,
      details: $("recordDetails").value.trim(),
      createdAt: new Date().toISOString()
    });

    await save();
    closeModal("recordModal");
    render();
    if (state.selectedAnimalId) renderProfile("records");
  });

  $("exportAnimalsCsv").addEventListener("click", () => {
    csvDownload("herdlook-animals.csv", [
      ["Animal ID", "Name", "Species", "Breed", "Sex", "DOB/Age", "Tag/RFID/Microchip", "Location", "Markings", "Photo Count"],
      ...state.animals.map(a => [a.code, a.name, a.species, a.breed, a.sex, a.dob, a.tag, a.location, a.markings, a.photos?.length || 0])
    ]);
  });

  $("exportRecordsCsv").addEventListener("click", () => {
    csvDownload("herdlook-records.csv", [
      ["Date", "Animal", "Type", "Follow-up", "Details"],
      ...state.records.map(r => {
        const a = state.animals.find(x => x.id === r.animalId);
        return [r.date, a ? animalLabel(a) : "", r.type, r.followUp, r.details];
      })
    ]);
  });

  document.querySelectorAll("[data-profile-tab]").forEach(btn => {
    btn.addEventListener("click", () => renderProfile(btn.dataset.profileTab));
  });

  window.HerdLook = {
    editAnimal,
    openProfile,
    addRecordFor,
    async deleteRecord(id) {
      if (!confirm("Delete this record?")) return;
      state.records = state.records.filter(r => r.id !== id);
      await save();
      render();
    },
    async deleteDocument(id) {
      if (!confirm("Delete this stored document?")) return;
      state.documents = state.documents.filter(d => d.id !== id);
      await save();
      render();
    },
    async deleteLocation(id) {
      if (!confirm("Delete this location?")) return;
      state.locations = state.locations.filter(l => l.id !== id);
      await save();
      render();
    },
    confirmMatch
  };

  (async () => {
    try {
      await load();
    } catch (e) {
      console.error('Failed to load data:', e);
    }
    // Auto-seed demo data on first launch (empty DB, never seeded before)
    if (state.animals.length === 0 && !localStorage.getItem('herdlook_beta_seeded')) {
      await seedDemo(true);
      localStorage.setItem('herdlook_beta_seeded', '1');
    }
    if (state.security?.pin) state.locked = true;
    render();
    renderProfileForm();
  })();
  $("recordDate").value = today();

  function toggleSidebar() {
    document.querySelector('.app').classList.toggle('sidebar-open');
  }

  function closeSidebar() {
    document.querySelector('.app').classList.remove('sidebar-open');
  }

  function openGettingStarted() {
    document.getElementById('gettingStartedModal').classList.add('open');
  }

  function closeGettingStarted() {
    document.getElementById('gettingStartedModal').classList.remove('open');
  }

  // Mobile: close sidebar when nav button is clicked
  document.querySelectorAll('#nav button').forEach(btn => {
    btn.addEventListener('click', () => {
      if (window.innerWidth <= 1050) closeSidebar();
    });
  });

  // Sidebar overlay click closes sidebar
  document.querySelector('.sidebar-overlay')?.addEventListener('click', closeSidebar);

  // Menu toggle
  document.getElementById('menuToggle')?.addEventListener('click', toggleSidebar);

  // Getting Started modal
  document.getElementById('gettingStartedBtn')?.addEventListener('click', openGettingStarted);
  document.getElementById('gettingStartedClose')?.addEventListener('click', closeGettingStarted);

  // Service worker registration
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();