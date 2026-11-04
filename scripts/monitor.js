/**
 * Uptime watch for the dev system: checks the watched endpoints (monitor/baseline.json), the admin
 * website and its script/style files, and the sign-ins; merges the browser check (scripts/monitor-ui.js)
 * when it ran; compares with the previous check and reports what went down or came back.
 *
 *   node scripts/monitor.js --state <dir> --plan            should the browser check run now? (→ $GITHUB_OUTPUT ui=true)
 *   node scripts/monitor.js --state <dir> [--out <dir>]     one check (the scheduled GitHub job)
 *   node scripts/monitor.js --state <dir> --test-email       the same, and always write an email (checks mail settings)
 *   node scripts/monitor.js --calibrate                     drop endpoints the monitor accounts may not read
 *
 * Read-only: GET requests only, with dedicated monitor accounts (MONITOR_ADMIN_*, MONITOR_CUSTOMER_*),
 * so the test customers can't be locked out. Plain Node 20 (built-in fetch): no npm install needed.
 *
 * State lives in <dir> (the monitor-state branch in CI):
 *   state.json      each target's current status and failure count, the portal version, the last browser check
 *   incidents.jsonl one line per change (down / back up / new portal version), with timings
 *   status.md       the current status page (readable on GitHub)
 * When something changes, <out>/alert.html is written and `alert`/`subject` go to $GITHUB_OUTPUT.
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
try { require('dotenv').config({ path: path.join(root, '.env') }); } catch { /* CI: settings come from secrets */ }

const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };
const STATE_DIR = path.resolve(arg('--state', path.join(root, 'reports/monitor-state')));
const OUT_DIR = path.resolve(arg('--out', path.join(root, 'reports/monitor-out')));
const CALIBRATE = process.argv.includes('--calibrate');
const PLAN = process.argv.includes('--plan');
/** The browser check runs after a new portal version appears, and otherwise at most this often. */
const UI_EVERY_MIN = 55;
const UI_RESULTS = path.join(OUT_DIR, 'ui-results.json');

// The server address only; a value ending in /api or /api/v3 is accepted too (the paths below add it).
const API = (process.env.API_BASE_URL || '').replace(/\/+$/, '').replace(/\/api(\/v3)?$/, '');
const ADMIN_SITE = (process.env.MONITOR_ADMIN_URL || process.env.DEV_ADMIN_URL || process.env.ADMIN_BASE_URL || '').replace(/\/$/, '');
const TIMEOUT_MS = 15_000;
const SLOW_MS = 5_000;
/** Failures in a row before a target counts as down (one-off network blips don't alert). */
const DOWN_AFTER = 2;
const BASELINE = path.join(root, 'monitor/baseline.json');

const lagos = (iso) => new Date(iso).toLocaleString('en-GB', { timeZone: 'Africa/Lagos', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const minutes = (from, to) => Math.max(1, Math.round((new Date(to) - new Date(from)) / 60_000));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

async function get(url, token) {
  const started = Date.now();
  try {
    const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {}, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'follow' });
    let message = '';
    if (res.status >= 400) { try { const b = await res.json(); message = String(b.message || b.error || '').slice(0, 120); } catch { /* not JSON */ } }
    else await res.body?.cancel();
    return { status: res.status, ms: Date.now() - started, message };
  } catch (e) {
    return { status: 0, ms: Date.now() - started, message: e.name === 'TimeoutError' ? `no answer within ${TIMEOUT_MS / 1000} s` : 'could not connect' };
  }
}

async function signIn(pathname, email, password) {
  if (!email || !password) return { skipped: true };
  const started = Date.now();
  try {
    const res = await fetch(API + pathname, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }), signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = await res.json().catch(() => ({}));
    return res.status === 200 && body.token ? { token: body.token, id: body.id, status: 200, ms: Date.now() - started } : { status: res.status, ms: Date.now() - started, message: String(body.message || '').slice(0, 120) };
  } catch (e) {
    return { status: 0, ms: Date.now() - started, message: e.name === 'TimeoutError' ? `no answer within ${TIMEOUT_MS / 1000} s` : 'could not connect' };
  }
}

/** Runs fn over items, a few at a time, so the check doesn't hammer the dev server. */
async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i]); } }));
  return out;
}

const describe = (r) => (r.status === 0 ? r.message : `${r.status}${r.message ? ` “${r.message}”` : ''}`);

/**
 * The admin website and the script/style files its page loads. The file names change with every
 * deployment, so they double as the portal's version. A missing file usually comes back as the page
 * itself (200, text/html), which is why the content type is checked too.
 */
async function checkSite() {
  if (!ADMIN_SITE) return { results: [] };
  const started = Date.now();
  let html = '', status = 0, message = '';
  try {
    const res = await fetch(ADMIN_SITE + '/', { signal: AbortSignal.timeout(TIMEOUT_MS) });
    status = res.status;
    html = await res.text();
  } catch (e) { message = e.name === 'TimeoutError' ? `no answer within ${TIMEOUT_MS / 1000} s` : 'could not connect'; }
  const page = { key: 'site admin', name: 'Admin portal website', area: 'Websites', ok: status >= 200 && status < 400, status, ms: Date.now() - started, why: describe({ status, message }) };
  if (!page.ok) return { results: [page] };
  const assets = [...html.matchAll(/<script[^>]*\ssrc="([^"]+)"|<link[^>]*rel="(?:stylesheet|modulepreload)"[^>]*href="([^"]+)"|<link[^>]*href="([^"]+)"[^>]*rel="(?:stylesheet|modulepreload)"/g)]
    .map((m) => m[1] || m[2] || m[3]).filter((u) => !/^https?:\/\//.test(u) || u.startsWith(ADMIN_SITE));
  const broken = [];
  for (const a of assets) {
    const url = new URL(a, ADMIN_SITE + '/').toString();
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      const type = res.headers.get('content-type') || '';
      await res.body?.cancel();
      if (res.status !== 200) broken.push(`${path.basename(a)} answered ${res.status}`);
      else if (/text\/html/.test(type)) broken.push(`${path.basename(a)} is missing (the page came back instead)`);
    } catch { broken.push(`${path.basename(a)} didn't load`); }
  }
  const files = {
    key: 'site admin files', name: 'Admin portal script and style files', area: 'Websites', ok: assets.length > 0 && !broken.length, status: 200, ms: Date.now() - started,
    why: assets.length ? broken.join('; ') : 'the page loads no script files',
  };
  return { results: [page, files], version: assets.map((a) => path.basename(a)).sort().join(' ') };
}

async function checkAll() {
  if (!API) throw new Error('API_BASE_URL is not set');
  const baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
  const sessions = {
    admin: await signIn('/api/v3/admin-users/login', process.env.MONITOR_ADMIN_EMAIL, process.env.MONITOR_ADMIN_PASSWORD),
    customer: await signIn('/api/v3/users/login', process.env.MONITOR_CUSTOMER_EMAIL, process.env.MONITOR_CUSTOMER_PASSWORD),
  };
  const results = [];
  for (const [role, s] of Object.entries(sessions)) {
    if (s.skipped) continue;
    results.push({ key: `sign-in ${role}`, name: `${role === 'admin' ? 'Staff' : 'Customer'} sign-in`, area: 'Sign-in', ok: !!s.token, status: s.status, ms: s.ms, why: s.token ? '' : describe(s) });
  }
  const site = await checkSite();
  results.push(...site.results);
  const watched = baseline.endpoints.filter((e) => sessions[e.role]?.token);
  const notWatched = baseline.endpoints.length - watched.length;
  const why = Object.entries(sessions).filter(([, s]) => !s.token)
    .map(([role, s]) => (s.skipped ? `no monitor ${role} account set` : `${role === 'admin' ? 'staff' : 'customer'} sign-in failed`));
  const notWatchedNote = notWatched ? `${notWatched} not checked (${why.join('; ')})` : '';
  const checked = await pool(watched, 6, async (e) => {
    const s = sessions[e.role];
    const email = process.env.MONITOR_CUSTOMER_EMAIL || process.env.MONITOR_ADMIN_EMAIL || '';
    const r = await get(API + e.url.replace(/\{me\}/g, encodeURIComponent(s.id)).replace(/\{email\}/g, encodeURIComponent(email)), s.token);
    return { key: e.key, name: `${e.summary} (${e.key})`, area: e.area, role: e.role, ok: r.status >= 200 && r.status < 300, status: r.status, ms: r.ms, why: describe(r) };
  });
  results.push(...checked);
  return { results, notWatched, notWatchedNote, sessions, baseline, version: site.version };
}

async function calibrate() {
  const { results, sessions, baseline } = await checkAll();
  for (const [role, s] of Object.entries(sessions)) if (!s.skipped && !s.token) throw new Error(`${role} monitor sign-in failed (${describe(s)})`);
  const refused = new Set(results.filter((r) => [401, 403].includes(r.status) && r.role).map((r) => r.key));
  baseline.endpoints = baseline.endpoints.filter((e) => !refused.has(e.key));
  baseline.calibratedAt = new Date().toISOString();
  fs.writeFileSync(BASELINE, JSON.stringify(baseline, null, 1) + '\n');
  const failing = results.filter((r) => !r.ok && !refused.has(r.key));
  console.log(`Removed ${refused.size} endpoints the monitor accounts may not read; ${baseline.endpoints.length} remain.`);
  for (const k of refused) console.log('  refused:', k);
  if (failing.length) console.log(`${failing.length} still failing (kept, they will alert if they stay down):`, failing.map((r) => `${r.key} → ${r.why}`));
  const skipped = Object.entries(sessions).filter(([, s]) => s.skipped).map(([r]) => r);
  if (skipped.length) console.log(`No monitor account for: ${skipped.join(', ')} — those endpoints are kept but not checked yet.`);
}

const loadState = () => {
  const file = path.join(STATE_DIR, 'state.json');
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { targets: {} };
};

/** Before the main check: run the browser check if the portal has a new version, or it's been an hour. */
async function plan() {
  const state = loadState();
  const { version } = await checkSite();
  const last = state.ui?.lastAt ? (Date.now() - new Date(state.ui.lastAt)) / 60_000 : Infinity;
  const reason = process.argv.includes('--ui-now') ? 'asked for'
    : version && state.frontend?.version && version !== state.frontend.version ? 'new admin portal version'
      : Object.entries(state.targets).some(([k, t]) => k.startsWith('ui ') && t.status === 'down') ? 'a page was broken at the last check'
        : last >= UI_EVERY_MIN ? 'hourly' : '';
  console.log(reason ? `Browser check: yes (${reason})` : `Browser check: not now (last one ${Math.round(last)} min ago, no new version)`);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `ui=${reason ? 'true' : 'false'}\nui_reason=${reason}\n`);
}

function statusPage(state, run) {
  const items = Object.values(state.targets);
  const down = items.filter((t) => t.status === 'down');
  const failingNow = items.filter((t) => t.status === 'up' && t.fails > 0);
  const slow = items.filter((t) => t.ok !== false && t.ms > SLOW_MS);
  const incidents = fs.existsSync(path.join(STATE_DIR, 'incidents.jsonl'))
    ? fs.readFileSync(path.join(STATE_DIR, 'incidents.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)).slice(-30).reverse()
    : [];
  const row = (t) => `| ${t.area} | ${t.name.replace(/\|/g, '\\|')} | ${t.why || t.status} | ${t.since ? lagos(t.since) : ''} |`;
  return [
    `# Dev system status`,
    ``,
    `Last check: **${lagos(run.at)}** (Lagos time) · ${run.checked} checked · ${down.length ? `🔴 **${down.length} down**` : '🟢 all up'}${run.notWatchedNote ? ` · ${run.notWatchedNote}` : ''}`,
    ``,
    `Checks run every 15 minutes, Monday to Friday, 6am–7pm. Something counts as down after ${DOWN_AFTER} failed checks in a row. The browser check opens the main admin pages after each new portal version and otherwise about once an hour; a page counts as broken when it fails twice in the same check.`,
    ``,
    `Admin portal version: \`${state.frontend?.version || 'unknown'}\`${state.frontend?.since ? `, first seen ${lagos(state.frontend.since)}` : ''} · last browser check: ${state.ui?.lastAt ? lagos(state.ui.lastAt) : 'none yet'}`,
    ``,
    ...(down.length ? [`## Down now`, ``, `| Area | What | Answer | Down since |`, `|---|---|---|---|`, ...down.map(row), ``] : []),
    ...(failingNow.length ? [`## Failed the last check (not yet counted as down)`, ``, `| Area | What | Answer | |`, `|---|---|---|---|`, ...failingNow.map((t) => row({ ...t, since: '' })), ``] : []),
    ...(slow.length ? [`## Slow (over ${SLOW_MS / 1000} s)`, ``, ...slow.map((t) => `- ${t.name}: ${(t.ms / 1000).toFixed(1)} s`), ``] : []),
    `## Recent changes`,
    ``,
    ...(incidents.length ? [`| When | What | Change |`, `|---|---|---|`, ...incidents.map((i) => `| ${lagos(i.at)} | ${i.name.replace(/\|/g, '\\|')} | ${i.change === 'down' ? `🔴 down: ${i.why}` : i.change === 'deployed' ? `🔵 new version deployed (${i.why})` : `🟢 back up after ${i.minutes} min`} |`)] : ['None yet.']),
    ``,
  ].join('\n');
}

function alertEmail(wentDown, cameBack, stillDown, run) {
  const list = (rows, fmt) => {
    const byArea = rows.reduce((m, r) => ((m[r.area] = m[r.area] || []).push(r), m), {});
    return Object.entries(byArea).map(([area, rs]) => `<p style="margin:12px 0 4px"><b>${esc(area)}</b></p><ul style="margin:0">${rs.map((r) => `<li>${fmt(r)}</li>`).join('')}</ul>`).join('');
  };
  const parts = [`<p>Check at ${esc(lagos(run.at))} (Lagos time), ${run.checked} items checked.</p>`];
  if (run.deployedAt) parts.push(`<p>🔵 A new admin portal version was deployed (first seen ${esc(lagos(run.deployedAt))}).</p>`);
  if (wentDown.some((r) => r.screenshot)) parts.push(`<p style="color:#555">Screenshots of the broken pages are attached.</p>`);
  if (wentDown.length) parts.push(`<h3 style="color:#b42318">🔴 Down (${wentDown.length})</h3>`, list(wentDown, (r) => `${esc(r.name)}: ${esc(r.why)}, failing since ${esc(lagos(r.since))}`));
  if (cameBack.length) parts.push(`<h3 style="color:#067647">🟢 Back up (${cameBack.length})</h3>`, list(cameBack, (r) => `${esc(r.name)}: was down for about ${r.minutes} min`));
  if (stillDown.length) parts.push(`<p style="color:#555">Still down from earlier: ${stillDown.length} (${esc(stillDown.slice(0, 5).map((r) => r.name).join('; '))}${stillDown.length > 5 ? '; …' : ''}).</p>`);
  parts.push(`<p style="color:#555">Only endpoints that passed the last full API test are watched, so known problems don't alert. Status page: ${esc(run.statusUrl || 'status.md on the monitor-state branch')}.</p>`);
  const subject = wentDown.length
    ? `🔴 Rosabon dev: ${wentDown.length === 1 ? wentDown[0].name.replace(/ \(.*\)$/, '') : `${wentDown.length} items`} down${cameBack.length ? `, ${cameBack.length} back up` : ''}`
    : `🟢 Rosabon dev: ${cameBack.length === 1 ? cameBack[0].name.replace(/ \(.*\)$/, '') : `${cameBack.length} items`} back up`;
  return { subject, html: `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px">${parts.join('\n')}</div>` };
}

async function watch() {
  const at = new Date().toISOString();
  const { results, notWatched, notWatchedNote, baseline, version } = await checkAll();
  // The browser check already tried each page twice, so one failed run counts as down.
  const ui = fs.existsSync(UI_RESULTS) ? JSON.parse(fs.readFileSync(UI_RESULTS, 'utf8')) : null;
  if (ui) results.push(...ui.results.map((r) => ({ ...r, downAfter: 1 })));
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const stateFile = path.join(STATE_DIR, 'state.json');
  const state = loadState();
  const wentDown = [], cameBack = [], stillDown = [];
  const incidents = path.join(STATE_DIR, 'incidents.jsonl');

  let deployedAt;
  if (version && state.frontend?.version !== version) {
    if (state.frontend?.version) {
      deployedAt = at;
      fs.appendFileSync(incidents, JSON.stringify({ at, change: 'deployed', name: 'Admin portal', area: 'Websites', why: version }) + '\n');
    }
    state.frontend = { version, since: at };
  }
  if (ui) state.ui = { lastAt: ui.at, reason: process.env.UI_REASON || '' };

  for (const r of results) {
    const t = state.targets[r.key] || { status: 'up', fails: 0 };
    Object.assign(t, { name: r.name, area: r.area, ok: r.ok, status_code: r.status, ms: r.ms, why: r.ok ? '' : r.why, checkedAt: at, screenshot: r.screenshot });
    if (r.ok) {
      if (t.status === 'down') cameBack.push({ ...t, minutes: minutes(t.since, at) });
      Object.assign(t, { status: 'up', fails: 0, since: undefined });
    } else {
      t.fails += 1;
      if (t.fails === 1) t.since = at;
      if (t.status === 'up' && t.fails >= (r.downAfter || DOWN_AFTER)) { t.status = 'down'; wentDown.push({ ...t }); }
      else if (t.status === 'down') stillDown.push(t);
    }
    state.targets[r.key] = t;
  }
  // Endpoints dropped from the watch list (new baseline) stop being tracked; ones skipped because a sign-in
  // failed keep their state, and so do the browser pages between browser checks.
  const known = new Set([...results.map((r) => r.key), ...baseline.endpoints.map((e) => e.key)]);
  for (const k of Object.keys(state.targets)) if (!known.has(k) && !/^(sign-in|ui |site )/.test(k)) delete state.targets[k];

  for (const t of wentDown) fs.appendFileSync(incidents, JSON.stringify({ at, change: 'down', name: t.name, area: t.area, why: t.why, since: t.since }) + '\n');
  for (const t of cameBack) fs.appendFileSync(incidents, JSON.stringify({ at, change: 'up', name: t.name, area: t.area, minutes: t.minutes }) + '\n');

  const run = { at, checked: results.length, notWatched, notWatchedNote, deployedAt, statusUrl: process.env.MONITOR_STATUS_URL };
  state.lastRun = run;
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 1) + '\n');
  fs.writeFileSync(path.join(STATE_DIR, 'status.md'), statusPage(state, run));

  const down = Object.values(state.targets).filter((t) => t.status === 'down').length;
  console.log(`${lagos(at)}: ${results.length} checked, ${results.filter((r) => !r.ok).length} failing now, ${down} down · ${wentDown.length} went down, ${cameBack.length} came back`);
  for (const r of results.filter((x) => !x.ok)) console.log(`  ✖ ${r.name}: ${r.why}`);

  if (wentDown.length || cameBack.length) {
    const { subject, html } = alertEmail(wentDown, cameBack, stillDown, run);
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(path.join(OUT_DIR, 'alert.html'), html);
    const shots = wentDown.filter((r) => r.screenshot).map((r) => path.join(path.relative(process.cwd(), OUT_DIR), r.screenshot).replace(/\\/g, '/'));
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `alert=true\nsubject=${subject}\nattachments=${shots.join(',')}\n`);
    console.log('ALERT:', subject);
  } else if (process.argv.includes('--test-email')) {
    // Manual run with "send a test email": confirms the mail settings without waiting for an outage.
    const failing = results.filter((r) => !r.ok);
    const subject = `Rosabon dev uptime watch: test email (${failing.length ? `${failing.length} failing now` : 'all up'})`;
    const html = `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px"><p>This is a test email from the uptime watch. Alerts will arrive like this when something goes down or comes back.</p><p>Check at ${esc(lagos(at))} (Lagos time): ${results.length} items checked, ${failing.length} failing${notWatchedNote ? `, ${notWatchedNote}` : ''}.</p>${failing.length ? `<ul>${failing.map((r) => `<li>${esc(r.name)}: ${esc(r.why)}</li>`).join('')}</ul>` : ''}<p style="color:#555">Status page: ${esc(run.statusUrl || 'status.md on the monitor-state branch')}.</p></div>`;
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(path.join(OUT_DIR, 'alert.html'), html);
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `alert=true
subject=${subject}
`);
    console.log('TEST EMAIL:', subject);
  }
}

(CALIBRATE ? calibrate() : PLAN ? plan() : watch()).catch((e) => { console.error(e.message); process.exit(1); });
