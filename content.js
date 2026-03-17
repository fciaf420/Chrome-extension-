const API_BASE = "https://api.lpagent.io/open-api/v1";
const API_KEY = "lpagent_0e52bfc8744c421ca5fc0a2805c564ad404a22c9fe2a2a13";
const RPM_LIMIT = 5;
const apiCallTimestamps = [];

function canMakeRequest() {
  const now = Date.now();
  // Remove timestamps older than 60s
  while (apiCallTimestamps.length && apiCallTimestamps[0] < now - 60000) {
    apiCallTimestamps.shift();
  }
  return apiCallTimestamps.length < RPM_LIMIT;
}

function recordRequest() {
  apiCallTimestamps.push(Date.now());
}

function getPoolIdFromUrl() {
  const match = window.location.pathname.match(/\/dlmm\/([A-Za-z0-9]+)/);
  return match ? match[1] : null;
}

async function fetchTopLpers(poolId, page = 1, limit = 20, sortOrder = "desc") {
  if (!canMakeRequest()) {
    throw new Error("Rate limit reached (5 req/min). Please wait a moment.");
  }
  recordRequest();
  const url = `${API_BASE}/pools/${poolId}/top-lpers?sort_order=${sortOrder}&page=${page}&limit=${limit}`;
  const res = await fetch(url, {
    headers: { "x-api-key": API_KEY },
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

function shortenAddress(addr) {
  if (!addr) return "";
  return addr.slice(0, 4) + "..." + addr.slice(-4);
}

function formatUsd(val) {
  if (val == null) return "-";
  return "$" + Number(val).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPercent(val) {
  if (val == null) return "-";
  return Number(val).toFixed(2) + "%";
}

function formatHours(val) {
  if (val == null) return "-";
  if (val < 1) return "<1h";
  if (val < 24) return val.toFixed(0) + "h";
  return (val / 24).toFixed(1) + "d";
}

function createOverlay() {
  const existing = document.getElementById("tlw-overlay");
  if (existing) existing.remove();

  const overlay = document.createElement("div");
  overlay.id = "tlw-overlay";
  overlay.innerHTML = `
    <div class="tlw-panel">
      <div class="tlw-header">
        <span class="tlw-title">Top LP Wallets</span>
        <button class="tlw-close" id="tlw-close">&times;</button>
      </div>
      <div class="tlw-controls">
        <select id="tlw-sort">
          <option value="desc">Best First</option>
          <option value="asc">Worst First</option>
        </select>
        <span class="tlw-page-info" id="tlw-page-info"></span>
        <div class="tlw-pagination">
          <button id="tlw-prev" disabled>&larr;</button>
          <button id="tlw-next">&rarr;</button>
        </div>
      </div>
      <div class="tlw-body" id="tlw-body">
        <div class="tlw-loading">Loading...</div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  document.getElementById("tlw-close").addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });

  return overlay;
}

function renderTable(data) {
  const body = document.getElementById("tlw-body");
  if (!data || !data.length) {
    body.innerHTML = '<div class="tlw-empty">No LP data found for this pool.</div>';
    return;
  }

  const rows = data.map((lp, i) => {
    const pnlClass = lp.total_pnl >= 0 ? "tlw-positive" : "tlw-negative";
    const roiClass = lp.roi >= 0 ? "tlw-positive" : "tlw-negative";
    return `
      <tr>
        <td class="tlw-rank">${lp._rank}</td>
        <td class="tlw-address">
          <a href="https://solscan.io/account/${lp.owner}" target="_blank" rel="noopener">
            ${shortenAddress(lp.owner)}
          </a>
        </td>
        <td>${formatUsd(lp.total_inflow)}</td>
        <td>${formatUsd(lp.total_fee)}</td>
        <td class="${pnlClass}">${formatUsd(lp.total_pnl)}</td>
        <td class="${roiClass}">${formatPercent(lp.roi)}</td>
        <td>${formatPercent(lp.win_rate)}</td>
        <td>${lp.total_lp ?? "-"}</td>
        <td>${formatHours(lp.avg_age_hour)}</td>
      </tr>
    `;
  }).join("");

  body.innerHTML = `
    <table class="tlw-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Wallet</th>
          <th>Inflow</th>
          <th>Fees</th>
          <th>PnL</th>
          <th>ROI</th>
          <th>Win Rate</th>
          <th>LPs</th>
          <th>Avg Age</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

async function loadPage(poolId, page, sortOrder) {
  const body = document.getElementById("tlw-body");
  body.innerHTML = '<div class="tlw-loading">Loading...</div>';

  try {
    const result = await fetchTopLpers(poolId, page, 20, sortOrder);
    const { data, pagination } = result;

    data.forEach((lp, i) => {
      lp._rank = (pagination.page - 1) * pagination.pageSize + i + 1;
    });

    renderTable(data);

    const pageInfo = document.getElementById("tlw-page-info");
    pageInfo.textContent = `Page ${pagination.page} of ${pagination.totalPages} (${pagination.totalCount} LPers)`;

    const prevBtn = document.getElementById("tlw-prev");
    const nextBtn = document.getElementById("tlw-next");
    prevBtn.disabled = pagination.page <= 1;
    nextBtn.disabled = !pagination.hasNextPage;

    return pagination;
  } catch (err) {
    body.innerHTML = `<div class="tlw-error">Error: ${err.message}</div>`;
    return null;
  }
}

function initOverlay(poolId) {
  createOverlay();

  let currentPage = 1;
  let sortOrder = "desc";

  const load = () => loadPage(poolId, currentPage, sortOrder);

  document.getElementById("tlw-prev").addEventListener("click", () => {
    if (currentPage > 1) { currentPage--; load(); }
  });
  document.getElementById("tlw-next").addEventListener("click", () => {
    currentPage++; load();
  });
  document.getElementById("tlw-sort").addEventListener("change", (e) => {
    sortOrder = e.target.value;
    currentPage = 1;
    load();
  });

  load();
}

function injectButton() {
  if (document.getElementById("tlw-btn")) return;

  const btn = document.createElement("button");
  btn.id = "tlw-btn";
  btn.textContent = "Top LP Wallets";
  btn.addEventListener("click", () => {
    const poolId = getPoolIdFromUrl();
    if (!poolId) {
      alert("Could not detect pool address from URL.");
      return;
    }
    initOverlay(poolId);
  });

  document.body.appendChild(btn);
}

// Inject once DOM is ready, with a small delay to let Meteora's SPA render
setTimeout(injectButton, 1500);

// Re-inject on SPA navigation
let lastUrl = location.href;
new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    const old = document.getElementById("tlw-btn");
    if (old) old.remove();
    const oldOverlay = document.getElementById("tlw-overlay");
    if (oldOverlay) oldOverlay.remove();
    setTimeout(injectButton, 1500);
  }
}).observe(document.body, { childList: true, subtree: true });
