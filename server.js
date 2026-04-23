'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const axios = require('axios');
const https = require('https');
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
const SHOW_HOST_INFO = (process.env.SHOW_HOST_INFO || 'false').toLowerCase() === 'true';

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

// ==== Static frontend =======================================================
app.use(express.static(path.join(__dirname, 'public')));

// ==== Public UI config ======================================================
app.get('/api/config', (req, res) => {
  res.json({
    ok: true,
    data: {
      thresholds,
      defaultLang: DEFAULT_LANG,
      cacheTtl: CACHE_TTL,
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

// ==== Start =================================================================
app.listen(LISTEN_PORT, () => {
  console.log(`PVE Vitals running at http://localhost:${LISTEN_PORT}`);
  console.log(`Connecting to Proxmox at https://${PVE_HOST}:${PVE_PORT}`);
});
