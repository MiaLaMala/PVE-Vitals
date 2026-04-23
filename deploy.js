'use strict';
const { exec } = require('child_process');
const http = require('http');

const SECRET = process.env.DEPLOY_SECRET;
const PORT = process.env.DEPLOY_PORT || 4000;
const REPO_PATH = process.env.REPO_PATH || '/opt/pve-vitals';
const PM2_APP = process.env.PM2_APP || 'pve-vitals';

if (!SECRET) {
  console.error('DEPLOY_SECRET env var is required');
  process.exit(1);
}

const DEPLOY_CMD = `git -C "${REPO_PATH}" pull && npm install --omit=dev --prefix "${REPO_PATH}" && pm2 restart ${PM2_APP}`;

http.createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== '/deploy') {
    res.writeHead(404).end();
    return;
  }

  const token = req.headers['x-gitlab-token'];
  if (!token || token !== SECRET) {
    console.warn('Unauthorized deploy attempt from', req.socket.remoteAddress);
    res.writeHead(401).end('Unauthorized');
    return;
  }

  res.writeHead(200).end('Deploy started');

  console.log(`[${new Date().toISOString()}] Deploy triggered`);
  exec(DEPLOY_CMD, (err, stdout, stderr) => {
    if (err) {
      console.error(`[${new Date().toISOString()}] Deploy failed:\n`, stderr);
    } else {
      console.log(`[${new Date().toISOString()}] Deploy succeeded:\n`, stdout);
    }
  });
}).listen(PORT, () => {
  console.log(`Webhook listener running on port ${PORT}`);
});
