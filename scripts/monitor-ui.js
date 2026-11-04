/**
 * Browser check for the uptime watch: signs in to the admin portal with the read-only monitor user,
 * opens the main pages and records any that are broken. Only opens pages; never clicks anything
 * that changes data.
 *
 *   node scripts/monitor-ui.js --out <dir>     → <dir>/ui-results.json (+ a screenshot per broken page)
 *
 * A page counts as broken when it throws a script error, shows an error screen or nothing at all,
 * gets a 5xx from the API while loading, or doesn't finish within 30 s. Each broken page is tried
 * once more before it is reported, so a single slow load doesn't alert. scripts/monitor.js merges
 * the results into the status page and the alert email.
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
try { require('dotenv').config({ path: path.join(root, '.env') }); } catch { /* CI: settings come from secrets */ }
const { chromium } = require('@playwright/test');

const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };
const OUT_DIR = path.resolve(arg('--out', path.join(root, 'reports/monitor-out')));
const SITE = (process.env.MONITOR_ADMIN_URL || process.env.DEV_ADMIN_URL || process.env.ADMIN_BASE_URL || '').replace(/\/+$/, '');
const API_HOST = (() => { try { return new URL(process.env.API_BASE_URL).host; } catch { return ''; } })();
const LOAD_MS = 30_000;
const AREA = 'Admin portal (browser)';

/** Pages to open, in order. `open` is a hash route, or a function for pages reached by a click; `shows` is text the page must display. */
const PAGES = [
  { name: 'Home page after sign-in', open: null },
  { name: 'Customers', open: '#/customer/directory', shows: /Customer Directory/ },
  {
    name: 'A customer’s page', open: async (page) => {
      await page.goto(`${SITE}/#/customer/directory`);
      const view = page.getByRole('button', { name: 'View' }).or(page.getByRole('link', { name: 'View' })).first();
      await view.waitFor({ timeout: LOAD_MS });
      await view.click();
    },
    shows: /Overview|KYC|Tier/i,
  },
  { name: 'Investments', open: '#/investment-management', shows: /Investment Management/ },
  { name: 'Loan applications', open: '#/loan-management/applications', shows: /Loan applications/ },
  { name: 'Product Management', open: '#/configurations/product-management', shows: /Investment products/ },
  { name: 'Pending Approvals', open: '#/rbac/approvals', shows: /Approval Queue/ },
];

/** Text the portal shows when a screen crashed or failed to load its data. */
const ERROR_SCREEN = /something went wrong|unexpected application error|failed to load|cannot read propert|is not a function|is not defined|chunkloaderror|loading chunk \d+ failed/i;

async function checkPage(page, p, signal) {
  signal.errors.length = 0;
  signal.serverErrors.length = 0;
  const started = Date.now();
  try {
    if (typeof p.open === 'function') await p.open(page);
    else if (p.open) await page.goto(`${SITE}/${p.open}`);
    await page.waitForLoadState('networkidle', { timeout: LOAD_MS }).catch(() => undefined);
    await page.waitForTimeout(1500); // late renders and errors
  } catch (e) {
    return { ok: false, ms: Date.now() - started, why: `didn’t open: ${String(e.message).split('\n')[0].slice(0, 140)}` };
  }
  const ms = Date.now() - started;
  if (/#\/login/.test(page.url())) return { ok: false, ms, why: 'sent back to the sign-in page' };
  const text = (await page.locator('body').innerText().catch(() => '')).trim();
  const problems = [];
  if (signal.errors.length) problems.push(`script error: “${signal.errors[0]}”`);
  if (signal.serverErrors.length) problems.push(`server error while loading: ${signal.serverErrors.slice(0, 3).join(', ')}`);
  const screen = text.match(ERROR_SCREEN);
  if (screen) problems.push(`error on screen: “${screen[0]}”`);
  if (text.length < 40) problems.push('blank page');
  else if (p.shows && !p.shows.test(text)) problems.push(`its content didn’t appear (expected “${p.shows.source.split('|')[0]}”)`);
  if (ms > LOAD_MS) problems.push(`slow: ${(ms / 1000).toFixed(0)} s`);
  return { ok: problems.length === 0, ms, why: problems.join('; ') };
}

(async () => {
  if (!SITE) throw new Error('DEV_ADMIN_URL (or MONITOR_ADMIN_URL) is not set');
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const signal = { errors: [], serverErrors: [] };
  page.on('pageerror', (e) => signal.errors.push(String(e.message).split('\n')[0].slice(0, 160)));
  page.on('response', (r) => {
    if (r.status() >= 500 && (!API_HOST || new URL(r.url()).host === API_HOST)) signal.serverErrors.push(`${r.status()} ${new URL(r.url()).pathname}`);
  });

  const results = [];
  const shot = async (name) => {
    const file = `ui-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`;
    await page.screenshot({ path: path.join(OUT_DIR, file) }).catch(() => undefined);
    return file;
  };

  // Sign in through the form, as a person would.
  const started = Date.now();
  let signedIn = false;
  try {
    await page.goto(`${SITE}/#/login`, { timeout: LOAD_MS });
    await page.getByPlaceholder('you@rosabon.com').fill(process.env.MONITOR_ADMIN_EMAIL || '');
    await page.getByPlaceholder('Enter your password').fill(process.env.MONITOR_ADMIN_PASSWORD || '');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL((u) => !/#\/login/.test(u.toString()), { timeout: LOAD_MS });
    signedIn = true;
    results.push({ key: 'ui sign-in', name: 'Admin portal sign-in (in the browser)', area: AREA, ok: true, ms: Date.now() - started, why: '' });
  } catch (e) {
    const onScreen = (await page.locator('body').innerText().catch(() => '')).match(/invalid[^\n]{0,60}|incorrect[^\n]{0,60}|error[^\n]{0,60}/i);
    results.push({
      key: 'ui sign-in', name: 'Admin portal sign-in (in the browser)', area: AREA, ok: false, ms: Date.now() - started,
      why: signal.errors[0] ? `script error: “${signal.errors[0]}”` : onScreen ? `“${onScreen[0].trim()}”` : 'the sign-in page didn’t move on within 30 s',
      screenshot: await shot('sign-in'),
    });
  }

  if (signedIn) {
    for (const p of PAGES) {
      let r = await checkPage(page, p, signal);
      if (!r.ok) r = await checkPage(page, p, signal); // one more try before reporting
      results.push({ key: `ui ${p.name}`, name: p.name, area: AREA, ...r, ...(r.ok ? {} : { screenshot: await shot(p.name) }) });
    }
  }
  await browser.close();
  fs.writeFileSync(path.join(OUT_DIR, 'ui-results.json'), JSON.stringify({ at: new Date().toISOString(), results }, null, 1));
  for (const r of results) console.log(`${r.ok ? '✓' : '✖'} ${r.name} (${(r.ms / 1000).toFixed(1)} s)${r.ok ? '' : `: ${r.why}`}`);
})().catch((e) => { console.error(e.message); process.exit(1); });
