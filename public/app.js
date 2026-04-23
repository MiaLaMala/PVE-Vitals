'use strict';

// ============================================================================
// PVE Vitals. Read-only Proxmox status wall display.
// ============================================================================

const state = {
  lang: 'en',
  thresholds: {
    cpuWarn: 80, cpuCrit: 95,
    memWarn: 85, memCrit: 95,
    diskWarn: 85, diskCrit: 95,
    storageWarn: 85, storageCrit: 95,
  },
  nodes: [],
  resources: [],
  tasks: {},
  storage: {},
  nodeDetail: {},
  timeframe: 'hour',
  timeframeCycle: ['hour', 'day', 'week'],
  timeframeIdx: 0,
  refreshMs: 10000,
  lastGoodUpdate: null,
  fetchFailCount: 0,
};

const i18n = {
  en: {
    cluster: 'Cluster',
    nodes: 'Nodes',
    guests: 'VMs & CTs',
    storage: 'Storage',
    tasks: 'Recent tasks',
    loading: 'Loading',
    waitingForData: 'Waiting for data',
    healthOk: 'All systems normal',
    healthWarn: 'Attention needed',
    healthCrit: 'Critical',
    healthChecking: 'Checking',
    healthOffline: 'Cannot reach Proxmox API',
    online: 'Online',
    offline: 'Offline',
    running: 'running',
    stopped: 'stopped',
    uptime: 'Uptime',
    cpu: 'CPU',
    memory: 'Memory',
    disk: 'Disk',
    rootDisk: 'Root disk',
    empty: 'Nothing to show',
    window: 'Window',
    updatedAgo: (s) => `Updated ${s}s ago`,
    staleSince: (s) => `No fresh data for ${s}s`,
    nodeOfflineAlert: (name) => `Node ${name} is offline`,
    storageAlert: (name, pct) => `Storage ${name} at ${pct}%`,
    cpuAlert: (name, pct) => `CPU on ${name} at ${pct}%`,
    memAlert: (name, pct) => `Memory on ${name} at ${pct}%`,
    diskAlert: (name, pct) => `Disk on ${name} at ${pct}%`,
    taskFailedAlert: (type, node) => `Task ${type} failed on ${node}`,
  },
  de: {
    cluster: 'Cluster',
    nodes: 'Knoten',
    guests: 'VMs & CTs',
    storage: 'Speicher',
    tasks: 'Letzte Aufgaben',
    loading: 'Lädt',
    waitingForData: 'Warte auf Daten',
    healthOk: 'Alles in Ordnung',
    healthWarn: 'Achtung erforderlich',
    healthCrit: 'Kritisch',
    healthChecking: 'Prüfe',
    healthOffline: 'Proxmox-API nicht erreichbar',
    online: 'Online',
    offline: 'Offline',
    running: 'laufend',
    stopped: 'gestoppt',
    uptime: 'Laufzeit',
    cpu: 'CPU',
    memory: 'RAM',
    disk: 'Disk',
    rootDisk: 'Systemdisk',
    empty: 'Nichts zu zeigen',
    window: 'Zeitraum',
    updatedAgo: (s) => `Vor ${s}s aktualisiert`,
    staleSince: (s) => `Seit ${s}s keine neuen Daten`,
    nodeOfflineAlert: (name) => `Knoten ${name} ist offline`,
    storageAlert: (name, pct) => `Speicher ${name} bei ${pct}%`,
    cpuAlert: (name, pct) => `CPU auf ${name} bei ${pct}%`,
    memAlert: (name, pct) => `RAM auf ${name} bei ${pct}%`,
    diskAlert: (name, pct) => `Disk auf ${name} bei ${pct}%`,
    taskFailedAlert: (type, node) => `Aufgabe ${type} auf ${node} fehlgeschlagen`,
  },
};

const $ = (id) => document.getElementById(id);
const $$ = (sel) => document.querySelectorAll(sel);
function t(key, ...args) {
  const v = i18n[state.lang]?.[key] ?? i18n.en[key] ?? key;
  return typeof v === 'function' ? v(...args) : v;
}

// ==== Formatting ============================================================
function fmtBytes(b, decimals = 1) {
  if (!b) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
  const i = Math.min(Math.floor(Math.log(b) / Math.log(k)), sizes.length - 1);
  return parseFloat((b / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i];
}
function fmtUptime(sec) {
  if (!sec) return '-';
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
function pct(v, total) {
  if (!total) return 0;
  return Math.min(100, Math.round((v / total) * 100));
}
function fmtRelTime(epoch) {
  if (!epoch) return '-';
  const d = new Date(epoch * 1000);
  const diff = Math.max(0, Math.round((Date.now() - d.getTime()) / 1000));
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return d.toLocaleDateString();
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ==== Severity ==============================================================
function sevForPct(p, warn, crit) {
  if (p >= crit) return 'crit';
  if (p >= warn) return 'warn';
  return 'ok';
}
function maxSev(...sevs) {
  const order = { ok: 0, warn: 1, crit: 2 };
  return sevs.reduce((a, b) => (order[b] > order[a] ? b : a), 'ok');
}

// ==== I18n application ======================================================
function applyI18n() {
  document.documentElement.lang = state.lang;
  $$('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    el.textContent = t(key);
  });
}

// ==== API ===================================================================
async function api(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  if (!j.ok) throw new Error(j.error || 'API error');
  return j.data;
}

// ==== Data fetch ============================================================
async function fetchAll() {
  try {
    const [nodes, resources] = await Promise.all([
      api('/api/nodes'),
      api('/api/cluster/resources'),
    ]);
    state.nodes = nodes;
    state.resources = resources;

    await Promise.all(nodes.map(async (n) => {
      if (n.status !== 'online') return;
      try {
        const [tasks, storage, detail] = await Promise.all([
          api(`/api/nodes/${n.node}/tasks`),
          api(`/api/nodes/${n.node}/storage`),
          api(`/api/nodes/${n.node}?tf=${state.timeframe}`),
        ]);
        state.tasks[n.node] = tasks;
        state.storage[n.node] = storage;
        state.nodeDetail[n.node] = detail;
      } catch (e) { /* node can flicker; keep last-known */ }
    }));

    state.lastGoodUpdate = Date.now();
    state.fetchFailCount = 0;
  } catch (e) {
    state.fetchFailCount++;
    console.error('fetchAll error:', e);
  } finally {
    render();
  }
}

// ==== Alerts ================================================================
function computeAlerts() {
  const alerts = [];
  const th = state.thresholds;

  if (state.fetchFailCount >= 2) {
    alerts.push({ sev: 'crit', msg: t('healthOffline') });
    return alerts;
  }

  state.nodes.forEach((n) => {
    if (n.status !== 'online') {
      alerts.push({ sev: 'crit', msg: t('nodeOfflineAlert', n.node) });
      return;
    }
    const cpuPct = Math.round((n.cpu ?? 0) * 100);
    const memPct = pct(n.mem, n.maxmem);
    const diskPct = pct(n.disk, n.maxdisk);
    const cpuSev = sevForPct(cpuPct, th.cpuWarn, th.cpuCrit);
    const memSev = sevForPct(memPct, th.memWarn, th.memCrit);
    const diskSev = sevForPct(diskPct, th.diskWarn, th.diskCrit);
    if (cpuSev !== 'ok') alerts.push({ sev: cpuSev, msg: t('cpuAlert', n.node, cpuPct) });
    if (memSev !== 'ok') alerts.push({ sev: memSev, msg: t('memAlert', n.node, memPct) });
    if (diskSev !== 'ok') alerts.push({ sev: diskSev, msg: t('diskAlert', n.node, diskPct) });
  });

  Object.entries(state.storage).forEach(([node, pools]) => {
    (pools || []).forEach((s) => {
      const p = pct(s.used, s.total);
      const sev = sevForPct(p, th.storageWarn, th.storageCrit);
      if (sev !== 'ok') alerts.push({ sev, msg: t('storageAlert', `${node}/${s.storage}`, p) });
    });
  });

  const cutoff = Math.floor(Date.now() / 1000) - 7200;
  Object.entries(state.tasks).forEach(([node, tasks]) => {
    (tasks || [])
      .filter((tk) => tk.status && tk.status !== 'OK' && tk.endtime && tk.endtime > cutoff)
      .slice(0, 3)
      .forEach((tk) => alerts.push({ sev: 'warn', msg: t('taskFailedAlert', tk.type || '?', node) }));
  });

  return alerts;
}

// ==== Render: top bar + alerts =============================================
function renderTopBar() {
  const clusterRes = state.resources.find((r) => r.type === 'cluster');
  if (clusterRes?.name) $('cluster-name').textContent = clusterRes.name;

  const alerts = computeAlerts();
  const worst = alerts.reduce((a, alert) => {
    const order = { ok: 0, warn: 1, crit: 2 };
    return order[alert.sev] > order[a] ? alert.sev : a;
  }, 'ok');

  const health = $('health');
  health.className = `health sev-${worst}`;
  const label = worst === 'crit' ? t('healthCrit')
              : worst === 'warn' ? t('healthWarn')
              : t('healthOk');
  health.querySelector('.health-text').textContent = label;

  const alertsEl = $('alerts');
  if (alerts.length) {
    alertsEl.hidden = false;
    alertsEl.innerHTML = alerts.slice(0, 12)
      .map((a) => `<div class="alert alert-${esc(a.sev)}">${esc(a.msg)}</div>`)
      .join('');
  } else {
    alertsEl.hidden = true;
    alertsEl.innerHTML = '';
  }
}

// ==== Render: clock + last updated =========================================
function renderClock() {
  const d = new Date();
  $('clock').textContent =
    `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

  const lu = $('last-updated');
  if (state.lastGoodUpdate) {
    const age = Math.round((Date.now() - state.lastGoodUpdate) / 1000);
    lu.textContent = age > 30 ? t('staleSince', age) : t('updatedAgo', age);
    lu.classList.toggle('stale', age > 30);
  } else {
    lu.textContent = t('waitingForData');
  }
}

// ==== Render: nodes panel ==================================================
function renderNodes() {
  $('nodes-count').textContent =
    `${state.nodes.filter((n) => n.status === 'online').length} / ${state.nodes.length}`;

  const body = $('nodes-body');
  if (!state.nodes.length) {
    body.innerHTML = `<div class="placeholder">${esc(t('empty'))}</div>`;
    return;
  }

  const th = state.thresholds;
  body.innerHTML = state.nodes.map((n) => {
    const online = n.status === 'online';
    const cpuPct = Math.round((n.cpu ?? 0) * 100);
    const memPct = pct(n.mem, n.maxmem);
    const diskPct = pct(n.disk, n.maxdisk);
    const cpuSev = sevForPct(cpuPct, th.cpuWarn, th.cpuCrit);
    const memSev = sevForPct(memPct, th.memWarn, th.memCrit);
    const diskSev = sevForPct(diskPct, th.diskWarn, th.diskCrit);
    const nodeSev = !online ? 'crit' : maxSev(cpuSev, memSev, diskSev);

    const vmsOn = state.resources.filter(
      (r) => (r.type === 'qemu' || r.type === 'lxc') && r.node === n.node
    );
    const runningCount = vmsOn.filter((v) => v.status === 'running').length;

    return `
    <div class="node-card sev-${nodeSev}">
      <div class="node-head">
        <div class="node-name">
          <span class="dot dot-${online ? 'ok' : 'crit'}"></span>
          ${esc(n.node)}
        </div>
        <div class="node-subs">
          <span>${esc(online ? t('online') : t('offline'))}</span>
          <span>${esc(t('uptime'))} ${esc(fmtUptime(n.uptime))}</span>
          <span>${runningCount} / ${vmsOn.length} ${esc(t('running'))}</span>
        </div>
      </div>
      <div class="bars">
        ${bar(t('cpu'), cpuPct, `${cpuPct}%`, cpuSev)}
        ${bar(t('memory'), memPct, `${fmtBytes(n.mem)} / ${fmtBytes(n.maxmem)}`, memSev)}
        ${bar(t('rootDisk'), diskPct, `${fmtBytes(n.disk)} / ${fmtBytes(n.maxdisk)}`, diskSev)}
      </div>
      <div class="sparks" aria-label="${esc(t('window'))}: ${esc(state.timeframe)}">
        <canvas class="spark" data-node="${esc(n.node)}" data-metric="cpu"></canvas>
        <canvas class="spark" data-node="${esc(n.node)}" data-metric="mem"></canvas>
        <canvas class="spark" data-node="${esc(n.node)}" data-metric="net"></canvas>
      </div>
    </div>`;
  }).join('');

  state.nodes.forEach((n) => drawSparks(n.node));
}

function bar(label, p, detail, sev) {
  return `
    <div class="bar-row">
      <div class="bar-top">
        <span class="bar-label">${esc(label)}</span>
        <span class="bar-value sev-${sev}">${esc(detail)}</span>
      </div>
      <div class="bar"><div class="bar-fill sev-${sev}" style="width:${p}%"></div></div>
    </div>`;
}

function drawSparks(node) {
  const detail = state.nodeDetail[node];
  const rrd = detail?.rrd || [];
  const cpuSeries = rrd.map((p) => (p.cpu ?? 0) * 100);
  const memSeries = rrd.map((p) => (p.maxmem ? (p.mem / p.maxmem) * 100 : 0));
  const netinSeries = rrd.map((p) => p.netin ?? 0);
  const netoutSeries = rrd.map((p) => p.netout ?? 0);

  const canvases = document.querySelectorAll(`.spark[data-node="${CSS.escape(node)}"]`);
  canvases.forEach((c) => {
    if (c.dataset.metric === 'cpu') {
      sparkline(c, cpuSeries, '#388bfd',
        `${t('cpu')} ${Math.round(cpuSeries[cpuSeries.length - 1] || 0)}%`);
    } else if (c.dataset.metric === 'mem') {
      sparkline(c, memSeries, '#3fb950',
        `${t('memory')} ${Math.round(memSeries[memSeries.length - 1] || 0)}%`);
    } else if (c.dataset.metric === 'net') {
      sparklineDual(c, netinSeries, netoutSeries, '#a371f7', '#f78166',
        `↓ ${fmtBytes(netinSeries[netinSeries.length - 1] || 0)}/s   ↑ ${fmtBytes(netoutSeries[netoutSeries.length - 1] || 0)}/s`);
    }
  });
}

function sparkline(canvas, data, color, label) {
  const W = canvas.clientWidth || 200;
  const H = canvas.clientHeight || 48;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  ctx.fillStyle = '#8b949e';
  ctx.font = '11px -apple-system, system-ui, sans-serif';
  ctx.fillText(label, 6, 12);

  if (!data || data.length < 2) return;
  const max = Math.max(...data, 1);
  const step = W / (data.length - 1);
  const top = 16, bot = H - 2;

  const grad = ctx.createLinearGradient(0, top, 0, bot);
  grad.addColorStop(0, color + '55');
  grad.addColorStop(1, color + '05');
  ctx.beginPath();
  data.forEach((v, i) => {
    const x = i * step;
    const y = bot - (v / max) * (bot - top);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.lineTo((data.length - 1) * step, bot);
  ctx.lineTo(0, bot);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.beginPath();
  data.forEach((v, i) => {
    const x = i * step;
    const y = bot - (v / max) * (bot - top);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

function sparklineDual(canvas, a, b, colA, colB, label) {
  const W = canvas.clientWidth || 200;
  const H = canvas.clientHeight || 48;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  ctx.fillStyle = '#8b949e';
  ctx.font = '11px -apple-system, system-ui, sans-serif';
  ctx.fillText(label, 6, 12);

  const all = [...a, ...b];
  if (all.length < 2) return;
  const max = Math.max(...all, 1);
  const top = 16, bot = H - 2;

  [{ d: a, c: colA }, { d: b, c: colB }].forEach(({ d, c }) => {
    if (d.length < 2) return;
    const step = W / (d.length - 1);
    ctx.beginPath();
    d.forEach((v, i) => {
      const x = i * step;
      const y = bot - (v / max) * (bot - top);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.strokeStyle = c;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.stroke();
  });
}

// ==== Render: VMs panel ====================================================
function renderVMs() {
  const th = state.thresholds;
  const items = state.resources.filter((r) => r.type === 'qemu' || r.type === 'lxc');
  const running = items.filter((v) => v.status === 'running');
  $('vms-count').textContent = `${running.length} / ${items.length}`;

  const body = $('vms-body');
  if (!items.length) {
    body.innerHTML = `<div class="placeholder">${esc(t('empty'))}</div>`;
    return;
  }

  const sorted = [...items].sort((a, b) => {
    if ((a.status === 'running') !== (b.status === 'running')) {
      return a.status === 'running' ? -1 : 1;
    }
    return (b.cpu ?? 0) - (a.cpu ?? 0);
  });

  body.innerHTML = sorted.map((v) => {
    const isRun = v.status === 'running';
    const cpuPct = Math.round((v.cpu ?? 0) * 100);
    const memPct = pct(v.mem, v.maxmem);
    const cpuSev = sevForPct(cpuPct, th.cpuWarn, th.cpuCrit);
    const memSev = sevForPct(memPct, th.memWarn, th.memCrit);
    const sev = !isRun ? 'idle' : maxSev(cpuSev, memSev);
    const kind = v.type === 'qemu' ? 'VM' : 'CT';

    return `
    <div class="vm-row sev-${sev}">
      <span class="dot dot-${isRun ? 'ok' : 'idle'}"></span>
      <div class="vm-main">
        <div class="vm-name">${esc(v.name || `${kind} ${v.vmid}`)}</div>
        <div class="vm-meta">${esc(kind)} · #${esc(v.vmid)} · ${esc(v.node)}${isRun && v.cpus ? ` · ${esc(v.cpus)} vCPU` : ''}</div>
      </div>
      ${isRun ? `
      <div class="vm-bars">
        <div class="mini-bar"><span>${esc(t('cpu'))}</span><div class="bar"><div class="bar-fill sev-${cpuSev}" style="width:${cpuPct}%"></div></div><span class="num">${cpuPct}%</span></div>
        <div class="mini-bar"><span>${esc(t('memory'))}</span><div class="bar"><div class="bar-fill sev-${memSev}" style="width:${memPct}%"></div></div><span class="num">${memPct}%</span></div>
      </div>` : `
      <div class="vm-idle">${esc(t('stopped'))}</div>
      `}
    </div>`;
  }).join('');
}

// ==== Render: storage panel ================================================
function renderStorage() {
  const th = state.thresholds;
  const all = [];
  Object.entries(state.storage).forEach(([node, pools]) => {
    (pools || []).forEach((p) => all.push({ node, ...p }));
  });
  $('storage-count').textContent = `${all.length}`;

  const body = $('storage-body');
  if (!all.length) {
    body.innerHTML = `<div class="placeholder">${esc(t('empty'))}</div>`;
    return;
  }

  all.sort((a, b) => pct(b.used, b.total) - pct(a.used, a.total));

  body.innerHTML = all.map((s) => {
    const p = pct(s.used, s.total);
    const sev = sevForPct(p, th.storageWarn, th.storageCrit);
    return `
    <div class="storage-row sev-${sev}">
      <div class="storage-head">
        <span class="storage-name">${esc(s.storage)}</span>
        <span class="storage-sub">${esc(s.node)} · ${esc(s.type)}</span>
        <span class="storage-pct sev-${sev}">${p}%</span>
      </div>
      <div class="bar"><div class="bar-fill sev-${sev}" style="width:${p}%"></div></div>
      <div class="storage-bytes">${esc(fmtBytes(s.used))} / ${esc(fmtBytes(s.total))}</div>
    </div>`;
  }).join('');
}

// ==== Render: tasks panel ==================================================
function renderTasks() {
  const all = [];
  Object.entries(state.tasks).forEach(([node, tasks]) => {
    (tasks || []).forEach((tk) => all.push({ _node: node, ...tk }));
  });
  all.sort((a, b) => (b.starttime || 0) - (a.starttime || 0));
  const top = all.slice(0, 18);
  $('tasks-count').textContent = `${top.length}`;

  const body = $('tasks-body');
  if (!top.length) {
    body.innerHTML = `<div class="placeholder">${esc(t('empty'))}</div>`;
    return;
  }

  body.innerHTML = top.map((tk) => {
    const sev = tk.status === 'OK' ? 'ok'
              : (tk.status && tk.status !== 'OK' && tk.endtime) ? 'crit'
              : !tk.endtime ? 'warn' : 'idle';
    const ago = tk.starttime ? fmtRelTime(tk.starttime) : '-';
    return `
    <div class="task-row sev-${sev}">
      <span class="dot dot-${sev}"></span>
      <div class="task-info">
        <div class="task-type">${esc(tk.type || '?')}</div>
        <div class="task-meta">${esc(tk._node)}${tk.id ? ` · ${esc(tk.id)}` : ''}${tk.user ? ` · ${esc(tk.user)}` : ''}</div>
      </div>
      <div class="task-time">
        ${esc(ago)}${tk.status ? `<br><span class="task-status sev-${sev}">${esc(tk.status)}</span>` : ''}
      </div>
    </div>`;
  }).join('');
}

// ==== Render orchestrator ===================================================
function render() {
  renderTopBar();
  renderNodes();
  renderVMs();
  renderStorage();
  renderTasks();
}

// ==== Init ==================================================================
function pickLang(serverDefault) {
  const forced = new URLSearchParams(location.search).get('lang');
  if (forced === 'de' || forced === 'en') return forced;
  const nav = (navigator.language || '').toLowerCase();
  if (nav.startsWith('de')) return 'de';
  if (nav.startsWith('en')) return 'en';
  return serverDefault || 'en';
}

async function init() {
  try {
    const cfg = await api('/api/config');
    if (cfg.thresholds) state.thresholds = cfg.thresholds;
    state.lang = pickLang(cfg.defaultLang);
    if (cfg.cacheTtl) state.refreshMs = Math.max(5000, cfg.cacheTtl * 1000);
  } catch {
    state.lang = pickLang('en');
  }

  applyI18n();
  renderClock();
  await fetchAll();

  setInterval(fetchAll, state.refreshMs);
  setInterval(renderClock, 1000);

  // Cycle sparkline time window every 2 minutes (hour -> day -> week)
  setInterval(() => {
    state.timeframeIdx = (state.timeframeIdx + 1) % state.timeframeCycle.length;
    state.timeframe = state.timeframeCycle[state.timeframeIdx];
    fetchAll();
  }, 120000);

  // Re-draw sparklines on window resize (Canvas needs fresh sizing)
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => state.nodes.forEach((n) => drawSparks(n.node)), 150);
  });
}

init();
