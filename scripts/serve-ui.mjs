#!/usr/bin/env node
// Paper desk. Listens on 127.0.0.1:4173. Serves the new UI and two read APIs.
// Market reads happen in the browser against public Polymarket endpoints.
// This process does not submit orders and does not hold a wallet.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveMode, createGovernor } from '../packages/harness/index.js';
import { researchStatus, writeResearchNote } from '../packages/adapters/research-note.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || 4173);
const pages = {
  '/': 'apps/paper/index.html',
  '/about': 'apps/paper/about.html',
  '/research': 'apps/paper/research.html',
};
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
}

function ceilings() {
  const mode = resolveMode(process.env);
  const gov = createGovernor();
  return {
    requested: mode.requested,
    mode: mode.mode,
    refused: mode.refused,
    polymarketSpend: false,
    killed: gov.killed,
    killReason: gov.killReason,
    maxDailyLossPct: gov.maxDailyLossPct,
    startEquity: gov.startEquity,
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 8000) {
        reject(new Error('too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  const pathname = url.pathname;

  if (pathname === '/api/ceilings' && req.method === 'GET') {
    send(res, 200, JSON.stringify(ceilings()));
    return;
  }
  if (pathname === '/api/research/status' && req.method === 'GET') {
    const status = researchStatus(process.env);
    send(res, 200, JSON.stringify({ enabled: status.enabled, reason: status.reason || null }));
    return;
  }
  if (pathname === '/api/research' && req.method === 'POST') {
    let payload = {};
    try {
      payload = JSON.parse(await readBody(req) || '{}');
    } catch {
      send(res, 400, JSON.stringify({ ok: false, reason: 'note failed' }));
      return;
    }
    const note = await writeResearchNote({
      question: payload.question,
      outcome: payload.outcome,
      price: payload.price,
      symbol: 'pm:research',
    }, process.env);
    send(res, note.ok ? 200 : 200, JSON.stringify(note));
    return;
  }

  const page = pages[pathname];
  let rel = page || decodeURIComponent(pathname);
  if (rel.includes('\0') || rel.split('/').some((part) => part.startsWith('.'))) {
    send(res, 404, 'not found', 'text/plain; charset=utf-8');
    return;
  }
  const file = path.normalize(path.join(root, rel));
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    send(res, 404, 'not found', 'text/plain; charset=utf-8');
    return;
  }
  res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`paper UI: http://127.0.0.1:${port}/`);
  console.log('PAPER default. Public Polymarket prices. No wallet. No order submission.');
});
