#!/usr/bin/env node
/**
 * Builds reports/summary/:
 *   report.html   — the full technical Playwright report (copied from reports/playwright-html, renamed)
 *   index.html    — a plain-English results page for non-technical readers, with an
 *                   Admin portal | Mobile app switch
 *   screenshots/  — the screenshot taken at the moment each admin problem was found
 * and site/index.html — the same page for Netlify / Vercel, without screenshots or technical report.
 * site/ is committed (reports/ is git-ignored) so git-linked hosts can publish it without a build.
 *
 *   node scripts/build-summary.js [admin-results.json]   (default: reports/dev-final.json)
 *
 * Admin results: Playwright JSON. Mobile results: reports/mobile-results/*.jsonl, written by
 * mobile/config/wdio.shared.conf.ts (one line per test).
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.join(root, '.env') });
const resultsFile = path.resolve(root, process.argv[2] || 'reports/dev-final.json');
const mobileResultsDir = path.join(root, 'reports/mobile-results');
const htmlReportDir = path.join(root, 'reports/playwright-html');
const outDir = path.join(root, 'reports/summary');

/* ================================================================== ADMIN — plain-English vocabulary */

const AREAS = {
  'dev.setup.ts': { name: 'Signing in', what: 'Admins can sign in, and a wrong password is refused.' },
  'app-wide-sweep.spec.ts': { name: 'Every page opens correctly', what: 'Each of the admin portal’s sections, sub-pages and tabs opens without errors, blank screens or system failures.' },
  'customer-management.spec.ts': { name: 'Customer management', what: 'Finding customers, viewing their full profile, reviewing documents and protecting personal data.' },
  'investment-management.spec.ts': { name: 'Investments', what: 'Searching and filtering investments, viewing a plan, and booking, topping up or withdrawing on a customer’s behalf.' },
  'investment-operations.spec.ts': { name: 'Investment approvals, alerts and audit log', what: 'Approval queues, on-behalf requests, system alerts, tax settings and the record of who did what.' },
  'loan-interest-models.spec.ts': { name: 'Loan interest calculations', what: 'That loans charge interest the way the loan specification says — “Monthly equal” (Model A) or “Monthly reducing” (Model B).' },
  'loan-management.spec.ts': { name: 'Loans', what: 'Loan applications, booking a loan on a customer’s behalf, repayments and payroll reconciliation.' },
  'product-management.spec.ts': { name: 'Product setup', what: 'Creating and editing investment and loan products, loan purposes, variants, eligibility rules and required documents.' },
  'transactions-communications.spec.ts': { name: 'Transactions, billers and communications', what: 'The transaction monitor, billers, the approvals inbox, campaigns and in-app banners.' },
  'wallet-management.spec.ts': { name: 'Wallet management', what: 'The live wallet board, payment providers, routing rules, wallet settings and manual ledger tools.' },
};

/** Plain-English write-up for each known problem, matched on the test title. */
const FINDINGS = [
  {
    match: /posted repayments match the configured model/,
    title: 'A loan is being repaid at the wrong monthly amount',
    severity: 'High',
    owner: 'Engineering (loan calculation) and Product',
    impact: 'Customers may be charged the wrong amount of interest. This affects money and must be confirmed before loans go live.',
    saw: 'Loan #169 (Personal, ₦5,000,000 over 24 months at 8.5%, set to “Monthly equal”) is collecting ₦226,041.66 every month.',
    expected: 'Under the loan specification the monthly amount should be ₦633,333.33 if 8.5% is a monthly rate, or ₦243,750.00 if 8.5% is a yearly rate. The amount being collected matches neither.',
  },
  {
    match: /disbursed amount = amount − stated management fee/,
    title: 'Money is deducted from a loan payout without being shown',
    severity: 'High',
    owner: 'Engineering (loans) and Finance',
    impact: 'The customer received less than they borrowed, and the screen does not explain why.',
    saw: 'Loan #169 was approved for ₦5,000,000 with a management fee of ₦0, but only ₦4,625,000 was paid out — ₦375,000 is missing.',
    expected: 'The amount paid out should equal the loan amount minus any fee shown on the loan.',
  },
  {
    match: /Audit log: portal actions are recorded/,
    title: 'The main audit log is empty',
    severity: 'High',
    owner: 'Engineering and Compliance',
    impact: 'The portal is not keeping its official record of who did what. This is a compliance requirement.',
    saw: 'The Audit Log page says “No system actions have been recorded yet” and shows 0 entries for the past week — even though admin actions were carried out during this test.',
    expected: 'Every admin action should be recorded permanently in the audit log (Admin PRD). Entries were visible here on 21 October.',
  },
  {
    match: /Add biller/,
    title: 'A new biller disappears after it is submitted',
    severity: 'Medium',
    owner: 'Engineering (Transactions & Ledger)',
    impact: 'Admins cannot add new bill-payment providers, and they get no message telling them anything went wrong.',
    saw: 'After filling in a new biller and pressing “Submit for approval”, it does not appear in the billers list or in either approvals tab, and no message is shown.',
    expected: 'The new biller should wait in the approvals inbox for a second admin to approve it, as it did on 21 October.',
  },
  {
    match: /PII is masked; reveal\/hide is recorded/,
    title: 'Viewing a customer’s private details is not recorded',
    severity: 'Medium',
    owner: 'Engineering and Compliance (data protection)',
    impact: 'There is no record of which admin looked at a customer’s BVN or NIN, which data-protection rules expect.',
    saw: 'After revealing a customer’s hidden BVN/NIN, the customer’s Audit tab still says “No audit entries found”.',
    expected: 'Each time an admin reveals private details, it should appear in that customer’s audit history.',
  },
];

const MISMATCHES = [
  ['RWIN holding period', 'When booking an RWIN plan for a customer, the form asks them to accept a 1-day minimum holding period. The RWIN 2.0 specification says 30 days, with no exceptions.'],
  ['Early-repayment charge on loans', 'Personal and Public Sector loan products have a “Liquidation charge” (3% by default). The loan specification says customers can repay early without any penalty.'],
  ['Personal loan limits', 'A new Personal loan product starts at ₦50,000–₦6,000,000 and 3–18 months. The specification allows up to ₦30,000,000 and 3–24 months. (These can be changed by an admin.)'],
  ['Daily-interest loans', 'Nano and Payday loans can be switched to a monthly interest model in the admin portal, although the specification says they are always charged per day.'],
];

const QUESTIONS = [
  'Is the loan “Interest rate” shown in the portal a monthly rate (as in the specification’s 2% examples) or a yearly rate? Either way, loan #169 does not match.',
  'What is the minimum customer verification level (KYC tier) for a Personal loan? The specification does not say; the tests assume Tier 2.',
];

const SKIP_REASONS = [
  [/destructive|Acts on existing records/, 'Not run on purpose: this action changes real records on the test system (for example releasing a transaction or freezing an account). It can be switched on when a safe test record is available.'],
  [/No investments in status|No audit entries|No .* yet|Approval queue is empty|No .*requests|No alerts|No masked/, 'Not run: there was no suitable data on the test system to check this against.'],
];

/* ================================================================== MOBILE — plain-English vocabulary */

/** Header line for the mobile tab, from what the run recorded (device from Appium, app from MOBILE_APP_LABEL). */
const mobileContext = (rows) => {
  const device = rows.find((r) => r.device)?.device;
  const app = rows.find((r) => r.app)?.app;
  return [device ? `Device: ${device}` : 'Android device', app ? `app ${app}` : null, 'dev environment'].filter(Boolean).join(' · ');
};

const MOBILE_AREAS = {
  'persona-login.spec.ts': { name: 'Signing in', what: 'Each test customer can sign in with email and password, or with phone number and passcode.' },
  'onboarding-login.spec.ts': { name: 'Sign-up, sign-in security and sessions', what: 'Creating an account, wrong-password handling, account lock-out, staying signed in, and frozen accounts.' },
  'home-grow-borrow.spec.ts': { name: 'Home, Grow and Borrow screens', what: 'The balance and quick actions on Home, investment products and plan totals on Grow, and the loans offered on Borrow.' },
};

const MOBILE_FINDINGS = [
  {
    match: /recommended offer stays within the product limits/,
    title: 'The app offers a Payday loan ten times bigger than allowed',
    severity: 'High',
    owner: 'Engineering (loans) and Product',
    impact: 'Customers are invited to take a loan above the approved limit. This affects money and lending risk.',
    saw: 'The Borrow screen’s “Recommended for you” card says “Get ₦5,000,000 instantly” for a Payday loan (30 days, no paperwork).',
    expected: 'Payday loans are capped at ₦500,000 (Loan product specification).',
  },
  {
    match: /local-format phone number/,
    title: 'Signing in with a phone number that starts with 0 does nothing',
    severity: 'Medium',
    owner: 'Engineering (mobile app)',
    impact: 'Customers who type their number the usual way (080…) are stuck on the sign-in screen with no explanation.',
    saw: 'Entering a mobile number in the usual 080… form and tapping Continue does nothing — no next screen and no error. Only the +234 form of the same number works.',
    expected: 'The app should accept the usual Nigerian format, or clearly say which format it needs.',
  },
  {
    match: /Tier 3 customer has no identity steps left/,
    title: 'The Tier 3 test account still shows an identity step to complete',
    severity: 'Medium',
    owner: 'Product and Compliance (KYC)',
    impact: 'Either the test account is not really Tier 3, or the “Complete your profile” card does not follow the customer’s verification level — which would confuse fully verified customers.',
    saw: 'The Home screen shows “Complete your profile — 2/3, 1 key identity step left” for the Tier 3 test account.',
    expected: 'A fully verified (Tier 3) customer should have every identity step complete.',
  },
];

/** Problems seen during the mobile run that no automated check covers yet (from the app’s own error log). */
const MOBILE_EXTRA_FINDINGS = [
  {
    title: 'Identity verification (SmileID) fails to start in this app build',
    severity: 'High',
    owner: 'Engineering (mobile app build)',
    impact: 'Selfie / ID verification for upgrading a customer’s KYC tier is likely to fail in this build.',
    saw: 'Every time the app starts, its error log reports “SmileID initialize error: smile_config.json not found in assets”. The file is missing from the app package.',
    expected: 'The SmileID configuration file should be included in the build so identity checks can run.',
    area: 'App start-up (seen in the app’s error log)',
  },
];

const MOBILE_MISMATCHES = [
  ['Password error wording', 'After a wrong password, the app says “Incorrect passcode. 3 attempt(s) left.” — it should say password; “passcode” is the 6-digit code used with a phone number.'],
  ['Shared attempt counter', 'Wrong attempts with email + password and with phone + passcode count towards the same limit (4 attempts in total). Product should confirm this is intended.'],
];

const MOBILE_QUESTIONS = [
  'Is the “Complete your profile” card meant to follow the customer’s KYC tier? The Tier 3 test account shows 2 of 3 steps done.',
  'Should sign-in accept phone numbers starting with 0, or only the +234 format?',
];

const MOBILE_SKIP_REASONS = [
  [/onboarding-login\.spec\.ts/, 'Not run: needs backend test tools (to create fresh test customers and control the clock) that the backend team has not provided yet.'],
  [/HELD/, 'Held back on purpose: this test account has only 1 sign-in attempt left, and a wrong try would lock it. It will run once the account is confirmed or reset.'],
  [/phone \+ passcode/, 'Not run: no phone number and passcode are on file for this test account yet.'],
  [/email \+ password/, 'Not run: no email and password are on file for this test account.'],
];

/* ================================================================== helpers */

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const strip = (s) => (s || '').replace(/\x1b\[[0-9;]*m/g, '');
const cleanTitle = (t) => t.replace(/\s@\S+/g, '').replace(/\bT(\d) customer\b/g, 'Tier $1 test account').trim();
const count = (st, list) => list.filter((t) => t.status === st).length;
const fmt = (d) => d.toLocaleString('en-GB', { timeZone: 'Africa/Lagos', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const sevRank = (s) => (s === 'High' ? 0 : 1);

fs.mkdirSync(path.join(outDir, 'screenshots'), { recursive: true });

/* ================================================================== read ADMIN results */

function readAdmin() {
  if (!fs.existsSync(resultsFile)) return null;
  const results = JSON.parse(fs.readFileSync(resultsFile, 'utf8'));
  const tests = [];
  (function walk(suite) {
    for (const s of suite.suites || []) walk(s);
    for (const spec of suite.specs || []) {
      for (const t of spec.tests) {
        const res = t.results[t.results.length - 1] || {};
        const status = t.status === 'unexpected' ? 'problem' : res.status === 'skipped' ? 'not-run' : 'passed';
        tests.push({
          file: path.basename(spec.file),
          title: cleanTitle(spec.title),
          rawTitle: spec.title,
          status,
          skipReason: (t.annotations || []).filter((a) => a.type === 'skip').map((a) => a.description).join(' '),
          error: strip(((res.errors || [])[0] || res.error || {}).message || '').split('\n').filter((l) => l.trim())[0] || '',
          screenshot: (res.attachments || []).find((a) => a.name === 'screenshot' && a.path)?.path,
        });
      }
    }
  })(results);

  // Technical report, renamed so index.html can be the summary.
  if (fs.existsSync(path.join(htmlReportDir, 'index.html'))) {
    for (const entry of fs.readdirSync(htmlReportDir)) {
      fs.cpSync(path.join(htmlReportDir, entry), path.join(outDir, entry === 'index.html' ? 'report.html' : entry), { recursive: true });
    }
  }

  const findings = tests.filter((t) => t.status === 'problem').map((t) => {
    const f = FINDINGS.find((x) => x.match.test(t.rawTitle)) || genericFinding(t);
    let shot = null;
    if (t.screenshot && fs.existsSync(t.screenshot)) {
      shot = `screenshots/${path.basename(path.dirname(t.screenshot)).slice(0, 40)}.png`;
      fs.copyFileSync(t.screenshot, path.join(outDir, shot));
    }
    return { ...f, area: AREAS[t.file]?.name || t.file, shot };
  }).sort((a, b) => sevRank(a.severity) - sevRank(b.severity));

  return {
    id: 'admin',
    label: 'Admin portal',
    heading: 'Admin Portal Test Results',
    context: 'Chrome browser · dev environment',
    runText: `Automated check run on ${fmt(new Date(results.stats.startTime))} (WAT) · took about ${Math.round(results.stats.duration / 60000)} minutes`,
    intro: 'An automated tester used the admin portal the way a staff member would — opening pages, filling in forms and checking the results against the product documents.',
    tests, findings, areas: AREAS, mismatches: MISMATCHES, questions: QUESTIONS,
    notRunReason: (t) => (SKIP_REASONS.find(([re]) => re.test(t.rawTitle + ' ' + t.skipReason)) || [null, 'Not run: ' + (t.skipReason || 'see technical report')])[1],
    techInternal: '<p class="muted">The full technical report has every step of every check, with screenshots, recordings and timings.</p>\n    <a class="tech" href="report.html">Open the technical report →</a>',
    techPublic: '<p class="muted">Screenshots and the full technical report (every step, with recordings and timings) are kept internally because they contain customer details and system access data. Ask the QA team for access.</p>',
  };
}

/* ================================================================== read MOBILE results */

function readMobile() {
  if (!fs.existsSync(mobileResultsDir)) return null;
  const byKey = new Map();
  for (const f of fs.readdirSync(mobileResultsDir).filter((x) => x.endsWith('.jsonl'))) {
    for (const line of fs.readFileSync(path.join(mobileResultsDir, f), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      const r = JSON.parse(line);
      byKey.set(`${r.file}|${r.suite}|${r.title}`, r); // a retried test keeps its last result
    }
  }
  if (!byKey.size) return null;
  const held = (process.env.MOBILE_HOLD_PERSONAS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const rows = [...byKey.values()];
  const tests = rows.map((r) => ({
    file: r.file,
    title: cleanTitle(r.title),
    rawTitle: r.title,
    status: r.status === 'failed' ? 'problem' : r.status === 'skipped' ? 'not-run' : 'passed',
    held: held.some((p) => new RegExp(`^${p} customer\\b`).test(r.title)),
    error: r.error || '',
  }));
  const fromChecks = tests.filter((t) => t.status === 'problem').map((t) => ({
    ...(MOBILE_FINDINGS.find((x) => x.match.test(t.rawTitle)) || genericFinding(t)),
    area: MOBILE_AREAS[t.file]?.name || t.file,
  }));
  const findings = [...fromChecks, ...MOBILE_EXTRA_FINDINGS].sort((a, b) => sevRank(a.severity) - sevRank(b.severity));

  const times = rows.map((r) => new Date(r.at)).sort((a, b) => a - b);
  const mins = Math.max(1, Math.round((times[times.length - 1] - times[0]) / 60000));
  return {
    id: 'mobile',
    label: 'Mobile app',
    heading: 'Mobile App Test Results',
    context: mobileContext(rows),
    runText: `Automated check run on ${fmt(times[0])} (WAT) · took about ${mins} minutes`,
    intro: 'An automated tester used the Rosabon app on an Android phone the way a customer would — signing in, moving between screens and checking what they show against the product documents. Nothing was booked, borrowed or paid during these checks.',
    tests, findings, extraCount: MOBILE_EXTRA_FINDINGS.length,
    areas: MOBILE_AREAS, mismatches: MOBILE_MISMATCHES, questions: MOBILE_QUESTIONS,
    notRunReason: (t) => (MOBILE_SKIP_REASONS.find(([re]) => re.test(`${t.held ? 'HELD ' : ''}${t.file} ${t.rawTitle}`)) || [null, 'Not run in this round.'])[1],
    techInternal: '<p class="muted">The mobile app blocks screenshots for security, so failures are recorded as the screen’s layout instead. These are in <code>reports/mobile-screens/</code> with the QA team.</p>',
    techPublic: '<p class="muted">Step-by-step technical detail is kept internally. Ask the QA team for access.</p>',
  };
}

function genericFinding(t) {
  return {
    title: t.title, severity: 'Medium', owner: 'Engineering',
    impact: 'An automated check did not get the result the specification expects.',
    saw: t.error, expected: 'See the technical report for details.',
  };
}

/* ================================================================== one tab’s content */

function panel(d, pub) {
  const { tests, findings } = d;
  const total = tests.length;
  const passed = count('passed', tests);
  const failed = count('problem', tests);
  const notRun = count('not-run', tests);
  const checked = total - notRun;
  const passRate = checked ? Math.round((passed / checked) * 100) : 0;
  const high = findings.filter((f) => f.severity === 'High').length;
  const n = findings.length;
  const extra = d.extraCount ? ` (including ${d.extraCount} seen in the app’s error log)` : '';
  const verdict = n === 0
    ? { tone: 'good', head: 'Everything checked is working as expected', sub: `All ${checked} checks passed.` }
    : { tone: 'warn', head: `Mostly working — ${n} problem${n > 1 ? 's' : ''} need attention${extra}`, sub: high ? `${high} of them affect money or compliance and should be fixed before release.` : 'None of them affect money or compliance.' };

  const areaRows = Object.entries(d.areas).map(([file, a]) => {
    const list = tests.filter((t) => t.file === file);
    if (!list.length) return '';
    const p = count('problem', list);
    const nr = count('not-run', list);
    const ran = list.length - nr;
    const badge = p ? `<span class="badge bad">${p} problem${p > 1 ? 's' : ''}</span>` : ran ? '<span class="badge ok">All good</span>' : '<span class="badge idle">Not run yet</span>';
    return `<tr><td><strong>${esc(a.name)}</strong><div class="muted">${esc(a.what)}</div></td><td class="num">${ran}</td><td class="num">${count('passed', list)}</td><td>${badge}${nr ? `<div class="muted small">${nr} not run</div>` : ''}</td></tr>`;
  }).join('');

  const cards = findings.map((f, i) => `
      <article class="card finding">
        <header>
          <span class="sev ${f.severity === 'High' ? 'high' : 'med'}">${esc(f.severity)} priority</span>
          <h3>${i + 1}. ${esc(f.title)}</h3>
          <p class="muted">Area: ${esc(f.area)} · Who should look at this: ${esc(f.owner)}</p>
        </header>
        <p class="impact">${esc(f.impact)}</p>
        <dl>
          <dt>What we saw</dt><dd>${esc(f.saw)}</dd>
          <dt>What should happen</dt><dd>${esc(f.expected)}</dd>
        </dl>
        ${f.shot && !pub ? `<details><summary>Show screenshot</summary><a href="${f.shot}" target="_blank" rel="noopener"><img src="${f.shot}" alt="Screenshot taken when problem ${i + 1} was found" loading="lazy"></a></details>` : ''}
      </article>`).join('');

  const notRunRows = tests.filter((t) => t.status === 'not-run')
    .map((t) => `<li><strong>${esc(t.title)}</strong> <span class="muted">(${esc(d.areas[t.file]?.name || t.file)})</span><br><span class="muted">${esc(d.notRunReason(t))}</span></li>`)
    .join('');

  const pct = (x) => (total ? (x / total) * 100 : 0);
  return `
    <p class="muted small">${esc(d.context)}</p>
    <h2 class="panel-title">${esc(d.heading)}</h2>
    <p class="muted">${esc(d.runText)}</p>

    <section class="card verdict ${verdict.tone}">
      <h3>${esc(verdict.head)}</h3>
      <p>${esc(verdict.sub)}</p>
    </section>

    <div class="stats">
      <div class="stat"><div class="n">${total}</div><div class="muted">checks in total</div></div>
      <div class="stat ok"><div class="n">${passed}</div><div class="muted">worked as expected</div></div>
      <div class="stat bad"><div class="n">${failed}</div><div class="muted">checks with a problem</div></div>
      <div class="stat"><div class="n">${notRun}</div><div class="muted">not run (see below)</div></div>
    </div>
    <div class="bar" role="img" aria-label="${passed} passed, ${failed} problems, ${notRun} not run">
      <span class="p" style="width:${pct(passed)}%"></span><span class="f" style="width:${pct(failed)}%"></span><span class="s" style="width:${pct(notRun)}%"></span>
    </div>
    <div class="legend muted"><span><i class="dot" style="background:var(--good)"></i>Worked (${passRate}% of checks that ran)</span><span><i class="dot" style="background:var(--bad)"></i>Problem</span><span><i class="dot" style="background:var(--muted)"></i>Not run</span></div>

    <h2>What was checked</h2>
    <p class="muted">${esc(d.intro)}</p>
    <div class="table-wrap">
    <table>
      <thead><tr><th>Area</th><th class="num">Checks run</th><th class="num">Worked</th><th>Result</th></tr></thead>
      <tbody>${areaRows}</tbody>
    </table>
    </div>

    <h2>Problems found</h2>
    <p class="muted">These did not behave the way the product documents say they should. “High priority” means it affects customers’ money or a compliance requirement.</p>
    ${cards || '<p>No problems were found.</p>'}

    <h2>Differences from the documents (not failures)</h2>
    <p class="muted">These work, but don’t match what the specifications say. Product should confirm which is correct.</p>
    <ul class="clean">${d.mismatches.map(([t, x]) => `<li><strong>${esc(t)}.</strong> ${esc(x)}</li>`).join('')}</ul>

    <h2>Questions for the product team</h2>
    <ul class="clean">${d.questions.map((q) => `<li>${esc(q)}</li>`).join('')}</ul>

    <h2>Not run in this round</h2>
    <ul class="clean">${notRunRows || '<li>Everything was run.</li>'}</ul>

    <h2>Need the technical detail?</h2>
    ${pub ? d.techPublic : d.techInternal}`;
}

function emptyPanel(label, how) {
  return `<h2 class="panel-title">${esc(label)} Test Results</h2><section class="card verdict"><h3>No results yet</h3><p class="muted">${esc(how)}</p></section>`;
}

/* ================================================================== page */

const admin = readAdmin();
const mobile = readMobile();
const tabs = [
  { id: 'admin', label: 'Admin portal', icon: '🖥', data: admin, empty: 'Run the admin portal checks (npm run test:admin:dev) to fill this in.' },
  { id: 'mobile', label: 'Mobile app', icon: '📱', data: mobile, empty: 'Run the mobile checks (npx wdio run mobile/config/wdio.android.conf.ts) to fill this in.' },
];
const pill = (d) => {
  if (!d) return '<span class="pill idle">no run yet</span>';
  const n = d.findings.length;
  return n ? `<span class="pill bad">${n} problem${n > 1 ? 's' : ''}</span>` : '<span class="pill ok">all good</span>';
};

const render = (pub) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Rosabon Test Results</title>
${pub ? '<meta name="robots" content="noindex, nofollow">' : ''}
<style>
  :root {
    --bg: #f6f7f9; --surface: #ffffff; --text: #1d2433; --muted: #5d6677; --line: #e3e6ec;
    --accent: #1f3a6d; --good: #1d7a46; --good-bg: #e6f4ec; --warn: #9a5b00; --warn-bg: #fff4e0;
    --bad: #b42318; --bad-bg: #fdecea; --med: #8a5a00; --med-bg: #fff4e0; --idle-bg: #eceef2;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --bg: #11151c; --surface: #1a2029; --text: #e7eaf0; --muted: #9aa4b5; --line: #2c3442;
      --accent: #9db8ec; --good: #6fd29b; --good-bg: #173326; --warn: #ffc56b; --warn-bg: #3a2c12;
      --bad: #ff8a80; --bad-bg: #3d1d1b; --med: #ffc56b; --med-bg: #3a2c12; --idle-bg: #252c38;
    }
  }
  :root[data-theme="dark"] {
    --bg: #11151c; --surface: #1a2029; --text: #e7eaf0; --muted: #9aa4b5; --line: #2c3442;
    --accent: #9db8ec; --good: #6fd29b; --good-bg: #173326; --warn: #ffc56b; --warn-bg: #3a2c12;
    --bad: #ff8a80; --bad-bg: #3d1d1b; --med: #ffc56b; --med-bg: #3a2c12; --idle-bg: #252c38;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.6 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { max-width: 960px; margin: 0 auto; padding: 32px 16px 64px; }
  h1 { font-size: 1.9rem; line-height: 1.25; margin: 0 0 4px; color: var(--accent); }
  h2 { font-size: 1.3rem; margin: 40px 0 6px; }
  h2.panel-title { margin-top: 4px; font-size: 1.5rem; }
  h3 { font-size: 1.08rem; margin: 6px 0 2px; }
  p { margin: 6px 0; }
  .muted { color: var(--muted); }
  .small { font-size: .85rem; }

  /* Admin | Mobile switch */
  .tabs { display: flex; gap: 6px; padding: 6px; margin: 24px 0 20px; background: var(--surface); border: 1px solid var(--line); border-radius: 14px; position: sticky; top: 8px; z-index: 5; }
  .tab { flex: 1; display: flex; align-items: center; justify-content: center; flex-wrap: wrap; gap: 8px; padding: 12px 14px; border: 0; border-radius: 10px; background: transparent; color: var(--muted); font: inherit; font-weight: 600; cursor: pointer; }
  .tab:hover { background: var(--bg); color: var(--text); }
  .tab[aria-selected="true"] { background: var(--accent); color: var(--surface); }
  .tab:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
  .pill { font-size: .75rem; font-weight: 700; padding: 1px 9px; border-radius: 999px; white-space: nowrap; }
  .pill.bad { background: var(--bad-bg); color: var(--bad); } .pill.ok { background: var(--good-bg); color: var(--good); } .pill.idle { background: var(--idle-bg); color: var(--muted); }
  .tab[aria-selected="true"] .pill { background: var(--surface); }
  [role="tabpanel"][hidden] { display: none; }
  .nojs-divider { border: 0; border-top: 2px dashed var(--line); margin: 48px 0; }
  .js .nojs-divider { display: none; }

  .card { background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 20px; margin: 14px 0; }
  .verdict { border-left: 6px solid var(--warn); background: var(--warn-bg); }
  .verdict.good { border-left-color: var(--good); background: var(--good-bg); }
  .verdict h3 { margin: 0 0 4px; font-size: 1.25rem; }
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-top: 14px; }
  .stat { background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 16px; }
  .stat .n { font-size: 2rem; font-weight: 700; line-height: 1.1; font-variant-numeric: tabular-nums; }
  .stat.ok .n { color: var(--good); } .stat.bad .n { color: var(--bad); }
  .bar { display: flex; height: 12px; border-radius: 6px; overflow: hidden; background: var(--line); margin-top: 16px; }
  .bar span { display: block; }
  .bar .p { background: var(--good); } .bar .f { background: var(--bad); } .bar .s { background: var(--muted); opacity: .45; }
  .legend { display: flex; flex-wrap: wrap; gap: 16px; font-size: .85rem; margin-top: 6px; }
  .dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 6px; vertical-align: middle; }
  .table-wrap { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; background: var(--surface); border: 1px solid var(--line); border-radius: 12px; overflow: hidden; }
  th, td { text-align: left; padding: 12px 14px; border-bottom: 1px solid var(--line); vertical-align: top; }
  th { font-size: .8rem; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  tr:last-child td { border-bottom: 0; }
  .badge { display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: .85rem; font-weight: 600; white-space: nowrap; }
  .badge.ok { background: var(--good-bg); color: var(--good); } .badge.bad { background: var(--bad-bg); color: var(--bad); } .badge.idle { background: var(--idle-bg); color: var(--muted); }
  .sev { display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: .78rem; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; }
  .sev.high { background: var(--bad-bg); color: var(--bad); } .sev.med { background: var(--med-bg); color: var(--med); }
  .finding .impact { font-weight: 600; }
  dl { margin: 10px 0 0; } dt { font-weight: 600; margin-top: 10px; } dd { margin: 2px 0 0; }
  details { margin-top: 12px; } summary { cursor: pointer; color: var(--accent); font-weight: 600; }
  details img { width: 100%; height: auto; border: 1px solid var(--line); border-radius: 8px; margin-top: 10px; }
  ul.clean { padding-left: 20px; } ul.clean li { margin: 10px 0; }
  a { color: var(--accent); }
  code { font-size: .9em; }
  .tech { display: inline-block; margin-top: 8px; padding: 10px 16px; border-radius: 8px; border: 1px solid var(--line); background: var(--surface); text-decoration: none; font-weight: 600; }
  footer { margin-top: 48px; font-size: .85rem; color: var(--muted); }
  @media (max-width: 520px) { .tab { padding: 10px 8px; font-size: .95rem; } }
</style>
</head>
<body>
<main>
  <p class="muted small">Rosabon Unified · Test environment (dev)</p>
  <h1>Automated Test Results</h1>
  <p class="muted">Choose which part of the product to see. The admin portal is the staff website; the mobile app is what customers use.</p>

  <div class="tabs" role="tablist" aria-label="Which results to show">
    ${tabs.map((t, i) => `<button class="tab" role="tab" id="tab-${t.id}" aria-controls="panel-${t.id}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}"><span aria-hidden="true">${t.icon}</span> ${esc(t.label)} ${pill(t.data)}</button>`).join('\n    ')}
  </div>

  ${tabs.map((t, i) => `${i ? '<hr class="nojs-divider">' : ''}<section role="tabpanel" id="panel-${t.id}" aria-labelledby="tab-${t.id}" tabindex="0">
    ${t.data ? panel(t.data, pub) : emptyPanel(t.label, t.empty)}
  </section>`).join('\n  ')}

  <footer>
    Generated automatically from the test results by <code>scripts/build-summary.js</code>. Sources: Admin PRD, Unified app PRD, Investment and Loan product specifications, KYC specification, QA Strategy.
  </footer>
</main>
<script>
  (function () {
    document.documentElement.classList.add('js');
    var tabs = Array.prototype.slice.call(document.querySelectorAll('[role="tab"]'));
    function show(id, focus) {
      tabs.forEach(function (t) {
        var on = t.id === 'tab-' + id;
        t.setAttribute('aria-selected', on);
        t.tabIndex = on ? 0 : -1;
        document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
        if (on && focus) t.focus();
      });
      if (location.hash !== '#' + id) history.replaceState(null, '', '#' + id);
    }
    tabs.forEach(function (t, i) {
      t.addEventListener('click', function () { show(t.id.slice(4)); });
      t.addEventListener('keydown', function (e) {
        var d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (d) { e.preventDefault(); show(tabs[(i + d + tabs.length) % tabs.length].id.slice(4), true); }
      });
    });
    var start = (location.hash || '').slice(1);
    show(document.getElementById('tab-' + start) ? start : 'admin');
  })();
</script>
</body>
</html>
`;

const summarise = (d) => (d ? `${count('passed', d.tests)} passed, ${count('problem', d.tests)} problems, ${count('not-run', d.tests)} not run` : 'no results');
fs.writeFileSync(path.join(outDir, 'index.html'), render(false));
console.log(`Wrote ${path.relative(root, path.join(outDir, 'index.html'))}`);
console.log(`  Admin portal: ${summarise(admin)}`);
console.log(`  Mobile app:   ${summarise(mobile)}`);
if (admin) console.log(`Technical report: ${path.relative(root, path.join(outDir, 'report.html'))}`);

// Public site for Netlify: the summary page only — no screenshots, traces, videos or technical report.
const siteDir = path.join(root, 'site');
fs.mkdirSync(siteDir, { recursive: true });
fs.writeFileSync(path.join(siteDir, 'index.html'), render(true));
console.log(`Public site (Netlify / Vercel — commit it to publish): ${path.relative(root, siteDir)}/index.html`);
