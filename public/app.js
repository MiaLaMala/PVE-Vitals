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
  hostInfo: null,
  tasksAckedUntil: 0,
  backupJobs: [],
  guestInfo: {},
  guestBackups: {},
  notBackedUp: [],
  ha: [],
  ceph: null,
  replication: [],
  enableSound: false,
  lastWorstSev: 'ok',
  timeframe: 'hour',
  timeframeCycle: ['hour', 'day', 'week'],
  timeframeIdx: 0,
  refreshMs: 10000,
  lastGoodUpdate: null,
  fetchFailCount: 0,
  themeFamily: 'phosphor',
  themeMode: 'dark',
  clusterName: null,
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
    memory: 'RAM',
    disk: 'Disk',
    rootDisk: 'Root disk',
    shared: 'shared',
    empty: 'Nothing to show',
    window: 'Window',
    updatedAgo: (s) => `Updated ${s}s ago`,
    staleSince: (s) => `No fresh data for ${s}s`,
    nodeOfflineAlert: (name) => `Node ${name} is offline`,
    storageAlert: (name, pct) => `Storage ${name} at ${pct}%`,
    cpuAlert: (name, pct) => `CPU on ${name} at ${pct}%`,
    memAlert: (name, pct) => `RAM on ${name} at ${pct}%`,
    diskAlert: (name, pct) => `Disk on ${name} at ${pct}%`,
    taskFailedAlert: (type, node) => `Task ${type} failed on ${node}`,
    markAsRead: 'Mark as read',
    backupJobs: 'Backup jobs',
    backupAll: 'all guests',
    lastBackup: 'Backup',
    noBackupAlert: (n) => n === 1 ? '1 guest without backup' : `${n} guests without backup`,
    cephWarnAlert: 'Ceph health: warning',
    cephCritAlert: 'Ceph health: error',
    haAlert: (n) => n === 1 ? '1 HA service in error state' : `${n} HA services in error state`,
    replicationAlert: (n) => n === 1 ? '1 replication job failing' : `${n} replication jobs failing`,
    summaryNodes: 'Nodes',
    summaryGuests: 'Guests',
    summaryCPU: 'CPU',
    summaryRAM: 'RAM',
    transit_status_ok:    'Cluster running on time',
    transit_status_warn:  'Delays likely',
    transit_status_crit:  'SERVICE DISRUPTION',
    transit_label_ok:     'on time · no notices',
    transit_label_warn:   'minor delay · load elevated',
    transit_label_crit:   'service disrupted · immediate attention',
    transit_via_ok:       'on time',
    transit_via_warn:     'slightly delayed',
    transit_via_crit:     'disrupted',
    transit_via_planned:  'scheduled',
    transit_parked:       'parked',
    transit_anschluesse:  'Connections · guests on board',
    transit_no_notices:   'All services on time',
    transit_notice:       'Notice',
    transit_platform:     'Platform',
    transit_platform_sub: 'nodes online',
    transit_via_head_ab:     'dep',
    transit_via_head_ueber:  'via',
    transit_via_head_status: 'Status',
    transit_via_head_last:   'Load',
    transit_status_plate: 'Cluster\nStatus',
    transit_compute:      'Compute',
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
    shared: 'geteilt',
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
    markAsRead: 'Als erledigt markieren',
    backupJobs: 'Backup-Aufträge',
    backupAll: 'alle Gäste',
    lastBackup: 'Backup',
    noBackupAlert: (n) => n === 1 ? '1 Gast ohne Backup' : `${n} Gäste ohne Backup`,
    cephWarnAlert: 'Ceph-Status: Warnung',
    cephCritAlert: 'Ceph-Status: Fehler',
    haAlert: (n) => n === 1 ? '1 HA-Dienst im Fehlerzustand' : `${n} HA-Dienste im Fehlerzustand`,
    replicationAlert: (n) => n === 1 ? '1 Replikations-Job fehlgeschlagen' : `${n} Replikations-Jobs fehlgeschlagen`,
    summaryNodes: 'Knoten',
    summaryGuests: 'Gäste',
    summaryCPU: 'CPU',
    summaryRAM: 'RAM',
    transit_status_ok:    'Cluster betriebsbereit',
    transit_status_warn:  'Verspätung wahrscheinlich',
    transit_status_crit:  'BETRIEBSSTÖRUNG',
    transit_label_ok:     'pünktlich · keine Meldungen',
    transit_label_warn:   'leichte Verspätung · Auslastung erhöht',
    transit_label_crit:   'Betrieb gestört · sofortige Aufmerksamkeit',
    transit_via_ok:       'planmäßig',
    transit_via_warn:     'leicht erhöht',
    transit_via_crit:     'störung',
    transit_via_planned:  'vorgesehen',
    transit_parked:       'geparkt',
    transit_anschluesse:  'Anschlüsse · Gäste an Bord',
    transit_no_notices:   'Alle Verbindungen planmäßig',
    transit_notice:       'Hinweis',
    transit_platform:     'Gleis',
    transit_platform_sub: 'Knoten online',
    transit_via_head_ab:     'ab',
    transit_via_head_ueber:  'über',
    transit_via_head_status: 'Status',
    transit_via_head_last:   'Last',
    transit_status_plate: 'Cluster\nStatus',
    transit_compute:      'Compute',
  },
};

// ==== Task-alert acknowledgement ===========================================
// Only task-failure alerts are dismissible. Real-time alerts (node offline,
// high CPU/RAM/disk/storage) reflect the current state and are not hidden.
// The ack timestamp is stored server-side so clicking "Mark as read" on one
// device hides the alert on every viewer at the next refresh.
async function ackTaskAlertsNow() {
  try {
    const r = await fetch('/api/ack', { method: 'POST', headers: authHeaders() });
    const j = await r.json();
    if (j.ok && j.data) state.tasksAckedUntil = j.data.tasksAckedUntil;
  } catch (e) {
    console.error('ack failed:', e);
  }
  render();
}

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

// ==== Attribution footer ====================================================
function renderAttribution() {
  const el = $('attribution');
  if (!el) return;
  const parts = ['by Mia Grünwald'];
  if (state.hostInfo?.pve) {
    parts.push(`PVE ${state.hostInfo.pve}`);
    parts.push(`Dashboard ${window.location.host}`);
  }
  el.textContent = parts.join(' · ');
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
// Token, if present in the URL, is sent on every request so DASHBOARD_TOKEN
// deployments work from a bookmarkable URL like http://host:3000/?token=xxx.
const urlToken = new URLSearchParams(location.search).get('token') || '';
function authHeaders() {
  return urlToken ? { Authorization: `Bearer ${urlToken}` } : {};
}
async function api(path, opts = {}) {
  const headers = Object.assign({}, authHeaders(), opts.headers || {});
  const r = await fetch(path, { ...opts, headers });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  if (!j.ok) throw new Error(j.error || 'API error');
  return j.data;
}

// ==== Data fetch ============================================================
async function fetchAll() {
  try {
    const [nodes, resources, ack, backupJobs, guestInfo, guestBackups, notBackedUp, ha, ceph, replication] = await Promise.all([
      api('/api/nodes'),
      api('/api/cluster/resources'),
      api('/api/ack').catch(() => ({ tasksAckedUntil: 0 })),
      api('/api/cluster/backup-jobs').catch(() => []),
      api('/api/guests/info').catch(() => ({})),
      api('/api/guests/backups').catch(() => ({})),
      api('/api/cluster/not-backed-up').catch(() => []),
      api('/api/cluster/ha').catch(() => []),
      api('/api/cluster/ceph').catch(() => null),
      api('/api/cluster/replication').catch(() => []),
    ]);
    state.nodes = nodes;
    state.resources = resources;
    state.tasksAckedUntil = ack.tasksAckedUntil || 0;
    state.backupJobs = backupJobs || [];
    state.guestInfo = guestInfo || {};
    state.guestBackups = guestBackups || {};
    state.notBackedUp = notBackedUp || [];
    state.ha = ha || [];
    state.ceph = ceph || null;
    state.replication = replication || [];

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

  const sharedAlerted = new Set();
  Object.entries(state.storage).forEach(([node, pools]) => {
    (pools || []).forEach((s) => {
      if (s.shared) {
        if (sharedAlerted.has(s.storage)) return;
        sharedAlerted.add(s.storage);
      }
      const p = pct(s.used, s.total);
      const sev = sevForPct(p, th.storageWarn, th.storageCrit);
      const label = s.shared ? s.storage : `${node}/${s.storage}`;
      if (sev !== 'ok') alerts.push({ sev, msg: t('storageAlert', label, p) });
    });
  });

  const cutoff = Math.floor(Date.now() / 1000) - 7200;
  const ackedUntil = state.tasksAckedUntil || 0;
  Object.entries(state.tasks).forEach(([node, tasks]) => {
    (tasks || [])
      .filter((tk) =>
        tk.status && tk.status !== 'OK' &&
        tk.endtime && tk.endtime > cutoff && tk.endtime > ackedUntil
      )
      .slice(0, 3)
      .forEach((tk) => alerts.push({ sev: 'warn', msg: t('taskFailedAlert', tk.type || '?', node) }));
  });

  if ((state.notBackedUp || []).length > 0) {
    alerts.push({ sev: 'warn', msg: t('noBackupAlert', state.notBackedUp.length) });
  }

  // Ceph health (if configured)
  const cephStatus = state.ceph?.health?.status;
  if (cephStatus === 'HEALTH_ERR') alerts.push({ sev: 'crit', msg: t('cephCritAlert') });
  else if (cephStatus === 'HEALTH_WARN') alerts.push({ sev: 'warn', msg: t('cephWarnAlert') });

  // HA services in error/fence state
  const haErr = (state.ha || []).filter((h) =>
    h.type === 'service' && ['error', 'fence'].includes(h.state)
  );
  if (haErr.length > 0) alerts.push({ sev: 'warn', msg: t('haAlert', haErr.length) });

  // Failed storage replication jobs
  const replErr = (state.replication || []).filter((r) =>
    r.state === 'error' || Number(r.fail_count) > 0
  );
  if (replErr.length > 0) alerts.push({ sev: 'warn', msg: t('replicationAlert', replErr.length) });

  return alerts;
}

// ==== Render: top bar + alerts =============================================
function renderTopBar() {
  // Priority: explicit CLUSTER_NAME env var → /api/cluster/resources name →
  // localised "Cluster" placeholder set by applyI18n.
  const clusterRes = state.resources.find((r) => r.type === 'cluster');
  const name = state.clusterName || clusterRes?.name || null;
  if (name) {
    $('cluster-name').textContent = name;
    document.title = `PVE Vitals · ${name}`;
    const host = $('term-host');
    if (host) host.textContent = name.toLowerCase().replace(/[^a-z0-9-]+/g, '-');
  }

  const alerts = computeAlerts();
  const worst = maxSev(...alerts.map((a) => a.sev));

  const health = $('health');
  health.className = `health sev-${worst}`;
  const label = worst === 'crit' ? t('healthCrit')
              : worst === 'warn' ? t('healthWarn')
              : t('healthOk');
  health.querySelector('.health-text').textContent = label;

  // Beep on transition into CRIT, if sound is enabled and the audio context
  // has been unlocked by a user gesture. Silent failure otherwise.
  if (state.enableSound && worst === 'crit' && state.lastWorstSev !== 'crit') {
    playAlertSound();
  }
  state.lastWorstSev = worst;

  const alertsEl = $('alerts');
  if (alerts.length) {
    alertsEl.hidden = false;
    const chips = alerts.slice(0, 12)
      .map((a) => `<div class="alert alert-${esc(a.sev)}">${esc(a.msg)}</div>`)
      .join('');
    alertsEl.innerHTML = `${chips}<button class="alert-ack" type="button">${esc(t('markAsRead'))}</button>`;
    const btn = alertsEl.querySelector('.alert-ack');
    if (btn) btn.addEventListener('click', ackTaskAlertsNow);
  } else {
    alertsEl.hidden = true;
    alertsEl.innerHTML = '';
  }
}

// ==== Render: clock + last updated =========================================
function renderClock() {
  const family = state.themeFamily || 'phosphor';
  const mod = window.PVE_THEMES?.[family];
  if (mod && typeof mod.tick === 'function') {
    try { mod.tick(state, themeHelpers()); }
    catch (e) { console.error(`[theme:${family}] tick failed:`, e); }
    return;
  }

  const clockEl = $('clock');
  if (!clockEl) return;
  const d = new Date();
  clockEl.textContent =
    `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

  const lu = $('last-updated');
  if (!lu) return;
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
  // PVE RRD uses memused/memtotal on nodes; older builds use mem/maxmem.
  // Fall back across both so the sparkline works on every version.
  const cpuSeries = rrd.map((p) => (p.cpu ?? 0) * 100);
  const memSeries = rrd.map((p) => {
    const used = p.memused ?? p.mem;
    const total = p.memtotal ?? p.maxmem;
    return total ? (used / total) * 100 : 0;
  });
  const netinSeries = rrd.map((p) => p.netin ?? 0);
  const netoutSeries = rrd.map((p) => p.netout ?? 0);

  const latest = (arr) => arr[arr.length - 1] || 0;
  const canvases = document.querySelectorAll(`.spark[data-node="${CSS.escape(node)}"]`);
  canvases.forEach((c) => {
    if (c.dataset.metric === 'cpu') {
      // Percent metric: lock the y-axis to 0-100 so a steady 5% does not
      // render pegged at the top of the canvas.
      sparkline(c, `${t('cpu')} ${Math.round(latest(cpuSeries))}%`,
        [{ data: cpuSeries, color: '#388bfd' }], { fill: true, maxOverride: 100 });
    } else if (c.dataset.metric === 'mem') {
      sparkline(c, `${t('memory')} ${Math.round(latest(memSeries))}%`,
        [{ data: memSeries, color: '#3fb950' }], { fill: true, maxOverride: 100 });
    } else if (c.dataset.metric === 'net') {
      // Byte rates span orders of magnitude, so auto-scale to max.
      sparkline(c, `↓ ${fmtBytes(latest(netinSeries))}/s   ↑ ${fmtBytes(latest(netoutSeries))}/s`,
        [{ data: netinSeries, color: '#a371f7' }, { data: netoutSeries, color: '#f78166' }]);
    }
  });
}

// Draw one or more series on a canvas with a text label.
// series: [{ data: number[], color: string }]
// opts.fill: when true, fills the area under each line with a vertical gradient.
// opts.maxOverride: fix the y-axis to this value instead of auto-scaling.
//   Use for percent metrics (0-100) so low-but-steady values don't peg the top.
function sparkline(canvas, label, series, { fill = false, maxOverride = null } = {}) {
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

  const flat = series.flatMap((s) => s.data || []);
  if (flat.length < 2) return;
  const max = maxOverride ?? Math.max(...flat, 1);
  const top = 16, bot = H - 2;

  const tracePath = (data, step) => {
    ctx.beginPath();
    data.forEach((v, i) => {
      const x = i * step;
      const y = bot - (v / max) * (bot - top);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
  };

  series.forEach(({ data, color }) => {
    if (!data || data.length < 2) return;
    const step = W / (data.length - 1);

    if (fill) {
      const grad = ctx.createLinearGradient(0, top, 0, bot);
      grad.addColorStop(0, color + '55');
      grad.addColorStop(1, color + '05');
      tracePath(data, step);
      ctx.lineTo((data.length - 1) * step, bot);
      ctx.lineTo(0, bot);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();
    }

    tracePath(data, step);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.stroke();
  });
}

// ==== Tag and OS helpers ==================================================
// Stable FNV-1a hash → hue in [0,360) so the same tag always gets the same color.
function tagHue(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h % 360;
}

// External SVG assets bundled in /public. Rendered via <img> so each icon
// keeps its own colors (Tux, Microsoft, FreeBSD daemon, etc).
const OS_ICON_FILES = {
  windows: '/microsoft-svgrepo-com.svg',
  linux:   '/linux-svgrepo-com.svg',
  bsd:     '/freebsd-icon.svg',
};
const UNKNOWN_OS_ICON = '/unknown-os-svgrepo-com.svg';
function osIcon(os) {
  const src = OS_ICON_FILES[os] || UNKNOWN_OS_ICON;
  return `<img class="os-icon" src="${src}" alt="${esc(os || 'unknown')}" aria-hidden="true">`;
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
    const info = state.guestInfo[`${v.type}/${v.vmid}/${v.node}`] || {};
    const ips = info.ips || [];
    const ipLine = isRun && ips.length
      ? `<div class="vm-ips" title="${esc(ips.join(', '))}">${esc(ips.join(' · '))}</div>`
      : '';
    const tags = String(v.tags || '').split(/[;,]/).filter(Boolean);
    const tagPills = tags
      .map((tg) => `<span class="tag" style="--tag-hue:${tagHue(tg)}">${esc(tg)}</span>`)
      .join('');
    const lastBackupTs = state.guestBackups[String(v.vmid)];
    const backupLine = lastBackupTs
      ? `<div class="vm-backup">${esc(t('lastBackup'))} ${esc(fmtRelTime(lastBackupTs))}</div>`
      : '';

    return `
    <div class="vm-row sev-${sev}">
      <span class="dot dot-${isRun ? 'ok' : 'idle'}"></span>
      <div class="vm-main">
        <div class="vm-name">
          ${osIcon(info.os)}
          <span class="vm-name-text">${esc(v.name || `${kind} ${v.vmid}`)}</span>
          ${tagPills}
        </div>
        <div class="vm-meta">${esc(kind)} · #${esc(v.vmid)} · ${esc(v.node)}${isRun && v.cpus ? ` · ${esc(v.cpus)} vCPU` : ''}</div>
        ${ipLine}
        ${backupLine}
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
  const sharedSeen = new Map();
  Object.entries(state.storage).forEach(([node, pools]) => {
    (pools || []).forEach((p) => {
      if (p.shared) {
        const prev = sharedSeen.get(p.storage);
        if (prev) {
          prev.node = t('shared') || 'shared';
          if ((p.used || 0) > (prev.used || 0)) {
            prev.used = p.used; prev.total = p.total; prev.avail = p.avail;
          }
          return;
        }
        const entry = { node, ...p };
        sharedSeen.set(p.storage, entry);
        all.push(entry);
      } else {
        all.push({ node, ...p });
      }
    });
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

// ==== Render: cluster summary strip ========================================
function renderClusterSummary() {
  const el = $('cluster-summary');
  if (!el) return;
  const guests = state.resources.filter((r) => r.type === 'qemu' || r.type === 'lxc');
  if (!guests.length && !state.nodes.length) { el.hidden = true; el.innerHTML = ''; return; }
  const runningGuests = guests.filter((v) => v.status === 'running').length;
  const onlineNodes = state.nodes.filter((n) => n.status === 'online').length;
  const cpuUsed = state.nodes.reduce((s, n) => s + (n.cpu || 0) * (n.maxcpu || 0), 0);
  const cpuTotal = state.nodes.reduce((s, n) => s + (n.maxcpu || 0), 0);
  const memUsed = state.nodes.reduce((s, n) => s + (n.mem || 0), 0);
  const memTotal = state.nodes.reduce((s, n) => s + (n.maxmem || 0), 0);

  const chip = (label, value) =>
    `<div class="cs-chip"><span class="cs-label">${esc(label)}</span><span class="cs-value">${esc(value)}</span></div>`;

  el.hidden = false;
  el.innerHTML = [
    chip(t('summaryNodes'), `${onlineNodes}/${state.nodes.length}`),
    chip(t('summaryGuests'), `${runningGuests}/${guests.length}`),
    cpuTotal > 0 ? chip(t('summaryCPU'), `${cpuUsed.toFixed(1)} / ${cpuTotal}`) : '',
    memTotal > 0 ? chip(t('summaryRAM'), `${fmtBytes(memUsed)} / ${fmtBytes(memTotal)}`) : '',
  ].filter(Boolean).join('');
}

// ==== Render: backup jobs strip ============================================
function renderBackupJobs() {
  const el = $('backup-strip');
  if (!el) return;
  const jobs = state.backupJobs || [];
  if (!jobs.length) { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  const chips = jobs.map((j) => {
    const sched = j.schedule || '-';
    const who = j.vmid ? `VMID ${j.vmid}` : (Number(j.all) === 1 ? t('backupAll') : (j.pool ? `pool ${j.pool}` : '-'));
    const store = j.storage ? ` → ${j.storage}` : '';
    return `<div class="backup-chip"><b>${esc(sched)}</b>${esc(who)}${esc(store)}</div>`;
  }).join('');
  el.innerHTML = `<div class="backup-strip-label">${esc(t('backupJobs'))} · ${jobs.length}</div>${chips}`;
}

// ==== Render orchestrator ===================================================
// Architecture and Transit themes own the entire viewport via #theme-host and
// register a renderer on window.PVE_THEMES. Phosphor and Professional share
// the DOM and re-use the panel pipeline below.
function render() {
  const family = state.themeFamily || 'phosphor';
  const mod = window.PVE_THEMES?.[family];
  if (mod && typeof mod.render === 'function') {
    try { mod.render(state, themeHelpers()); }
    catch (e) { console.error(`[theme:${family}] render failed:`, e); }
    return;
  }
  renderTopBar();
  renderClusterSummary();
  renderBackupJobs();
  renderNodes();
  renderVMs();
  renderStorage();
  renderTasks();
}

// ==== Init ==================================================================
// URL ?lang= wins (useful for ad-hoc testing). FORCE_LANG from .env
// overrides browser auto-detect. DEFAULT_LANG is the final fallback.
function pickLang(serverDefault, forceLang) {
  const urlForced = new URLSearchParams(location.search).get('lang');
  if (urlForced === 'de' || urlForced === 'en') return urlForced;
  if (forceLang === 'de' || forceLang === 'en') return forceLang;
  const nav = (navigator.language || '').toLowerCase();
  if (nav.startsWith('de')) return 'de';
  if (nav.startsWith('en')) return 'en';
  return serverDefault || 'en';
}

// ==== Sound on CRIT (opt-in via ENABLE_SOUND) ==============================
// Browsers require a user gesture to unlock AudioContext; we register a
// one-time listener that primes it on the first click or key press.
let audioCtx = null;
function ensureAudio() {
  if (audioCtx || !window.AudioContext) return;
  try { audioCtx = new AudioContext(); } catch {}
}
function playAlertSound() {
  ensureAudio();
  if (!audioCtx) return;
  if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  try {
    const now = audioCtx.currentTime;
    [880, 660].forEach((freq, i) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, now + i * 0.22);
      gain.gain.linearRampToValueAtTime(0.18, now + i * 0.22 + 0.02);
      gain.gain.linearRampToValueAtTime(0, now + i * 0.22 + 0.2);
      osc.connect(gain); gain.connect(audioCtx.destination);
      osc.start(now + i * 0.22);
      osc.stop(now + i * 0.22 + 0.25);
    });
  } catch {}
}

// ==== Fullscreen toggle (F key) ============================================
function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else document.documentElement.requestFullscreen().catch(() => {});
}

// ==== Theme ================================================================
// Theme keys are 'phosphor' | 'professional' | 'architecture' | 'transit',
// optionally with a '-light' or '-dark' suffix that pins the colour mode.
// Bare 'light' / 'dark' / 'auto' are legacy aliases for the Phosphor family.
// Phosphor and Transit ship a single CSS file (style.css and transit.css);
// the others have a separate stylesheet under /themes that is loaded on
// demand. Architecture and Transit also have a JS renderer that takes over
// the DOM via #theme-host while the standard panel grid stays hidden.
// Pick one of the four theme families using today's date as the seed, so
// every viewer of the same cluster lands on the same theme on the same day
// (across reloads). Switches at local midnight; no mid-day shuffling.
function pickRandomFamily() {
  const families = ['phosphor', 'professional', 'architecture', 'transit'];
  const d = new Date();
  const key = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  let h = 2166136261 >>> 0;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return families[h % families.length];
}

function resolveTheme(rawTheme) {
  const t = String(rawTheme || '').toLowerCase().trim();
  if (t === 'random') return resolveTheme(pickRandomFamily());
  if (t === 'light' || t === 'dark') return { family: 'phosphor', mode: t };
  if (!t || t === 'auto') return { family: 'phosphor', mode: 'auto' };
  const m = t.match(/^(phosphor|professional|architecture|transit)(?:-(light|dark))?$/);
  if (!m) return { family: 'phosphor', mode: 'auto' };
  let mode = m[2] || 'auto';
  if (m[1] === 'transit') mode = 'dark';
  return { family: m[1], mode };
}

function applyTheme(rawTheme) {
  const { family, mode } = resolveTheme(rawTheme);
  const resolvedMode = mode === 'auto'
    ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
    : mode;

  // For phosphor we keep emitting data-theme="light"/"dark" so the existing
  // :root[data-theme="light"] override in style.css continues to apply.
  if (family === 'phosphor') {
    document.documentElement.dataset.theme = resolvedMode;
  } else {
    document.documentElement.dataset.theme =
      resolvedMode === 'light' ? `${family}-light` : family;
  }
  document.documentElement.dataset.themeFamily = family;
  document.documentElement.dataset.themeMode = resolvedMode;
  state.themeFamily = family;
  state.themeMode = resolvedMode;

  // The brand-name literal in index.html is "pve_vitals" — a Phosphor
  // terminal-style identifier. For other families we want a normal title.
  const brand = document.querySelector('.brand-name');
  if (brand) brand.textContent = family === 'phosphor' ? 'pve_vitals' : 'PVE Vitals';
}

const themeAssetPromises = new Map();
function loadThemeAssets(family) {
  if (family === 'phosphor') return Promise.resolve();
  if (themeAssetPromises.has(family)) return themeAssetPromises.get(family);

  const promise = (async () => {
    const cssId = `theme-css-${family}`;
    if (!document.getElementById(cssId)) {
      const link = document.createElement('link');
      link.id = cssId;
      link.rel = 'stylesheet';
      link.href = `themes/${family}.css`;
      document.head.appendChild(link);
    }
    if (family === 'architecture' || family === 'transit') {
      await new Promise((resolve, reject) => {
        const jsId = `theme-js-${family}`;
        if (document.getElementById(jsId)) return resolve();
        const s = document.createElement('script');
        s.id = jsId;
        s.src = `themes/${family}.js`;
        s.onload = resolve;
        s.onerror = () => reject(new Error(`failed to load themes/${family}.js`));
        document.head.appendChild(s);
      });
    }
  })();
  themeAssetPromises.set(family, promise);
  return promise;
}

// Theme renderers register here (architecture.js / transit.js).
// Shape: { render(state, helpers), tick?() }
window.PVE_THEMES = window.PVE_THEMES || {};
function themeHelpers() {
  return {
    t, esc, pct, fmtBytes, fmtUptime, fmtRelTime,
    sevForPct, maxSev, computeAlerts,
  };
}

// Auto-scroll long panel bodies so wall-monitor viewers see all content.
// Pauses on hover, disabled if prefers-reduced-motion, disabled if the panel
// content fits without overflow. Panel starts are staggered so they don't
// all scroll in lockstep, which would feel hypnotic.
function startAutoScroll(intervalSec) {
  if (!intervalSec || intervalSec <= 0) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  document.querySelectorAll('.panel-body').forEach((body, idx) => {
    let paused = false;
    body.addEventListener('mouseenter', () => { paused = true; });
    body.addEventListener('mouseleave', () => { paused = false; });
    setTimeout(() => {
      setInterval(() => {
        if (paused) return;
        if (body.scrollHeight <= body.clientHeight + 4) return;
        const atBottom = body.scrollTop + body.clientHeight >= body.scrollHeight - 8;
        const next = atBottom ? 0 : body.scrollTop + body.clientHeight - 24;
        body.scrollTo({ top: next, behavior: 'smooth' });
      }, intervalSec * 1000);
    }, idx * 2500);
  });
}

async function init() {
  let autoScrollInterval = 15;
  let theme = new URLSearchParams(location.search).get('theme') || 'auto';
  try {
    const cfg = await api('/api/config');
    if (cfg.thresholds) state.thresholds = cfg.thresholds;
    state.lang = pickLang(cfg.defaultLang, cfg.forceLang);
    if (cfg.cacheTtl) state.refreshMs = Math.max(5000, cfg.cacheTtl * 1000);
    state.hostInfo = cfg.hostInfo || null;
    state.clusterName = cfg.clusterName || null;
    if (typeof cfg.autoScrollInterval === 'number') autoScrollInterval = cfg.autoScrollInterval;
    state.enableSound = !!cfg.enableSound;
    if (theme === 'auto' && cfg.defaultTheme) theme = cfg.defaultTheme;
  } catch {
    state.lang = pickLang('en', null);
  }

  applyTheme(theme);
  try { await loadThemeAssets(state.themeFamily); }
  catch (e) { console.error('theme assets:', e); }
  applyI18n();
  renderAttribution();
  renderClock();

  // Prime audio on first user gesture so beeps work without prompts.
  if (state.enableSound) {
    const once = () => {
      ensureAudio();
      document.removeEventListener('click', once);
      document.removeEventListener('keydown', once);
    };
    document.addEventListener('click', once, { once: true });
    document.addEventListener('keydown', once, { once: true });
  }

  // Keyboard shortcuts: F toggles fullscreen.
  window.addEventListener('keydown', (e) => {
    if (e.target && ['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)) return;
    if (e.key === 'f' || e.key === 'F') { e.preventDefault(); toggleFullscreen(); }
  });

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

  startAutoScroll(autoScrollInterval);
}

init();
