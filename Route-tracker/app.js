import { STORES, dbPut, dbGetAll, exportAll, importAll, dbClear } from "./db.js";

const $ = (id) => document.getElementById(id);

const state = {
  customers: [],
  visits: [],
  dueFilter: "all",
};
let pendingConfirm = false;

function uid(prefix = "id") {
  return `${prefix}_${crypto.randomUUID()}`;
}

function formatDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function buildLatestVisitMap() {
  // Returns: { [customerId]: visitDateISO }
  const map = {};
  for (const v of (state.visits || [])) {
    if (!v.customerId || !v.visitDate) continue;
    const cur = map[v.customerId];
    if (!cur || v.visitDate > cur) map[v.customerId] = v.visitDate; // ISO strings compare fine
  }
  return map;
}
function isoFromDateInput(dateStr) {
  // dateStr is "YYYY-MM-DD"
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return null;

  // Create a local-midnight Date, then convert to ISO
  const dt = new Date(y, m - 1, d);
  dt.setHours(0, 0, 0, 0);
  return dt.toISOString();
}

function dateInputFromISO(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  // Convert to YYYY-MM-DD in local time
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function clampWeeks(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 4;
  return Math.max(1, Math.min(12, Math.trunc(x)));
}

function computeNextDue(visitDateISO, weeks) {
  const d = new Date(visitDateISO);
  const days = clampWeeks(weeks) * 7;
  d.setDate(d.getDate() + days);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function diffDays(fromISO, toISO) {
  const a = new Date(fromISO);
  const b = new Date(toISO);
  a.setHours(0, 0, 0, 0);
  b.setHours(0, 0, 0, 0);
  return Math.round((b - a) / (1000 * 60 * 60 * 24));
}

function setStatus(el, msg) {
  el.textContent = msg;
  if (!msg) return;
  window.clearTimeout(el._t);
  el._t = window.setTimeout(() => (el.textContent = ""), 3500);
}

function switchTab(tabName) {
  document.querySelectorAll(".tab").forEach((b) => {
    const active = b.dataset.tab === tabName;
    b.classList.toggle("active", active);
    b.setAttribute("aria-selected", active ? "true" : "false");
  });
  document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
  $(
    `tab-${tabName}`
  ).classList.add("active");
}

function sortCustomersByName(a, b) {
  return (a.name || "").localeCompare(b.name || "");
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function renderCustomerSelect(filterText = "") {
  const sel = $("customerSelect");
  sel.innerHTML = "";

  const f = (filterText || "").trim().toLowerCase();
  const list = state.customers
    .filter((c) => c.active !== false)
    .filter((c) => !f || c.name.toLowerCase().includes(f))
    .sort(sortCustomersByName);

  for (const c of list) {
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = c.city ? `${c.name} (${c.city})` : c.name;
    sel.appendChild(opt);
  }

  if (!sel.value && list.length) sel.value = list[0].id;
}

function renderNextDuePreview() {
  const weeks = clampWeeks($("followWeeks").value);

  const visitDateISO = isoFromDateInput($("visitDate")?.value);
  if (!visitDateISO) {
    $("nextDuePreview").textContent = `Next due: —`;
    return;
  }

  const nextDue = computeNextDue(visitDateISO, weeks);
  $("nextDuePreview").textContent = `Next due: ${formatDate(nextDue)}`;
}

function renderCustomerTable(filterText = "") {
  const body = $("customerTableBody");
  body.innerHTML = "";

  const f = (filterText || "").trim().toLowerCase();
  const list = state.customers
    .filter((c) => c.active !== false)
    .filter((c) => !f || `${c.name} ${c.city || ""} ${c.tier || ""}`.toLowerCase().includes(f))
    .sort(sortCustomersByName);
    
	const latestVisit = buildLatestVisitMap();

  for (const c of list) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(c.name)}</td>
      <td>${escapeHtml(c.city || "")}</td>
      <td>${escapeHtml(c.tier || "")}</td>
        <td class="muted">
    ${latestVisit[c.id] ? formatDate(latestVisit[c.id]) : "—"}</td>
      <td>${formatDate(c.nextDue || null)}</td>
      <td><button class="danger" data-del="${c.id}" type="button">Archive</button></td>
    `;
    body.appendChild(tr);
  }

  body.querySelectorAll("button[data-del]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-del");
      const c = state.customers.find((x) => x.id === id);
      if (!c) return;
      if (!confirm(`Archive "${c.name}"? (keeps visit history)`)) return;

      c.active = false;
      await dbPut(STORES.customers, c);
      await refreshAll();
    });
  });
}

function latestVisitForCustomer(customerId) {
  const v = state.visits
    .filter((x) => x.customerId === customerId)
    .sort((a, b) => (b.visitDate || "").localeCompare(a.visitDate || ""))[0];
  return v || null;
}

function renderDueTable() {
  const body = $("dueTableBody");
  body.innerHTML = "";

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayISO = today.toISOString();

  const rows = state.customers
    .filter((c) => c.active !== false)
    .map((c) => {
      const lv = latestVisitForCustomer(c.id);
      const nextDue = c.nextDue || (lv ? lv.nextDue : null);
      const days = nextDue ? diffDays(todayISO, nextDue) : null;
      return {
        customer: c,
        nextDue,
        days,
        lastVisit: lv?.visitDate || null,
        lastSale: lv?.salesAmount ?? null,
        lastNotes: lv?.notes ?? "",
        city: c.city || "",
      };
    })
    .filter((r) => {
      if (!r.nextDue) return state.dueFilter === "all";
      if (state.dueFilter === "all") return true;
      if (state.dueFilter === "overdue") return r.days !== null && r.days < 0;
      const n = Number(state.dueFilter);
      if (Number.isFinite(n)) return r.days !== null && r.days <= n;
      return true;
    })
    .sort((a, b) => {
      const ad = a.nextDue || "9999-12-31";
      const bd = b.nextDue || "9999-12-31";
      return ad.localeCompare(bd);
    });

  for (const r of rows) {
    const tr = document.createElement("tr");

    if (r.days !== null && r.days < 0) tr.classList.add("overdue");
    if (r.days !== null && r.days >= 0 && r.days <= 7) tr.classList.add("due-soon");

    tr.innerHTML = `
      <td>${escapeHtml(r.customer.name)}</td>
      <td>${escapeHtml(r.city)}</td>
      <td class="muted">${r.lastVisit ? formatDate(r.lastVisit) : "—"}</td>
      <td>${formatDate(r.nextDue)}</td>
      <td>${r.days === null ? "—" : r.days}</td>
      <td>${r.lastSale === null || r.lastSale === "" ? "—" : Number(r.lastSale).toFixed(2)}</td>
      <td>${escapeHtml((r.lastNotes || "").slice(0, 90))}${(r.lastNotes || "").length > 90 ? "…" : ""}</td>
    `;
    body.appendChild(tr);
  }
}

async function refreshAll() {
  state.customers = await dbGetAll(STORES.customers);
  state.visits = await dbGetAll(STORES.visits);

  renderCustomerSelect($("customerSearch").value);
  renderCustomerTable($("customerListSearch").value);
  renderDueTable();
  renderNextDuePreview();
}

async function addCustomer({ name, city, tier, defaultWeeks }) {
  const now = new Date().toISOString();
  const customer = {
    id: uid("cust"),
    name: name.trim(),
    city: (city || "").trim(),
    tier: tier || "",
    defaultWeeks: defaultWeeks ? clampWeeks(defaultWeeks) : null,
    nextDue: null,
    active: true,
    createdAt: now,
    updatedAt: now,
  };
  await dbPut(STORES.customers, customer);
}

async function saveVisit() {
  const sel = $("customerSelect");
  const customerId = sel.value;
  const customer = state.customers.find((c) => c.id === customerId);

  if (!customer) {
    setStatus($("logStatus"), "Pick a customer first.");
    return;
  }

  const weeks = clampWeeks($("followWeeks").value);
  const salesRaw = $("salesAmount").value;
  const salesAmount = salesRaw === "" ? null : Number(salesRaw);
  const notes = $("visitNotes").value || "";

  const visitDateISO = isoFromDateInput($("visitDate")?.value);
if (!visitDateISO) {
  setStatus($("logStatus"), "Pick a visit date.");
  return;
}

const nextDue = computeNextDue(visitDateISO, weeks);

  const visit = {
    id: uid("visit"),
    customerId,
    visitDate: visitDateISO,
    followupWeeks: weeks,
    nextDue,
    salesAmount: Number.isFinite(salesAmount) ? salesAmount : null,
    notes,
    createdAt: new Date().toISOString(),
  };

  await dbPut(STORES.visits, visit);

  customer.nextDue = nextDue;
  customer.updatedAt = new Date().toISOString();
  await dbPut(STORES.customers, customer);

  $("salesAmount").value = "";
  $("visitNotes").value = "";

  const vd = $("visitDate");
if (vd) {
  const now = new Date();
  now.setHours(0,0,0,0);
  vd.value = dateInputFromISO(now.toISOString());
}
renderNextDuePreview();

  setStatus($("logStatus"), `Saved. Next due: ${formatDate(nextDue)}`);
  await refreshAll();
}

function wireTabs() {
  document.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });
}

function wireWeeks() {
  $("followWeeks").addEventListener("input", renderNextDuePreview);
  $("visitDate")?.addEventListener("change", renderNextDuePreview);
  document.querySelectorAll(".pill").forEach((b) => {
    b.addEventListener("click", () => {
      $("followWeeks").value = b.dataset.weeks;
      renderNextDuePreview();
    });
  });
}

function wireCustomerSearch() {
  $("customerSearch").addEventListener("input", (e) => {
    renderCustomerSelect(e.target.value);
  });
  $("customerListSearch").addEventListener("input", (e) => {
    renderCustomerTable(e.target.value);
  });
}

function wireAddCustomer() {
  $("addCustomer").addEventListener("click", async () => {
    const name = $("custName").value.trim();
    const city = $("custCity").value.trim();
    const tier = $("custTier").value;
    const def = $("custDefaultWeeks").value;

    if (!name) {
      setStatus($("custStatus"), "Customer name is required.");
      return;
    }

    await addCustomer({ name, city, tier, defaultWeeks: def || null });

    $("custName").value = "";
    $("custCity").value = "";
    $("custTier").value = "";
    $("custDefaultWeeks").value = "";

    setStatus($("custStatus"), "Customer added.");
    await refreshAll();
  });

  $("newCustomerQuick").addEventListener("click", () => {
    switchTab("customers");
    $("custName").focus();
  });
}

function wireDefaultWeeksOnSelect() {
  $("customerSelect").addEventListener("change", () => {
    const c = state.customers.find((x) => x.id === $("customerSelect").value);
    if (c?.defaultWeeks) {
      $("followWeeks").value = clampWeeks(c.defaultWeeks);
      renderNextDuePreview();
    }
  });
}

function wireDueFilters() {
  document.querySelectorAll(".filter-btn").forEach((b) => {
    b.addEventListener("click", () => {
      state.dueFilter = b.dataset.filter;
      renderDueTable();
    });
  });
}

function wireRefreshButtons() {
  $("refreshCustomers").addEventListener("click", refreshAll);
  $("refreshDue").addEventListener("click", refreshAll);
}

// ---- Backup helpers (JSON + CSV + nag banner) ----

function buildConfirmText() {
  const customerId = $("customerSelect")?.value;
  const c = state.customers.find(x => x.id === customerId);

  const visitDateISO = isoFromDateInput($("visitDate")?.value);
  const weeks = clampWeeks($("followWeeks")?.value);
  const nextDue = visitDateISO ? computeNextDue(visitDateISO, weeks) : null;

  const salesRaw = $("salesAmount")?.value;
  const sales = salesRaw === "" ? null : Number(salesRaw);
  const notes = ($("visitNotes")?.value || "").trim();

  const lines = [];
  lines.push(`Customer: ${c ? c.name : "—"}`);
  if (c?.city) lines.push(`City: ${c.city}`);
  lines.push(`Visit date: ${visitDateISO ? formatDate(visitDateISO) : "—"}`);
  lines.push(`Follow-up: ${weeks} week(s)`);
  lines.push(`Next due: ${nextDue ? formatDate(nextDue) : "—"}`);
  lines.push(`Sales: ${Number.isFinite(sales) ? sales.toFixed(2) : "—"}`);
  lines.push(`Notes: ${notes ? notes : "—"}`);
  lines.push("");
lines.push("⚠️ If this is your last stop today, remember to tap");
lines.push("“Finished for Today” to back up your data.");

  return lines.join("\n");
}

function openConfirmModal() {
  // Basic validation so you don't confirm garbage
  const customerId = $("customerSelect")?.value;
  const c = state.customers.find(x => x.id === customerId);
  if (!c) {
    setStatus($("logStatus"), "Pick a customer first.");
    return;
  }

  const visitDateISO = isoFromDateInput($("visitDate")?.value);
  if (!visitDateISO) {
    setStatus($("logStatus"), "Pick a visit date.");
    return;
  }

  $("confirmSummary").textContent = buildConfirmText();
  $("confirmOverlay").classList.remove("hidden");
}

function closeConfirmModal() {
  $("confirmOverlay").classList.add("hidden");
}

function csvEscape(value) {
  const s = String(value ?? "");
  if (/[\",\n\r]/.test(s)) {
    return `"${s.replaceAll('"', '""')}"`;
  }
  return s;
}

function toCsv(rows, headers) {
  const lines = [];
  lines.push(headers.map(csvEscape).join(","));
  for (const row of rows) {
    lines.push(headers.map((h) => csvEscape(row[h])).join(","));
  }
  return lines.join("\n");
}

function downloadTextFile(filename, text, mime = "text/plain") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function setLastBackupNow() {
  localStorage.setItem("rt_last_backup", new Date().toISOString());
}

function getLastBackupLabel() {
  const iso = localStorage.getItem("rt_last_backup");
  if (!iso) return "Never";
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function daysSinceISO(iso) {
  if (!iso) return Infinity;
  const d = new Date(iso);
  d.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.floor((today - d) / 86400000);
}

function todayKey() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

function updateBackupBanner() {
  const banner = $("backupBanner");
  const detail = $("backupBannerDetail");
  if (!banner || !detail) return;

  const last = localStorage.getItem("rt_last_backup");
  detail.textContent = `Last backup: ${getLastBackupLabel()}`;

  const dismissedOn = localStorage.getItem("rt_backup_banner_dismissed_on");
  const overdue = daysSinceISO(last) >= 7;
  const dismissedToday = dismissedOn === todayKey();

  if (overdue && !dismissedToday) banner.classList.remove("hidden");
  else banner.classList.add("hidden");
}

function wireBackupBanner() {
  const nowBtn = $("backupNowBtn");
  const dismissBtn = $("dismissBackupBannerBtn");

  if (nowBtn) {
    nowBtn.addEventListener("click", () => {
      switchTab("data");
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  if (dismissBtn) {
    dismissBtn.addEventListener("click", () => {
      localStorage.setItem("rt_backup_banner_dismissed_on", todayKey());
      updateBackupBanner();
    });
  }
}

function wireDataTools() {
  $("exportJson").addEventListener("click", async () => {
    const payload = await exportAll();
    downloadTextFile(
      `route-tracker-backup-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(payload, null, 2),
      "application/json"
    );

    setLastBackupNow();
    const label = $("lastBackupLabel");
    if (label) label.textContent = `Last backup: ${getLastBackupLabel()}`;
    updateBackupBanner();

    setStatus($("dataStatus"), "Exported JSON backup.");
  });

  $("exportCustomersCsv").addEventListener("click", async () => {
    await refreshAll();

    const headers = ["id", "name", "city", "tier", "defaultWeeks", "nextDue", "active", "createdAt", "updatedAt"];
    const rows = state.customers.map((c) => ({
      id: c.id,
      name: c.name,
      city: c.city || "",
      tier: c.tier || "",
      defaultWeeks: c.defaultWeeks ?? "",
      nextDue: c.nextDue || "",
      active: c.active !== false,
      createdAt: c.createdAt || "",
      updatedAt: c.updatedAt || "",
    }));

    downloadTextFile(
      `route-tracker-customers-${new Date().toISOString().slice(0, 10)}.csv`,
      toCsv(rows, headers),
      "text/csv"
    );

    setLastBackupNow();
    const label = $("lastBackupLabel");
    if (label) label.textContent = `Last backup: ${getLastBackupLabel()}`;
    updateBackupBanner();

    setStatus($("dataStatus"), "Exported Customers CSV.");
  });

  $("exportVisitsCsv").addEventListener("click", async () => {
    await refreshAll();

    const headers = ["id", "customerId", "visitDate", "followupWeeks", "nextDue", "salesAmount", "notes", "createdAt"];
    const rows = state.visits.map((v) => ({
      id: v.id,
      customerId: v.customerId,
      visitDate: v.visitDate || "",
      followupWeeks: v.followupWeeks ?? "",
      nextDue: v.nextDue || "",
      salesAmount: v.salesAmount ?? "",
      notes: v.notes || "",
      createdAt: v.createdAt || "",
    }));

    downloadTextFile(
      `route-tracker-visits-${new Date().toISOString().slice(0, 10)}.csv`,
      toCsv(rows, headers),
      "text/csv"
    );

    setLastBackupNow();
    const label = $("lastBackupLabel");
    if (label) label.textContent = `Last backup: ${getLastBackupLabel()}`;
    updateBackupBanner();

    setStatus($("dataStatus"), "Exported Visits CSV.");
  });

  $("importJson").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      await importAll(payload);
      setStatus($("dataStatus"), "Import complete.");
      e.target.value = "";
      await refreshAll();

      const label = $("lastBackupLabel");
      if (label) label.textContent = `Last backup: ${getLastBackupLabel()}`;
      updateBackupBanner();
    } catch (err) {
      setStatus($("dataStatus"), `Import failed: ${err.message || err}`);
    }
  });

  $("wipeData").addEventListener("click", async () => {
    if (!confirm("Wipe ALL local data on this device? This cannot be undone.")) return;
    await Promise.all([dbClear(STORES.customers), dbClear(STORES.visits)]);
    setStatus($("dataStatus"), "Local data wiped.");
    await refreshAll();
    updateBackupBanner();
  });
}

function wireSaveVisit() {
  $("saveVisit").addEventListener("click", () => {
    if (pendingConfirm) return;
    openConfirmModal();
  });

  $("confirmCancel")?.addEventListener("click", () => {
    closeConfirmModal();
  });

  $("confirmOverlay")?.addEventListener("click", (e) => {
    // Click outside modal closes it
    if (e.target && e.target.id === "confirmOverlay") closeConfirmModal();
  });

  $("confirmSave")?.addEventListener("click", async () => {
    if (pendingConfirm) return;
    pendingConfirm = true;
    try {
      await saveVisit();
      closeConfirmModal();
    } finally {
      pendingConfirm = false;
    }
  });
   $("finishDayBtn")?.addEventListener("click", async () => {
  const msg =
    "End-of-day backup\n\n" +
    "Next, iPad will download a JSON backup file.\n\n" +
    "IMPORTANT: Save it somewhere safe:\n" +
    "• On the next screen, tap the Share button (top-right)\n" +
    "• Tap Save To Files (may need to click the ... button to find)\n" +
    "• Save to Files → create a folder and save your backups there. (recommend using iCloud drive)\n\n";
    

  if (!confirm(msg)) return;

  try {
    // Make sure state is current before export
    await refreshAll();

    // Reuse the existing Data tab export logic
    const exportBtn = $("exportJson");
    if (!exportBtn) {
      setStatus($("logStatus"), "Export JSON button not found (Data tab).");
      return;
    }

    exportBtn.click();

    setStatus($("logStatus"), "Backup started. Save it to Files/iCloud.");
  } catch (err) {
    console.error(err);
    setStatus($("logStatus"), "Backup export failed.");
  }
});
}

async function seedIfEmpty() {
  const customers = await dbGetAll(STORES.customers);
  if (customers.length) return;
  await addCustomer({ name: "Sample Customer", city: "Utah County", tier: "B", defaultWeeks: 4 });
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("./sw.js");
  } catch {
    // ignore
  }
}

(async function init() {
  // Wiring
  wireTabs();
  wireWeeks();
  wireCustomerSearch();
  wireAddCustomer();
  wireDefaultWeeksOnSelect();
  wireDueFilters();
  wireRefreshButtons();
  wireDataTools();
  wireSaveVisit();
  wireBackupBanner();

  await seedIfEmpty();
  await refreshAll();
  const vd = $("visitDate");
if (vd && !vd.value) {
  const now = new Date();
  now.setHours(0,0,0,0);
  vd.value = dateInputFromISO(now.toISOString());
}
  await registerServiceWorker();

  const label = $("lastBackupLabel");
  if (label) label.textContent = `Last backup: ${getLastBackupLabel()}`;
  updateBackupBanner();
})();
