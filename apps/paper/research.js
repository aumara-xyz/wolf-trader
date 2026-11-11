const state = document.getElementById('state');
const form = document.getElementById('form');
const question = document.getElementById('question');
const out = document.getElementById('out');
const yes = document.getElementById('yes');
const no = document.getElementById('no');
const params = new URLSearchParams(location.search);

question.value = params.get('q') || '';
let outcome = params.get('outcome') === 'NO' ? 'NO' : 'YES';

function paintSide() {
  yes.setAttribute('aria-pressed', outcome === 'YES' ? 'true' : 'false');
  no.setAttribute('aria-pressed', outcome === 'NO' ? 'true' : 'false');
}
paintSide();
yes.addEventListener('click', () => { outcome = 'YES'; paintSide(); });
no.addEventListener('click', () => { outcome = 'NO'; paintSide(); });

const status = await fetch('/api/research/status').then((r) => r.json()).catch(() => ({ enabled: false, reason: 'set OPENROUTER_API_KEY or GEMINI_API_KEY to enable' }));
if (!status.enabled) {
  state.textContent = status.reason || 'set OPENROUTER_API_KEY or GEMINI_API_KEY to enable';
} else {
  state.hidden = true;
  form.hidden = false;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  out.replaceChildren();
  const res = await fetch('/api/research', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ question: question.value, outcome, price: 0.5 }),
  });
  const body = await res.json().catch(() => ({ ok: false, reason: 'note failed' }));
  if (!body.ok) {
    state.hidden = false;
    state.textContent = body.reason || 'note failed';
    return;
  }
  state.hidden = true;
  const inv = document.createElement('p');
  inv.textContent = body.note.invalidation;
  const cap = document.createElement('p');
  cap.className = 'num';
  const pct = body.note.maxAllocation == null ? '—' : `${(body.note.maxAllocation * 100).toFixed(1)}%`;
  cap.textContent = pct;
  out.append(inv, cap);
});
