import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { PINS } from '../providers/index.mjs';
import { loadNostrCore } from '../aukora-vendor/x1/src/aukora-nostr.mjs';
import { loadAuraRelayCell } from '../aukora-vendor/x1/src/aukora-aura-relay.mjs';
const digest = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const fail = message => { throw Object.assign(new Error(message), { code: 'FORECAST_MAPPING', status: 400 }); };
const MODEL = PINS.kronos.model.revision;

/** Owner-reviewed threshold mappings; signed history owns authority, SQLite is an index. */
export function createForecastMappings({ dataDir, markets, aukora, now = Date.now }) {
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(join(dataDir, 'forecast-mappings.sqlite'));
  db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS mappings(id TEXT PRIMARY KEY,json TEXT NOT NULL); CREATE TABLE IF NOT EXISTS signals(id TEXT PRIMARY KEY,json TEXT NOT NULL);');
  const nostr = loadNostrCore(), aura = loadAuraRelayCell(), identity = aukora.status().identity.pubkey;
  const verified = new Map(); let retainedHead = null, closed = false;

  function trustedRecords() {
    if(aukora.readRecords&&aukora.getRecord){
      const head=aukora.status().head, records=new Map();let after=0,previous=null,batch;
      if(retainedHead&&head.size<retainedHead.size)fail('The mapping evidence history was rolled back.');
      if(retainedHead?.last)aukora.getRecord(retainedHead.last);
      do{
        batch=aukora.readRecords({after,limit:1024});
        for(const body of batch){
          if(body.sequence!==after+1||body.previous!==previous||body.signer!==identity||body.parents.some(id=>!records.has(id)))fail('Mapping evidence lineage changed.');
          records.set(body.id,{...body,evidenceId:body.id});after=body.sequence;previous=body.id;
        }
      }while(batch.length);
      if(after!==head.size||previous!==head.last)fail('The mapping history is incomplete.');
      retainedHead={size:after,last:previous};return records;
    }
    const bundle = aukora.exportEvidence();
    if (bundle.pubkey !== identity || !Array.isArray(bundle.events) || bundle.events.length > 4096) fail('The mapping evidence identity or history changed.');
    const records = new Map(), ids = []; let previous = null;
    for (let index = 0; index < bundle.events.length; index++) {
      const event = bundle.events[index], bytes = JSON.stringify(event);
      if (verified.get(event.id) !== bytes) {
        if (event.pubkey !== identity || event.kind !== 9451 || !nostr.verifyEvent(event).valid) fail('A mapping evidence signature is invalid.');
        verified.set(event.id, bytes);
      }
      let body; try { body = JSON.parse(event.content); } catch { fail('Mapping evidence cannot be read.'); }
      if (body.schema !== 'wolf-evidence/v1' || body.sequence !== index + 1 || body.previous !== previous || !Array.isArray(body.parents) || body.parents.some(id => !records.has(id)) || records.has(event.id)) fail('Mapping evidence order or causal references changed.');
      records.set(event.id, { ...body, evidenceId: event.id }); ids.push(event.id); previous = event.id;
    }
    const checkpoint = bundle.checkpoint;
    if (checkpoint?.pubkey !== identity || checkpoint.kind !== 9451 || !nostr.verifyEvent(checkpoint).valid) fail('The mapping evidence checkpoint is invalid.');
    let head; try { head = JSON.parse(checkpoint.content); } catch { fail('The mapping evidence checkpoint cannot be read.'); }
    if (head.schema !== 'wolf-checkpoint/v1' || head.size !== ids.length || head.last !== previous || head.root !== aura.root(ids).root) fail('The mapping evidence checkpoint does not match its records.');
    if (retainedHead && (ids.length < retainedHead.size || aura.root(ids.slice(0, retainedHead.size)).root !== retainedHead.root)) fail('The mapping evidence history was rolled back.');
    retainedHead = { size: ids.length, root: head.root };
    return records;
  }
  function recordPayload(record, records) {
    const payload = record?.payload;
    if (payload?.schema !== 'wolf-evidence-parts/v1') return payload;
    if (!Array.isArray(payload.parts) || payload.parts.length > 40 || payload.byteLength > 512000 || payload.encoding !== 'utf8-json') fail('The signed research attachment is invalid.');
    const chunks = []; let offset = 0;
    for (const id of payload.parts) {
      const part = records.get(id);
      if (part?.kind !== 'research.evidence-part' || part.payload.sha256 !== payload.sha256 || part.payload.offset !== offset || part.payload.encoding !== 'base64' || typeof part.payload.data !== 'string') fail('A signed research attachment is missing or changed.');
      const bytes = Buffer.from(part.payload.data, 'base64'); chunks.push(bytes); offset += bytes.length;
    }
    const bytes = Buffer.concat(chunks);
    if (offset !== payload.byteLength || digest(bytes.toString('utf8')) !== payload.sha256) fail('The complete signed research attachment does not match.');
    try { return JSON.parse(bytes.toString('utf8')); } catch { fail('The signed research attachment cannot be read.'); }
  }
  function authority(records) {
    const values = new Map();
    for (const record of records.values()) {
      if (record.kind === 'strategy.forecast-mapping') {
        const { id, ...mapping } = record.payload;
        if (digest(mapping) !== id || mapping.status !== 'approved' || mapping.capitalMode !== 'DEMO') fail('A signed mapping does not bind its exact parameters.');
        if (!values.has(id)) values.set(id, { id, ...mapping, evidenceId: record.evidenceId });
      } else if (record.kind === 'strategy.mapping-revoked') {
        const prior = values.get(record.payload.id);
        if (!prior) fail('A mapping revocation has no prior approval.');
        values.set(prior.id, { ...prior, status: 'revoked', revokedAt: record.payload.revokedAt ?? new Date(record.observedAt).toISOString(), revocationEvidenceId: record.evidenceId });
      }
    }
    return values;
  }
  function validateIndexed(row, approvals) {
    if (!row) return null;
    let value; try { value = JSON.parse(row.json); } catch { fail('The mapping index cannot be read.'); }
    const approved = approvals.get(value.id);
    if (!approved || digest(value) !== digest(approved)) fail('The mapping index differs from its signed approval or revocation.');
    return approved;
  }
  function list() {
    const approvals = authority(trustedRecords());
    return db.prepare('SELECT json FROM mappings ORDER BY rowid DESC LIMIT 100').all().map(row => validateIndexed(row, approvals));
  }
  function get(id) { const row = db.prepare('SELECT json FROM mappings WHERE id=?').get(String(id)); return row ? validateIndexed(row, authority(trustedRecords())) : null; }
  async function create(input) {
    if (input?.confirmTerminalPriceContract !== true || input?.capitalMode !== 'DEMO') fail('Confirm that the source rules resolve on the terminal asset price. This mapping is paper-only.');
    if (!['BTC-USD', 'ETH-USD'].includes(input.symbol) || !['above', 'below'].includes(input.direction) || typeof input.strike !== 'number' || !Number.isFinite(input.strike) || input.strike <= 0 || input.strike > 1e8) fail('Supply an exact asset, positive strike, and above/below comparison.');
    const market = await markets.market(String(input.marketId), { fresh: true });
    if (!market.supported || !market.outcomes.some(o => o.assetId === input.assetId) || input.rulesVersion !== market.rulesVersion) fail('The exact market, outcome and current rule version are required.');
    const end = Date.parse(market.endDate);
    if (!Number.isFinite(end) || end <= now() || end - now() > 24 * 3600000 || end % 3600000 !== 0) fail('The contract must end on an hourly boundary within the next 24 hours.');
    const mapping = { schema: 'wolf-forecast-mapping/v1', capitalMode: 'DEMO', status: 'approved', marketId: market.id, assetId: input.assetId, rulesVersion: market.rulesVersion, symbol: input.symbol, strike: input.strike, direction: input.direction, horizonEnd: market.endDate, modelArtifact: MODEL, minRelativeMove: '0.01', expiresAt: market.endDate, approvedAt: new Date(now()).toISOString(), semanticAuthority: 'owner-reviewed mapping, not automatic model inference', sourceUrl: market.sourceUrl, question: market.question };
    const id = digest(mapping), existing = db.prepare('SELECT json FROM mappings WHERE id=?').get(id);
    if (existing) { const prior = get(id); if (prior.status !== 'approved') fail('This exact approval was revoked. Review and create a fresh mapping.'); return prior; }
    const receipt = aukora.record('strategy.forecast-mapping', { id, ...mapping });
    const value = { id, ...mapping, evidenceId: receipt.id };
    db.prepare('INSERT INTO mappings VALUES(?,?)').run(id, JSON.stringify(value)); return value;
  }
  function revoke(id) {
    const value = get(id); if (!value) fail('Mapping not found.'); if (value.status === 'revoked') return value;
    const revokedAt = new Date(now()).toISOString(), receipt = aukora.record('strategy.mapping-revoked', { id, revokedAt }, [value.evidenceId]);
    const next = { ...value, status: 'revoked', revokedAt, revocationEvidenceId: receipt.id };
    db.prepare('UPDATE mappings SET json=? WHERE id=?').run(JSON.stringify(next), id); return next;
  }
  function horizon(input) {
    const last = Date.parse(input.candles.at(-1).timestamp) + input.intervalSeconds * 1000;
    const values = list().filter(x => x.status === 'approved' && x.symbol === input.symbol && Date.parse(x.expiresAt) > now()).map(x => (Date.parse(x.horizonEnd) - last) / (input.intervalSeconds * 1000)).filter(x => Number.isInteger(x) && x >= 1 && x <= 24);
    return values.length ? Math.max(...values) : input.horizon ?? 6;
  }
  function signals(scan) {
    const forecast = scan?.specialists?.kronos;
    if (!forecast || forecast.unavailable || forecast.provider !== 'kronos' || forecast.model?.revision !== MODEL || !/^[a-f0-9]{64}$/.test(forecast.inputHash ?? '') || !Array.isArray(forecast.predictions)) return [];
    const observed = Date.parse(forecast.observedAt);
    if (!Number.isFinite(observed) || observed > now() || now() - observed > 300000) return [];
    const records = trustedRecords(), findingsRecord = records.get(scan.evidenceId);
    if (findingsRecord?.kind !== 'research.findings') fail('A forecast must be part of a signed completed research record.');
    const facts = recordPayload(findingsRecord, records);
    if (!facts?.specialists?.kronos || digest(facts.specialists.kronos) !== digest(forecast)) fail('The cached forecast differs from its signed research record.');
    const approvals = authority(records), output = [];
    const mappings = db.prepare('SELECT json FROM mappings ORDER BY rowid DESC LIMIT 100').all().map(row => validateIndexed(row, approvals));
    for (const mapping of mappings) {
      if (mapping.status !== 'approved' || Date.parse(mapping.expiresAt) <= now() || mapping.symbol !== forecast.symbol) continue;
      const finding = facts.findings?.find(item => item.marketId === mapping.marketId);
      if (!finding || finding.rulesVersion !== mapping.rulesVersion) continue;
      const terminal = forecast.predictions.find(p => Date.parse(p.timestamp) + 3600000 === Date.parse(mapping.horizonEnd));
      if (!terminal || !Number.isFinite(terminal.close) || terminal.close <= 0) continue;
      const payload = { kind: 'underlying-price-forecast', mappingId: mapping.id, marketId: mapping.marketId, assetId: mapping.assetId, rulesVersion: mapping.rulesVersion, symbol: mapping.symbol, strike: mapping.strike, direction: mapping.direction, horizonEnd: mapping.horizonEnd, modelArtifact: MODEL, inputHash: forecast.inputHash, terminalPrice: Number(terminal.close.toFixed(6)), forecastAt: forecast.observedAt, observedAt: forecast.observedAt, expiresAt: new Date(Math.min(observed + 300000, Date.parse(mapping.expiresAt))).toISOString(), eventProbability: null, sourceUrl: forecast.sourceUrl, authorizesOrder: false };
      const id = digest(payload), stored = db.prepare('SELECT json FROM signals WHERE id=?').get(id);
      if (stored) {
        const value = JSON.parse(stored.json), record = records.get(value.evidenceId);
        if (record?.kind !== 'strategy.directional-signal' || digest(record.payload) !== digest({ id, ...payload }) || digest(value) !== digest({ id, ...payload, evidenceId: record.evidenceId })) fail('The cached signal differs from its signed source record.');
        output.push(value); continue;
      }
      const receipt = aukora.record('strategy.directional-signal', { id, ...payload }, [mapping.evidenceId, scan.evidenceId]);
      const value = { id, ...payload, evidenceId: receipt.id }; db.prepare('INSERT INTO signals VALUES(?,?)').run(id, JSON.stringify(value)); output.push(value);
    }
    return output;
  }
  return { create, list, get, revoke, horizon, signals, close: () => { if (!closed) { closed = true; db.close(); } } };
}
