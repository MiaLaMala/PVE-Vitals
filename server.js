'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const axios = require('axios');
const https = require('https');
const fs = require('fs');
const NodeCache = require('node-cache');

const app = express();

// ==== Config ================================================================
const PVE_HOST     = process.env.PVE_HOST;
const PVE_PORT     = process.env.PVE_PORT     || '8006';
const PVE_TOKEN_ID = process.env.PVE_TOKEN_ID;
const PVE_SECRET   = process.env.PVE_SECRET;
const LISTEN_PORT  = process.env.PORT         || 3000;
const CACHE_TTL    = parseInt(process.env.CACHE_TTL || '10');
const DEFAULT_LANG = (process.env.DEFAULT_LANG || 'en').toLowerCase().startsWith('de') ? 'de' : 'en';
const FORCE_LANG_RAW = (process.env.FORCE_LANG || '').toLowerCase();
const FORCE_LANG = (FORCE_LANG_RAW === 'de' || FORCE_LANG_RAW === 'en') ? FORCE_LANG_RAW : null;
const SHOW_HOST_INFO = (process.env.SHOW_HOST_INFO || 'false').toLowerCase() === 'true';
const AUTO_SCROLL_INTERVAL = Math.max(0, parseInt(process.env.AUTO_SCROLL_INTERVAL || '15', 10) || 0);
const ENABLE_SOUND = (process.env.ENABLE_SOUND || 'false').toLowerCase() === 'true';
const DEFAULT_THEME = ['light', 'dark', 'auto'].includes((process.env.DEFAULT_THEME || 'auto').toLowerCase())
  ? (process.env.DEFAULT_THEME || 'auto').toLowerCase() : 'auto';
const DASHBOARD_TOKEN = process.env.DASHBOARD_TOKEN ? String(process.env.DASHBOARD_TOKEN) : null;

const thresholds = {
  cpuWarn:     parseInt(process.env.CPU_WARN     || '80'),
  cpuCrit:     parseInt(process.env.CPU_CRIT     || '95'),
  memWarn:     parseInt(process.env.MEM_WARN     || '85'),
  memCrit:     parseInt(process.env.MEM_CRIT     || '95'),
  diskWarn:    parseInt(process.env.DISK_WARN    || '85'),
  diskCrit:    parseInt(process.env.DISK_CRIT    || '95'),
  storageWarn: parseInt(process.env.STORAGE_WARN || '85'),
  storageCrit: parseInt(process.env.STORAGE_CRIT || '95'),
};

if (!PVE_HOST || !PVE_TOKEN_ID || !PVE_SECRET) {
  console.error('ERROR: PVE_HOST, PVE_TOKEN_ID, and PVE_SECRET must be set in .env');
  process.exit(1);
}

// Proxmox uses self-signed certs by default
const agent = new https.Agent({ rejectUnauthorized: false });

const pve = axios.create({
  baseURL: `https://${PVE_HOST}:${PVE_PORT}/api2/json`,
  httpsAgent: agent,
  headers: { Authorization: `PVEAPIToken=${PVE_TOKEN_ID}=${PVE_SECRET}` },
  timeout: 10000,
});

const cache = new NodeCache({ stdTTL: CACHE_TTL, checkperiod: Math.max(CACHE_TTL + 5, 15) });

// ==== Shared state (cross-device alert ack) =================================
const STATE_DIR = path.join(__dirname, '.state');
const STATE_FILE = path.join(STATE_DIR, 'state.json');
function readState() {
  try {
    const j = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    return { tasksAckedUntil: Number(j.tasksAckedUntil) || 0 };
  } catch {
    return { tasksAckedUntil: 0 };
  }
}
function writeState(s) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}

// ==== Helpers ===============================================================
async function cachedGet(key, ttl, fetcher) {
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const data = await fetcher();
  cache.set(key, data, ttl);
  return data;
}

function safeGet(fetcher) {
  return async (req, res) => {
    try {
      const data = await fetcher(req);
      res.json({ ok: true, data });
    } catch (e) {
      console.error(`[api] ${req.path}:`, e.message);
      res.status(502).json({ ok: false, error: e.message });
    }
  };
}

// ==== Auth middleware (only active if DASHBOARD_TOKEN is set) ===============
// Accepts the token via Authorization: Bearer <t> header or ?token=<t> query.
// Gates /api/* and /metrics. Static assets (HTML, CSS, JS, SVG) stay public
// so the kiosk can boot; the token is then used on every data request.
function authMiddleware(req, res, next) {
  if (!DASHBOARD_TOKEN) return next();
  const auth = req.headers.authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  const given = m ? m[1] : (req.query.token || '');
  if (given !== DASHBOARD_TOKEN) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
  next();
}

// ==== Static frontend =======================================================
app.use(express.json({ limit: '1kb' }));
app.use(['/api', '/metrics'], authMiddleware);
app.use(express.static(path.join(__dirname, 'public')));

// ==== Public UI config ======================================================
app.get('/api/config', (req, res) => {
  res.json({
    ok: true,
    data: {
      thresholds,
      defaultLang: DEFAULT_LANG,
      forceLang: FORCE_LANG,
      cacheTtl: CACHE_TTL,
      autoScrollInterval: AUTO_SCROLL_INTERVAL,
      enableSound: ENABLE_SOUND,
      defaultTheme: DEFAULT_THEME,
      authRequired: DASHBOARD_TOKEN !== null,
      hostInfo: SHOW_HOST_INFO ? { pve: `${PVE_HOST}:${PVE_PORT}` } : null,
    },
  });
});

// ==== Read-only API routes ==================================================
app.get('/api/nodes', safeGet(async () =>
  cachedGet('nodes', CACHE_TTL, async () => (await pve.get('/nodes')).data.data)
));

app.get('/api/nodes/:node', safeGet(async (req) => {
  const { node } = req.params;
  const tf = ['hour', 'day', 'week', 'month', 'year'].includes(req.query.tf) ? req.query.tf : 'hour';
  return cachedGet(`node:${node}:${tf}`, CACHE_TTL, async () => {
    const [status, rrd] = await Promise.all([
      pve.get(`/nodes/${node}/status`),
      pve.get(`/nodes/${node}/rrddata?timeframe=${tf}&cf=AVERAGE`),
    ]);
    return { status: status.data.data, rrd: rrd.data.data };
  });
}));

app.get('/api/nodes/:node/storage', safeGet(async (req) =>
  cachedGet(`storage:${req.params.node}`, CACHE_TTL, async () =>
    (await pve.get(`/nodes/${req.params.node}/storage`)).data.data.filter((s) => s.active)
  )
));

app.get('/api/nodes/:node/tasks', safeGet(async (req) =>
  cachedGet(`tasks:${req.params.node}`, 20, async () =>
    (await pve.get(`/nodes/${req.params.node}/tasks?limit=30`)).data.data
  )
));

app.get('/api/cluster/resources', safeGet(async () =>
  cachedGet('resources', CACHE_TTL, async () => (await pve.get('/cluster/resources')).data.data)
));

// High-availability service status. Empty if HA is not configured.
app.get('/api/cluster/ha', safeGet(async () =>
  cachedGet('ha', 30, async () => {
    try { return (await pve.get('/cluster/ha/status/current')).data.data || []; }
    catch { return []; }
  })
));

// Ceph cluster health. Null if Ceph is not configured.
app.get('/api/cluster/ceph', safeGet(async () =>
  cachedGet('ceph', 30, async () => {
    try { return (await pve.get('/cluster/ceph/status')).data.data || null; }
    catch { return null; }
  })
));

// Storage replication jobs across every node. Empty if not used.
app.get('/api/cluster/replication', safeGet(async () =>
  cachedGet('replication', 30, async () => {
    let nodes = [];
    try { nodes = (await pve.get('/nodes')).data.data || []; } catch { return []; }
    const all = [];
    await Promise.all(nodes.map(async (n) => {
      if (n.status !== 'online') return;
      try {
        const r = await pve.get(`/nodes/${n.node}/replication`);
        (r.data.data || []).forEach((j) => all.push({ node: n.node, ...j }));
      } catch { /* ignore */ }
    }));
    return all;
  })
));

// ==== Backup jobs & guest info =============================================
app.get('/api/cluster/backup-jobs', safeGet(async () =>
  cachedGet('backup-jobs', 60, async () => {
    try {
      const r = await pve.get('/cluster/backup');
      return (r.data.data || []).filter((j) => Number(j.enabled) === 1 || j.enabled === true);
    } catch { return []; }
  })
));

// Guests not covered by any backup job.
app.get('/api/cluster/not-backed-up', safeGet(async () =>
  cachedGet('not-backed-up', 300, async () => {
    try {
      const r = await pve.get('/cluster/backup-info/not-backed-up');
      return r.data.data || [];
    } catch { return []; }
  })
));

// Last successful vzdump per vmid, collected from each node's task log.
app.get('/api/guests/backups', safeGet(async () =>
  cachedGet('guest-backups', 120, async () => {
    const latest = {};
    let nodes = [];
    try { nodes = (await pve.get('/nodes')).data.data || []; } catch { return latest; }
    await Promise.all(nodes.map(async (n) => {
      if (n.status !== 'online') return;
      try {
        const r = await pve.get(`/nodes/${n.node}/tasks?typefilter=vzdump&limit=500`);
        (r.data.data || []).forEach((tk) => {
          if (tk.status !== 'OK' || !tk.endtime || !tk.id) return;
          const vmid = String(tk.id).match(/^\d+$/) ? String(tk.id) : null;
          if (!vmid) return;
          if (!latest[vmid] || latest[vmid] < tk.endtime) latest[vmid] = tk.endtime;
        });
      } catch { /* skip this node's history */ }
    }));
    return latest;
  })
));

// Proxmox ostype values vary between qemu (l26, win11, ...) and lxc (debian,
// ubuntu, alpine, ...). Collapse them to a small set the frontend can icon.
function osFamily(ostype) {
  if (!ostype) return null;
  const s = String(ostype).toLowerCase();
  if (s.startsWith('win') || s.startsWith('w2k') || s === 'wxp' || s === 'wvista') return 'windows';
  if (s === 'l26' || s === 'l24' || s === 'linux') return 'linux';
  if ([
    'debian', 'ubuntu', 'alpine', 'centos', 'fedora', 'arch', 'gentoo',
    'opensuse', 'nixos', 'rockylinux', 'almalinux', 'devuan',
  ].includes(s)) return 'linux';
  if (s === 'solaris') return 'solaris';
  if (s === 'freebsd') return 'bsd';
  return null;
}

// Gather IPs and OS family for every running guest. Failures per guest are
// swallowed so one broken agent never kills the response.
app.get('/api/guests/info', safeGet(async () =>
  cachedGet('guest-info', 30, async () => {
    const all = (await pve.get('/cluster/resources')).data.data;
    const guests = all.filter((r) =>
      (r.type === 'qemu' || r.type === 'lxc') && r.status === 'running'
    );
    const extractIps = (addrs) =>
      (addrs || [])
        .filter((a) => a['ip-address-type'] === 'ipv4')
        .map((a) => a['ip-address'])
        .filter((ip) => ip && !ip.startsWith('127.') && !ip.startsWith('169.254.'));

    async function fetchIps(g) {
      try {
        if (g.type === 'qemu') {
          const r = await pve.get(
            `/nodes/${g.node}/qemu/${g.vmid}/agent/network-get-interfaces`,
            { timeout: 3000 }
          );
          const ips = [];
          (r.data.data.result || []).forEach((i) => {
            if (i.name === 'lo') return;
            extractIps(i['ip-addresses']).forEach((ip) => ips.push(ip));
          });
          return Array.from(new Set(ips));
        }
        const r = await pve.get(
          `/nodes/${g.node}/lxc/${g.vmid}/interfaces`,
          { timeout: 3000 }
        );
        const ips = [];
        (r.data.data || []).forEach((i) => {
          if (i.name === 'lo') return;
          if (i.inet) {
            const ip = String(i.inet).split('/')[0];
            if (ip && !ip.startsWith('127.')) ips.push(ip);
          }
        });
        return Array.from(new Set(ips));
      } catch { return []; }
    }
    async function fetchOs(g) {
      try {
        const r = await pve.get(
          `/nodes/${g.node}/${g.type}/${g.vmid}/config`,
          { timeout: 3000 }
        );
        return osFamily(r.data.data?.ostype);
      } catch { return null; }
    }

    const results = await Promise.allSettled(guests.map(async (g) => {
      const key = `${g.type}/${g.vmid}/${g.node}`;
      const [ips, os] = await Promise.all([fetchIps(g), fetchOs(g)]);
      return [key, { ips, os }];
    }));

    const map = {};
    results.forEach((r) => {
      if (r.status === 'fulfilled') {
        const [key, info] = r.value;
        if ((info.ips && info.ips.length) || info.os) map[key] = info;
      }
    });
    return map;
  })
));

// ==== Shared alert ack (synced across all viewers) ==========================
app.get('/api/ack', (req, res) => {
  res.json({ ok: true, data: readState() });
});
app.post('/api/ack', (req, res) => {
  const s = { tasksAckedUntil: Math.floor(Date.now() / 1000) };
  try {
    writeState(s);
    res.json({ ok: true, data: s });
  } catch (e) {
    console.error('[api] /api/ack write failed:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ==== Prometheus metrics ====================================================
// Plain-text exposition for Prometheus scrapers. Reuses the same NodeCache as
// the dashboard UI, so scraping at 15s costs no extra PVE API calls.
function promEscape(s) {
  return String(s ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}
app.get('/metrics', async (req, res) => {
  try {
    const [nodes, resources] = await Promise.all([
      cachedGet('nodes', CACHE_TTL, async () => (await pve.get('/nodes')).data.data),
      cachedGet('resources', CACHE_TTL, async () => (await pve.get('/cluster/resources')).data.data),
    ]);
    const lines = [];
    const help = (name, desc, type = 'gauge') => {
      lines.push(`# HELP ${name} ${desc}`);
      lines.push(`# TYPE ${name} ${type}`);
    };

    help('pve_node_up', 'Node online status (1=online, 0=offline)');
    nodes.forEach((n) => lines.push(
      `pve_node_up{node="${promEscape(n.node)}"} ${n.status === 'online' ? 1 : 0}`
    ));
    help('pve_node_cpu_ratio', 'Node CPU usage ratio (0..1)');
    nodes.forEach((n) => lines.push(
      `pve_node_cpu_ratio{node="${promEscape(n.node)}"} ${n.cpu || 0}`
    ));
    help('pve_node_memory_used_bytes', 'Node used memory in bytes');
    nodes.forEach((n) => lines.push(
      `pve_node_memory_used_bytes{node="${promEscape(n.node)}"} ${n.mem || 0}`
    ));
    help('pve_node_memory_total_bytes', 'Node total memory in bytes');
    nodes.forEach((n) => lines.push(
      `pve_node_memory_total_bytes{node="${promEscape(n.node)}"} ${n.maxmem || 0}`
    ));
    help('pve_node_disk_used_bytes', 'Node root-disk used bytes');
    nodes.forEach((n) => lines.push(
      `pve_node_disk_used_bytes{node="${promEscape(n.node)}"} ${n.disk || 0}`
    ));
    help('pve_node_disk_total_bytes', 'Node root-disk total bytes');
    nodes.forEach((n) => lines.push(
      `pve_node_disk_total_bytes{node="${promEscape(n.node)}"} ${n.maxdisk || 0}`
    ));
    help('pve_node_uptime_seconds', 'Node uptime in seconds');
    nodes.forEach((n) => lines.push(
      `pve_node_uptime_seconds{node="${promEscape(n.node)}"} ${n.uptime || 0}`
    ));

    help('pve_guest_running', 'Guest running state (1=running, 0=stopped)');
    resources
      .filter((r) => r.type === 'qemu' || r.type === 'lxc')
      .forEach((v) => {
        const lbl = `type="${promEscape(v.type)}",vmid="${promEscape(v.vmid)}",name="${promEscape(v.name || '')}",node="${promEscape(v.node || '')}"`;
        lines.push(`pve_guest_running{${lbl}} ${v.status === 'running' ? 1 : 0}`);
      });

    res.type('text/plain; version=0.0.4').send(lines.join('\n') + '\n');
  } catch (e) {
    res.status(502).type('text/plain').send(`# error: ${e.message}\n`);
  }
});

// ==== Start =================================================================
app.listen(LISTEN_PORT, () => {
  console.log(`PVE Vitals running at http://localhost:${LISTEN_PORT}`);
  console.log(`Connecting to Proxmox at https://${PVE_HOST}:${PVE_PORT}`);
});
