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

const JUP_API_KEY = "3856bf2f-4df9-448c-b1cd-99600be781cc";

async function fetchJupiterTokenInfo(mintAddresses) {
  if (!mintAddresses.length) return [];
  // Jupiter search supports comma-separated mint addresses (up to 100)
  const query = mintAddresses.slice(0, 100).join(",");
  const res = await fetch(`https://api.jup.ag/tokens/v2/search?query=${query}`, {
    headers: { "x-api-key": JUP_API_KEY },
  });
  if (!res.ok) return [];
  return res.json();
}

async function fetchHistoricalPositions(owner, fromDate, toDate) {
  let url = `${API_BASE}/lp-positions/historical?owner=${owner}&limit=20`;
  if (fromDate) url += `&from_date=${fromDate.toISOString()}`;
  if (toDate) url += `&to_date=${toDate.toISOString()}`;
  return apiRequest(url);
}

function shortenAddress(addr) {
  if (!addr) return "";
  return addr.slice(0, 4) + "..." + addr.slice(-4);
}

// Extract a value from a field that may be a number or an object with time-range keys
function ovVal(field) {
  if (field == null) return null;
  if (typeof field === "number") return field;
  if (typeof field === "object") {
    for (const k of ["ALL", "all", "total", "7D", "1M", "30D"]) {
      if (field[k] != null) return field[k];
    }
    const vals = Object.values(field).filter(v => typeof v === "number");
    if (vals.length) return vals[0];
  }
  return null;
}

// Wallet scoring algorithm (0-100) based on overview metrics
// Weighs: profitability, consistency, experience, risk management
function computeWalletScore(ov) {
  if (!ov) return null;

  let score = 0;

  // 1. Win Rate (0-25 pts) - most important signal
  const winRate = ovVal(ov.win_rate);
  if (winRate != null) {
    // 50% win rate = 10pts, 70% = 20pts, 90%+ = 25pts
    score += Math.min(winRate * 100 / 4, 25);
  }

  // 2. ROI (0-20 pts) - profitability per dollar
  const roi = ov.roi;
  if (roi != null) {
    // Positive ROI gets points, diminishing returns above 5%
    if (roi > 0) {
      score += Math.min(roi * 100 * 2, 20);
    } else {
      // Negative ROI deducts up to -5 pts
      score += Math.max(roi * 100, -5);
    }
  }

  // 3. Experience / Volume (0-15 pts) - based on total positions
  const totalLp = parseInt(ov.total_lp) || 0;
  if (totalLp >= 100) score += 15;
  else if (totalLp >= 50) score += 12;
  else if (totalLp >= 20) score += 9;
  else if (totalLp >= 10) score += 6;
  else if (totalLp >= 3) score += 3;

  // 4. Fee efficiency (0-10 pts) - fees as % of inflow
  const feePct = ov.fee_percent;
  if (feePct != null && feePct > 0) {
    // Good fee capture = points
    score += Math.min(feePct * 100 * 10, 10);
  }

  // 5. Consistency / Monthly profitability (0-15 pts)
  const monthlyPct = ov.avg_monthly_profit_percent;
  if (monthlyPct != null) {
    if (monthlyPct > 0) {
      score += Math.min(monthlyPct * 100 * 5, 15);
    } else {
      score += Math.max(monthlyPct * 100 * 2, -5);
    }
  }

  // 6. Diversification (0-10 pts) - number of pools
  const totalPools = parseInt(ov.total_pool) || 0;
  if (totalPools >= 20) score += 10;
  else if (totalPools >= 10) score += 8;
  else if (totalPools >= 5) score += 5;
  else if (totalPools >= 2) score += 2;

  // 7. Longevity bonus (0-5 pts) - older wallets get trust bonus
  if (ov.first_activity) {
    const ageMonths = (Date.now() - new Date(ov.first_activity).getTime()) / (30 * 24 * 60 * 60 * 1000);
    if (ageMonths >= 6) score += 5;
    else if (ageMonths >= 3) score += 3;
    else if (ageMonths >= 1) score += 1;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

function getScoreLabel(score) {
  if (score == null) return { label: "?", color: "#64748b" };
  if (score >= 80) return { label: "A+", color: "#4ade80" };
  if (score >= 65) return { label: "A", color: "#4ade80" };
  if (score >= 50) return { label: "B", color: "#a3e635" };
  if (score >= 35) return { label: "C", color: "#fbbf24" };
  if (score >= 20) return { label: "D", color: "#fb923c" };
  return { label: "F", color: "#f87171" };
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

  console.log("[TLW] Overview data:", JSON.stringify(ov).slice(0, 2000));

  const totalPnl = ovVal(ov.total_pnl);
  const pnlClass = (totalPnl ?? 0) >= 0 ? "tlw-positive" : "tlw-negative";
  const winRateVal = ovVal(ov.win_rate);
  const winRate = winRateVal != null ? (winRateVal * 100).toFixed(1) + "%" : "-";
  const apr = ov.apr != null ? (ov.apr * 100).toFixed(1) + "%" : "-";
  const roi = ov.roi != null ? (ov.roi * 100).toFixed(2) + "%" : "-";
  const feePercent = ov.fee_percent != null ? (ov.fee_percent * 100).toFixed(2) + "%" : "-";
  const avgMonthlyPct = ov.avg_monthly_profit_percent != null ? (ov.avg_monthly_profit_percent * 100).toFixed(2) + "%" : "-";

  const score = computeWalletScore(ov);
  const scoreInfo = getScoreLabel(score);

  return `
    <div class="tlw-overview-card">
      <div class="tlw-overview-section">
        <div class="tlw-overview-title">
          Wallet Profile
          <div class="tlw-score-badge" style="background: ${scoreInfo.color}20; border-color: ${scoreInfo.color}">
            <span class="tlw-score-number" style="color: ${scoreInfo.color}">${score ?? "?"}</span>
            <span class="tlw-score-grade" style="color: ${scoreInfo.color}">${scoreInfo.label}</span>
          </div>
        </div>
        <div class="tlw-overview-grid">
          <div class="tlw-ov-stat">
            <span class="tlw-ov-label">Total PnL</span>
            <span class="tlw-ov-value ${pnlClass}">${formatUsd(totalPnl)}</span>
          </div>
          <div class="tlw-ov-stat">
            <span class="tlw-ov-label">Total Inflow</span>
            <span class="tlw-ov-value">${formatUsd(ov.total_inflow)}</span>
          </div>
          <div class="tlw-ov-stat">
            <span class="tlw-ov-label">Total Fees</span>
            <span class="tlw-ov-value">${formatUsd(ovVal(ov.total_fee))}</span>
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

function initOpeningPositions(positions, parentEl) {
  if (!positions || !positions.length) return;

  const section = document.createElement("div");
  section.className = "tlw-positions-section";
  section.innerHTML = `
    <div class="tlw-positions-title">
      Open Positions <span class="tlw-positions-count">${positions.length}</span>
    </div>
  `;

  const list = document.createElement("div");
  list.className = "tlw-pos-list";

  positions.forEach(p => {
    const pnlVal = p.pnl?.total ?? 0;
    const pnlClass = pnlVal >= 0 ? "tlw-positive" : "tlw-negative";
    const rangeClass = p.inRange ? "tlw-in-range" : "tlw-out-range";
    const rangeText = p.inRange ? "IN RANGE" : "OUT";

    const wrapper = document.createElement("div");
    wrapper.className = "tlw-pos-accordion";

    // Summary row (always visible)
    const summary = document.createElement("div");
    summary.className = "tlw-pos-item tlw-pos-expandable";
    summary.innerHTML = `
      <div class="tlw-pos-logos">
        <img src="${p.logo0 || ''}" alt="" onerror="this.style.display='none'">
        <img src="${p.logo1 || ''}" alt="" onerror="this.style.display='none'">
      </div>
      <div>
        <div class="tlw-pos-pair">${p.pairName || ((p.tokenName0 || "?") + "/" + (p.tokenName1 || "?"))}</div>
        <div class="tlw-pos-detail">${p.age ? p.age + "d" : "-"} · <span class="${rangeClass}">${rangeText}</span></div>
      </div>
      <div class="tlw-pos-value">${formatUsd(p.value)}</div>
      <div class="tlw-pos-pnl ${pnlClass}">${formatUsd(pnlVal)}</div>
      <div class="tlw-pos-fee">${formatUsd(p.collectedFee)}</div>
      <div class="tlw-pos-chevron">&#9662;</div>
    `;
    wrapper.appendChild(summary);

    // Detail panel (hidden by default)
    const priceRange = p.priceRange || [];
    const binRange = p.range || [];
    const detail = document.createElement("div");
    detail.className = "tlw-pos-detail-panel";
    detail.style.display = "none";
    detail.innerHTML = `
      <div class="tlw-pos-detail-grid">
        <div class="tlw-pos-detail-item">
          <span class="tlw-ov-label">Input Value</span>
          <span>${formatUsd(p.inputValue)}</span>
        </div>
        <div class="tlw-pos-detail-item">
          <span class="tlw-ov-label">Current Value</span>
          <span>${formatUsd(p.value)}</span>
        </div>
        <div class="tlw-pos-detail-item">
          <span class="tlw-ov-label">Fees Collected</span>
          <span>${formatUsd(p.collectedFee)}</span>
        </div>
        <div class="tlw-pos-detail-item">
          <span class="tlw-ov-label">Uncollected Fees</span>
          <span>${formatUsd(p.unCollectedFee)}</span>
        </div>
        <div class="tlw-pos-detail-item">
          <span class="tlw-ov-label">Strategy</span>
          <span>${p.strategyType || "-"}</span>
        </div>
        <div class="tlw-pos-detail-item">
          <span class="tlw-ov-label">DPR</span>
          <span>${p.dpr != null ? (p.dpr * 100).toFixed(2) + "%" : "-"}</span>
        </div>
        <div class="tlw-pos-detail-item">
          <span class="tlw-ov-label">Bin Range</span>
          <span>${binRange.length >= 2 ? binRange[0] + " → " + binRange[1] : "-"}</span>
        </div>
        <div class="tlw-pos-detail-item">
          <span class="tlw-ov-label">Current Bin</span>
          <span>${binRange.length >= 3 ? binRange[2] : "-"}</span>
        </div>
        <div class="tlw-pos-detail-item">
          <span class="tlw-ov-label">Price Range</span>
          <span>${priceRange.length >= 2 ? "$" + priceRange[0].toFixed(4) + " – $" + priceRange[1].toFixed(4) : "-"}</span>
        </div>
        <div class="tlw-pos-detail-item">
          <span class="tlw-ov-label">Current Price</span>
          <span>${priceRange.length >= 3 ? "$" + priceRange[2].toFixed(4) : "-"}</span>
        </div>
        <div class="tlw-pos-detail-item">
          <span class="tlw-ov-label">Pool</span>
          <span class="tlw-pos-pool-link">${shortenAddress(p.pool)}</span>
        </div>
        <div class="tlw-pos-detail-item">
          <span class="tlw-ov-label">Opened</span>
          <span>${p.createdAt ? formatDate(p.createdAt) : "-"}</span>
        </div>
      </div>
    `;
    wrapper.appendChild(detail);

    // Toggle accordion
    summary.addEventListener("click", () => {
      const isOpen = detail.style.display !== "none";
      detail.style.display = isOpen ? "none" : "";
      summary.querySelector(".tlw-pos-chevron").innerHTML = isOpen ? "&#9662;" : "&#9652;";
    });

    list.appendChild(wrapper);
  });

  section.appendChild(list);
  parentEl.appendChild(section);
}

function renderTokenBalances(balances, jupData) {
  if (!balances || !balances.length) return "";

  // Build Jupiter lookup by mint address
  const jupMap = {};
  if (jupData && jupData.length) {
    jupData.forEach(t => { jupMap[t.id] = t; });
  }

  // Sort by USD value descending, filter out dust
  const sorted = balances
    .filter(t => t.balanceInUsd > 0.01)
    .sort((a, b) => (b.balanceInUsd || 0) - (a.balanceInUsd || 0));

  if (!sorted.length) return "";

  const totalUsd = sorted.reduce((s, t) => s + (t.balanceInUsd || 0), 0);

  const items = sorted.slice(0, 12).map(t => {
    const pct = totalUsd > 0 ? ((t.balanceInUsd / totalUsd) * 100).toFixed(1) : "0";
    const jup = jupMap[t.tokenAddress];
    const change24h = jup?.stats24h?.priceChange;
    const changeClass = change24h != null ? (change24h >= 0 ? "tlw-positive" : "tlw-negative") : "";
    const changeText = change24h != null ? (change24h >= 0 ? "+" : "") + change24h.toFixed(1) + "%" : "";
    const mcapText = jup?.mcap ? "$" + (jup.mcap >= 1e9 ? (jup.mcap / 1e9).toFixed(1) + "B" : jup.mcap >= 1e6 ? (jup.mcap / 1e6).toFixed(1) + "M" : (jup.mcap / 1e3).toFixed(0) + "K") : "";
    return `
      <div class="tlw-token-item">
        <img class="tlw-token-logo" src="${jup?.icon || t.logo || ''}" alt="" onerror="this.style.display='none'">
        <div class="tlw-token-info">
          <div class="tlw-token-name">${t.symbol || shortenAddress(t.tokenAddress)}</div>
          ${mcapText ? `<div class="tlw-token-mcap">MC ${mcapText}</div>` : ""}
        </div>
        <div class="tlw-token-bal">${Number(t.balance).toLocaleString(undefined, { maximumFractionDigits: 4 })}</div>
        <div class="tlw-token-usd">${formatUsd(t.balanceInUsd)}</div>
        <div class="tlw-token-change ${changeClass}">${changeText}</div>
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

function renderHistoricalPositionsList(positions) {
  if (!positions || !positions.length) return '<div class="tlw-empty" style="padding:12px">No closed positions in this range.</div>';

  return positions.map(p => {
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
}

function buildMiniCalendar(year, month, selectedDate, onSelect) {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startDow = firstDay.getDay();
  const daysInMonth = lastDay.getDate();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  const container = document.createElement("div");
  container.className = "tlw-cal";

  // Header with month/year and nav
  const header = document.createElement("div");
  header.className = "tlw-cal-header";
  header.innerHTML = `
    <button class="tlw-cal-nav" data-dir="-1">&larr;</button>
    <span class="tlw-cal-month">${monthNames[month]} ${year}</span>
    <button class="tlw-cal-nav" data-dir="1">&rarr;</button>
  `;
  container.appendChild(header);

  // Day-of-week labels
  const dowRow = document.createElement("div");
  dowRow.className = "tlw-cal-dow";
  ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].forEach(d => {
    const cell = document.createElement("span");
    cell.textContent = d;
    dowRow.appendChild(cell);
  });
  container.appendChild(dowRow);

  // Day grid
  const grid = document.createElement("div");
  grid.className = "tlw-cal-grid";

  for (let i = 0; i < startDow; i++) {
    const empty = document.createElement("span");
    empty.className = "tlw-cal-day tlw-cal-empty";
    grid.appendChild(empty);
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const cell = document.createElement("button");
    cell.className = "tlw-cal-day";
    cell.textContent = d;
    const cellDate = new Date(year, month, d);

    if (cellDate > today) {
      cell.classList.add("tlw-cal-disabled");
      cell.disabled = true;
    } else {
      if (selectedDate && cellDate.toDateString() === selectedDate.toDateString()) {
        cell.classList.add("tlw-cal-selected");
      }
      if (cellDate.toDateString() === today.toDateString()) {
        cell.classList.add("tlw-cal-today");
      }
      cell.addEventListener("click", () => onSelect(cellDate));
    }
    grid.appendChild(cell);
  }
  container.appendChild(grid);

  // Month nav handlers
  header.querySelectorAll(".tlw-cal-nav").forEach(btn => {
    btn.addEventListener("click", () => {
      const dir = parseInt(btn.dataset.dir);
      let newMonth = month + dir;
      let newYear = year;
      if (newMonth < 0) { newMonth = 11; newYear--; }
      if (newMonth > 11) { newMonth = 0; newYear++; }
      const newCal = buildMiniCalendar(newYear, newMonth, selectedDate, onSelect);
      container.replaceWith(newCal);
    });
  });

  return container;
}

function initHistoricalSection(owner, initialPositions) {
  const section = document.createElement("div");
  section.className = "tlw-positions-section";

  const now = new Date();
  let selectedDay = null;

  // Title row
  const titleRow = document.createElement("div");
  titleRow.className = "tlw-positions-title";

  const titleText = document.createTextNode("Closed Positions ");
  titleRow.appendChild(titleText);

  const countBadge = document.createElement("span");
  countBadge.className = "tlw-positions-count";
  countBadge.textContent = initialPositions?.length ?? 0;
  titleRow.appendChild(countBadge);

  const rangeLabel = document.createElement("span");
  rangeLabel.className = "tlw-hist-label";
  rangeLabel.textContent = "Last 7 days";
  titleRow.appendChild(rangeLabel);

  const calToggle = document.createElement("button");
  calToggle.className = "tlw-cal-toggle";
  calToggle.innerHTML = "&#128197;";
  titleRow.appendChild(calToggle);

  section.appendChild(titleRow);

  // Calendar dropdown (hidden by default)
  const calWrap = document.createElement("div");
  calWrap.className = "tlw-cal-wrap";
  calWrap.style.display = "none";

  // Quick presets
  const presets = document.createElement("div");
  presets.className = "tlw-cal-presets";
  presets.innerHTML = `
    <button class="tlw-cal-preset tlw-cal-preset-active" data-days="7">7D</button>
    <button class="tlw-cal-preset" data-days="14">14D</button>
    <button class="tlw-cal-preset" data-days="30">30D</button>
  `;
  calWrap.appendChild(presets);

  const calContainer = document.createElement("div");
  calContainer.className = "tlw-cal-container";
  calWrap.appendChild(calContainer);

  const calHint = document.createElement("div");
  calHint.className = "tlw-cal-hint";
  calHint.textContent = "Pick a day to see positions closed on that date";
  calWrap.appendChild(calHint);

  section.appendChild(calWrap);

  // Positions list
  const listEl = document.createElement("div");
  listEl.className = "tlw-pos-list";
  listEl.innerHTML = renderHistoricalPositionsList(initialPositions);
  section.appendChild(listEl);

  // Render calendar
  function renderCal() {
    const d = selectedDay || now;
    const cal = buildMiniCalendar(d.getFullYear(), d.getMonth(), selectedDay, async (picked) => {
      selectedDay = picked;
      const dayStart = new Date(picked);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(picked);
      dayEnd.setHours(23, 59, 59, 999);

      // Clear preset active
      calWrap.querySelectorAll(".tlw-cal-preset").forEach(b => b.classList.remove("tlw-cal-preset-active"));
      rangeLabel.textContent = formatDate(picked);

      listEl.innerHTML = '<div class="tlw-loading" style="padding:12px">Loading...</div>';
      try {
        const result = await fetchHistoricalPositions(owner, dayStart, dayEnd);
        const data = result?.data?.data ?? [];
        listEl.innerHTML = renderHistoricalPositionsList(data);
        countBadge.textContent = data.length;
      } catch (err) {
        listEl.innerHTML = `<div class="tlw-error" style="padding:12px">${err.message}</div>`;
      }
      renderCal();
    });
    calContainer.innerHTML = "";
    calContainer.appendChild(cal);
  }
  renderCal();

  // Toggle calendar visibility
  calToggle.addEventListener("click", () => {
    calWrap.style.display = calWrap.style.display === "none" ? "" : "none";
  });

  // Preset handlers
  presets.querySelectorAll(".tlw-cal-preset").forEach(btn => {
    btn.addEventListener("click", async () => {
      const days = parseInt(btn.dataset.days);
      selectedDay = null;
      const fromDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

      presets.querySelectorAll(".tlw-cal-preset").forEach(b => b.classList.remove("tlw-cal-preset-active"));
      btn.classList.add("tlw-cal-preset-active");
      rangeLabel.textContent = `Last ${days} days`;

      listEl.innerHTML = '<div class="tlw-loading" style="padding:12px">Loading...</div>';
      try {
        const result = await fetchHistoricalPositions(owner, fromDate, now);
        const data = result?.data?.data ?? [];
        listEl.innerHTML = renderHistoricalPositionsList(data);
        countBadge.textContent = data.length;
      } catch (err) {
        listEl.innerHTML = `<div class="tlw-error" style="padding:12px">${err.message}</div>`;
      }
      renderCal();
    });
  });

  return section;
}

function renderRevenueView(owner, revenueData, overviewData, openingPositions, tokenBalances, historicalPositions, jupData, onBack) {
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

  // Build static HTML sections
  const overviewHtml = renderOverviewCard(overviewData);
  // openingPositions rendered via DOM below
  const tokensHtml = renderTokenBalances(tokenBalances, jupData);

  if (!data || !data.length) {
    body.innerHTML = overviewHtml + tokensHtml;
    initOpeningPositions(openingPositions, body);
    body.appendChild(initHistoricalSection(owner, historicalPositions));
    const emptyMsg = document.createElement("div");
    emptyMsg.className = "tlw-empty";
    emptyMsg.textContent = "No revenue data found for this wallet.";
    body.appendChild(emptyMsg);
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
        <td>${formatUsd(d.max_invested || d.total_invested)}</td>
        <td>${formatPercent(d.pnl_percent * 100)}</td>
      </tr>
    `;
  }).join("");

  // Set static HTML first
  body.innerHTML = `
    ${overviewHtml}
    ${tokensHtml}
    <div id="tlw-pos-anchor"></div>
    <div id="tlw-hist-anchor"></div>
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
        <span class="tlw-stat-label">Invested</span>
        <span class="tlw-stat-value">${formatUsd(latest.max_invested || latest.total_invested)}</span>
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

  // Insert interactive DOM sections at anchor points
  const posAnchor = document.getElementById("tlw-pos-anchor");
  if (openingPositions && openingPositions.length) {
    const posSection = document.createElement("div");
    initOpeningPositions(openingPositions, posSection);
    posAnchor.replaceWith(posSection);
  } else {
    posAnchor.remove();
  }

  const anchor = document.getElementById("tlw-hist-anchor");
  anchor.replaceWith(initHistoricalSection(owner, historicalPositions));

  // Range toggle handlers (re-fetch revenue only, keep everything else)
  body.querySelectorAll(".tlw-range-btn").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      const range = e.target.dataset.range;
      body.querySelectorAll(".tlw-range-btn").forEach(b => b.classList.remove("tlw-range-active"));
      e.target.classList.add("tlw-range-active");
      body.innerHTML = '<div class="tlw-loading">Loading...</div>';
      try {
        const result = await fetchRevenue(owner, "day", range);
        renderRevenueView(owner, result.data, overviewData, openingPositions, tokenBalances, historicalPositions, jupData, onBack);
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

// Quick score from pool-level top-lpers data (subset of full score)
function computePoolScore(lp) {
  let score = 0;
  // Win rate (0-25)
  if (lp.win_rate != null) score += Math.min((lp.win_rate / 100) * 100 / 4, 25);
  // ROI (0-20)
  if (lp.roi != null) {
    if (lp.roi > 0) score += Math.min(lp.roi * 2, 20);
    else score += Math.max(lp.roi, -5);
  }
  // Experience (0-15)
  const totalLp = lp.total_lp || 0;
  if (totalLp >= 100) score += 15;
  else if (totalLp >= 50) score += 12;
  else if (totalLp >= 20) score += 9;
  else if (totalLp >= 10) score += 6;
  else if (totalLp >= 3) score += 3;
  // Fee efficiency (0-10)
  if (lp.fee_percent != null && lp.fee_percent > 0) score += Math.min(lp.fee_percent * 10, 10);
  // Longevity (0-5)
  if (lp.first_activity) {
    const months = (Date.now() - new Date(lp.first_activity).getTime()) / (30 * 24 * 60 * 60 * 1000);
    if (months >= 6) score += 5;
    else if (months >= 3) score += 3;
    else if (months >= 1) score += 1;
  }
  // PnL bonus (0-10)
  if (lp.total_pnl > 0) score += Math.min(10, 5 + Math.log10(lp.total_pnl + 1));
  // Diversification proxy from avg_age (0-5) - longer avg = more patient
  if (lp.avg_age_hour != null && lp.avg_age_hour > 1) score += Math.min(lp.avg_age_hour / 24, 5);
  // Penalty: negative PnL
  if (lp.total_pnl < 0) score -= Math.min(10, Math.abs(lp.total_pnl) / 1000);
  return Math.max(0, Math.min(100, Math.round(score)));
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
    const score = computePoolScore(lp);
    const si = getScoreLabel(score);
    return `
      <tr class="tlw-clickable" data-owner="${lp.owner}">
        <td class="tlw-rank">${lp._rank}</td>
        <td class="tlw-address">
          ${shortenAddress(lp.owner)}
        </td>
        <td class="tlw-score-cell"><span class="tlw-score-pill" style="background:${si.color}20;color:${si.color}">${score} ${si.label}</span></td>
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
          <th>Score</th>
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

  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  try {
    const [revenueResult, overviewResult, openingResult, balancesResult, historicalResult] = await Promise.all([
      fetchRevenue(owner, "day", "7D"),
      fetchOverview(owner).catch(() => null),
      fetchOpeningPositions(owner).catch(() => null),
      fetchTokenBalances(owner).catch(() => null),
      fetchHistoricalPositions(owner, weekAgo, now).catch(() => null),
    ]);

    // Fetch Jupiter enrichment for token balances (non-blocking)
    const tokenAddresses = (balancesResult?.data || [])
      .filter(t => t.balanceInUsd > 0.01)
      .map(t => t.tokenAddress);
    const jupData = tokenAddresses.length
      ? await fetchJupiterTokenInfo(tokenAddresses).catch(() => [])
      : [];

    renderRevenueView(
      owner,
      revenueResult.data,
      Array.isArray(overviewResult?.data) ? overviewResult.data[0] : (overviewResult?.data ?? null),
      openingResult?.data ?? null,
      balancesResult?.data ?? null,
      historicalResult?.data?.data ?? null,
      jupData,
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
