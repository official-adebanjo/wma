/**
 * Builds the uptime watch list (monitor/baseline.json) from the last full API run.
 *
 *   npm run test:api:dev && node scripts/monitor-baseline.js
 *
 * Only read-only endpoints that answered successfully in that run are watched, so problems we already
 * know about don't raise alerts. The test customer's own ID is replaced with {me} (filled with the
 * monitor account's ID at check time), and emails in queries with {email}. Customer endpoints that
 * need someone else's record ID are left out — those records belong to the test customer.
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const records = fs.readFileSync(path.join(root, 'reports/api-results/records.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const OWN_ID = /^\{(userId|customerId)\}$/;

const endpoints = [];
const skipped = { failing: 0, noAddress: 0, otherRecords: 0 };
for (const r of records) {
  if (r.outcome !== 'checked' || r.checks?.call !== 'ok') { skipped.failing++; continue; }
  if (!r.url) { skipped.noAddress++; continue; } // live streams, and runs from before addresses were recorded
  const [concrete, query = ''] = r.url.split('?');
  const tpl = r.path.split('/');
  const parts = concrete.split('/');
  let foreign = false;
  for (let i = 0; i < tpl.length; i++) {
    if (OWN_ID.test(tpl[i]) && r.role === 'customer') parts[i] = '{me}';
    else if (/^\{.+\}$/.test(tpl[i]) && r.role === 'customer') foreign = true;
  }
  if (foreign) { skipped.otherRecords++; continue; }
  const q = new URLSearchParams(query);
  if (r.role === 'customer') for (const k of ['userId', 'customerId']) if (q.has(k)) q.set(k, '{me}');
  // No customer emails in the committed list: filled with the monitor account's email at check time.
  for (const [k, v] of q) if (v.includes('@')) q.set(k, '{email}');
  const url = parts.join('/') + (q.size ? `?${q.toString().replace(/%7B(me|email)%7D/g, '{$1}')}` : '');
  endpoints.push({ key: `${r.method} ${r.path}`, url, role: r.role, area: r.tag, summary: r.summary });
}

const out = path.join(root, 'monitor/baseline.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ builtAt: new Date().toISOString(), from: 'reports/api-results/records.jsonl', endpoints }, null, 1) + '\n');
const byRole = endpoints.reduce((m, e) => ((m[e.role] = (m[e.role] || 0) + 1), m), {});
console.log(`Watching ${endpoints.length} endpoints`, byRole, '· left out:', skipped);
