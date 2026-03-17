const API_BASE = "https://api.lpagent.io/open-api/v1";
const API_KEYS = [
  "lpagent_0e52bfc8744c421ca5fc0a2805c564ad404a22c9fe2a2a13",
  "lpagent_a31bd196e5c67adfc724af89ab3c3d38c93109b41623f7cd",
  "lpagent_b74eb3129e8b2683a180e41a0e918bd08b332b19bb2b726d",
];
const RPM_LIMIT = 5;
const apiCallTimestamps = {};
API_KEYS.forEach(k => { apiCallTimestamps[k] = []; });

function getAvailableKey() {
  const now = Date.now();
  for (const key of API_KEYS) {
    const stamps = apiCallTimestamps[key];
    while (stamps.length && stamps[0] < now - 60000) {
      stamps.shift();
    }
    if (stamps.length < RPM_LIMIT) return key;
  }
  return null;
}

function recordRequest(key) {
  apiCallTimestamps[key].push(Date.now());
}

function getPoolIdFromUrl() {
  const match = window.location.pathname.match(/\/dlmm\/([A-Za-z0-9]+)/);
  return match ? match[1] : null;
}

async function apiRequest(url) {
  const key = getAvailableKey();
  if (!key) {
    throw new Error("Rate limit reached. Please wait a moment.");
  }
  recordRequest(key);
  const res = await fetch(url, {
    headers: { "x-api-key": key },
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

async function fetchTopLpers(poolId, page = 1, limit = 20, sortOrder = "desc") {
  return apiRequest(`${API_BASE}/pools/${poolId}/top-lpers?sort_order=${sortOrder}&page=${page}&limit=${limit}`);
}

async function fetchRevenue(owner, period = "day", range = "7D") {
  return apiRequest(`${API_BASE}/lp-positions/revenue/${owner}?period=${period}&range=${range}`);
}

async function fetchOverview(owner) {
  return apiRequest(`${API_BASE}/lp-positions/overview?owner=${owner}&protocol=meteora`);
}

async function fetchOpeningPositions(owner) {
  return apiRequest(`${API_BASE}/lp-positions/opening?owner=${owner}`);
}

async function fetchTokenBalances(owner) {
  return apiRequest(`${API_BASE}/token/balance?owner=${owner}`);
}

async function fetchHistoricalPositions(owner) {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const fromDate = weekAgo.toISOString();
  return apiRequest(`${API_BASE}/lp-positions/historical?owner=${owner}&from_date=${fromDate}&limit=20`);
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
      <div class="tlw-header" id="tlw-header">
        <span id="tlw-header-content"><span class="tlw-title">Top LP Wallets</span></span>
        <button class="tlw-close" id="tlw-close">&times;</button>
      </div>
      <div class="tlw-controls" id="tlw-controls">
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

function formatDate(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatSol(val) {
  if (val == null) return "-";
  return Number(val).toFixed(4) + " SOL";
}

function renderOverviewCard(ov) {
  if (!ov) return '<div class="tlw-overview-card"><div class="tlw-empty">Overview data unavailable.</div></div>';

  const pnlClass = (ov.total_pnl?.all ?? 0) >= 0 ? "tlw-positive" : "tlw-negative";
  const winRate = ov.win_rate?.all != null ? (ov.win_rate.all * 100).toFixed(1) + "%" : "-";
  const apr = ov.apr != null ? (ov.apr * 100).toFixed(1) + "%" : "-";
  const roi = ov.roi != null ? (ov.roi * 100).toFixed(2) + "%" : "-";
  const feePercent = ov.fee_percent != null ? (ov.fee_percent * 100).toFixed(2) + "%" : "-";
  const avgMonthlyPct = ov.avg_monthly_profit_percent != null ? (ov.avg_monthly_profit_percent * 100).toFixed(2) + "%" : "-";

  return `
    <div class="tlw-overview-card">
      <div class="tlw-overview-section">
        <div class="tlw-overview-title">Wallet Profile</div>
        <div class="tlw-overview-grid">
          <div class="tlw-ov-stat">
            <span class="tlw-ov-label">Total PnL</span>
            <span class="tlw-ov-value ${pnlClass}">${formatUsd(ov.total_pnl?.all)}</span>
          </div>
          <div class="tlw-ov-stat">
            <span class="tlw-ov-label">Total Inflow</span>
            <span class="tlw-ov-value">${formatUsd(ov.total_inflow)}</span>
          </div>
          <div class="tlw-ov-stat">
            <span class="tlw-ov-label">Total Fees</span>
            <span class="tlw-ov-value">${formatUsd(ov.total_fee?.all)}</span>
          </div>
          <div class="tlw-ov-stat">
            <span class="tlw-ov-label">Win Rate</span>
            <span class="tlw-ov-value">${winRate}</span>
          </div>
          <div class="tlw-ov-stat">
            <span class="tlw-ov-label">ROI</span>
            <span class="tlw-ov-value">${roi}</span>
          </div>
          <div class="tlw-ov-stat">
            <span class="tlw-ov-label">APR</span>
            <span class="tlw-ov-value">${apr}</span>
          </div>
          <div class="tlw-ov-stat">
            <span class="tlw-ov-label">Fee %</span>
            <span class="tlw-ov-value">${feePercent}</span>
          </div>
          <div class="tlw-ov-stat">
            <span class="tlw-ov-label">Monthly PnL</span>
            <span class="tlw-ov-value">${formatUsd(ov.avg_monthly_pnl)}</span>
          </div>
          <div class="tlw-ov-stat">
            <span class="tlw-ov-label">Monthly %</span>
            <span class="tlw-ov-value">${avgMonthlyPct}</span>
          </div>
          <div class="tlw-ov-stat">
            <span class="tlw-ov-label">Avg Pos Profit</span>
            <span class="tlw-ov-value">${formatUsd(ov.avg_pos_profit)}</span>
          </div>
          <div class="tlw-ov-stat">
            <span class="tlw-ov-label">Total Pools</span>
            <span class="tlw-ov-value">${ov.total_pool ?? "-"}</span>
          </div>
          <div class="tlw-ov-stat">
            <span class="tlw-ov-label">Positions</span>
            <span class="tlw-ov-value">${ov.total_lp ?? "-"} (${ov.opening_lp ?? 0} open)</span>
          </div>
          <div class="tlw-ov-stat">
            <span class="tlw-ov-label">Win / Total</span>
            <span class="tlw-ov-value">${ov.win_lp ?? "-"} / ${ov.total_lp ?? "-"}</span>
          </div>
          <div class="tlw-ov-stat">
            <span class="tlw-ov-label">Avg Age</span>
            <span class="tlw-ov-value">${formatHours(ov.avg_age_hour)}</span>
          </div>
          <div class="tlw-ov-stat">
            <span class="tlw-ov-label">First Active</span>
            <span class="tlw-ov-value">${ov.first_activity ? formatDate(ov.first_activity) : "-"}</span>
          </div>
          <div class="tlw-ov-stat">
            <span class="tlw-ov-label">Last Active</span>
            <span class="tlw-ov-value">${ov.last_activity ? formatDate(ov.last_activity) : "-"}</span>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderOpeningPositions(positions) {
  if (!positions || !positions.length) return "";

  const items = positions.map(p => {
    const pnlVal = p.pnl?.total ?? 0;
    const pnlClass = pnlVal >= 0 ? "tlw-positive" : "tlw-negative";
    const rangeClass = p.inRange ? "tlw-in-range" : "tlw-out-range";
    const rangeText = p.inRange ? "IN RANGE" : "OUT";
    return `
      <div class="tlw-pos-item">
        <div class="tlw-pos-logos">
          <img src="${p.logo0}" alt="" onerror="this.style.display='none'">
          <img src="${p.logo1}" alt="" onerror="this.style.display='none'">
        </div>
        <div>
          <div class="tlw-pos-pair">${p.pairName || (p.tokenName0 + "/" + p.tokenName1)}</div>
          <div class="tlw-pos-detail">${p.age ? p.age + "d" : "-"} · <span class="${rangeClass}">${rangeText}</span></div>
        </div>
        <div class="tlw-pos-value">${formatUsd(p.value)}</div>
        <div class="tlw-pos-pnl ${pnlClass}">${formatUsd(pnlVal)}</div>
        <div class="tlw-pos-fee">${formatUsd(p.collectedFee)}</div>
      </div>
    `;
  }).join("");

  return `
    <div class="tlw-positions-section">
      <div class="tlw-positions-title">
        Open Positions <span class="tlw-positions-count">${positions.length}</span>
      </div>
      <div class="tlw-pos-list">${items}</div>
    </div>
  `;
}

function renderTokenBalances(balances) {
  if (!balances || !balances.length) return "";

  // Sort by USD value descending, filter out dust
  const sorted = balances
    .filter(t => t.balanceInUsd > 0.01)
    .sort((a, b) => (b.balanceInUsd || 0) - (a.balanceInUsd || 0));

  if (!sorted.length) return "";

  const totalUsd = sorted.reduce((s, t) => s + (t.balanceInUsd || 0), 0);

  const items = sorted.slice(0, 12).map(t => {
    const pct = totalUsd > 0 ? ((t.balanceInUsd / totalUsd) * 100).toFixed(1) : "0";
    return `
      <div class="tlw-token-item">
        <img class="tlw-token-logo" src="${t.logo || ''}" alt="" onerror="this.style.display='none'">
        <div class="tlw-token-name">${t.symbol || shortenAddress(t.tokenAddress)}</div>
        <div class="tlw-token-bal">${Number(t.balance).toLocaleString(undefined, { maximumFractionDigits: 4 })}</div>
        <div class="tlw-token-usd">${formatUsd(t.balanceInUsd)}</div>
        <div class="tlw-token-pct">${pct}%</div>
      </div>
    `;
  }).join("");

  const moreText = sorted.length > 12 ? `<div class="tlw-token-more">+${sorted.length - 12} more tokens</div>` : "";

  return `
    <div class="tlw-tokens-section">
      <div class="tlw-positions-title">
        Wallet Holdings <span class="tlw-positions-count">${formatUsd(totalUsd)}</span>
      </div>
      <div class="tlw-token-list">${items}</div>
      ${moreText}
    </div>
  `;
}

function renderHistoricalPositions(positions) {
  if (!positions || !positions.length) return "";

  const items = positions.map(p => {
    const pnlVal = p.pnl?.total ?? p.pnlNative ?? 0;
    const pnlClass = pnlVal >= 0 ? "tlw-positive" : "tlw-negative";
    const feeVal = p.collectedFee ?? p.fee ?? 0;
    const ageText = p.age ? p.age + "d" : "-";
    return `
      <div class="tlw-pos-item">
        <div class="tlw-pos-logos">
          <img src="${p.logo0 || ''}" alt="" onerror="this.style.display='none'">
          <img src="${p.logo1 || ''}" alt="" onerror="this.style.display='none'">
        </div>
        <div>
          <div class="tlw-pos-pair">${p.pairName || (p.tokenName0 + "/" + p.tokenName1)}</div>
          <div class="tlw-pos-detail">${ageText} · Closed ${p.closeAt ? formatDate(p.closeAt) : "-"}</div>
        </div>
        <div class="tlw-pos-value">${formatUsd(p.inputValue)}</div>
        <div class="tlw-pos-pnl ${pnlClass}">${formatUsd(pnlVal)}</div>
        <div class="tlw-pos-fee">${formatUsd(feeVal)}</div>
      </div>
    `;
  }).join("");

  return `
    <div class="tlw-positions-section">
      <div class="tlw-positions-title">
        Recent Closed Positions <span class="tlw-positions-count">${positions.length}</span>
        <span class="tlw-hist-label">Last 7 days</span>
      </div>
      <div class="tlw-pos-list">${items}</div>
    </div>
  `;
}

function renderRevenueView(owner, revenueData, overviewData, openingPositions, tokenBalances, historicalPositions, onBack) {
  const body = document.getElementById("tlw-body");
  const header = document.getElementById("tlw-header-content");

  // Update header with back button
  header.innerHTML = `
    <button class="tlw-back" id="tlw-back">&larr;</button>
    <span class="tlw-title">${shortenAddress(owner)} Revenue</span>
    <a href="https://solscan.io/account/${owner}" target="_blank" rel="noopener" class="tlw-solscan-link">Solscan</a>
  `;
  document.getElementById("tlw-back").addEventListener("click", onBack);

  // Hide controls
  document.getElementById("tlw-controls").style.display = "none";

  const data = revenueData;

  // Build overview card + token balances + positions
  const overviewHtml = renderOverviewCard(overviewData);
  const positionsHtml = renderOpeningPositions(openingPositions);
  const tokensHtml = renderTokenBalances(tokenBalances);
  const historicalHtml = renderHistoricalPositions(historicalPositions);

  if (!data || !data.length) {
    body.innerHTML = overviewHtml + tokensHtml + positionsHtml + historicalHtml + '<div class="tlw-empty">No revenue data found for this wallet.</div>';
    return;
  }

  // Summary from latest data point
  const latest = data[data.length - 1];
  const totalPnl = latest.cumulative_pnl;
  const totalPnlNative = latest.cumulative_pnl_native;
  const pnlClass = totalPnl >= 0 ? "tlw-positive" : "tlw-negative";

  // Bar chart using simple HTML bars
  const maxAbsPnl = Math.max(...data.map(d => Math.abs(d.sum)), 1);

  const rows = data.map(d => {
    const barWidth = Math.min(Math.abs(d.sum) / maxAbsPnl * 100, 100);
    const barClass = d.sum >= 0 ? "tlw-bar-positive" : "tlw-bar-negative";
    const cumClass = d.cumulative_pnl >= 0 ? "tlw-positive" : "tlw-negative";
    return `
      <tr>
        <td class="tlw-date">${formatDate(d.close_day)}</td>
        <td class="tlw-bar-cell">
          <div class="tlw-bar-container">
            <div class="tlw-bar ${barClass}" style="width: ${barWidth}%"></div>
          </div>
        </td>
        <td class="${d.sum >= 0 ? 'tlw-positive' : 'tlw-negative'}">${formatUsd(d.sum)}</td>
        <td class="${cumClass}">${formatUsd(d.cumulative_pnl)}</td>
        <td>${formatUsd(d.max_invested)}</td>
        <td>${formatPercent(d.pnl_percent * 100)}</td>
      </tr>
    `;
  }).join("");

  body.innerHTML = `
    ${overviewHtml}
    ${tokensHtml}
    ${positionsHtml}
    ${historicalHtml}
    <div class="tlw-revenue-summary">
      <div class="tlw-stat">
        <span class="tlw-stat-label">Cumulative PnL</span>
        <span class="tlw-stat-value ${pnlClass}">${formatUsd(totalPnl)}</span>
      </div>
      <div class="tlw-stat">
        <span class="tlw-stat-label">PnL (Native/SOL)</span>
        <span class="tlw-stat-value ${pnlClass}">${totalPnlNative != null ? totalPnlNative.toFixed(4) : '-'} SOL</span>
      </div>
      <div class="tlw-stat">
        <span class="tlw-stat-label">Max Invested</span>
        <span class="tlw-stat-value">${formatUsd(latest.max_invested)}</span>
      </div>
    </div>
    <div class="tlw-range-toggle">
      <button class="tlw-range-btn tlw-range-active" data-range="7D">7D</button>
      <button class="tlw-range-btn" data-range="1M">1M</button>
    </div>
    <table class="tlw-table">
      <thead>
        <tr>
          <th style="text-align:left">Date</th>
          <th></th>
          <th>Day PnL</th>
          <th>Cum. PnL</th>
          <th>Max Invested</th>
          <th>PnL %</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;

  // Range toggle handlers (re-fetch revenue only, keep overview)
  body.querySelectorAll(".tlw-range-btn").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      const range = e.target.dataset.range;
      body.querySelectorAll(".tlw-range-btn").forEach(b => b.classList.remove("tlw-range-active"));
      e.target.classList.add("tlw-range-active");
      body.innerHTML = '<div class="tlw-loading">Loading...</div>';
      try {
        const result = await fetchRevenue(owner, "day", range);
        renderRevenueView(owner, result.data, overviewData, openingPositions, tokenBalances, historicalPositions, onBack);
        const newBtn = body.querySelector(`.tlw-range-btn[data-range="${range}"]`);
        if (newBtn) {
          body.querySelectorAll(".tlw-range-btn").forEach(b => b.classList.remove("tlw-range-active"));
          newBtn.classList.add("tlw-range-active");
        }
      } catch (err) {
        body.innerHTML = `<div class="tlw-error">Error: ${err.message}</div>`;
      }
    });
  });
}

function renderTable(data, onWalletClick) {
  const body = document.getElementById("tlw-body");
  if (!data || !data.length) {
    body.innerHTML = '<div class="tlw-empty">No LP data found for this pool.</div>';
    return;
  }

  const rows = data.map((lp, i) => {
    const pnlClass = lp.total_pnl >= 0 ? "tlw-positive" : "tlw-negative";
    const roiClass = lp.roi >= 0 ? "tlw-positive" : "tlw-negative";
    return `
      <tr class="tlw-clickable" data-owner="${lp.owner}">
        <td class="tlw-rank">${lp._rank}</td>
        <td class="tlw-address">
          ${shortenAddress(lp.owner)}
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

  // Attach click handlers to rows
  body.querySelectorAll(".tlw-clickable").forEach(row => {
    row.addEventListener("click", () => {
      onWalletClick(row.dataset.owner);
    });
  });
}

async function loadPage(poolId, page, sortOrder, onWalletClick) {
  const body = document.getElementById("tlw-body");
  body.innerHTML = '<div class="tlw-loading">Loading...</div>';

  try {
    const result = await fetchTopLpers(poolId, page, 20, sortOrder);
    const { data, pagination } = result;

    data.forEach((lp, i) => {
      lp._rank = (pagination.page - 1) * pagination.pageSize + i + 1;
    });

    renderTable(data, onWalletClick);

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

function restoreTableHeader() {
  const header = document.getElementById("tlw-header-content");
  header.innerHTML = '<span class="tlw-title">Top LP Wallets</span>';
  document.getElementById("tlw-controls").style.display = "";
}

async function showWalletRevenue(owner, restoreList) {
  const body = document.getElementById("tlw-body");
  body.innerHTML = '<div class="tlw-loading">Loading wallet data...</div>';

  const onBack = () => {
    restoreTableHeader();
    restoreList();
  };

  try {
    const [revenueResult, overviewResult, openingResult, balancesResult, historicalResult] = await Promise.all([
      fetchRevenue(owner, "day", "7D"),
      fetchOverview(owner).catch(() => null),
      fetchOpeningPositions(owner).catch(() => null),
      fetchTokenBalances(owner).catch(() => null),
      fetchHistoricalPositions(owner).catch(() => null),
    ]);
    renderRevenueView(
      owner,
      revenueResult.data,
      overviewResult?.data ?? null,
      openingResult?.data ?? null,
      balancesResult?.data ?? null,
      historicalResult?.data?.data ?? null,
      onBack
    );
  } catch (err) {
    body.innerHTML = `<div class="tlw-error">Error: ${err.message}</div>`;
  }
}

function initOverlay(poolId) {
  createOverlay();

  let currentPage = 1;
  let sortOrder = "desc";

  const load = () => loadPage(poolId, currentPage, sortOrder, (owner) => {
    showWalletRevenue(owner, load);
  });

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
