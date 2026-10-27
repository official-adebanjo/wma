#!/usr/bin/env node
/**
 * Builds reports/summary/:
 *   report.html   — the full technical Playwright report (copied from reports/playwright-html, renamed)
 *   index.html    — a plain-English results page for non-technical readers
 *   screenshots/  — the screenshot taken at the moment each problem was found
 *
 *   node scripts/build-summary.js [results.json]      (default: reports/dev-final.json)
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const resultsFile = path.resolve(root, process.argv[2] || 'reports/dev-final.json');
const htmlReportDir = path.join(root, 'reports/playwright-html');
const outDir = path.join(root, 'reports/summary');

/* ------------------------------------------------------------------ plain-English vocabulary */

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

/* ------------------------------------------------------------------ read results */

if (!fs.existsSync(resultsFile)) throw new Error(`Results file not found: ${resultsFile}`);
const results = JSON.parse(fs.readFileSync(resultsFile, 'utf8'));
const strip = (s) => (s || '').replace(/\x1b\[[0-9;]*m/g, '');

const tests = [];
(function walk(suite) {
  for (const s of suite.suites || []) walk(s);
  for (const spec of suite.specs || []) {
    for (const t of spec.tests) {
      const res = t.results[t.results.length - 1] || {};
      const status = t.status === 'unexpected' ? 'problem' : res.status === 'skipped' ? 'not-run' : 'passed';
      tests.push({
        file: path.basename(spec.file),
        title: spec.title.replace(/\s@\S+/g, '').trim(),
        rawTitle: spec.title,
        status,
        skipReason: (t.annotations || []).filter((a) => a.type === 'skip').map((a) => a.description).join(' '),
        error: strip(((res.errors || [])[0] || res.error || {}).message || '').split('\n').filter((l) => l.trim())[0] || '',
        screenshot: (res.attachments || []).find((a) => a.name === 'screenshot' && a.path)?.path,
      });
    }
  }
})(results);

/* ------------------------------------------------------------------ copy technical report + screenshots */

fs.mkdirSync(path.join(outDir, 'screenshots'), { recursive: true });
if (fs.existsSync(path.join(htmlReportDir, 'index.html'))) {
  for (const entry of fs.readdirSync(htmlReportDir)) {
    const from = path.join(htmlReportDir, entry);
    const to = path.join(outDir, entry === 'index.html' ? 'report.html' : entry);
    fs.cpSync(from, to, { recursive: true });
  }
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const problems = tests.filter((t) => t.status === 'problem');
const findings = problems.map((t) => {
  const f = FINDINGS.find((x) => x.match.test(t.rawTitle)) || {
    title: t.title, severity: 'Medium', owner: 'Engineering',
    impact: 'An automated check did not get the result the specification expects.',
    saw: t.error, expected: 'See the technical report for details.',
  };
  let shot = null;
  if (t.screenshot && fs.existsSync(t.screenshot)) {
    shot = `screenshots/${path.basename(path.dirname(t.screenshot)).slice(0, 40)}.png`;
    fs.copyFileSync(t.screenshot, path.join(outDir, shot));
  }
  return { ...f, area: AREAS[t.file]?.name || t.file, shot };
}).sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'High' ? -1 : 1));

/* ------------------------------------------------------------------ figures */

const count = (st, list = tests) => list.filter((t) => t.status === st).length;
const total = tests.length;
const passed = count('passed');
const notRun = count('not-run');
const checked = total - notRun;
const passRate = checked ? Math.round((passed / checked) * 100) : 0;
const high = findings.filter((f) => f.severity === 'High').length;
const runDate = new Date(results.stats.startTime);
const fmtDate = runDate.toLocaleString('en-GB', { timeZone: 'Africa/Lagos', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const minutes = Math.round(results.stats.duration / 60000);

const verdict = problems.length === 0
  ? { tone: 'good', head: 'Everything checked is working as expected', sub: `All ${checked} checks passed.` }
  : high > 0
    ? { tone: 'warn', head: `Mostly working — ${problems.length} problem${problems.length > 1 ? 's' : ''} need attention`, sub: `${high} of them affect money or compliance and should be fixed before release.` }
    : { tone: 'warn', head: `Mostly working — ${problems.length} minor problem${problems.length > 1 ? 's' : ''}`, sub: 'None of them affect money or compliance.' };

const areaRows = Object.entries(AREAS)
  .map(([file, a]) => {
    const list = tests.filter((t) => t.file === file);
    if (!list.length) return '';
    const p = count('problem', list);
    const badge = p ? `<span class="badge bad">${p} problem${p > 1 ? 's' : ''}</span>` : '<span class="badge ok">All good</span>';
    return `<tr><td><strong>${esc(a.name)}</strong><div class="muted">${esc(a.what)}</div></td><td class="num">${list.length - count('not-run', list)}</td><td class="num">${count('passed', list)}</td><td>${badge}${count('not-run', list) ? `<div class="muted small">${count('not-run', list)} not run</div>` : ''}</td></tr>`;
  })
  .join('');

/** pub = public (Netlify) build: no screenshots, because they show customer names and contact details. */
const findingCards = (pub) => findings
  .map((f, i) => `
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
    </article>`)
  .join('');

const notRunRows = tests
  .filter((t) => t.status === 'not-run')
  .map((t) => {
    const why = (SKIP_REASONS.find(([re]) => re.test(t.rawTitle + ' ' + t.skipReason)) || [null, 'Not run: ' + (t.skipReason || 'see technical report')])[1];
    return `<li><strong>${esc(t.title)}</strong> <span class="muted">(${esc(AREAS[t.file]?.name || t.file)})</span><br><span class="muted">${esc(why)}</span></li>`;
  })
  .join('');

/* ------------------------------------------------------------------ page */

const render = (pub) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Admin Portal Test Results</title>
${pub ? '<meta name="robots" content="noindex, nofollow">' : ''}
<style>
  :root {
    --bg: #f6f7f9; --surface: #ffffff; --text: #1d2433; --muted: #5d6677; --line: #e3e6ec;
    --accent: #1f3a6d; --good: #1d7a46; --good-bg: #e6f4ec; --warn: #9a5b00; --warn-bg: #fff4e0;
    --bad: #b42318; --bad-bg: #fdecea; --med: #8a5a00; --med-bg: #fff4e0;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --bg: #11151c; --surface: #1a2029; --text: #e7eaf0; --muted: #9aa4b5; --line: #2c3442;
      --accent: #9db8ec; --good: #6fd29b; --good-bg: #173326; --warn: #ffc56b; --warn-bg: #3a2c12;
      --bad: #ff8a80; --bad-bg: #3d1d1b; --med: #ffc56b; --med-bg: #3a2c12;
    }
  }
  :root[data-theme="dark"] {
    --bg: #11151c; --surface: #1a2029; --text: #e7eaf0; --muted: #9aa4b5; --line: #2c3442;
    --accent: #9db8ec; --good: #6fd29b; --good-bg: #173326; --warn: #ffc56b; --warn-bg: #3a2c12;
    --bad: #ff8a80; --bad-bg: #3d1d1b; --med: #ffc56b; --med-bg: #3a2c12;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.6 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { max-width: 960px; margin: 0 auto; padding: 32px 16px 64px; }
  h1 { font-size: 1.9rem; line-height: 1.25; margin: 0 0 4px; color: var(--accent); }
  h2 { font-size: 1.3rem; margin: 40px 0 6px; }
  h3 { font-size: 1.08rem; margin: 6px 0 2px; }
  p { margin: 6px 0; }
  .muted { color: var(--muted); }
  .small { font-size: .85rem; }
  .card { background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 20px; margin: 14px 0; }
  .verdict { border-left: 6px solid var(--warn); background: var(--warn-bg); }
  .verdict.good { border-left-color: var(--good); background: var(--good-bg); }
  .verdict h2 { margin: 0 0 4px; }
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
  .badge.ok { background: var(--good-bg); color: var(--good); } .badge.bad { background: var(--bad-bg); color: var(--bad); }
  .sev { display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: .78rem; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; }
  .sev.high { background: var(--bad-bg); color: var(--bad); } .sev.med { background: var(--med-bg); color: var(--med); }
  .finding .impact { font-weight: 600; }
  dl { margin: 10px 0 0; } dt { font-weight: 600; margin-top: 10px; } dd { margin: 2px 0 0; }
  details { margin-top: 12px; } summary { cursor: pointer; color: var(--accent); font-weight: 600; }
  details img { width: 100%; height: auto; border: 1px solid var(--line); border-radius: 8px; margin-top: 10px; }
  ul.clean { padding-left: 20px; } ul.clean li { margin: 10px 0; }
  a { color: var(--accent); }
  .tech { display: inline-block; margin-top: 8px; padding: 10px 16px; border-radius: 8px; border: 1px solid var(--line); background: var(--surface); text-decoration: none; font-weight: 600; }
  footer { margin-top: 48px; font-size: .85rem; color: var(--muted); }
</style>
</head>
<body>
<main>
  <p class="muted small">Rosabon Unified · Admin Portal · Test environment (dev)</p>
  <h1>Admin Portal Test Results</h1>
  <p class="muted">Automated check run on ${esc(fmtDate)} (WAT) · took about ${minutes} minutes</p>

  <section class="card verdict ${verdict.tone}">
    <h2>${esc(verdict.head)}</h2>
    <p>${esc(verdict.sub)}</p>
  </section>

  <div class="stats">
    <div class="stat"><div class="n">${total}</div><div class="muted">checks in total</div></div>
    <div class="stat ok"><div class="n">${passed}</div><div class="muted">worked as expected</div></div>
    <div class="stat bad"><div class="n">${problems.length}</div><div class="muted">problems found</div></div>
    <div class="stat"><div class="n">${notRun}</div><div class="muted">not run (see below)</div></div>
  </div>
  <div class="bar" role="img" aria-label="${passed} passed, ${problems.length} problems, ${notRun} not run">
    <span class="p" style="width:${(passed / total) * 100}%"></span><span class="f" style="width:${(problems.length / total) * 100}%"></span><span class="s" style="width:${(notRun / total) * 100}%"></span>
  </div>
  <div class="legend muted"><span><i class="dot" style="background:var(--good)"></i>Worked (${passRate}% of checks that ran)</span><span><i class="dot" style="background:var(--bad)"></i>Problem</span><span><i class="dot" style="background:var(--muted)"></i>Not run</span></div>

  <h2>What was checked</h2>
  <p class="muted">An automated tester used the admin portal the way a staff member would — opening pages, filling in forms and checking the results against the product documents.</p>
  <div class="table-wrap">
  <table>
    <thead><tr><th>Area</th><th class="num">Checks run</th><th class="num">Worked</th><th>Result</th></tr></thead>
    <tbody>${areaRows}</tbody>
  </table>
  </div>

  <h2>Problems found</h2>
  <p class="muted">These did not behave the way the product documents say they should. “High priority” means it affects customers’ money or a compliance requirement.</p>
  ${findingCards(pub) || '<p>No problems were found.</p>'}

  <h2>Differences from the documents (not failures)</h2>
  <p class="muted">These work, but don’t match what the specifications say. Product should confirm which is correct.</p>
  <ul class="clean">${MISMATCHES.map(([t, d]) => `<li><strong>${esc(t)}.</strong> ${esc(d)}</li>`).join('')}</ul>

  <h2>Questions for the product team</h2>
  <ul class="clean">${QUESTIONS.map((q) => `<li>${esc(q)}</li>`).join('')}</ul>

  <h2>Not run in this round</h2>
  <ul class="clean">${notRunRows || '<li>Everything was run.</li>'}</ul>

  <h2>Need the technical detail?</h2>
  ${pub
    ? '<p class="muted">Screenshots and the full technical report (every step, with recordings and timings) are kept internally because they contain customer details and system access data. Ask the QA team for access.</p>'
    : '<p class="muted">The full technical report has every step of every check, with screenshots, recordings and timings.</p>\n  <a class="tech" href="report.html">Open the technical report →</a>'}

  <footer>
    Generated automatically from the test results by <code>scripts/build-summary.js</code>. Sources: Admin PRD, Investment and Loan product specifications, KYC specification, QA Strategy.
  </footer>
</main>
</body>
</html>
`;

fs.writeFileSync(path.join(outDir, 'index.html'), render(false));
console.log(`Wrote ${path.relative(root, path.join(outDir, 'index.html'))} — ${passed} passed, ${problems.length} problems, ${notRun} not run`);
console.log(`Technical report: ${path.relative(root, path.join(outDir, 'report.html'))}`);

// Public site for Netlify: the summary page only — no screenshots, traces, videos or technical report.
const siteDir = path.join(root, 'reports/site');
fs.rmSync(siteDir, { recursive: true, force: true });
fs.mkdirSync(siteDir, { recursive: true });
fs.writeFileSync(path.join(siteDir, 'index.html'), render(true));
console.log(`Public site (Netlify): ${path.relative(root, siteDir)}/index.html`);
