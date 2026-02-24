'use strict';

// ── State ──────────────────────────────────────────────────────────────────
const state = {
  nodes: [],
  resources: [],
  tasks: {},
  storage: {},
  interval: 10,
  showOffline: true,
  compact: false,
  vmFilter: 'all',
  vmSearch: '',
  activeTab: 'overview',
  timerHandle: null,
  pendingAction: null,
};

// ── DOM Refs ───────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

// ── Utility: formatting ────────────────────────────────────────────────────
function fmtBytes(bytes, decimals = 1) {
  if (bytes === 0 || bytes == null) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

function fmtUptime(seconds) {
  if (!seconds) return '—';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function fmtPct(val, total) {
  if (!total || total === 0) return 0;
  return Math.min(100, Math.round((val / total) * 100));
}

function fmtTime(epoch) {
  if (!epoch) return '—';
  const d = new Date(epoch * 1000);
  const now = Date.now();
  const diff = Math.round((now - d) / 1000);
  if (diff < 60)   return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff/60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff/3600)}h ago`;
  return d.toLocaleDateString();
}

function pctClass(pct) {
  if (pct < 60) return 'low';
  if (pct < 85) return 'medium';
  return 'high';
}

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

// ── Toast ──────────────────────────────────────────────────────────────────
let toastTimer;
function showToast(msg, type = '') {
  const el = $('toast');
  el.textContent = msg;
  el.className = `toast show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 3000);
}

// ── API ────────────────────────────────────────────────────────────────────
async function api(path, opts = {}) {
  const r = await fetch(path, opts);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const json = await r.json();
  if (!json.ok) throw new Error(json.error || 'API error');
  return json.data;
}

// ── Refresh indicator ──────────────────────────────────────────────────────
function setIndicator(status) {
  const el = $('refresh-indicator');
  el.className = `refresh-indicator ${status}`;
}

// ── Data fetching ──────────────────────────────────────────────────────────
async function fetchAll() {
  setIndicator('loading');
  try {
    const [nodes, resources] = await Promise.all([
      api('/api/nodes'),
      api('/api/cluster/resources'),
    ]);
    state.nodes = nodes;
    state.resources = resources;

    // Fetch per-node details in parallel
    await Promise.all(nodes.map(async n => {
      try {
        const [tasks, storage] = await Promise.all([
          api(`/api/nodes/${n.node}/tasks`),
          api(`/api/nodes/${n.node}/storage`),
        ]);
        state.tasks[n.node]   = tasks;
        state.storage[n.node] = storage;
      } catch { /* node might be offline */ }
    }));

    renderAll();
    $('last-updated').textContent = new Date().toLocaleTimeString();
    setIndicator('');
  } catch (e) {
    setIndicator('error');
    showToast('Failed to reach Proxmox API', 'error');
    console.error(e);
  }
}

// ── Schedule auto-refresh ──────────────────────────────────────────────────
function scheduleRefresh() {
  clearInterval(state.timerHandle);
  state.timerHandle = setInterval(fetchAll, state.interval * 1000);
}

// ── Render all tabs ────────────────────────────────────────────────────────
function renderAll() {
  renderOverview();
  renderVMs();
  renderStorage();
  renderTasks();
}

// ── Tab: Overview ──────────────────────────────────────────────────────────
function renderOverview() {
  const container = $('nodes-container');
  if (!state.nodes.length) {
    container.innerHTML = errorState('No nodes found', 'Check your Proxmox API connection.');
    return;
  }

  // Update cluster name in header
  const clusterRes = state.resources.find(r => r.type === 'cluster');
  if (clusterRes) $('cluster-name').textContent = clusterRes.name || 'Cluster';

  const html = state.nodes.map(node => nodeCard(node)).join('');
  container.innerHTML = html;

  // Draw sparklines after DOM update
  state.nodes.forEach(node => {
    drawNodeSparklines(node);
  });
}

function nodeCard(node) {
  const online = node.status === 'online';
  const cpuPct  = Math.round((node.cpu ?? 0) * 100);
  const memPct  = fmtPct(node.mem, node.maxmem);
  const diskPct = fmtPct(node.disk, node.maxdisk);

  // Count VMs/CTs on this node from resources
  const vmsOnNode = state.resources.filter(r =>
    (r.type === 'qemu' || r.type === 'lxc') && r.node === node.node
  );
  const running = vmsOnNode.filter(v => v.status === 'running').length;

  return `
  <div class="card node-card node-${online ? 'online' : 'offline'}">
    <div class="card-header">
      <div class="card-title">
        <div class="node-status-dot"></div>
        ${escHtml(node.node)}
      </div>
      <span class="status-badge ${online ? 'status-running' : 'status-stopped'}">
        ${online ? 'Online' : 'Offline'}
      </span>
    </div>

    <div class="node-meta">
      <div class="meta-item">
        <span class="meta-label">Uptime</span>
        <span class="meta-value">${fmtUptime(node.uptime)}</span>
      </div>
      <div class="meta-item">
        <span class="meta-label">VMs / CTs</span>
        <span class="meta-value">${running} / ${vmsOnNode.length} running</span>
      </div>
      <div class="meta-item">
        <span class="meta-label">RAM total</span>
        <span class="meta-value">${fmtBytes(node.maxmem)}</span>
      </div>
      <div class="meta-item">
        <span class="meta-label">Disk total</span>
        <span class="meta-value">${fmtBytes(node.maxdisk)}</span>
      </div>
    </div>

    <div class="gauge-row">
      ${gauge('CPU', cpuPct, `${cpuPct}%`)}
      ${gauge('Memory', memPct, `${fmtBytes(node.mem)} / ${fmtBytes(node.maxmem)}`)}
      ${gauge('Root Disk', diskPct, `${fmtBytes(node.disk)} / ${fmtBytes(node.maxdisk)}`)}
    </div>

    <div class="mini-chart-row">
      <div class="mini-chart">
        <div class="mini-chart-label">CPU %</div>
        <canvas class="sparkline" id="spark-cpu-${escHtml(node.node)}" width="200" height="36"></canvas>
      </div>
      <div class="mini-chart">
        <div class="mini-chart-label">Memory %</div>
        <canvas class="sparkline" id="spark-mem-${escHtml(node.node)}" width="200" height="36"></canvas>
      </div>
    </div>
    <div class="mini-chart-row net-chart-row">
      <div class="mini-chart">
        <div class="mini-chart-label net-in-label">Net In <span id="spark-netin-val-${escHtml(node.node)}" class="mini-chart-val"></span></div>
        <canvas class="sparkline" id="spark-netin-${escHtml(node.node)}" width="200" height="36"></canvas>
      </div>
      <div class="mini-chart">
        <div class="mini-chart-label net-out-label">Net Out <span id="spark-netout-val-${escHtml(node.node)}" class="mini-chart-val"></span></div>
        <canvas class="sparkline" id="spark-netout-${escHtml(node.node)}" width="200" height="36"></canvas>
      </div>
    </div>
  </div>`;
}

function gauge(label, pct, detail) {
  const cls = pctClass(pct);
  return `
  <div class="gauge-item">
    <div class="gauge-header">
      <span class="gauge-label">${escHtml(label)}</span>
      <span class="gauge-value" style="color:var(--${cls === 'low' ? 'green' : cls === 'medium' ? 'yellow' : 'red'})">${escHtml(detail)}</span>
    </div>
    <div class="progress-bar">
      <div class="progress-fill ${cls}" style="width:${pct}%"></div>
    </div>
  </div>`;
}

async function drawNodeSparklines(node) {
  // Fetch RRD data for this node
  try {
    const detail = await api(`/api/nodes/${node.node}`);
    const rrd = detail.rrd || [];

    drawSparkline(
      `spark-cpu-${node.node}`,
      rrd.map(p => (p.cpu ?? 0) * 100),
      '#388bfd'
    );
    drawSparkline(
      `spark-mem-${node.node}`,
      rrd.map(p => p.maxmem ? (p.mem / p.maxmem) * 100 : 0),
      '#2ea043'
    );

    const netinData  = rrd.map(p => p.netin  ?? 0);
    const netoutData = rrd.map(p => p.netout ?? 0);
    drawSparkline(`spark-netin-${node.node}`,  netinData,  '#a371f7');
    drawSparkline(`spark-netout-${node.node}`, netoutData, '#f78166');

    // Show latest rate as a label
    const lastIn  = netinData[netinData.length - 1]   || 0;
    const lastOut = netoutData[netoutData.length - 1]  || 0;
    const valIn  = document.getElementById(`spark-netin-val-${node.node}`);
    const valOut = document.getElementById(`spark-netout-val-${node.node}`);
    if (valIn)  valIn.textContent  = fmtBytes(lastIn)  + '/s';
    if (valOut) valOut.textContent = fmtBytes(lastOut) + '/s';
  } catch { /* ignore */ }
}

function drawSparkline(canvasId, data, color) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.offsetWidth  || 200;
  const H = canvas.offsetHeight || 36;
  canvas.width  = W * devicePixelRatio;
  canvas.height = H * devicePixelRatio;
  ctx.scale(devicePixelRatio, devicePixelRatio);

  if (!data || data.length < 2) return;

  const min = 0;
  const max = Math.max(...data, 10);
  const step = W / (data.length - 1);

  ctx.clearRect(0, 0, W, H);

  // Fill gradient
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, color + '44');
  grad.addColorStop(1, color + '00');

  ctx.beginPath();
  data.forEach((v, i) => {
    const x = i * step;
    const y = H - ((v - min) / (max - min)) * H;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.lineTo((data.length - 1) * step, H);
  ctx.lineTo(0, H);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // Line
  ctx.beginPath();
  data.forEach((v, i) => {
    const x = i * step;
    const y = H - ((v - min) / (max - min)) * H;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

// ── Tab: VMs & Containers ──────────────────────────────────────────────────
function renderVMs() {
  const container = $('vms-container');
  let items = state.resources.filter(r => r.type === 'qemu' || r.type === 'lxc');

  // Apply filter
  if (state.vmFilter === 'running') items = items.filter(v => v.status === 'running');
  else if (state.vmFilter === 'stopped') items = items.filter(v => v.status !== 'running');
  else if (state.vmFilter === 'qemu') items = items.filter(v => v.type === 'qemu');
  else if (state.vmFilter === 'lxc')  items = items.filter(v => v.type === 'lxc');

  // Hide offline toggle
  if (!state.showOffline) items = items.filter(v => v.status === 'running');

  // Search
  if (state.vmSearch) {
    const q = state.vmSearch.toLowerCase();
    items = items.filter(v =>
      (v.name || '').toLowerCase().includes(q) ||
      String(v.vmid).includes(q)
    );
  }

  if (!items.length) {
    container.innerHTML = `<div class="empty-state">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
      <h3>No VMs found</h3>
      <p>Try changing your filter.</p>
    </div>`;
    return;
  }

  // Group by node
  const byNode = {};
  items.forEach(v => {
    if (!byNode[v.node]) byNode[v.node] = [];
    byNode[v.node].push(v);
  });

  const html = Object.entries(byNode).map(([nodeName, vms]) => `
    <div class="section-label">${escHtml(nodeName)}</div>
    <div class="vm-list">
      ${vms.sort((a,b) => a.vmid - b.vmid).map(vm => vmItem(vm)).join('')}
    </div>
  `).join('');

  container.innerHTML = html;
}

function vmItem(vm) {
  const isRunning = vm.status === 'running';
  const cpuPct = Math.round((vm.cpu ?? 0) * 100);
  const memPct = fmtPct(vm.mem, vm.maxmem);
  const compact = state.compact;

  const actions = isRunning
    ? `<button class="vm-action-btn reboot" onclick="vmAction('${escHtml(vm.node)}','${escHtml(vm.type)}',${vm.vmid},'reboot')" title="Reboot">↺</button>
       <button class="vm-action-btn stop"   onclick="vmAction('${escHtml(vm.node)}','${escHtml(vm.type)}',${vm.vmid},'shutdown')" title="Shutdown">■</button>`
    : `<button class="vm-action-btn start"  onclick="vmAction('${escHtml(vm.node)}','${escHtml(vm.type)}',${vm.vmid},'start')" title="Start">▶</button>`;

  const bars = isRunning ? `
    <div class="vm-bars">
      <div class="vm-bar-row">
        <span class="vm-bar-label">CPU</span>
        <div class="vm-progress"><div class="vm-progress-fill" style="width:${cpuPct}%;background:${cpuPct>85?'var(--red)':cpuPct>60?'var(--yellow)':'var(--blue)'}"></div></div>
      </div>
      <div class="vm-bar-row">
        <span class="vm-bar-label">Mem</span>
        <div class="vm-progress"><div class="vm-progress-fill" style="width:${memPct}%;background:${memPct>85?'var(--red)':memPct>60?'var(--yellow)':'var(--green)'}"></div></div>
      </div>
    </div>` : '';

  const meta = [
    vm.type === 'qemu' ? 'VM' : 'CT',
    `ID ${vm.vmid}`,
    isRunning && vm.maxmem ? fmtBytes(vm.mem) + ' RAM' : '',
    isRunning && vm.cpus   ? `${vm.cpus} vCPU` : '',
  ].filter(Boolean).join(' · ');

  return `
  <div class="vm-item ${compact ? 'compact' : ''}">
    <div class="vm-icon ${escHtml(vm.type)}">
      ${vm.type === 'qemu' ? '🖥' : '📦'}
    </div>
    <div class="vm-info">
      <div class="vm-name">${escHtml(vm.name || `VM ${vm.vmid}`)}</div>
      <div class="vm-meta">${escHtml(meta)}</div>
    </div>
    <div class="vm-right">
      <span class="status-badge status-${escHtml(vm.status === 'running' ? 'running' : 'stopped')}">
        ${escHtml(vm.status)}
      </span>
      ${bars}
      <div class="vm-actions">${actions}</div>
    </div>
  </div>`;
}

// ── VM Actions ─────────────────────────────────────────────────────────────
window.vmAction = function(node, type, vmid, action) {
  const labels = { start: 'Start', stop: 'Stop', shutdown: 'Shut down', reboot: 'Reboot' };
  state.pendingAction = { node, type, vmid, action };
  $('action-modal-title').textContent = `${labels[action]} VM ${vmid}?`;
  $('action-modal-body').textContent  = `Are you sure you want to ${action} this ${type === 'qemu' ? 'virtual machine' : 'container'}?`;
  $('action-modal').classList.add('open');
};

$('action-confirm').addEventListener('click', async () => {
  const { node, type, vmid, action } = state.pendingAction || {};
  if (!node) return;
  $('action-modal').classList.remove('open');
  try {
    await api(`/api/nodes/${node}/${type}/${vmid}/${action}`, { method: 'POST' });
    showToast(`${action} sent to ${type} ${vmid}`, 'success');
    setTimeout(fetchAll, 1500);
  } catch (e) {
    showToast(`Error: ${e.message}`, 'error');
  }
  state.pendingAction = null;
});

$('action-cancel').addEventListener('click', () => {
  $('action-modal').classList.remove('open');
  state.pendingAction = null;
});

// ── Tab: Storage ───────────────────────────────────────────────────────────
function renderStorage() {
  const container = $('storage-container');
  const nodes = Object.entries(state.storage);

  if (!nodes.length) {
    container.innerHTML = errorState('No storage data', 'Waiting for data...');
    return;
  }

  const html = nodes.map(([nodeName, pools]) => {
    if (!pools || !pools.length) return '';
    const items = pools.map(s => {
      const usedPct = fmtPct(s.used, s.total);
      const cls = pctClass(usedPct);
      return `
      <div class="storage-item">
        <div class="storage-header">
          <span class="storage-name">${escHtml(s.storage)}</span>
          <span class="storage-type">${escHtml(s.type)}</span>
        </div>
        <div class="gauge-header" style="margin-bottom:6px">
          <span class="gauge-label">${usedPct}% used</span>
          <span class="gauge-value" style="color:var(--${cls==='low'?'green':cls==='medium'?'yellow':'red'})">${escHtml(fmtBytes(s.used))} / ${escHtml(fmtBytes(s.total))}</span>
        </div>
        <div class="progress-bar">
          <div class="progress-fill ${cls}" style="width:${usedPct}%"></div>
        </div>
        <div class="storage-size-row">
          <span>Available: ${escHtml(fmtBytes(s.avail))}</span>
          <span>Content: ${escHtml((s.content || '').replace(/,/g, ', '))}</span>
        </div>
      </div>`;
    }).join('');

    return `<div class="section-label">${escHtml(nodeName)}</div><div class="storage-grid">${items}</div>`;
  }).join('');

  container.innerHTML = html || errorState('No active storage', '');
}

// ── Tab: Tasks ─────────────────────────────────────────────────────────────
function renderTasks() {
  const container = $('tasks-container');
  const allTasks = [];
  Object.entries(state.tasks).forEach(([node, tasks]) => {
    (tasks || []).forEach(t => allTasks.push({ ...t, _node: node }));
  });

  if (!allTasks.length) {
    container.innerHTML = errorState('No recent tasks', '');
    return;
  }

  allTasks.sort((a, b) => (b.starttime || 0) - (a.starttime || 0));

  const html = `<div class="task-list">${allTasks.map(t => {
    const status = t.status === 'OK' ? 'ok'
      : t.status === 'ERROR' ? 'error'
      : !t.endtime ? 'running'
      : 'unknown';

    return `
    <div class="task-item task-${status}">
      <div class="task-dot"></div>
      <div class="task-info">
        <div class="task-type">${escHtml(t.type || '—')}</div>
        <div class="task-node">${escHtml(t._node)} · ${escHtml(t.id || '')}</div>
      </div>
      <div class="task-time">
        ${escHtml(fmtTime(t.starttime))}
        ${t.status ? `<br><span style="font-size:10px;color:${status==='ok'?'var(--green)':status==='error'?'var(--red)':'var(--yellow)'};">${escHtml(t.status)}</span>` : ''}
      </div>
    </div>`;
  }).join('')}</div>`;

  container.innerHTML = html;
}

// ── Error / empty state helper ─────────────────────────────────────────────
function errorState(title, body) {
  return `<div class="empty-state">
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
    <h3>${escHtml(title)}</h3>
    <p>${escHtml(body)}</p>
  </div>`;
}

// ── Tab navigation ─────────────────────────────────────────────────────────
$$('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    state.activeTab = tab;
    $$('.tab').forEach(t => t.classList.remove('active'));
    $$('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    $(`tab-${tab}`).classList.add('active');
  });
});

// ── Filter chips ───────────────────────────────────────────────────────────
$$('.chip').forEach(chip => {
  chip.addEventListener('click', () => {
    $$('.chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    state.vmFilter = chip.dataset.filter;
    renderVMs();
  });
});

// ── Search ─────────────────────────────────────────────────────────────────
$('vm-search').addEventListener('input', e => {
  state.vmSearch = e.target.value.trim();
  renderVMs();
});

// ── Settings ───────────────────────────────────────────────────────────────
$('settings-btn').addEventListener('click', () => $('settings-modal').classList.add('open'));
$('close-settings').addEventListener('click', () => $('settings-modal').classList.remove('open'));
$('settings-modal').addEventListener('click', e => {
  if (e.target === $('settings-modal')) $('settings-modal').classList.remove('open');
});

$('setting-interval').addEventListener('change', e => {
  state.interval = parseInt(e.target.value);
  scheduleRefresh();
  showToast(`Refresh set to ${e.target.value}s`, 'success');
});

$('setting-show-offline').addEventListener('change', e => {
  state.showOffline = e.target.checked;
  renderVMs();
});

$('setting-compact').addEventListener('change', e => {
  state.compact = e.target.checked;
  renderVMs();
});

// ── Manual refresh ─────────────────────────────────────────────────────────
$('refresh-btn').addEventListener('click', () => {
  fetchAll();
  scheduleRefresh(); // reset timer
});

// ── Close modals on overlay click ──────────────────────────────────────────
$('action-modal').addEventListener('click', e => {
  if (e.target === $('action-modal')) {
    $('action-modal').classList.remove('open');
    state.pendingAction = null;
  }
});

// ── Init ───────────────────────────────────────────────────────────────────
fetchAll();
scheduleRefresh();
