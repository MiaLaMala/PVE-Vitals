require('dotenv').config();
const express = require('express');
const axios = require('axios');
const https = require('https');
const NodeCache = require('node-cache');
const path = require('path');

const app = express();
const cache = new NodeCache({ stdTTL: 10, checkperiod: 15 });

// ─── Config ────────────────────────────────────────────────────────────────
const PVE_HOST   = process.env.PVE_HOST;
const PVE_PORT   = process.env.PVE_PORT   || '8006';
const PVE_TOKEN_ID  = process.env.PVE_TOKEN_ID;   // e.g. "user@pam!mytoken"
const PVE_SECRET    = process.env.PVE_SECRET;     // the UUID secret
const DASHBOARD_PORT = process.env.PORT || 3000;
const CACHE_TTL  = parseInt(process.env.CACHE_TTL || '10');

if (!PVE_HOST || !PVE_TOKEN_ID || !PVE_SECRET) {
  console.error('ERROR: PVE_HOST, PVE_TOKEN_ID, and PVE_SECRET must be set in .env');
  process.exit(1);
}

// Proxmox uses self-signed certs by default — allow that
const agent = new https.Agent({ rejectUnauthorized: false });

const pve = axios.create({
  baseURL: `https://${PVE_HOST}:${PVE_PORT}/api2/json`,
  httpsAgent: agent,
  headers: {
    Authorization: `PVEAPIToken=${PVE_TOKEN_ID}=${PVE_SECRET}`,
  },
  timeout: 10000,
});

// ─── Helpers ───────────────────────────────────────────────────────────────
async function cachedGet(key, ttl, fetcher) {
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const data = await fetcher();
  cache.set(key, data, ttl);
  return data;
}

function bytes(b) { return b; } // keep raw, format on frontend

// ─── API Routes ────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// GET /api/nodes  — list all nodes with basic status
app.get('/api/nodes', async (req, res) => {
  try {
    const data = await cachedGet('nodes', CACHE_TTL, async () => {
      const r = await pve.get('/nodes');
      return r.data.data;
    });
    res.json({ ok: true, data });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
});

// GET /api/nodes/:node  — detailed stats for one node
app.get('/api/nodes/:node', async (req, res) => {
  const { node } = req.params;
  try {
    const data = await cachedGet(`node:${node}`, CACHE_TTL, async () => {
      const [status, rrd] = await Promise.all([
        pve.get(`/nodes/${node}/status`),
        pve.get(`/nodes/${node}/rrddata?timeframe=hour&cf=AVERAGE`),
      ]);
      return { status: status.data.data, rrd: rrd.data.data.slice(-12) };
    });
    res.json({ ok: true, data });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
});

// GET /api/nodes/:node/vms  — all VMs + LXC on a node
app.get('/api/nodes/:node/vms', async (req, res) => {
  const { node } = req.params;
  try {
    const data = await cachedGet(`vms:${node}`, CACHE_TTL, async () => {
      const [qemu, lxc] = await Promise.all([
        pve.get(`/nodes/${node}/qemu`).catch(() => ({ data: { data: [] } })),
        pve.get(`/nodes/${node}/lxc`).catch(() => ({ data: { data: [] } })),
      ]);
      const vms = qemu.data.data.map(v => ({ ...v, type: 'qemu' }));
      const cts = lxc.data.data.map(v => ({ ...v, type: 'lxc' }));
      return [...vms, ...cts].sort((a, b) => a.vmid - b.vmid);
    });
    res.json({ ok: true, data });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
});

// GET /api/nodes/:node/storage  — storage pools
app.get('/api/nodes/:node/storage', async (req, res) => {
  const { node } = req.params;
  try {
    const data = await cachedGet(`storage:${node}`, CACHE_TTL, async () => {
      const r = await pve.get(`/nodes/${node}/storage`);
      return r.data.data.filter(s => s.active);
    });
    res.json({ ok: true, data });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
});

// GET /api/nodes/:node/network  — network interfaces
app.get('/api/nodes/:node/network', async (req, res) => {
  const { node } = req.params;
  try {
    const data = await cachedGet(`net:${node}`, 30, async () => {
      const r = await pve.get(`/nodes/${node}/network`);
      return r.data.data;
    });
    res.json({ ok: true, data });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
});

// GET /api/nodes/:node/tasks  — recent tasks
app.get('/api/nodes/:node/tasks', async (req, res) => {
  const { node } = req.params;
  try {
    const data = await cachedGet(`tasks:${node}`, 20, async () => {
      const r = await pve.get(`/nodes/${node}/tasks?limit=20`);
      return r.data.data;
    });
    res.json({ ok: true, data });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
});

// GET /api/cluster  — cluster status (if cluster is configured)
app.get('/api/cluster', async (req, res) => {
  try {
    const data = await cachedGet('cluster', CACHE_TTL, async () => {
      const r = await pve.get('/cluster/status');
      return r.data.data;
    });
    res.json({ ok: true, data });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
});

// GET /api/cluster/resources  — all resources across cluster
app.get('/api/cluster/resources', async (req, res) => {
  try {
    const data = await cachedGet('resources', CACHE_TTL, async () => {
      const r = await pve.get('/cluster/resources');
      return r.data.data;
    });
    res.json({ ok: true, data });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
});

// POST /api/nodes/:node/qemu/:vmid/:action  — start/stop/reboot a VM
app.post('/api/nodes/:node/qemu/:vmid/:action', async (req, res) => {
  const { node, vmid, action } = req.params;
  if (!['start', 'stop', 'reboot', 'shutdown'].includes(action)) {
    return res.status(400).json({ ok: false, error: 'Invalid action' });
  }
  try {
    const r = await pve.post(`/nodes/${node}/qemu/${vmid}/status/${action}`);
    cache.del(`vms:${node}`);
    cache.del('resources');
    res.json({ ok: true, task: r.data.data });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
});

// POST /api/nodes/:node/lxc/:vmid/:action  — start/stop/reboot a container
app.post('/api/nodes/:node/lxc/:vmid/:action', async (req, res) => {
  const { node, vmid, action } = req.params;
  if (!['start', 'stop', 'reboot', 'shutdown'].includes(action)) {
    return res.status(400).json({ ok: false, error: 'Invalid action' });
  }
  try {
    const r = await pve.post(`/nodes/${node}/lxc/${vmid}/status/${action}`);
    cache.del(`vms:${node}`);
    cache.del('resources');
    res.json({ ok: true, task: r.data.data });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
});

// ─── Start ─────────────────────────────────────────────────────────────────
app.listen(DASHBOARD_PORT, () => {
  console.log(`Proxmox Dashboard running at http://localhost:${DASHBOARD_PORT}`);
  console.log(`Connecting to Proxmox at https://${PVE_HOST}:${PVE_PORT}`);
});
