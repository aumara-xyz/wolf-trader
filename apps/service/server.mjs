import http from 'node:http';
import { readFileSync, existsSync, statSync, createReadStream } from 'node:fs';
import { resolve, join, extname, sep } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createLedger } from './ledger.mjs';
import { fail } from '../../packages/wolf-core/fixed.mjs';
import { createAukoraIntelligence } from '../../packages/aukora/index.mjs';
import { createProviderRegistry } from '../../packages/providers/index.mjs';
import { createIntelligenceService } from '../../packages/intelligence/service.mjs';
import { createForecastMappings } from '../../packages/intelligence/forecast-mappings.mjs';
import { createAutonomyService } from '../../packages/autonomy/index.mjs';
import { runControlChallenges } from '../../packages/weekly/challenges.mjs';
import { createWeeklyDesk } from '../../packages/weekly/index.mjs';
import { createAuthorityService, createResearchPolicyService, actionDigest } from '../../packages/authority/index.mjs';
import { resolveMandate } from '../../packages/autonomy/strategy.mjs';
import { composeWolf } from '../../packages/runtime/composition.mjs';
const defaultDist = fileURLToPath(new URL('../desk/dist/', import.meta.url));
const defaultData = process.platform === 'darwin' ? join(homedir(), 'Library', 'Application Support', 'Wolf Trader') : join(homedir(), '.local/share/wolf-trader');
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
export async function createWolfServer({ dataDir = process.env.WOLF_DATA_DIR || defaultData, distDir = defaultDist, markets, research, providers, fetchImpl, now = Date.now } = {}) {
  markets ??= (await import('./markets.mjs')).createMarketService();
  const ledger = createLedger({ dataDir, markets, now });
  research ??= (await import('./research.mjs')).createResearchService({ markets, readPortfolio: async () => ({ ...await ledger.markedPortfolio(), activity: ledger.activity() }) });
  const aukora = createAukoraIntelligence({ dataDir: join(dataDir, 'aukora'), now });
  providers ??= createProviderRegistry({ dataDir: join(dataDir, 'provider-results'), config: { allowPaidProviders: process.env.WOLF_ALLOW_PAID_PROVIDERS === '1' } });
  const mappings = createForecastMappings({ dataDir: join(dataDir, 'research'), markets, aukora, now });
  const pipelineProviders = { ...providers, forecast: input => providers.forecast({ ...input, horizon: mappings.horizon(input) }) };
  const intelligence = createIntelligenceService({ dataDir: join(dataDir, 'research'), markets, ledger, aukora, providers: pipelineProviders, fetchImpl, now });
  const authority=createAuthorityService({dataDir:join(dataDir,'authority'),aukora,now});
  const policy=createResearchPolicyService({dataDir:join(dataDir,'research-policy'),aukora,authority,now});
  const weekly=createWeeklyDesk({dataDir:join(dataDir,'weekly'),markets,intelligence,aukora,providers,ledger,researchPolicy:policy,fetchImpl,now});
  const authorityGate=({config,quote,operationId,final,action})=>{
    const binding=config.authority;
    if(!binding)fail('OWNER_GRANT_REQUIRED','Sign the exact paper limits before arming.',403);
    const request={grantId:binding.grantId,scope:'paper',resource:binding.resource,action:action==='arm'?'arm':'trade',operationId:operationId??'preflight',payload:JSON.parse(JSON.stringify(quote??{resource:binding.resource}))};
    if(final)authority.authorize(request);else authority.check(request);
  };
  const autonomy = createAutonomyService({ dataDir: join(dataDir, 'autonomy'), ledger, markets, intelligence: aukora, readSignals: () => [...mappings.signals(intelligence.latest()),...weekly.readSignals()], approvedMappings: mappings.get, authorityGate, now });
  const composition = await composeWolf({ markets, ledger, aukora, providers, intelligence, autonomy });
  // Slow research refreshes its own signed snapshot. The fast order path only
  // consumes completed snapshots; it never waits for an LLM committee.
  let closing = false, closePromise;
  const activeRequests = new Set();
  const refreshArmedResearch = async () => {
    if (closing || autonomy.status().phase !== 'armed' || autonomy.status().mandate?.config.strategy==='weekly-hypothesis/v1') return;
    const current = await intelligence.status();
    if (closing || ['running', 'cancelling'].includes(current.job?.phase)) return;
    const reservation = autonomy.reserveResearchScan();
    if (!reservation.allowed) return;
    const config = autonomy.status().mandate?.config;
    const mapping = config?.forecastMappingId ? mappings.get(config.forecastMappingId) : null;
    try { intelligence.launch({ marketId: config?.marketIds?.[0], symbol: mapping?.symbol ?? 'BTC-USD', useDexter: true }); }
    catch (error) { if (error.code !== 'SCAN_BUSY') autonomy.pause('Research could not start.'); }
  };
  const refreshResearch = () => refreshArmedResearch().catch(() => { if (!closing) autonomy.pause('Research could not start.'); });
  const researchTimer = setInterval(refreshResearch, 240000); researchTimer.unref();
  const scheduledTimer=setInterval(()=>{
    if(closing)return;
    try{weekly.runScheduled(({grantId,resource,config})=>authority.authorize({grantId,scope:'research',resource,action:'scan',operationId:'weekly:'+weekly.scheduleStatus().nextRunAt,payload:config}));}
    catch{weekly.configureSchedule({enabled:false});}
  },60000);scheduledTimer.unref();
  const capability = randomBytes(32).toString('hex'), cookie = randomBytes(24).toString('hex');
  let buildId = process.env.WOLF_BUILD_ID || 'development';
  const releasePath = join(distDir, 'release.json');
  if (!process.env.WOLF_BUILD_ID && existsSync(releasePath)) { try { buildId = JSON.parse(readFileSync(releasePath, 'utf8')).buildId || buildId; } catch { buildId = 'release-metadata-invalid'; } }
  const send = (res, status, value) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(JSON.stringify(value)); };
  const listeners = new Set();
  const notify = () => { for (const fn of listeners) fn(); };
  const server = http.createServer({ requestTimeout: 90000, headersTimeout: 10000 }, async (req, res) => {
    let finishRequest;
    const requestDone = new Promise(resolveDone => { finishRequest = resolveDone; });
    activeRequests.add(requestDone);
    try {
      if (closing) fail('SERVICE_CLOSING', 'Wolf Trader is stopping.', 503);
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
            research: researchStatus, researchStatus, foundation: 'wolf-intelligence/v1', composition: composition.status(), native: aukora.status(), autonomy: autonomy.status().phase, marketData: marketStatus.marketData ?? 'unavailable', instanceId: capability.slice(0, 12) });
        }
        if(req.method==='GET'&&route==='weekly')return send(res,200,await weekly.status());
        if(req.method==='POST'&&route==='weekly/schedule/prepare'){
          const request={enabled:true,intervalDays:7,query:input.query??'',limit:input.limit??3};
          if(typeof request.query!=='string'||request.query.length>200||![1,2,3,4,5,6].includes(request.limit))fail('WEEKLY_SCHEDULE','Choose one to six markets and a short topic.');
          return send(res,200,{request,terms:{scope:'research',resource:actionDigest(request),actions:['scan'],expiresAt:new Date(now()+28*86400000).toISOString(),maxUses:4}});
        }
        if(req.method==='POST'&&route==='weekly/schedule'){
          if(input.request?.enabled===false)return send(res,200,weekly.configureSchedule({enabled:false}));
          const resource=actionDigest(input.request);
          authority.check({grantId:input.grantId,scope:'research',resource,action:'scan',operationId:'schedule-configuration',payload:input.request});
          return send(res,200,weekly.configureSchedule(input.request,{grantId:input.grantId,resource}));
        }
        if(req.method==='GET'&&route==='weekly/books')return send(res,200,weekly.books());
        if(req.method==='GET'&&route==='weekly/score')return send(res,200,await weekly.score());
        if(req.method==='GET'&&route==='weekly/commitment')return send(res,200,weekly.commitment());
        if(req.method==='GET'&&route==='weekly/export')return send(res,200,weekly.exportBundle());
        if(req.method==='POST'&&route==='weekly/run')return send(res,202,weekly.launch(input));
        if(req.method==='POST'&&route==='weekly/cancel')return send(res,200,weekly.cancel());
        if(req.method==='POST'&&route==='weekly/score')return send(res,200,await weekly.score(input));
        if(req.method==='POST'&&route==='weekly/invalidate')return send(res,200,weekly.invalidate(input));
        if(req.method==='POST'&&route==='weekly/resolve')return send(res,200,await weekly.resolve(input));
        if(req.method==='POST'&&route==='weekly/challenge')return send(res,200,{evidence:await weekly.challenge(input),controls:await runControlChallenges()});
        if(req.method==='GET'&&route==='weekly/policy')return send(res,200,policy.status());
        if(req.method==='POST'&&route==='weekly/policy/propose')return send(res,200,policy.propose(input));
        if(req.method==='POST'&&route==='weekly/policy/evaluate')return send(res,200,policy.evaluate(input.id));
        if(req.method==='POST'&&route==='weekly/policy/prepare')return send(res,200,policy.promotionRequest(input.id));
        if(req.method==='POST'&&route==='weekly/policy/promote')return send(res,200,policy.promote(input.request,{grantId:input.grantId}));
        if(req.method==='GET'&&route==='authority')return send(res,200,authority.status());
        if(req.method==='POST'&&route==='authority/challenge')return send(res,200,authority.challenge(input));
        if(req.method==='POST'&&route==='authority/complete')return send(res,200,authority.complete(input));
        if(req.method==='POST'&&route==='authority/prepare'){
          const request=input.request;if(!request||typeof request!=='object'||request.authority||request.grantId)fail('PAPER_REQUEST_INVALID','Review an exact paper request without authority fields.');
          const config=resolveMandate(request,now());
          return send(res,200,{request,limits:config,terms:{scope:'paper',resource:actionDigest(request),actions:['arm','trade'],expiresAt:config.expiresAt,maxUses:config.maxOrders+1}});
        }
        if (req.method === 'GET' && route === 'intelligence') return send(res, 200, { ...await intelligence.status(), mappings: mappings.list(), composition: composition.status() });
        if (req.method === 'POST' && route === 'intelligence/scan') return send(res, 202, intelligence.launch(input));
        if (req.method === 'POST' && route === 'intelligence/cancel') return send(res, 200, intelligence.cancel());
        if (req.method === 'POST' && route === 'intelligence/observation') return send(res, 200, intelligence.importObservation(input));
        if(req.method==='GET'&&route==='intelligence/evidence/manifest')return send(res,200,aukora.exportManifest());
        if(req.method==='GET'&&/^intelligence\/evidence\/segments\/\d+$/.test(route))return send(res,200,aukora.exportSegment(Number(route.split('/').at(-1))));
        if (req.method === 'GET' && route === 'intelligence/evidence') return send(res, 200, aukora.exportEvidence());
        if (req.method === 'POST' && route === 'intelligence/verify') return send(res, 200, aukora.verifyEvidence(input.bundle ?? aukora.exportEvidence(), { expectedPubkey: aukora.status().identity.pubkey }));
        if (req.method === 'POST' && route === 'intelligence/recall') return send(res, 200, aukora.recall(input.query, { limit: input.limit ?? 8 }));
        if (req.method === 'POST' && route === 'intelligence/correct') return send(res, 200, aukora.correct(input.id, input.replacement));
        if (req.method === 'POST' && route === 'intelligence/nostr/import') return send(res, 200, aukora.importNostrEvent(input.event));
        if (req.method === 'POST' && route === 'intelligence/nostr/export') return send(res, 200, aukora.exportNostrEvent(input.recordId));
        if (req.method === 'POST' && route === 'intelligence/candidate') return send(res, 200, aukora.createCandidate(input));
        if (req.method === 'POST' && route === 'intelligence/evaluate') return send(res, 200, aukora.evaluateCandidate(input.id, input.evaluation));
        if (req.method === 'POST' && route === 'intelligence/promote') {
          if (autonomy.status().phase === 'armed') fail('PAUSE_BEFORE_PROMOTION', 'Pause the session before changing its research candidate.', 409);
          const {grantId,...request}=input;authority.authorize({grantId,scope:'research-policy',resource:actionDigest(request),action:'promote',operationId:'legacy-promote:'+grantId,payload:request});
          return send(res, 200, aukora.promoteCandidate(input.id, request));
        }
        if (req.method === 'POST' && route === 'intelligence/mapping') {
          if (autonomy.status().phase === 'armed') fail('PAUSE_BEFORE_MAPPING', 'Pause the paper session before changing a contract mapping.', 409);
          return send(res, 200, await mappings.create(input));
        }
        if (req.method === 'POST' && route === 'intelligence/mapping/revoke') return send(res, 200, mappings.revoke(input.id));
        if (req.method === 'POST' && route === 'intelligence/replay') return send(res, 200, await intelligence.replay(input));
        if (req.method === 'GET' && route === 'autonomy') return send(res, 200, autonomy.status());
        if (req.method === 'GET' && route === 'autonomy/events') return send(res, 200, { items: autonomy.events({ after: url.searchParams.get('after') }) });
        if(req.method==='POST'&&route==='autonomy/arm'){
          const {grantId,...request}=input;
          if(typeof grantId!=='string'||!grantId)fail('OWNER_GRANT_REQUIRED','Sign the exact paper limits before arming.',403);
          if(request.authority)fail('AUTHORITY_FIELD_REFUSED','Authority is resolved by the service.',403);
          if(autonomy.status().mandate?.config.authority?.grantId===grantId)fail('GRANT_ALREADY_ARMED','This grant already armed a session. Sign fresh limits to rearm.',409);
          const resource=actionDigest(request);
          const permission={grantId,scope:'paper',resource,action:'arm',operationId:'arm:'+grantId,payload:request};
          if(authority.check(permission).consumed)fail('GRANT_ALREADY_ARMED','This grant already armed a session. Sign fresh limits to rearm.',409);
          authority.authorize(permission);
          const result=await autonomy.arm({...request,authority:{grantId,resource}});refreshResearch();return send(res,200,result);
        }
        if (req.method === 'POST' && route === 'autonomy/pause') return send(res, 200, autonomy.pause());
        if (req.method === 'POST' && route === 'autonomy/stop') { intelligence.cancel(); return send(res, 200, autonomy.stop()); }
        if (req.method === 'POST' && route === 'autonomy/tick') return send(res, 200, await autonomy.tick());
        if (req.method === 'POST' && route === 'autonomy/evaluate') return send(res, 200, await autonomy.evaluate(input));
        if (req.method === 'GET' && route === 'markets') return send(res, 200, await markets.searchMarkets({ query: url.searchParams.get('q') || '', limit: Number(url.searchParams.get('limit') || 12), cursor: url.searchParams.get('cursor') }));
        if (req.method === 'GET' && route === 'market') return send(res, 200, await markets.market(url.searchParams.get('id')));
        if (req.method === 'GET' && route === 'book') return send(res, 200, await markets.book(url.searchParams.get('assetId')));
        if (req.method === 'GET' && route === 'portfolio') return send(res, 200, await ledger.markedPortfolio());
        if (req.method === 'GET' && route === 'activity') return send(res, 200, ledger.activity({ limit: url.searchParams.get('limit'), epoch: url.searchParams.get('epoch') || undefined }));
        if (req.method === 'GET' && route === 'operation') { const result = ledger.operation(url.searchParams.get('id')); return send(res, result ? 200 : 404, result ?? { ok: false, error: { code: 'OPERATION_NOT_FOUND', message: 'No operation was recorded with that ID.' } }); }
        if (req.method === 'POST' && route === 'preview') return send(res, 200, await ledger.preview(input));
        if (req.method === 'POST' && route === 'commitDemo') {
          if (autonomy.status().phase === 'armed') fail('PAUSE_FOR_MANUAL_ORDER', 'Pause Autopilot before placing a manual paper order.', 409);
          const result = await ledger.commitDemo(input, { beforeEffect: () => {
            if (closing || autonomy.status().phase === 'armed') fail('PAUSE_FOR_MANUAL_ORDER', 'Pause Autopilot before placing a manual paper order.', 409);
          } }); aukora.record('execution.manual-paper', result.operation); notify(); return send(res, 200, result);
        }
        if (req.method === 'POST' && route === 'resetDemo') {
          if (autonomy.status().phase === 'armed') fail('PAUSE_FOR_RESET', 'Pause Autopilot before starting a new paper account.', 409);
          const result = ledger.resetDemo(input); aukora.record('execution.account-reset', result.operation); notify(); return send(res, 200, result);
        }
        if (req.method === 'GET' && route === 'research') return send(res, 200, { ...await research.status(), history: ledger.researchHistory(url.searchParams.get('sessionId') ?? 'default').items });
        if (req.method === 'POST' && route === 'research') {
          const controller = new AbortController();
          res.on('close', () => { if (!res.writableEnded) controller.abort(); });
          const result = await research.research({ ...input, signal: controller.signal });
          if (controller.signal.aborted) return;
          const evidenceId = intelligence.recordConversation(input, result);
          return send(res, 200, ledger.recordResearch(input, { ...result, evidenceId }));
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
    } finally { activeRequests.delete(requestDone); finishRequest(); }
  });
  return { server, ledger, markets, research, intelligence, autonomy, aukora, providers, weekly, authority, policy, buildId,
    listen: (port = Number(process.env.WOLF_PORT || 4328)) => new Promise((resolveListening, reject) => {
      server.once('error', reject); server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolveListening(server.address()); });
    }),
    close: () => closePromise ??= (async () => {
      closing = true; clearInterval(researchTimer);clearInterval(scheduledTimer);
      autonomy.pause('Wolf Trader is stopping.'); weekly.cancel(); intelligence.cancel();
      await new Promise(resolveClosed => { server.close(resolveClosed); server.closeAllConnections(); });
      await Promise.allSettled([...activeRequests]);
      await weekly.close(); policy.close?.(); authority.close(); await composition.close(); await autonomy.close(); await intelligence.close(); await providers.close();
      mappings.close(); aukora.close(); ledger.close();
    })(),
  };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = await createWolfServer();
  const address = await app.listen();
  console.log(`Wolf Trader ${app.buildId}: http://127.0.0.1:${address.port} · DEMO money only`);
  let stopping = false;
  const stop = async () => { if (stopping) return; stopping = true; await app.close(); process.exit(0); };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
}
