// app.js - Catalog Jump
// Searches a local index (catalog_search_index.json) generated from catalog.pdf.
// Returns page links into DCatalog using ?page=.

const $ = (id) => document.getElementById(id);

let INDEX = null;

function norm(s) {
  return (s || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokens(s) {
  const n = norm(s);
  return n ? n.split(/\s+/).filter(Boolean) : [];
}

function escapeHtml(s) {
  return (s ?? "").toString()
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function pageUrl(pageNum) {
  const base = (window.DCATALOG_BASE_URL || "").replace(/\/?$/, "");
  const url = new URL(base);
  url.searchParams.set("page", String(pageNum));
  return url.toString();
}

function renderStatus(msg) {
  $("status").textContent = msg;
}

function renderResults(items) {
  const el = $("results");
  el.innerHTML = "";

  if (!items.length) {
    el.innerHTML = '<div class="small">No matches. Either the term is truly not there, or your PDF is text-hostile.</div>';
    return;
  }

  for (const it of items) {
    const card = document.createElement("div");
    card.className = "card";

    const url = pageUrl(it.page);
    const badges = [
      `<span class="badge">page ${it.page}</span>`,
      `<span class="badge">score ${Math.round(it.score)}</span>`
    ];

    const snip = $("tgSnip").checked && it.snippet
      ? `<div class="refs">${escapeHtml(it.snippet)}</div>`
      : "";

    card.innerHTML = `
      <div class="cardTop">
        <div>
          <div class="term"><a href="${escapeHtml(url)}" target="_blank" rel="noopener" style="color:#9dc2ff;text-decoration:none">Open page ${it.page}</a></div>
          ${snip}
          <div class="small"><a href="${escapeHtml(url)}" target="_blank" rel="noopener" style="color:#9dc2ff">DCatalog link</a></div>
        </div>
        <div class="badges">${badges.join("")}</div>
      </div>
    `;
    el.appendChild(card);
  }
}

function scorePage(qToks, pageTokCounts) {
  // simple scoring: sum counts for each token hit, plus small boost for multi-hit pages
  let score = 0;
  let hits = 0;
  for (const t of qToks) {
    const c = pageTokCounts[t] || 0;
    if (c > 0) { hits++; score += c; }
  }
  if (hits >= 2) score += 3;
  if (hits >= 3) score += 6;
  return score;
}

function search() {
  if (!INDEX) return;

  const q = $("q").value || "";
  const qToks = tokens(q);
  if (!qToks.length) {
    renderResults([]);
    renderStatus(`Loaded index: ${INDEX.meta?.page_count || "?"} pages.`);
    return;
  }

  const matchAny = $("tgAll").checked;
  const inv = INDEX.inv || {};
  const pageData = INDEX.pages || [];

  // candidate pages from inverted index
  let candidates = null;
  for (const t of qToks) {
    const pages = inv[t] || [];
    const set = new Set(pages);
    if (candidates === null) {
      candidates = set;
    } else if (matchAny) {
      for (const p of set) candidates.add(p);
    } else {
      // intersect
      candidates = new Set([...candidates].filter(x => set.has(x)));
    }
  }

  const candArr = candidates ? [...candidates] : [];
  const results = [];

  for (const pageNum of candArr) {
    const pd = pageData[pageNum - 1]; // pages are 1-based; array 0-based
    if (!pd) continue;

    const s = scorePage(qToks, pd.tok_counts || {});
    if (s <= 0) continue;

    results.push({
      page: pageNum,
      score: s,
      snippet: pd.snippet || ""
    });
  }

  results.sort((a,b)=> b.score - a.score || a.page - b.page);

  const top = results.slice(0, 40);
  renderResults(top);
  renderStatus(`Matches: ${results.length}. Showing top ${top.length}.`);
}

async function init() {
  $("btnOpenCatalog").href = window.DCATALOG_BASE_URL;

  $("btnHelp").addEventListener("click", () => $("dlg").showModal());
  $("btnClose").addEventListener("click", () => $("dlg").close());

  $("q").addEventListener("input", search);
  $("btnClear").addEventListener("click", () => { $("q").value=""; search(); });
  $("tgAll").addEventListener("change", search);
  $("tgSnip").addEventListener("change", search);

  // load index
  try {
    const res = await fetch("./catalog_search_index.json", { cache: "no-store" });
    if (!res.ok) throw new Error("missing");
    INDEX = await res.json();
    renderStatus(`Loaded index: ${INDEX.meta?.page_count || "?"} pages.`);
  } catch {
    renderStatus("Missing catalog_search_index.json. Put catalog.pdf here and run python build_index.py.");
  }

  // PWA offline
  if ("serviceWorker" in navigator) {
    try { await navigator.serviceWorker.register("./sw.js"); } catch {}
  }

  search();
}

init();
