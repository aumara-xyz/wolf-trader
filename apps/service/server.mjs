import http from 'node:http';
import { readFileSync, existsSync, statSync, createReadStream } from 'node:fs';
import { resolve, join, extname, sep } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createLedger } from './ledger.mjs';
import { fail } from '../../packages/wolf-core/fixed.mjs';
const defaultDist = fileURLToPath(new URL('../desk/dist/', import.meta.url));
const defaultData = join(homedir(), 'Library', 'Application Support', 'AUKORA Wolf');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
function equalSecret(value, expected) { return typeof value === 'string' && Buffer.byteLength(value) === Buffer.byteLength(expected) && timingSafeEqual(Buffer.from(value), Buffer.from(expected)); }
async function readBody(req) {
  let bytes = 0; const chunks = [];
  for await (const part of req) { bytes += part.length; if (bytes > 65536) fail('REQUEST_TOO_LARGE', 'Request exceeds the limit.', 413); chunks.push(part); }
  let value;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { fail('INVALID_JSON', 'A JSON object is required.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_JSON', 'A JSON object is required.');
  return value;
}
export async function createWolfServer({ dataDir = process.env.WOLF_DATA_DIR || defaultData, distDir = defaultDist, markets, research, now = Date.now } = {}) {
  markets ??= (await import('./markets.mjs')).createMarketService();
  const ledger = createLedger({ dataDir, markets, now });
  research ??= (await import('./research.mjs')).createResearchService({ markets, readPortfolio: async () => ({ ...await ledger.markedPortfolio(), activity: ledger.activity() }) });
  const capability = randomBytes(32).toString('hex'), cookie = randomBytes(24).toString('hex');
  let buildId = process.env.WOLF_BUILD_ID || 'development';
  const releasePath = join(distDir, 'release.json');
  if (!process.env.WOLF_BUILD_ID && existsSync(releasePath)) { try { buildId = JSON.parse(readFileSync(releasePath, 'utf8')).buildId || buildId; } catch { buildId = 'release-metadata-invalid'; } }
  const send = (res, status, value) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(JSON.stringify(value)); };
  const listeners = new Set();
  const notify = () => { for (const fn of listeners) fn(); };
  const server = http.createServer({ requestTimeout: 90000, headersTimeout: 10000 }, async (req, res) => {
    try {
      const port = server.address()?.port;
      if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(req.headers.host)) fail('HOST_REFUSED', 'This service accepts localhost requests only.', 403);
      const origin = `http://${req.headers.host}`, url = new URL(req.url, origin);
      if ((req.headers.origin && req.headers.origin !== origin) || req.headers['sec-fetch-site'] === 'cross-site') fail('ORIGIN_REFUSED', 'A same-origin request is required.', 403);
      const route = url.pathname.slice('/api/wolf/v1/'.length);
      if (url.pathname.startsWith('/api/wolf/v1/')) {
        if (req.method === 'GET' && route === 'session') {
          res.setHeader('set-cookie', `wolf_session=${cookie}; HttpOnly; SameSite=Strict; Path=/`);
          return send(res, 200, { capability, capitalMode: 'DEMO' });
        }
        let input = null;
        if (req.method === 'POST') {
          if (req.headers.origin !== origin || !equalSecret(req.headers['x-wolf-capability'], capability)
            || !String(req.headers.cookie ?? '').split(';').some(part => part.trim() === `wolf_session=${cookie}`)) fail('SESSION_REQUIRED', 'Refresh the app to renew its local session.', 403);
          if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) fail('JSON_REQUIRED', 'Use a JSON request.');
          input = await readBody(req);
        }
        if (req.method === 'GET' && route === 'capabilities') {
          const marketStatus = await markets.capabilities(), researchStatus = await research.status();
          return send(res, 200, { ...marketStatus, schema: 'wolf-capabilities/v1', capitalMode: 'DEMO', liveOrderSubmission: false, buildId,
            research: researchStatus, researchStatus, marketData: marketStatus.marketData ?? 'unavailable', instanceId: capability.slice(0, 12) });
        }
        if (req.method === 'GET' && route === 'markets') return send(res, 200, await markets.searchMarkets({ query: url.searchParams.get('q') || '', limit: Number(url.searchParams.get('limit') || 12), cursor: url.searchParams.get('cursor') }));
        if (req.method === 'GET' && route === 'market') return send(res, 200, await markets.market(url.searchParams.get('id')));
        if (req.method === 'GET' && route === 'book') return send(res, 200, await markets.book(url.searchParams.get('assetId')));
        if (req.method === 'GET' && route === 'portfolio') return send(res, 200, await ledger.markedPortfolio());
        if (req.method === 'GET' && route === 'activity') return send(res, 200, ledger.activity({ limit: url.searchParams.get('limit'), epoch: url.searchParams.get('epoch') || undefined }));
        if (req.method === 'GET' && route === 'operation') { const result = ledger.operation(url.searchParams.get('id')); return send(res, result ? 200 : 404, result ?? { ok: false, error: { code: 'OPERATION_NOT_FOUND', message: 'No operation was recorded with that ID.' } }); }
        if (req.method === 'POST' && route === 'preview') return send(res, 200, await ledger.preview(input));
        if (req.method === 'POST' && route === 'commitDemo') { const result = await ledger.commitDemo(input); notify(); return send(res, 200, result); }
        if (req.method === 'POST' && route === 'resetDemo') { const result = ledger.resetDemo(input); notify(); return send(res, 200, result); }
        if (req.method === 'GET' && route === 'research') return send(res, 200, { ...await research.status(), history: ledger.researchHistory(url.searchParams.get('sessionId') ?? 'default').items });
        if (req.method === 'POST' && route === 'research') {
          const controller = new AbortController();
          res.on('close', () => { if (!res.writableEnded) controller.abort(); });
          const result = await research.research({ ...input, signal: controller.signal });
          if (controller.signal.aborted) return;
          return send(res, 200, ledger.recordResearch(input, result));
        }
        if (req.method === 'POST' && route === 'cancelResearch') return send(res, 200, await research.cancel(input.jobId ?? input.sessionId));
        if (req.method === 'GET' && route === 'events') {
          res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
          let after = Number(url.searchParams.get('after') ?? req.headers['last-event-id'] ?? 0);
          if (!Number.isSafeInteger(after) || after < 0) after = 0;
          const flush = () => { for (const event of ledger.events(after)) { res.write(`id: ${event.sequence}\ndata: ${JSON.stringify(event)}\n\n`); after = event.sequence; } };
          listeners.add(flush); flush();
          const ping = setInterval(() => res.write(': heartbeat\n\n'), 15000); ping.unref();
          req.on('close', () => { clearInterval(ping); listeners.delete(flush); });
          return;
        }
        return send(res, 404, { ok: false, error: { code: 'ROUTE_NOT_FOUND', message: 'This demo operation is unavailable.' } });
      }
      if (!['GET', 'HEAD'].includes(req.method)) return send(res, 405, { error: { code: 'METHOD_REFUSED', message: 'Method unavailable.' } });
      let decoded;
      try { decoded = decodeURIComponent(url.pathname); } catch { fail('PATH_INVALID', 'Invalid path.'); }
      if (decoded.includes('\0') || decoded.split('/').some(part => part.startsWith('.'))) fail('PATH_INVALID', 'Invalid path.', 404);
      let file = resolve(distDir, '.' + (decoded === '/' ? '/index.html' : decoded));
      if (!file.startsWith(resolve(distDir) + sep)) fail('PATH_INVALID', 'Invalid path.', 404);
      if (!existsSync(file) && !extname(decoded)) file = join(distDir, 'index.html');
      if (!existsSync(file) || !statSync(file).isFile()) return send(res, 404, { error: { code: 'ASSET_NOT_FOUND', message: 'The application build is unavailable.' } });
      res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'cache-control': extname(file) === '.html' ? 'no-store' : 'public, max-age=60',
        'x-content-type-options': 'nosniff', 'referrer-policy': 'same-origin',
        'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'" });
      if (req.method === 'HEAD') return res.end();
      const stream = createReadStream(file);
      stream.on('error', () => res.destroy()); stream.pipe(res);
    } catch (error) {
      if (res.headersSent) return res.destroy();
      const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 600 ? error.status : 500;
      send(res, status, { ok: false, error: { code: error.code ?? 'SERVICE_ERROR', message: status === 500 ? 'The local service could not complete this request.' : error.message, details: error.details ?? {} } });
    }
  });
  return { server, ledger, markets, research, buildId,
    listen: (port = Number(process.env.WOLF_PORT || 4318)) => new Promise((resolveListening, reject) => {
      server.once('error', reject); server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolveListening(server.address()); });
    }),
    close: () => new Promise(resolveClosed => { server.closeAllConnections(); server.close(() => { ledger.close(); resolveClosed(); }); }),
  };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = await createWolfServer();
  const address = await app.listen();
  console.log(`AUKORA Wolf ${app.buildId}: http://127.0.0.1:${address.port} · DEMO money only`);
  let stopping = false;
  const stop = async () => { if (stopping) return; stopping = true; await app.close(); process.exit(0); };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
}
