const form = document.getElementById("search-form");
const statusEl = document.getElementById("status");
const resultsEl = document.getElementById("results");
const exportBtn = document.getElementById("export");
const goBtn = document.getElementById("go");
const resultsTitle = document.getElementById("results-title");

let currentResults = [];
let currentCity = "";
let currentNiche = "";

const escapeHtml = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );

function confidenceClass(level) {
  const v = String(level || "").toLowerCase();
  if (v.startsWith("h")) return "high";
  if (v.startsWith("m")) return "medium";
  return "low";
}

function renderCard(b) {
  const source = b.source && /^https?:\/\//i.test(b.source)
    ? `<a href="${escapeHtml(b.source)}" target="_blank" rel="noopener noreferrer">${escapeHtml(b.source)}</a>`
    : escapeHtml(b.source || "Unknown");
  return `
    <article class="card">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
        <h3>${escapeHtml(b.name || "Unnamed business")}</h3>
        <span class="badge ${confidenceClass(b.confidence)}">${escapeHtml(b.confidence || "Low")}</span>
      </div>
      <div class="meta">
        <div class="row"><span class="label">Address</span><span>${escapeHtml(b.address || "Unknown")}</span></div>
        <div class="row"><span class="label">Phone</span><span>${escapeHtml(b.phone || "Unknown")}</span></div>
        <div class="row"><span class="label">Source</span><span>${source}</span></div>
        <div class="row"><span class="label">Reason</span><span>${escapeHtml(b.reason || "")}</span></div>
      </div>
      <div class="pitch">
        <span class="label">Pitch tip</span>
        ${escapeHtml(b.pitch_tip || "")}
      </div>
    </article>
  `;
}

function render(list) {
  if (!list || list.length === 0) {
    resultsEl.innerHTML = `<div class="empty">No qualifying businesses returned. Try a broader niche or a different city.</div>`;
    exportBtn.disabled = true;
    return;
  }
  resultsEl.innerHTML = list.map(renderCard).join("");
  exportBtn.disabled = false;
}

function setStatus(msg, kind) {
  statusEl.className = "status" + (kind ? " " + kind : "");
  statusEl.innerHTML = kind === "loading"
    ? `<span class="spinner"></span>${escapeHtml(msg)}`
    : escapeHtml(msg);
}

function toCsv(rows) {
  const headers = ["name", "address", "phone", "source", "confidence", "reason", "pitch_tip"];
  const escape = (v) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.join(",")];
  for (const r of rows) lines.push(headers.map((h) => escape(r[h])).join(","));
  return lines.join("\n");
}

function downloadCsv() {
  if (!currentResults.length) return;
  const blob = new Blob([toCsv(currentResults)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  a.href = url;
  a.download = `no-website-${slug(currentNiche)}-${slug(currentCity)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function pollJob(jobId, city, niche) {
  const maxWait = 180000;
  const interval = 4000;
  const start = Date.now();

  while (Date.now() - start < maxWait) {
    await new Promise(res => setTimeout(res, interval));
    try {
      const res = await fetch(`/api/status/${jobId}`);
      const data = await res.json();

      if (data.status === "done") {
        currentResults = data.businesses || [];
        currentCity = data.city || city;
        currentNiche = data.niche || niche;
        resultsTitle.textContent = `Results — ${niche} in ${city}`;
        const qn = (data.queries || []).length;
        setStatus(`Done. ${currentResults.length} candidate(s) · ${qn} web search${qn === 1 ? "" : "es"} used.`, "");
        render(currentResults);
        return;
      } else if (data.status === "error") {
        setStatus(data.error || "Search failed.", "error");
        return;
      }
      // still running, keep polling
    } catch (err) {
      setStatus(`Network error: ${err.message}`, "error");
      return;
    }
  }
  setStatus("Search timed out. Please try again.", "error");
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const city = document.getElementById("city").value.trim();
  const niche = document.getElementById("niche").value.trim();
  if (!city || !niche) return;

  goBtn.disabled = true;
  exportBtn.disabled = true;
  currentResults = [];
  resultsEl.innerHTML = "";
  setStatus(`Searching the web for ${niche} in ${city}…`, "loading");

  try {
    const res = await fetch("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ city, niche }),
    });
    const data = await res.json();
    if (!res.ok) {
      setStatus(data.error || `Request failed (${res.status}).`, "error");
      return;
    }
    await pollJob(data.job_id, city, niche);
  } catch (err) {
    setStatus(`Network error: ${err.message}`, "error");
  } finally {
    goBtn.disabled = false;
  }
});

exportBtn.addEventListener("click", downloadCsv);
