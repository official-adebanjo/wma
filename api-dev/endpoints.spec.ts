import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { checkSchema } from './schema-check';
import { CACHE_DIR, Operation, Param, RECORDS, TOKENS, isAdminOnly, loadSpec, opKey, operations, successSchema } from './spec';

/**
 * One check per read-only (GET) endpoint in the saved API document, run against the dev backend:
 *
 *   1. without signing in, the request is refused (401/403)                 — every secured endpoint
 *   2. a customer is refused on staff-only areas (401/403)                   — admin areas
 *   3. a customer cannot read another customer's records (403/404)           — paths with {userId}/{customerId}
 *   4. with the right sign-in it answers 2xx, within 5 s
 *   5. the answer matches the documented response format
 *
 * Endpoints that create, change or delete data (POST/PUT/PATCH/DELETE) are documented in the report
 * but never called, so a run cannot change anything on the dev system. IDs in paths come from the
 * list endpoints' own answers (checked first). Each check's outcome is appended to
 * reports/api-results/records.jsonl for the results page.
 */
type Session = { token: string; id: number; email: string } | null;
type Tokens = { customer: Session; otherCustomer: Session; admin: Session };
/** ok · warn = refused, but with the wrong status (e.g. 400 instead of 401) · fail */
type Verdict = 'ok' | 'warn' | 'fail';
type Checks = Partial<Record<'noAuth' | 'customerOnAdmin' | 'otherCustomer' | 'call' | 'schema' | 'speed', Verdict>>;

/** A refusal check: answering with data is a failure; refusing with an unexpected status is a warning. */
const refusal = (status: number, expected: number[]): Verdict => (status === 0 ? 'warn' : status < 300 ? 'fail' : expected.includes(status) ? 'ok' : 'warn');
type ApiRecord = {
  method: string; path: string; tag: string; summary: string; outcome: 'checked' | 'not-run';
  role?: 'customer' | 'admin'; status?: number; ms?: number; checks: Checks; problems: string[]; reason?: string; at: string;
  /** Per failed check: the request and a redacted excerpt of the answer, shown behind "View" on the results page. */
  evidence?: Record<string, string>;
  /** The address actually called (path + query, IDs filled in); the uptime watch replays it (scripts/monitor-baseline.js). */
  url?: string;
};

/** Error fields the API fills with its own text; record fields are always blanked. */
const KEEP_TEXT = new Set(['message', 'error', 'status', 'path', 'timestamp']);

/** The answer's shape with every value blanked: lists show their first item and a count, never record data. */
function redact(body: unknown, key = '', depth = 0): unknown {
  if (body === null || typeof body === 'boolean') return body;
  if (typeof body === 'string') return KEEP_TEXT.has(key) ? body.slice(0, 160) : '<text>';
  if (typeof body === 'number') return KEEP_TEXT.has(key) ? body : '<number>';
  if (depth > 4) return '…';
  if (Array.isArray(body)) return body.length ? [redact(body[0], key, depth + 1), ...(body.length > 1 ? [`… ${body.length - 1} more`] : [])] : [];
  return Object.fromEntries(Object.entries(body as Record<string, unknown>).slice(0, 14).map(([k, v]) => [k, redact(v, k, depth + 1)]));
}

function evidenceFor(op: { method: string; path: string }, who: string, res: { status: number; ms: number; body: unknown; message: string }) {
  const shown = res.body === undefined ? res.message || '(no JSON body)' : JSON.stringify(redact(res.body), null, 1);
  const answer = res.status === 0 ? `no answer (${res.message})` : `${res.status} in ${res.ms} ms`;
  return `Request: ${op.method.toUpperCase()} ${op.path} (${who})\nAnswer: ${answer}\n${shown.length > 900 ? shown.slice(0, 900) + '\n…' : shown}`;
}

const spec = loadSpec();
const base = () => (process.env.API_BASE_URL || '').replace(/\/$/, '');
const SLOW_MS = 5_000;

const readTokens = (): Tokens => JSON.parse(fs.readFileSync(TOKENS, 'utf8'));
const cacheFile = (concretePath: string) => path.join(CACHE_DIR, `${concretePath.replace(/[^a-z0-9]+/gi, '_')}.json`);

function record(r: Omit<ApiRecord, 'at'>) {
  fs.mkdirSync(path.dirname(RECORDS), { recursive: true });
  fs.appendFileSync(RECORDS, JSON.stringify({ ...r, at: new Date().toISOString() }) + '\n');
}

async function call(url: string, token?: string) {
  const started = Date.now();
  let res: Response;
  try {
    res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {}, signal: AbortSignal.timeout(30_000) });
  } catch (e) {
    // Status 0: the server dropped the connection or took over 30 s — reported as "no answer".
    const why = (e as Error).name === 'TimeoutError' ? 'no answer within 30 s' : 'the server dropped the connection';
    return { status: 0, ms: Date.now() - started, body: undefined as unknown, isJson: false, message: why };
  }
  const text = await res.text();
  let body: unknown;
  try { body = JSON.parse(text); } catch { body = undefined; }
  // The API's own error text ("pageNo is required") explains most refusals; it never holds record data.
  const message = typeof (body as { message?: unknown })?.message === 'string' ? (body as { message: string }).message.slice(0, 120) : '';
  return { status: res.status, ms: Date.now() - started, body, isJson: body !== undefined, message };
}

/** Opens a live stream, reads only its status (and error body, if refused), then disconnects. */
async function openStream(url: string, token?: string) {
  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch(url, { headers: { Accept: 'text/event-stream', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, signal: ctrl.signal });
    const ms = Date.now() - started;
    if (res.ok) { ctrl.abort(); return { status: res.status, ms, body: undefined as unknown, isJson: false, message: 'stream opened' }; }
    const text = await res.text();
    let body: unknown;
    try { body = JSON.parse(text); } catch { body = undefined; }
    const message = typeof (body as { message?: unknown })?.message === 'string' ? (body as { message: string }).message.slice(0, 120) : '';
    return { status: res.status, ms, body, isJson: body !== undefined, message };
  } catch {
    return { status: 0, ms: Date.now() - started, body: undefined as unknown, isJson: false, message: 'the stream did not open within 15 s' };
  } finally {
    clearTimeout(timer);
  }
}

/** First value of `key` anywhere in a JSON body (lists and paged `content`/`data` wrappers included). */
function findValue(body: unknown, key: string, depth = 0): string | undefined {
  if (body === null || typeof body !== 'object' || depth > 6) return undefined;
  if (Array.isArray(body)) {
    for (const v of body) { const f = findValue(v, key, depth + 1); if (f !== undefined) return f; }
    return undefined;
  }
  const obj = body as Record<string, unknown>;
  if (obj[key] !== undefined && obj[key] !== null && typeof obj[key] !== 'object') return String(obj[key]);
  for (const v of Object.values(obj)) { const f = findValue(v, key, depth + 1); if (f !== undefined) return f; }
  return undefined;
}

function cached(concretePath: string): unknown {
  try { return JSON.parse(fs.readFileSync(cacheFile(concretePath), 'utf8')); } catch { return undefined; }
}

const cacheBodies = (match: (file: string) => boolean): unknown[] =>
  fs.existsSync(CACHE_DIR)
    ? fs.readdirSync(CACHE_DIR).filter(match).map((f) => JSON.parse(fs.readFileSync(path.join(CACHE_DIR, f), 'utf8')))
    : [];
/** Answers from lists below a path, e.g. "/api/v3/investments/my" for "/api/v3/investments". */
const cachedUnder = (concretePrefix: string) => {
  const stem = path.basename(cacheFile(concretePrefix), '.json');
  return cacheBodies((f) => f.startsWith(`${stem}_`));
};
/** Answers from lists whose path ends in a name, e.g. "/api/v3/country" for {countryId}. */
const cachedNamed = (name: string) => cacheBodies((f) => new RegExp(`_${name}s?\\.json$`, 'i').test(f));

/** Cached answers, closest area first: "/api/v3/loan-products…" answers before "/api/v3/investment-products…". */
function cachedNear(opPath: string): unknown[] {
  if (!fs.existsSync(CACHE_DIR)) return [];
  const key = opPath.replace(/[^a-z0-9]+/gi, '_');
  const shared = (f: string) => { let i = 0; while (i < f.length && f[i] === key[i]) i++; return i; };
  return fs.readdirSync(CACHE_DIR)
    .sort((a, b) => shared(b) - shared(a))
    .map((f) => JSON.parse(fs.readFileSync(path.join(CACHE_DIR, f), 'utf8')));
}

/** A value for a path/query parameter, from the sign-in or from an earlier answer. */
function valueFor(p: Param, concretePrefix: string, tokens: Tokens, opPath: string): string | undefined {
  const n = p.name;
  if (/^(userId|customerId)$/.test(n) || (n === 'id' && /\/(customers|users)$/.test(concretePrefix))) {
    return tokens.customer ? String(tokens.customer.id) : undefined;
  }
  if (/^(pageNo|page)$/.test(n)) return '1'; // 1-based: pageNo=0 is rejected as "pageNo is required"
  if (/^(pageSize|size|limit)$/.test(n)) return '10';
  if (/^(startTime|startDate|from)$/.test(n)) return new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 19);
  if (/^(endTime|endDate|to)$/.test(n)) return new Date().toISOString().slice(0, 19);
  if (n === 'email') return tokens.customer?.email;
  if (p.schema?.enum?.length) return String(p.schema.enum[0]);
  // The list one level up ("/loan-products" for "/loan-products/{id}") names the IDs it holds;
  // failing that, a list under it ("/investments/my" for "/investments/{id}"), or one named after
  // the parameter ("/country" for {countryId}).
  const stem = n.replace(/Id$/, '').toLowerCase();
  const lists = [cached(concretePrefix), ...cachedUnder(concretePrefix), ...(n !== 'id' && stem !== n.toLowerCase() ? cachedNamed(stem) : [])];
  for (const body of lists) {
    const v = findValue(body, n) ?? (n === 'id' || /Id$/.test(n) ? findValue(body, 'id') : undefined);
    if (v !== undefined) return v;
  }
  if (n === 'id') return undefined;
  // Named keys (slug, productKey, tierName, …) can come from any earlier answer — same area first.
  for (const body of cachedNear(opPath)) {
    const v = findValue(body, n);
    if (v !== undefined) return v;
  }
  return undefined;
}

/** Concrete URL for an operation, or the names of the values that could not be found. */
function buildUrl(op: Operation, tokens: Tokens): { url: string; concrete: string } | { missing: string[] } {
  let concrete = op.path;
  const missing: string[] = [];
  for (const p of op.params.filter((x) => x.in === 'path')) {
    const prefix = concrete.slice(0, concrete.indexOf(`{${p.name}}`)).replace(/\/$/, '');
    const v = valueFor(p, prefix, tokens, op.path);
    if (v === undefined) missing.push(p.name);
    else concrete = concrete.replace(`{${p.name}}`, encodeURIComponent(v));
  }
  const query = new URLSearchParams();
  // Required parameters, plus paging whenever it is offered (several "optional" pageNo fail when omitted).
  for (const p of op.params.filter((x) => x.in === 'query' && (x.required || /^(pageNo|pageSize)$/.test(x.name)))) {
    const v = valueFor(p, '', tokens, op.path);
    if (v === undefined) missing.push(p.name);
    else query.set(p.name, v);
  }
  if (missing.length) return { missing };
  return { url: `${base()}${concrete}${query.size ? `?${query}` : ''}`, concrete };
}

// List endpoints first: their answers supply the IDs the others need.
const gets = operations(spec)
  .filter((o) => o.method === 'get')
  .sort((a, b) => a.params.filter((p) => p.in === 'path').length - b.params.filter((p) => p.in === 'path').length || a.path.localeCompare(b.path));

test.describe('API › read-only endpoints (dev)', () => {
  test.skip(!process.env.API_BASE_URL, 'API_BASE_URL required');

  for (const op of gets) {
    test(`${opKey(op)} — ${op.summary}`, { tag: [`@api:${op.tag.replace(/\s+/g, '-')}`] }, async () => {
      const tokens = readTokens();
      const checks: Checks = {};
      const problems: string[] = [];
      const evidence: Record<string, string> = {};
      const meta = { method: op.method.toUpperCase(), path: op.path, tag: op.tag, summary: op.summary };

      const built = buildUrl(op, tokens);
      if ('missing' in built) {
        record({ ...meta, outcome: 'not-run', checks, problems, reason: `needs a value for ${built.missing.join(', ')} that no list endpoint provided` });
        test.skip(true, `No value found for ${built.missing.join(', ')}`);
        return;
      }

      // Live streams (server-sent events) stay open by design: judge them on the status they open with.
      if (spec.paths[op.path]?.get?.responses?.['200']?.content?.['text/event-stream']) {
        if (op.secured) {
          const anon = await openStream(built.url);
          checks.noAuth = refusal(anon.status, [401, 403]);
          if (checks.noAuth !== 'ok') evidence.noAuth = evidenceFor(op, 'no sign-in', anon);
          if (checks.noAuth === 'fail') problems.push(`stream opened (${anon.status}) without signing in`);
          if (checks.noAuth === 'warn') problems.push(`refused without signing in, but with ${anon.status} instead of 401`);
        }
        const res = await openStream(built.url, tokens.customer?.token);
        // Silence is normal for a quiet stream (some servers only send headers with the first event).
        checks.call = res.status >= 200 && res.status < 300 ? 'ok' : res.status === 0 ? 'warn' : 'fail';
        if (checks.call === 'warn') problems.push('stream sent nothing within 15 s (normal when there is nothing new)');
        if (checks.call === 'fail') {
          evidence.call = evidenceFor(op, 'signed in as the customer', res);
          problems.push(res.status === 0 ? `no answer: “${res.message}”` : res.status >= 500 ? `server error ${res.status}` : `answered ${res.status}${res.message ? `: “${res.message}”` : ''}`);
        }
        record({ ...meta, outcome: 'checked', role: 'customer', status: res.status, ms: res.ms, checks, problems, ...(Object.keys(evidence).length ? { evidence } : {}) });
        expect.soft(checks.noAuth ?? 'ok', 'refused without signing in').not.toBe('fail');
        expect.soft(checks.call, `stream opens (got ${res.status})`).not.toBe('fail');
        return;
      }

      // 1. Refused without signing in.
      if (op.secured) {
        const anon = await call(built.url);
        checks.noAuth = refusal(anon.status, [401, 403]);
        if (checks.noAuth !== 'ok') evidence.noAuth = evidenceFor(op, 'no sign-in', anon);
        if (checks.noAuth === 'fail') problems.push(`answered ${anon.status} with data without signing in`);
        if (checks.noAuth === 'warn') problems.push(`refused without signing in, but with ${anon.status} instead of 401`);
      }

      // 2. Staff-only areas refuse a customer.
      const adminOnly = isAdminOnly(op);
      if (adminOnly && tokens.customer) {
        const asCustomer = await call(built.url, tokens.customer.token);
        checks.customerOnAdmin = refusal(asCustomer.status, [401, 403]);
        if (checks.customerOnAdmin !== 'ok') evidence.customerOnAdmin = evidenceFor(op, 'signed in as a customer', asCustomer);
        if (checks.customerOnAdmin === 'fail') problems.push(`staff-only area answered ${asCustomer.status} with data to a customer sign-in`);
        if (checks.customerOnAdmin === 'warn') problems.push(`staff-only area refused a customer, but with ${asCustomer.status} instead of 403`);
      }

      // 3. A customer cannot read another customer's records. A 200 is only a leak when it differs from
      //    the customer's own answer and holds data (some endpoints ignore the ID and use the sign-in).
      const ownerParam = op.params.find((p) => p.in === 'path' && /^(userId|customerId)$/.test(p.name));
      if (ownerParam && !adminOnly && tokens.customer && tokens.otherCustomer) {
        const other = await call(built.url.replace(`/${tokens.customer.id}`, `/${tokens.otherCustomer.id}`), tokens.customer.token);
        checks.otherCustomer = refusal(other.status, [401, 403, 404]);
        if (checks.otherCustomer === 'fail') {
          const own = await call(built.url, tokens.customer.token);
          const holdsRecords = findValue(other.body, 'id') !== undefined;
          if (!holdsRecords || JSON.stringify(own.body) === JSON.stringify(other.body)) checks.otherCustomer = 'warn';
        }
        if (checks.otherCustomer === 'fail') evidence.otherCustomer = evidenceFor(op, "Tier 3 test customer asking for Tier 1's ID", other);
        if (checks.otherCustomer === 'fail') problems.push(`returned another customer's records (${other.status})`);
        if (checks.otherCustomer === 'warn') problems.push(`accepted another customer's ID (${other.status}) but returned no data of theirs`);
      }

      // 4. Answers with the right sign-in (customer first for customer areas, falling back to staff).
      const order: ('customer' | 'admin')[] = adminOnly ? ['admin'] : ['customer', 'admin'];
      let res: Awaited<ReturnType<typeof call>> | undefined;
      let role: 'customer' | 'admin' | undefined;
      for (const r of order) {
        const s = tokens[r];
        if (!s) continue;
        res = await call(built.url, s.token);
        role = r;
        if (![401, 403].includes(res.status)) break;
      }
      if (!res) {
        record({ ...meta, outcome: 'not-run', checks, problems, reason: 'no sign-in available for this area' });
        test.skip(true, 'No token for this area');
        return;
      }
      // 404 on a path with an ID can simply mean "nothing for this record" (e.g. no address on file).
      const notFoundForSample = res.status === 404 && op.params.some((p) => p.in === 'path');
      checks.call = res.status >= 200 && res.status < 300 ? 'ok' : notFoundForSample ? 'warn' : 'fail';
      if (checks.call === 'fail') {
        problems.push(res.status === 0 ? `no answer: “${res.message}”` : res.status >= 500 ? `server error ${res.status}` : `answered ${res.status}${res.message ? `: “${res.message}”` : ''}`);
      }
      if (checks.call === 'warn') problems.push(`nothing found for the sample record (404${res.message ? `: “${res.message}”` : ''})`);
      const who = role === 'admin' ? 'signed in as staff' : 'signed in as the customer';
      if (checks.call !== 'ok') evidence.call = evidenceFor(op, who, res);
      checks.speed = res.ms <= SLOW_MS ? 'ok' : 'fail';
      if (checks.speed === 'fail') evidence.speed = evidenceFor(op, who, res);
      if (checks.speed === 'fail') problems.push(`slow: ${(res.ms / 1000).toFixed(1)} s`);

      // 5. Matches the documented format.
      if (checks.call === 'ok' && res.isJson) {
        fs.writeFileSync(cacheFile(built.concrete), JSON.stringify(res.body));
        const schemaProblems = checkSchema(successSchema(op), res.body, spec);
        checks.schema = schemaProblems.length ? 'fail' : 'ok';
        if (schemaProblems.length) evidence.schema = `${schemaProblems.slice(0, 4).join('\n')}\n\n${evidenceFor(op, who, res)}`;
        problems.push(...schemaProblems.map((p) => `format: ${p}`));
      }

      record({ ...meta, outcome: 'checked', role, status: res.status, ms: res.ms, checks, problems, url: built.url.slice(base().length), ...(Object.keys(evidence).length ? { evidence } : {}) });
      // Refusals with an unexpected status ('warn') are reported on the results page but don't fail the check.
      expect.soft(checks.noAuth ?? 'ok', 'refused without signing in').not.toBe('fail');
      expect.soft(checks.customerOnAdmin ?? 'ok', 'staff-only area refuses a customer').not.toBe('fail');
      expect.soft(checks.otherCustomer ?? 'ok', "another customer's records are refused").not.toBe('fail');
      expect.soft(checks.call, `answers successfully (got ${res.status})`).not.toBe('fail');
      expect.soft(checks.schema ?? 'ok', `matches the documented format: ${problems.filter((p) => p.startsWith('format:')).join('; ')}`).toBe('ok');
      expect.soft(res.ms, 'answers within 5 seconds').toBeLessThanOrEqual(SLOW_MS);
    });
  }
});
