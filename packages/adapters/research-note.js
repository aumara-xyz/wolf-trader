// Optional research note. Not on the order path.
// No key, no note — the caller must not invent one.

import { paperThesis } from './polymarket-paper.js';

export const RESEARCH_DISABLED = 'set OPENROUTER_API_KEY or GEMINI_API_KEY to enable';

export function researchStatus(env = {}) {
  if (env.OPENROUTER_API_KEY) return { enabled: true, provider: 'openrouter' };
  if (env.GEMINI_API_KEY) return { enabled: true, provider: 'gemini' };
  return { enabled: false, provider: null, reason: RESEARCH_DISABLED };
}

function extractJson(text) {
  const raw = String(text || '').trim();
  const fenced = raw.match(/\{[\s\S]*\}/);
  if (!fenced) return null;
  try {
    const parsed = JSON.parse(fenced[0]);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

async function modelText(env, provider, prompt, fetchImpl) {
  if (provider === 'openrouter') {
    const res = await fetchImpl('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'google/gemini-2.0-flash-001',
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res?.ok && res?.ok !== undefined) return '';
    const body = await res.json();
    return body?.choices?.[0]?.message?.content || '';
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`;
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
  });
  if (!res?.ok && res?.ok !== undefined) return '';
  const body = await res.json();
  const parts = body?.candidates?.[0]?.content?.parts;
  return Array.isArray(parts) ? parts.map((p) => p.text || '').join('') : '';
}

export async function writeResearchNote({ question, outcome, price, symbol }, env = {}, fetchImpl = globalThis.fetch) {
  const status = researchStatus(env);
  if (!status.enabled) return { ok: false, reason: RESEARCH_DISABLED };
  const prompt = [
    'Return JSON only with keys invalidation (short string), maxAllocation (number from 0 to 0.25), claim (one sentence).',
    `Market: ${String(question || '').slice(0, 240)}`,
    `Outcome: ${outcome === 'NO' ? 'NO' : 'YES'}`,
    `Screen price: ${Number(price)}`,
    'Paper note only. Do not authorize a live order.',
  ].join('\n');
  let text = '';
  try {
    text = await modelText(env, status.provider, prompt, fetchImpl);
  } catch {
    return { ok: false, reason: 'note failed' };
  }
  const parsed = extractJson(text);
  if (!parsed || typeof parsed.invalidation !== 'string' || !parsed.invalidation.trim()) {
    return { ok: false, reason: 'note failed' };
  }
  const thesis = paperThesis({
    symbol: symbol || 'pm:research',
    question,
    outcome: outcome === 'NO' ? 'NO' : 'YES',
    price,
  });
  thesis.invalidation = parsed.invalidation.trim().slice(0, 280);
  const cap = Number(parsed.maxAllocation);
  thesis.maxAllocation = Number.isFinite(cap) ? Math.min(0.25, Math.max(0, cap)) : null;
  thesis.authorizesLiveOrder = false;
  thesis.mode = 'PAPER';
  return {
    ok: true,
    note: {
      invalidation: thesis.invalidation,
      maxAllocation: thesis.maxAllocation,
      authorizesLiveOrder: false,
    },
  };
}
