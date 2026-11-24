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
const assetsDir = path.join(root, 'report-assets'); // favicons (scripts/make-favicons.js)

/** Copy the icons next to a built page and write its web manifest ("Add to home screen"). */
function writeIcons(dir) {
  for (const f of ['favicon.svg', 'favicon.ico', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png']) {
    if (fs.existsSync(path.join(assetsDir, f))) fs.copyFileSync(path.join(assetsDir, f), path.join(dir, f));
  }
  fs.writeFileSync(path.join(dir, 'site.webmanifest'), JSON.stringify({
    name: 'Rosabon Test Results', short_name: 'Test Results', start_url: './', display: 'standalone',
    background_color: '#f6f7f9', theme_color: '#1f3a6d',
    icons: [
      { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml' },
    ],
  }, null, 2) + '\n');
}

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
    title: 'Loans on the same setting are repaid using different interest calculations',
    severity: 'High',
    owner: 'Engineering (loan calculation) and Product',
    status: 'Fix expected: the team expects the new loan integration to resolve this (23 November). It stays open until a re-run after that integration is live shows every loan following the same rule.',
    impact: 'Customers on the same loan product are charged interest in different ways, and older loans may be charged the wrong amount. This affects money and must be confirmed before loans go live.',
    saw: 'Both loans are Personal loans at 8.5% set to “Monthly equal”. The newer loan #188 (₦500,000 over 9 months) collects ₦98,056 a month — the specification’s amount at 8.5% a month (₦98,055.56), rounded up to the whole naira. The older loan #169 (₦5,000,000 over 24 months) still collects ₦226,041.66 a month, which is what you get if 8.5% were the interest for the whole 24 months.',
    expected: 'Every loan should follow the same rule from the loan specification. For loan #169 that is ₦633,333.33 a month if 8.5% is a monthly rate, or ₦243,750.00 if it is a yearly rate (loan #188: ₦98,055.56 or ₦59,097.23). Rounding up to the whole naira also means loan #188 would collect ₦4 more than the schedule over 9 months unless the last payment is adjusted.',
  },
  {
    match: /disbursed amount = amount − stated management fee/,
    title: '7.5% “Loan VAT” is taken from every loan payout without being shown on the loan',
    severity: 'High',
    owner: 'Engineering (loans) and Finance',
    impact: 'Customers receive less than they borrowed, and neither the loan record nor the offer explains why. It happens on every loan checked, including new ones.',
    saw: 'All three loans show a management fee of ₦0, yet exactly 7.5% was kept back: #169 ₦5,000,000 → ₦4,625,000 paid out; #188 ₦500,000 → ₦462,500; #189 (paid out during this round) ₦100,000 → ₦92,500. The customer’s wallet history shows the full amount credited, then the 7.5% taken back as “Loan VAT”.',
    expected: 'The amount paid out should equal the loan amount minus the charges shown on the loan. Finance should confirm whether VAT applies to the amount lent (it normally applies to fees); if it does, it should be shown on the offer and the loan record.',
  },
  {
    match: /Audit log: portal actions are recorded/,
    title: 'The main audit log is empty',
    severity: 'High',
    owner: 'Engineering and Compliance',
    impact: 'The portal is not keeping its official record of who did what. This is a compliance requirement.',
    saw: 'The Audit Log page says “No system actions have been recorded yet” and shows 0 entries for the past week — even though admin actions were carried out during this test.',
    expected: 'Every admin action should be recorded permanently in the audit log (Admin PRD). Entries were visible here on 21 October; it has been empty on 26 October and 2 November.',
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
  {
    match: /rates and fees are stored in percent/,
    title: 'Public Sector corridors still hold rates as fractions, though the portal now treats them as percent',
    severity: 'Medium',
    owner: 'Product and Engineering (loans)',
    impact: 'Staff cannot tell from the portal what rate customers will be charged, and a rate typed in the wrong unit would go live unnoticed.',
    saw: 'Since the 9 November portal update the corridor form labels every rate and fee “%” and fills a new corridor with 3%, 1% and 0.5%, so percent is now the intended unit. The two existing corridors were not converted: Lagos Civil Servants still stores a policy rate of 0.03 and a management fee of 0.01, which the list and form now show as “0.03%” and “0.01%” (its quarterly fee is now 0.4 and a 2.5% penalty rate was added); lagos-v1 shows a 25% policy rate and a 0.01% quarterly fee. The app quotes Lagos Civil Servants loans at 4% a month, which is the corridor’s booked average interim rate. An automated check now flags any rate or fee below 0.1%.',
    expected: 'The existing corridors’ values re-entered in percent (for example a 3% policy rate and a 1% management fee, if those were meant), the period stated (for example “% per month”), and the customer’s rate clearly identified.',
  },
];

const MISMATCHES = [
  ['RWIN holding period', 'When booking an RWIN plan for a customer, the form asks them to accept a 1-day minimum holding period. The RWIN 2.0 specification says 30 days, with no exceptions.'],
  ['Early-repayment charge on loans', 'Personal and Public Sector loan products have a “Liquidation charge” (3% by default). The loan specification says customers can repay early without any penalty.'],
  ['Personal loan limits', 'A new Personal loan product starts at ₦50,000–₦6,000,000 and 3–18 months. The specification allows up to ₦30,000,000 and 3–24 months. (These can be changed by an admin.)'],
  ['Daily-interest loans', 'Nano and Payday loans can be switched to a monthly interest model in the admin portal, although the specification says they are always charged per day.'],
];

const QUESTIONS = [
  'What status should a written-off or force-closed loan have? The API’s loan statuses have no “Written off” or “Force closed”, while the admin requirements expect a separate “Written off” state. No loan on the test system has been written off or force-closed yet.',
  'Should defaulted loans be written off? “Write off” only appears on overdue loans; a defaulted loan (for example #183) shows no actions at all.',
  'Is the loan “Interest rate” shown in the portal a monthly rate (as in the specification’s 2% examples) or a yearly rate? Newer loans now treat it as monthly; loan #169 matches neither.',
  'Should monthly loan repayments be rounded to the whole naira, and if so, is the difference corrected in the last payment?',
  'Should existing loans (such as #169) be recalculated under the new interest rule, or keep their original schedule?',
  'What is the minimum customer verification level (KYC tier) for a Personal loan? The specification does not say; the tests assume Tier 2.',
  'Public Sector corridors: is the customer’s rate the “policy rate” or the “booked average interim rate”, and in what unit? The Lagos Civil Servants corridor stores 0.03 and 4; lagos-v1 stores 25 and 2.5. The app quotes 4% a month.',
  'Public Sector fees: should the corridor’s 1% management fee and 1% quarterly fee (capitalised) apply, or the product’s “Public sector fee” structure (0%, deducted upfront, 7.5% VAT)? The app shows the first; the saved loans follow the second.',
];

/** Problems found by hand in the admin portal (no automated check covers them yet). */
/**
 * Test-only shortcuts the team has confirmed are deliberate on dev. Not problems here, but each must be
 * gone before production; listed on the Admin tab's notes so the removal is not forgotten.
 */
const ADMIN_PRE_PROD = [
  ['“Mark as paid” on loans (PATCH /api/v3/loan-applications/{id}/mark-as-paid)', 'A temporary workaround to make testing easier; the team will remove it before production (confirmed 23 November). On dev it closes any loan as “REPAID”, including one that was never paid out: loan #95 (approved, never disbursed) was closed this way on 23 November. Before go-live, check the endpoint and any portal button for it are gone, and that approved-but-unpaid loans have a proper cancel action instead.'],
];

const ADMIN_EXTRA_FINDINGS = [
  {
    title: 'Wallet history in the portal doesn’t say whose wallet each line belongs to',
    severity: 'Medium',
    owner: 'Engineering (admin portal)',
    impact: 'Staff can’t look up one customer’s wallet history, answer a customer query or follow a transfer between two customers, which is what the wallet-history ticket (748) is for.',
    saw: '24 November, Transactions & Ledger → Transaction Monitor: it lists all 460 wallet movements of every customer, with date, transaction ID, type, category, description, amount and balance after — but no customer name or ID, and the only filter is a date range (no search by customer, transaction ID, type or category). Rows can’t be opened. A transfer shows as two lines (a debit and a “SIM…” credit) whose “balance after” belongs to two different wallets, with nothing to tell them apart. The back end can already return one customer’s history (GET /api/v3/wallet-histories/{userId}).',
    expected: 'Show the customer on each line (linking to Customer 360), let staff filter by customer, transaction ID, type and category, and show a customer’s wallet history on their profile.',
    area: 'Transactions & Ledger (checked by hand)',
  },
  {
    title: 'Nano and Payday interest is not worked out by the number of days',
    severity: 'High',
    owner: 'Engineering (loans calculation)',
    impact: 'A 7-day loan costs as much as a 30-day loan, against the loan specification; customers repaying early are overcharged.',
    saw: '23 November, loan calculator (POST /api/v3/loan-calculations, “Daily direct”): ₦20,000 at 0.3 costs ₦60 for 7 days and ₦60 for 30 days; the rate is charged once for the whole loan. The loan specification says interest = principal × daily rate × days (₦20,000 for 7 days at 0.30% a day = ₦420; for 30 days = ₦1,800). The portal field is “Flat interest rate (30-day term)”. Nano and Payday were set to 9% per 30-day term (= 0.30% a day) and left at a 30-day tenor only, so no one is overcharged for now.',
    expected: 'Charge daily-rate loans for the days chosen (or used, for early settlement), then offer the 1–30 day (Nano) and 7–30 day (Payday) tenors from the specification.',
    area: 'Loan products (checked by hand)',
  },
  {
    title: 'The new investment product form drops the withholding-tax setting',
    severity: 'Medium',
    owner: 'Engineering (admin portal)',
    impact: 'Products are created with WHT off, so interest would be paid without the 10% tax the specifications require.',
    saw: '23 November: Adebanjo RWIN, REAP and RTN were created in the portal and saved with whtApplicable = false; the form removes the field before sending it. It was then switched on through the API, which accepts it.',
    expected: 'Show and send the WHT setting (on by default for these products).',
    area: 'Product Management (checked by hand)',
  },
  {
    title: 'RWIN set up as the specification describes is refused by the back end',
    severity: 'Medium',
    owner: 'Product and Engineering (treasury back end)',
    impact: 'RWIN cannot have both optional autosave and a separate tranche per top-up, as the RWIN specification describes.',
    saw: '23 November: creating Adebanjo RWIN with recurring contributions and tranche top-ups was refused: “A product funded by contributions credits top-ups to the plan; it cannot book them as tranches.” With recurring contributions on, the app could not book it at all (see the app problem “The app says nothing when a booking is refused”). It is now set as a lump-sum product with tranche top-ups.',
    expected: 'Decide which rule is right and align the specification, the back end and the app.',
    area: 'Product Management (checked by hand)',
  },
  {
    title: 'Notifications sent by the system are not recorded anywhere staff can see',
    severity: 'Medium',
    owner: 'Engineering (backend and admin portal) and Customer Support',
    impact: 'Staff cannot see what a customer was told, or when, about their loans, investments or account (for example “loan approved”, “offer ready”, “paid out”), so support cannot answer “I never got the message” and there is no record for audit or disputes.',
    saw: 'Checked 9 November. Communications → Campaigns, and the notification list behind it, only hold messages staff wrote and sent by hand (each has an admin sender and a recipient segment). Nothing the system sends by itself appears there, although the Tier 1 and Tier 3 test accounts had several loans applied for, approved, offered, accepted, paid out and repaid in the past week. Every messaging page in the portal was checked: Campaigns (menu), its Templates page, the Campaigns “Delivery log” (no longer in the menu since 6 November; its address now sends you back to Campaigns), and Discovery banners (“coming soon”). There is no message centre, inbox or notifications page under any name, the bell-style icon in the header is “Approvals awaiting you”, and the only notification data the portal asks the back end for is the campaign list and the templates. The customers’ own in-app inbox is also empty for all three test accounts.',
    expected: 'Every notification the system sends (in-app, push, email, SMS) should be stored with its recipient, channel, time and delivery status, shown on the customer’s page (for example an Activity or Communications tab) and in a searchable delivery log; and the customer’s inbox should show the in-app ones.',
    area: 'Communications (checked by hand)',
  },
  {
    title: 'Force close, write-off and penalty waivers skip the approval workflow',
    severity: 'High',
    owner: 'Engineering (admin portal and loans) and Compliance',
    impact: 'One administrator could close a loan, write off its balance or remove its penalty alone, although a sign-off is set up for each. A write-off cannot be undone from the portal.',
    saw: 'On loan #196 (active) the “Force close” dialog, and on loan #169 (overdue) the “Waive penalty” and “Write off” dialogs, each say the action “takes effect immediately, with no second approval”, and ask only for an optional reason. General Approvals has a one-level workflow for each of these three actions (created 23 October), and the page says it decides “who signs off loan force-closes, penalty waivers and write-offs”. The dialogs were opened and cancelled; no action was carried out, so whether the server waits for approval is not yet proven.',
    expected: 'Each action should become a request that waits for the configured approver, and the dialog should say so; a reason should be required.',
    area: 'Loan Management (checked by hand)',
  },
];

/** Admin configuration reviewed by hand, with the outcome. */
const ADMIN_JOURNEYS = {
  when: '3 and 5 November',
  intro: 'The Public Sector loan set-up was read in the admin portal and through the staff API (nothing was changed), then compared with the loan specification and with what the app does. On 5 November the status of 11 backlog items was checked: the pages and dialogs were opened and cancelled, and nothing was carried out.',
  items: [
    ['5 Nov: Force close and write off a loan', 'bad', 'Available: “Force close” on active loans (e.g. #196) and “Write off” on overdue loans (e.g. #169). Each dialog shows the customer, product, amount and tenor and asks for an optional reason, but says it takes effect immediately with no second approval, although a workflow is set up for each. See “Problems found”.'],
    ['5 Nov: Waive a loan penalty', 'bad', 'Available on overdue loans (e.g. #169); same “no second approval” wording. Not offered on a due loan with a 1% penalty rate (#82) or on defaulted loans.'],
    ['5 Nov: General Approvals', 'ok', 'Lists the 5 workflows (loan force close, waive penalty and write off; investment top-up and reverse booking), each one level with an approver; 5 of the 12 possible actions are covered. New workflow and Edit are offered.'],
    ['5 Nov: Message templates', 'ok', 'Communications → Campaigns → Templates lists the 3 templates, with New template, Edit and Delete.'],
    ['5 Nov: Customer management actions', 'ok', 'A customer’s page offers Freeze wallet, Freeze account and Close account. Each asks for a reason code, a reason, a review date (freezes) and evidence, and the page says each is a request a second administrator (Compliance) must approve. Screening and Support are still “Coming soon”.'],
    ['5 Nov: Human metrics', 'idle', 'Not built: there is no menu item, and the only related page (Settings → Metric Definitions) says “This page is coming soon”. The API has nothing for it either.'],
    ['Public Sector products', 'idle', 'Three exist: Adebanjo Public Sector (Active, reducing-balance interest, payroll-deduction repayment), public-sector-loan-v2 (Active, equal-instalment interest, bank transfer or card repayment), and Auto-public (Draft). All three use the Lagos Civil Servants corridor, a 30-day re-apply cooldown, a ₦1,000,000 control-gate threshold, CRC Credit Bureau, and loyalty discounts of 0.5% after 3 clean repayments and 1% after 6. None has its own amount range, rate or tenors; these come from the corridor. The product list therefore shows their amount range as “— – —”.'],
    ['Corridor: Lagos Civil Servants (Remita)', 'bad', '₦200,000–₦10,000,000; 3, 6, 9, 12 or 18 months; DTI 0.33; collection capitalised; salary basis from the bank-statement average; top-up allowed; 8 MDAs. The app offers the right tenors but does not enforce the amount range. Rates and fees use mixed units (see “Problems found”).'],
    ['Fee structure “Public sector fee”', 'bad', '0% management fee, deducted upfront, 7.5% VAT, 0% WHT. This contradicts the corridor’s 1% management and 1% quarterly fees. The app shows 1%; the saved loans show ₦0 plus 7.5% VAT.'],
    ['Pre-eligibility gate “GATE-STATE-PUBLIC-01”', 'idle', 'Maximum age 60, 2–420 months of service, ₦40,000 minimum net salary, MDA collection gate 85. The other gates store this gate as 0.65, so the unit needs confirming. The app does not ask for age, service or salary details.'],
    ['Approval workflows', 'ok', 'Adebanjo Public Sector: one level, ₦100,000–₦70,000,000, any credit score. Application #191 from the app was correctly routed to level 1. public-sector-loan-v2 has no workflow yet; workflows are set up per product by the admin team, so this is a set-up choice, not a fault.'],
    ['Documents and purposes', 'ok', 'Adebanjo Public Sector requires 6 documents (driver’s licence, employment letter, statement of accounts, latest payslip, NIN, pension statement), and the app asks for exactly these. It lists 7 loan purposes, one of which (#5) no longer exists; the app shows the remaining 6.'],
    ['“One active loan across the family”', 'idle', 'Switched off on both active Public Sector products, although only one loan at a time is allowed. In practice the server still refused a second loan (“You have an active loan running currently”). Product should confirm which setting is meant to control this.'],
  ],
};

/** Shown on the Admin tab: what this run found different from the previous one. */
const ADMIN_CHANGES = {
  since: '30 October',
  items: [
    ['24 November: wallet history, discovery banners and the new Rewards Engine checked', 'Checked the tickets reported as done (747, 748, 752). Rewards & Incentives is back in the menu as a new “Rewards Engine” page: it lists referral rewards (stage, target plan, flat or percentage value) and the “New referral reward” form works — stages Registered, Wallet funded and Plan created; target plan offers only active products (the three Adebanjo plans); the value label switches between ₦ and %. Nothing was saved. The four existing rewards (July) all point to products retired on 23 November, so they show as “#2”, “#10” and “#3” instead of a name, and no reward is set up for the active products — a set-up choice for the team. Discovery banners work as on 19 November (one draft, one unpublished, none live). The Transaction Monitor now lists every customer’s wallet movements, but without the customer (see “Problems found”). Wallet Management is still “Coming soon”.'],
    ['23 November: new products set up, and one product kept per type', 'Created Adebanjo RWIN (90-day cycle, 14%, ₦50,000 to ₦100M, 30-day lock), Adebanjo REAP (3, 6, 12 and 24 months at 14%, 16.5%, 18% and 18%, from ₦10,000, target required) and Adebanjo RTN (30 to 365 days, from ₦1M, amount bands ₦1M–5M, ₦5M–20M and ₦20M+, upfront or at-maturity interest), with rate cards for the 24-month REAP and 180–365-day RTN tenors. Tier access set as asked: REAP for Tiers 1–3, RWIN and RTN for Tiers 2–3 (both now also require Tier 2). Then only one product per type was kept: the old RWIN, REAP and RTN and two drafts holding plans are “Retiring” (closed to new plans; existing plans run to maturity), the other drafts and the “-v2” loan products are retired, and 11 open loans on retired loan products were closed (10 marked as paid or declined, and #95, never paid out, marked as paid with the test-only shortcut — see “Remove before production”). The Adebanjo loans were checked against the loan specification: Nano and Payday set to 9% per 30-day term (0.30% a day), Payday capped at ₦500,000 and removed from Tier 1 (specification: Tier 2); Personal (up to ₦30M, 3–24 months) and Public Sector (terms per employer) already matched. Retiring the loan products answered with “504 Gateway Time-out” and the dev API then stopped answering for about 20 minutes (the changes had been saved); the dev API was also down at other times today.'],
    ['19 November: “not run” checks looked at again', 'Every switched-off page was opened in the new portal version. Three are back and their checks now run and pass: Discovery banners (the “Open” button is now “Edit”; the editor offers Save as draft or Send for approval, and “Preview on device” is gone), the Transaction Monitor under Transactions & Ledger (rebuilt: a date range, page size and Refresh, with date, transaction ID, type, category, description, amount and balance after; the old Type, Category, Status, Channel and Provider filters, search box, Export CSV and clickable customer names are gone), and the Account Controls link under Customer Management. Still switched off: the investment request pages, Payroll reconciliation, the Wallet Management live board, the ledger tabs (Reversals & Adjustments, Cashback Ledger, Billers), Support & Tickets, Rewards rules, Dashboards and the five settings pages; Review Queues, Auto Grants and Screening are still gone. Only these checks were re-run; the full admin re-run waits for the go-ahead after the deployment.'],
    ['16 November: not re-run', 'The portal itself has not changed since 9 November. From about 14:00 the dev API stopped answering requests from the test office’s network (connections open, but no reply comes; outside locations got normal answers). A re-run at 14:38 was blocked again after about 7 minutes. The results below are therefore still those of 10 November; the team has been asked to allow the test network.'],
    ['Re-run on 10 November', 'No new portal version since 9 November afternoon. Same results: the same 4 problems, nothing newly broken or fixed.'],
    ['Re-run on 9 November (afternoon)', 'A new portal version went live on 9 November. The menu is unchanged; the changes are in Corridors & partners: a new “Duplicate” action (copies a corridor under a new code; checked, opened and cancelled), a “Penalty interest rate” field, every rate and fee now labelled “%” with at most 2 decimals, new corridors filled with 3%, 1% and 0.5%, and at least one tenor required. The two existing corridors were not converted to percent, so a new check fails (see “Problems found”). The other 3 problems are unchanged; nothing was fixed.'],
    ['Re-run on 9 November', 'No new portal version since 6 November. Same results: the same 3 problems, nothing newly broken or fixed. Checked by hand: notifications the system sends by itself are not recorded anywhere in the portal, and the customers’ in-app inboxes are empty (see “Problems found”).'],
    ['Re-run on 6 November', 'Two new portal versions went live (5 November 14:00 and 6 November 13:49). The menu is unchanged and the results are the same as on 4 November: the same 3 problems. The Campaigns page was redesigned: it now lists drafts, scheduled and sent campaigns, the “State” filter is called “Status”, and the Delivery log button is gone. The check was updated to match.'],
    ['Backlog status check (5 November)', 'Done: force close, write off and waive penalty (API and portal), General Approvals, message templates, and the customer freeze and close actions. Not built: human metrics (portal and API). NIN verification is in the API but fails with a server error for any NIN (checked 9 November). One problem: the loan actions say they skip the approval workflow. See “What we checked by hand”.'],
    ['Re-run on 4 November', 'Every check was run again after the latest portal changes. The results are the same as on 3 November: the same 3 problems, with nothing new broken and nothing newly fixed. The menu is unchanged, so none of the switched-off pages has come back. One check failed at first because it opened the newest investment, which had been cancelled and correctly offers no withdraw or top-up. The check now opens an active plan, and it passes. The Public Sector findings were looked at again and still apply: the corridor rate still shows as 0.03%.'],
    ['20 pages switched off', 'Wallet Management, Transactions & Ledger, Support & Tickets, Rewards & Incentives and Payroll reconciliation are now marked “Coming soon” in the menu and can’t be opened. These were removed from the menu altogether: Discovery banners; the investment request pages (Approval queue, On-behalf requests, Break requests, On-behalf withdrawals, top-ups and rollovers, Unlock requests, Auto-rollover and Statutory tax carry-across); and the settings pages Field Rules Setup, Controlled Vocabularies, Approval Thresholds, Communications Providers and Metric Definitions. Their old addresses now open Pending Approvals or an empty page. Checks on them are listed as “not run” until they come back.'],
    ['Customer Management', 'The Review Queues, Auto Grants, Screening and Account Controls sub-pages are gone. On a customer’s page the Screening and Support tabs are now marked “Coming soon”. “Freeze account (full)” is now just “Freeze account”, and the note under account controls now says a second administrator (Compliance) must approve every request. Our checks were updated and pass.'],
    ['Pending Approvals', 'A new “Created by me” tab lists the requests you raised, with a Withdraw button. This replaces the old investment Approval queue. “Dual-control changes” is marked “Coming soon”, and there is a page-size choice with Previous/Next. Our checks were updated to use it.'],
    ['Reports & Analytics', 'It has moved to a new address (Reports instead of Dashboards).'],
    ['Public Sector loan set-up reviewed', 'Products, corridor, fees, pre-eligibility, approval workflows and documents were read (not changed) and compared with the app. See “What we checked by hand” and “Problems found”.'],
    ['Fixed', 'The audit log now records portal actions, each with a “View” button, and can be exported. Our check passes.'],
    ['Still not fixed', 'Viewing a customer’s private details is still not recorded in their audit trail, and loan #188 still has the 7.5% deduction from its payout and repayments that don’t match its interest model. The disappearing new biller can no longer be checked, because Transactions & Ledger was taken out of the menu.'],
  ],
};

const SKIP_REASONS = [
  [/No longer in the portal/, 'Not run: this page was switched off (“Coming soon” or removed from the menu) in the 3 November update.'],
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
  'investing.spec.ts': { name: 'Investing', what: 'Opening each investment product, and creating, checking and deleting an RWIN savings goal.' },
  'borrowing.spec.ts': { name: 'Borrowing', what: 'Opening short-term loans, and checking a Personal loan’s quote, offer and repayment countdown against the loan rules.' },
  'profile.spec.ts': { name: 'Profile', what: 'Editing employment details, adding a next of kin and a home address.' },
  'account.spec.ts': { name: 'Account', what: 'Send Money recipients, funding the wallet by card, and logging out.' },
};

const MOBILE_FINDINGS = [
  {
    match: /Personal loan quote/,
    title: 'The Personal loan repayment breakdown does not open',
    severity: 'High',
    owner: 'Engineering (mobile app and loans)',
    impact: 'Customers cannot see their monthly repayments before applying for a Personal loan; the review screen only shows the total.',
    saw: 'Tier 3 test account, Adebanjo Personal, ₦100,000 over 3 months: after the three documents are uploaded, the review screen shows 8.5% a month, a ₦1,000 management fee and ₦126,500 to repay, but tapping “See Breakdown” next to “Estimated Monthly Pay” does nothing (watched for 30 and 60 seconds by hand, and 45 seconds by the automated check). The breakdown opened normally on 2 and 3 November. Reaching the review screen took 9 seconds once and over 20 seconds another time.',
    expected: 'The breakdown should list each month’s repayment, adding up to the total repayable.',
  },
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
    saw: 'Entering a mobile number in the usual 080… form and tapping Continue did not reach the passcode screen within 45 seconds.',
    expected: 'The app should accept the usual Nigerian format, or clearly say which format it needs.',
  },
  {
    match: /international-format phone number/,
    title: 'Signing in with a +234 phone number does not work',
    severity: 'Medium',
    owner: 'Engineering (mobile app)',
    impact: 'Customers who type their number with the country code (+234…) cannot sign in with it.',
    saw: 'On the 4 November build, entering the Tier 2 test account’s number as +234… and tapping Continue never reached the passcode screen (watched for 90 seconds, twice). Once, by hand, the app said “Please enter a valid email or phone number”. The same number written 080… works.',
    expected: 'Both 080… and +234… should be accepted, as they are the same number.',
  },
  {
    match: /moves on to the passcode screen within 10 seconds/,
    title: 'Phone sign-in takes 20 seconds or more to respond',
    severity: 'Low',
    owner: 'Engineering (mobile app and back end)',
    impact: 'After tapping Continue nothing visibly happens for 20 seconds or more, so customers may think the app is stuck and tap again or give up. Signing in with an email moves on in about 1 second.',
    saw: 'With a number written 080…, the passcode screen appeared after 19, 20 and 32 seconds, and once not within 45 seconds (4 November build). Until 4 November the automated check waited only 15 seconds, which is why it reported 080… as not working.',
    expected: 'The next screen within a few seconds, or a visible “please wait” while the number is checked.',
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
  // Customer journeys (mobile/specs/journeys) — first found by hand on 2 November.
  {
    match: /Tier 3 customer can open/,
    title: 'A Tier 3 customer cannot open an investment product',
    severity: 'High',
    owner: 'Engineering (mobile app and KYC) and Product',
    impact: 'Fully verified customers are locked out of investing.',
    saw: 'Signed in as the Tier 3 test account, opening the product shows “This investment isn’t available on your current tier. Upgrade your account to invest.”',
    expected: 'A Tier 3 customer should be able to open and invest in every product.',
  },
  {
    match: /(Nano|Payday) loan application opens without crashing/,
    title: 'Nano and Payday loan applications crash',
    severity: 'High',
    owner: 'Engineering (mobile app)',
    impact: 'Customers cannot apply for any short-term loan. After the crash the app shows a blank screen and has to be closed.',
    saw: 'Tapping a Nano or Payday loan on the Borrow screen shows a red error screen: “ReferenceError: Property ’useFocusEffect’ doesn’t exist” in the loan-amount screen. Dismissing or reloading leaves a blank screen.',
    expected: 'The loan-amount screen should open so the customer can choose an amount and apply.',
  },
  {
    match: /Send Money lists no recipients/,
    title: 'Send Money shows recipients the customer never added',
    severity: 'High',
    owner: 'Engineering (mobile app) and Compliance',
    impact: 'A customer could send money to a stranger they think they paid before.',
    saw: 'On the Tier 1 test account, which has never sent money, Send Money lists “Recent Recipients” and saved beneficiaries with names, banks and the last four digits of their account numbers. They look like built-in sample data, but could also be another customer’s list.',
    expected: 'Only recipients this customer has actually paid or saved should be shown; a new customer should see an empty list. If these belong to another customer, it is also a data leak.',
  },
  {
    match: /Loan offer shows the same terms as the application/,
    title: 'The loan offer asks the customer to repay ₦865,000 on a ₦100,000 loan',
    severity: 'High',
    owner: 'Engineering (loans and mobile app)',
    status: 'Fix expected: the team believes recent updates fixed this (23 November). Not yet confirmed: no Personal loan offer has been seen since 2 November (a Public Sector offer, #194, showed the right figures on 4 November), and the automated check only runs while an offer is waiting to be accepted. To confirm: approve a small Personal loan in the admin portal and compare the offer screen with the application.',
    impact: 'Customers are asked to accept terms that are wildly wrong.',
    saw: 'The offer screen’s repayment amount does not match either loan interest rule (see the technical report for the figures).',
    expected: 'The offer should show the same terms as the application and the admin portal.',
  },
  {
    match: /schedule follows the interest rule and adds up to the total/,
    title: 'Personal loan total does not match its repayment schedule',
    severity: 'Medium',
    owner: 'Engineering (loans) and Product',
    impact: 'Customers cannot see the real cost of the loan before they apply.',
    saw: 'On the review screen, “Total Repayable” differs from the sum of the monthly repayment schedule, or the schedule does not follow the “Monthly equal” / “Monthly reducing” rule.',
    expected: 'The total and the schedule should agree, and follow the loan specification.',
  },
  {
    match: /next payment countdown is within a month/,
    title: 'The loan screen counts down to the wrong payment date',
    severity: 'Medium',
    owner: 'Engineering (mobile app)',
    impact: 'Customers may miss their first payment and be charged late penalties.',
    saw: 'With a 3-month Personal loan being repaid monthly, the Borrow screen says “Next payment due in 90 days”. The admin portal shows the next repayment on 2 December 2026 — 30 days away. (90 days is the last payment.)',
    expected: 'It should count down to the next monthly payment.',
  },
  {
    match: /next of kin can be saved/,
    title: 'Next of kin cannot be saved',
    severity: 'Medium',
    owner: 'Engineering (mobile app and API)',
    impact: 'Customers cannot add a next of kin, which is normally required for KYC.',
    saw: 'After filling in every field on the Next of Kin form and pressing Save, the app shows “City cannot be empty”. The form has no City field.',
    expected: 'The form should ask for everything the system needs (add a City field, or stop requiring it).',
  },
  {
    match: /Log out returns to the sign-in screen/,
    title: '“Log out” does nothing',
    severity: 'Medium',
    owner: 'Engineering (mobile app)',
    status: 'The team believes this is solved (23 November), but the automated check on the 23 November build (code 97, run 10:27 WAT) still found the customer signed in after tapping “Log out”. It needs a check by hand on that build; if Log out works by hand, the automated check is at fault and will be fixed instead.',
    impact: 'Customers cannot sign out — a risk on shared or lost phones.',
    saw: 'Tapping “Log out” in Settings has no effect. The customer stays signed in until the app times out.',
    expected: 'Log out should end the session and return to the sign-in screen.',
  },
  {
    match: /card funding opens the payment page/,
    title: 'Funding the wallet by card does nothing',
    severity: 'Medium',
    owner: 'Engineering (mobile app and payments)',
    impact: 'Customers cannot add money by card, so they cannot fund investments or repayments that way.',
    saw: 'Fund → Card Payment → entering an amount and tapping “Pay ₦…” does nothing — no card form and no message.',
    expected: 'The card payment page (Paystack) should open.',
  },
  {
    match: /topping up from an empty wallet/,
    title: 'Investment goals can be created and topped up with an empty wallet, with no warning',
    severity: 'Medium',
    owner: 'Engineering (mobile app) and Product',
    impact: 'Customers set up a plan whose first payment will fail, and get no message telling them why nothing happens.',
    saw: 'The Tier 1 test account (₦0.00 balance) can create an RWIN goal whose first debit is due that day. Tapping “Add ₦…” to top it up then does nothing — no “insufficient balance” message and no other way to pay.',
    expected: 'The app should tell the customer their balance is too low and offer a way to fund it before (or while) creating the goal.',
  },
  {
    match: /tenors match the product rate table/,
    title: 'RWIN goals offer tenors that are not in the RWIN rate table',
    severity: 'Medium',
    owner: 'Product and Engineering (mobile app)',
    impact: 'Customers can book a term with no published rate, so the rate they get is unclear.',
    saw: 'Booking an RWIN goal offers 60, 90 or 120 days; the RWIN product page lists rates only for 90, 180, 270 and 360 days.',
    expected: 'Booking should offer the tenors in the rate table (or the table should cover every tenor offered).',
  },
];

/** Problems seen during the mobile run that no automated check covers yet (from the app’s own error log). */
const MOBILE_EXTRA_FINDINGS = [
  {
    title: 'Send money shows a fee and stamp duty that are not charged, and the two screens disagree',
    severity: 'Medium',
    owner: 'Engineering (mobile app and wallet back end)',
    impact: 'Customers are told different totals before and after a transfer, and neither matches what leaves the wallet; if the fees are meant to apply, Rosabon is not collecting them.',
    saw: '24 November, Send → Wema Bank, ₦100 from the Tier 2 to the Tier 3 test account (ticket 742): the name lookup found the right account and the transfer arrived (status SUCCESSFUL in about 7 seconds). The “Confirm Transfer” screen showed a ₦10.00 transaction fee and “Total Debit ₦110.00”; the “Transfer Successful” receipt then also listed “Stamp Duty ₦50”, which the confirm screen had not shown. The wallet was debited ₦100 only (no fee or duty entries in the wallet history). Stamp duty of ₦50 normally applies only to transfers of ₦10,000 or more.',
    expected: 'Show the same, correct charges on both screens (no stamp duty under ₦10,000), and debit exactly the total the customer confirmed, with each charge as its own wallet-history line.',
    area: 'Wallet (tried by hand)',
  },
  {
    title: 'New investment plans cannot be paid for in the app',
    severity: 'High',
    owner: 'Engineering (mobile app)',
    impact: 'A customer can book REAP, RWIN or RTN, but the plan stays unpaid at ₦0 and never starts earning; there is no way in the app to put money into it.',
    saw: '23 November, with the new Adebanjo REAP, RWIN and RTN products: every booking (Tier 1, 2 and 3 test accounts) ended as “PENDING_FUNDING” with ₦0 in the back end, and the wallet was not charged, although the Tier 2 wallet held about ₦9.96M. On the plan, “Top up” → “Add ₦50,000” does nothing: no PIN prompt, no request to the server, no message. The back end itself works: the same plans were paid from the wallet through the API with the transaction PIN (POST /api/v3/investments/{id}/funding), and went ACTIVE with the right amounts.',
    expected: 'Booking (or “Top up”) should ask for the transaction PIN and take the amount from the wallet, as the RWIN and RTN specifications describe, and say clearly if the wallet is short.',
    area: 'Investing (tried by hand)',
  },
  {
    title: 'Booking success screens show ₦0.00 and missing details',
    severity: 'Medium',
    owner: 'Engineering (mobile app)',
    impact: 'Right after booking, customers are told their investment of ₦0.00 is “active and earning interest”, which is wrong and alarming.',
    saw: '23 November: RTN and RWIN end on “Investment confirmed! Your ₦0.00 Adebanjo RTN is now active and earning interest.” For RWIN the first attempt also showed “0% p.a.” and no tenor or maturity date. REAP’s screen was correct (“Your first debit of ₦3,263.86 will be automatically processed on 23 November 2026”).',
    expected: 'Show the booked amount, rate, tenor and maturity, and say “waiting for payment” until the plan is funded.',
    area: 'Investing (tried by hand)',
  },
  {
    title: 'RTN quotes two different rates for the same placement',
    severity: 'Medium',
    owner: 'Engineering (mobile app and treasury rates)',
    impact: 'The customer cannot tell what rate they will earn.',
    saw: '23 November, ₦1,000,000 for 90 days paid at maturity: the projection screen says “Interest earned (20% p.a.)” (+₦44,383.56), and the next screen, the summary, says “25% p.a.”, which is also what the plan was booked at. Two rate cards cover 90 days (20% for any payout, 25% for monthly back-end interest); the app picks a different one on each screen.',
    expected: 'One rate per amount, tenor and timing, the same on every screen; and the rate cards should not overlap.',
    area: 'Investing (tried by hand)',
  },
  {
    title: 'Product pages show rates for tenors the product does not offer',
    severity: 'Medium',
    owner: 'Engineering (treasury rates) and Product',
    impact: 'Customers are shown rates they cannot get; REAP is advertised at a rate none of its tenors pays.',
    saw: '23 November: Adebanjo REAP is advertised as “30% p.a.” on Grow and on its page, and its rate table lists 1-month (30%) and 2-month (18% and 12%) rates, but it only offers 3, 6, 12 and 24 months (14% to 18%). Adebanjo RWIN only offers a 90-day cycle but lists 180, 270 and 360-day rates and a 30% “small” rate. The rate cards seem to come from the older product of the same type.',
    expected: 'The headline rate and rate table should come only from the rates of tenors the product offers.',
    area: 'Investing (tried by hand)',
  },
  {
    title: 'RWIN booking misses the 30-day holding confirmation, and auto-rollover starts off',
    severity: 'Low',
    owner: 'Engineering (mobile app)',
    impact: 'Customers are not told up front that RWIN money cannot be withdrawn for 30 days; plans do not roll over unless the customer turns it on.',
    saw: '23 November: the RWIN booking has no “I understand the 30-day minimum holding period” checkbox (required by the RWIN specification, step 6), and the plans were saved with auto-rollover off, while the specification says it is on by default.',
    expected: 'Add the required acknowledgement and default auto-rollover to on for RWIN.',
    area: 'Investing (tried by hand)',
  },
  {
    title: 'The app says nothing when a booking is refused',
    severity: 'Medium',
    owner: 'Engineering (mobile app)',
    impact: 'Customers tap “Create Goal” and nothing happens, with no reason.',
    saw: '23 November: while Adebanjo RWIN accepted recurring contributions, the server refused each booking with “A monthly contribution is required for this product” (the RWIN flow never asks for one). The app showed no message; the reason was only in the app log.',
    expected: 'Show the server’s message, and collect every value the product needs.',
    area: 'Investing (tried by hand)',
  },
  {
    title: 'Customers get no notification for investments, wallet funding or product retirement',
    severity: 'High',
    owner: 'Engineering (back end notifications)',
    impact: 'Customers are not told when a plan starts, is paid into, when money arrives in their wallet by bank transfer, or when a product they hold is closed, although the specifications and the admin portal promise it.',
    saw: '23 November: the Tier 2 account had three plans activated (₦1.05M taken from its wallet) and holds a plan on a product that was retired the same day; its inbox is empty, in the app and in the back end (GET /api/v3/notifications/inbox). The Tier 3 account had two plans activated and holds retired-product plans; its inbox only has older loan messages. The retire dialog says “Every holder is notified in the app, by push and by email”. 24 November: a ₦1,000 bank transfer into the Tier 2 account’s Wema account number (test transfer) credited the wallet at once but sent no notification. Wallet-to-wallet transfers do notify both sides, with well-formatted text (“₦100.00 has been sent to …”, “You received ₦100.00 from …”).',
    expected: 'Send and store the notifications the specifications list (plan created, contribution, top-up, maturity, retirement), in the app and by push or email.',
    area: 'Notifications (checked by hand)',
  },
  {
    title: 'Notifications show raw amounts and dates',
    severity: 'Medium',
    owner: 'Engineering (back end notification templates)',
    impact: 'Messages look broken and are hard to read; one reads as if a wallet were called “211”.',
    saw: '23 November, Tier 3 inbox (same text in the back end): “We have received your payment of NGN216000”; “NGN200000.00 credited to your wallet 211. Repayment due on 2026-12-18T07:39:59.910”; “You qualify for NGN200000.00”. In the list, “Loan Disbursed” and “Agreement Executed” are cut off with “…”, hiding the due date and where the documents are.',
    expected: 'Write amounts as ₦216,000.00, dates as 18 December 2026, keep the loan reference apart from “your wallet”, and let the important part of a message fit.',
    area: 'Notifications (checked by hand)',
  },
  {
    title: 'An overdue Payday loan is not marked overdue',
    severity: 'High',
    owner: 'Engineering (loans back end and mobile app)',
    impact: 'Customers aren’t told a Payday loan is late, and any late-payment rules (penalty, reminders, credit score) may never start for these loans.',
    saw: '18 November: the Tier 3 test account’s Payday loan (₦200,000 + ₦16,000 interest) was due on 12 November. Six days later the back end still has it as “ACTIVE”, and the app’s Borrow tab shows “TOTAL REPAYABLE ₦216,000.00 · Payment Due · Due Date 12 November 2026” with no overdue warning. A Public Sector loan due on 15 November on another account was marked “Overdue” with an overdue banner within 3 days.',
    expected: 'A loan past its due date (after any grace period) should be marked overdue in the same way for every product, and the app should say so. If Payday loans have a grace period, the app should show when it ends.',
    area: 'Borrowing (tried by hand)',
  },
  {
    title: 'Borrow shows wrong amounts for a moment after sign-in',
    severity: 'Medium',
    owner: 'Engineering (mobile app)',
    impact: 'A customer may see a lower amount owed than they really owe and plan their payment on it.',
    saw: '18 November, overdue Public Sector loan (₦3,000,000, 12 months, 4% a month, reducing balance): straight after signing in, Borrow showed “TOTAL OUTSTANDING ₦3,120,000.00” and “Overdue ₦260,000”. About a minute later it changed to ₦3,780,000.00 and ₦370,000, which match the back end’s schedule (₦780,000 interest; first instalment ₦370,000). The first figures treat 4% as a yearly rate. Seen once; reopening Borrow afterwards always showed the correct figures.',
    expected: 'Show a loading state until the real figures arrive, never amounts worked out another way.',
    area: 'Borrowing (tried by hand)',
  },
  {
    title: 'A waived penalty is not explained to the customer',
    severity: 'Low',
    owner: 'Engineering (mobile app) and Product',
    impact: 'The customer can’t tell whether a penalty was charged or waived, and the repayment sheet labels the instalment as the loan amount.',
    saw: '18 November, overdue loan whose penalty was waived in admin: Borrow and the Pay Now sheet show only the instalment (₦370,000). Nothing mentions a penalty or that it was waived, and the sheet calls the ₦370,000 instalment “Loan Amount”.',
    expected: 'Show a “Penalty waived” note (or a ₦0 penalty line) on overdue loans, and label the sheet’s figure “Amount due”.',
    area: 'Borrowing (tried by hand)',
  },
  {
    title: 'Investments cannot be paid for in the app',
    severity: 'Critical',
    owner: 'Engineering (mobile app and investments)',
    impact: 'No customer can put money into RWIN, REAP or RTN from the app, so no new investment can start.',
    saw: 'Tier 2 test account, 4 November build, with ₦9,900,707.51 in the wallet: an RWIN goal (#85), a REAP goal (#86) and an RTN note (#87) were created, then “Top up” → “Add ₦…” was tapped on each. Nothing happens: no PIN prompt, no message, and the wallet is not charged. All three stay “waiting for funding”. Calling the back end’s funding service directly answers “Your transaction PIN is required”, so the app appears never to ask for the PIN it needs.',
    expected: 'Tapping “Add” should ask for the transaction PIN, take the amount from the wallet and start the plan (for an upfront RTN, also pay the interest to the wallet).',
    area: 'Investing (tried by hand)',
  },
  {
    title: 'Unpaid investments are described as active and auto-debited',
    severity: 'High',
    owner: 'Engineering (mobile app and investments)',
    impact: 'Customers are told their money is invested and earning when nothing has been taken, so they may not notice the plan is unpaid until it lapses.',
    saw: 'After creating the RWIN and REAP goals the app said “Your first debit of ₦… will be automatically processed on 4 November 2026”, but the plans are saved with automatic debit switched off and nothing was taken that day. Overnight the next payment date moved on to 5 December, still with nothing taken and no missed payment recorded. After placing the RTN note it said “Investment confirmed! Your ₦0.00 Rosabon Treasury Note (RTN) is now active and earning interest”, while the note is unpaid. The RTN confirmation also offers “Top up”, which RTN does not allow.',
    expected: 'Until the first payment succeeds, say the plan is waiting for payment, by when, and how to pay.',
    area: 'Investing (tried by hand)',
  },
  {
    title: 'Home counts ₦300,000 in plans the customer does not have',
    severity: 'Medium',
    owner: 'Engineering (investments)',
    impact: 'The total balance on Home is overstated by ₦300,000.',
    saw: 'Tier 2 test account: Home shows a total balance of ₦10,200,707.51 (wallet ₦9,900,707.51 plus ₦300,000 in plans), but Grow shows “Active Plans (0)” and every plan on the account is unpaid, with ₦0 in it.',
    expected: 'The total balance should only count money actually held in plans.',
    area: 'Investing (tried by hand)',
  },
  {
    title: 'New customers cannot finish sign-up: the Smile ID selfie is refused as “Unauthorized”',
    severity: 'Critical',
    owner: 'Engineering (mobile app and Smile ID set-up)',
    impact: 'No new customer can open an account: sign-up stops at the selfie (step 3 of 6), and the half-made account cannot be used.',
    saw: '11 November, 9 November build, a new sign-up with a real phone number, BVN and the tester’s own face (laptop webcam). Phone code, email, passcode and BVN all worked, and the BVN matched NIBSS (“Is this you?”). The Smile ID selfie screen then opened, took the selfie and the smile, and asked “Is this a good quality selfie?”. After “Yes, use this” it showed “Your selfie failed to process — Unauthorized”, and “Retry” failed the same way (4 tries). The app’s log shows why: before anything is uploaded, the Smile ID library asks Smile ID’s test service for permission (POST testapi.smileidentity.com/v1/auth_smile) and is refused every time (HTTP 400, “Error authenticating request”). This points to the Smile ID partner ID, key or signature the app gives the library, not to the selfie itself. The earlier start-up error (“smile_config.json not found”) no longer appears in this build.',
    expected: 'With valid Smile ID test credentials, the selfie should be accepted and sign-up should go on to step 4. If the check can’t run, the app should fall back to the selfie upload, as this build is meant to, and show a message a customer can act on, not “Unauthorized”.',
    area: 'Sign-up (tried by hand)',
  },
  {
    title: 'A sign-up stopped part-way leaves an account that cannot sign in',
    severity: 'Medium',
    owner: 'Engineering (mobile app and API)',
    impact: 'A customer whose app closes during sign-up is told their password is wrong and pointed to “Forgot password”, although they never set one.',
    saw: 'After the passcode step, the app was restarted. It opened on the Welcome screen with the sign-up forgotten. “I already have an account” recognised the email and asked for a password; the 6-digit passcode was refused with “Incorrect email and password combination. Please click on forgot password link to reset your password”. Starting “Create account” again with the same phone number (a new SMS code) and the same email did pick up the sign-up again.',
    expected: 'Sign-in with an unfinished account should say the sign-up isn’t complete and take the customer back to where they stopped.',
    area: 'Sign-up (tried by hand)',
  },
  {
    title: 'The selfie screen waits forever when it can’t see a face',
    severity: 'Low',
    owner: 'Engineering (mobile app)',
    impact: 'A customer with a poor camera or bad light is left on “Position your face in the oval” with no help and no way out except the phone’s Back button.',
    saw: 'On a camera with no face in view, the Smile ID screen showed “Position your face in the oval” for over a minute with no timeout, tip, Cancel or Close button.',
    expected: 'After a short while, offer help (light, distance) and a way to cancel or use the selfie upload instead.',
    area: 'Sign-up (tried by hand)',
  },
  // Found by hand on 2 November (30 October build) and not yet covered by an automated check —
  // the rest of that round's findings are in MOBILE_FINDINGS, matched to mobile/specs/journeys.
  {
    title: 'A customer with no address on file is told they can no longer change it',
    severity: 'Medium',
    owner: 'Engineering (mobile app and API) and Product',
    impact: 'Customers without an address cannot add one, although an address is normally needed for KYC.',
    saw: 'The Tier 3 test account’s profile shows no address (“Add your address”). Adding one and pressing “Save changes” briefly shows “You can no longer update your residential address”, and nothing is saved.',
    expected: 'A customer with no address on file should be able to add one — or, if one is on file, the profile should show it and explain how to change it.',
    area: 'Profile (tried by hand)',
  },
  {
    title: 'Loan documents are marked “Verified” the moment they are uploaded',
    severity: 'Medium',
    owner: 'Engineering (mobile app) and Operations',
    impact: 'Customers are told their documents are verified before anyone has checked them, and are asked to upload documents already on file.',
    saw: 'Applying for a Personal loan (2 November) asked for a statement of accounts, NIN document and utility bill, although the admin portal shows this customer uploaded all three on 21 October. A blank test PDF uploaded for each was immediately labelled “Verified”. Still happening on 3 November: a Public Sector application asked for all 6 documents again (the customer had a Public Sector loan in October), and each blank PDF showed “Verified” at once.',
    expected: 'Documents already on file should be reused, and new uploads should show “Uploaded” or “Pending review” until someone checks them.',
    area: 'Borrowing (tried by hand)',
  },
  {
    title: 'The loan offer asks the customer to repay ₦865,000 on a ₦100,000 loan',
    severity: 'High',
    owner: 'Engineering (loans and mobile app)',
    status: 'Fix expected: the team believes recent updates fixed this (23 November). Not yet confirmed: no Personal loan offer has been seen since 2 November (a Public Sector offer, #194, showed the right figures on 4 November), and the automated check only runs while an offer is waiting to be accepted. To confirm: approve a small Personal loan in the admin portal and compare the offer screen with the application.',
    impact: 'Customers are asked to accept terms that are wildly wrong. Most would decline; anyone who accepts is agreeing to repay more than eight times what they borrowed.',
    saw: 'Loan #189 (₦100,000 over 3 months at 8.5% a month, approved in the admin portal) showed “Interest Fee (8.5%) ₦765,000.00 · Repayment Amount ₦865,000.00 · Repayment Date 31 January 2027” on the offer screen — 8.5% charged per day for 90 days, in one payment. When applying, the same loan showed ₦125,500 over three monthly payments, and after acceptance the loan screen shows ₦125,500 outstanding.',
    expected: 'The offer should show the same terms as the application and the admin portal: ₦125,500 in three monthly payments of about ₦41,833 (“Monthly equal”), the first on 2 December 2026.',
    area: 'Borrowing (tried by hand)',
  },
  {
    title: 'Loan screens show a fee that is never charged, and hide the 7.5% VAT that is',
    severity: 'Medium',
    owner: 'Engineering (loans) and Finance',
    impact: 'Customers cannot see the real cost of the loan before they accept it.',
    saw: 'Personal loan #189 (2 November): the review screen showed “Management Fee (1%) ₦1,000” and “Total Repayable ₦126,500”, while its own schedule adds up to ₦125,500. The admin portal shows a ₦0 management fee, and no fee was charged. Instead, when ₦100,000 was paid out, ₦7,500 was taken straight back as “Loan VAT” (wallet credited ₦92,500). Same on 3 November with Public Sector loans. Application #191 (₦300,000): the review screen shows “Management Fee (1%) ₦3,000” and “Total Repayable ₦345,000”, its schedule adds up to ₦342,000, and the saved application has a ₦0 fee and 7.5% VAT. VAT is not mentioned on any application or offer screen.',
    expected: 'Every charge should be shown, with the correct amount, before the customer accepts. Finance should confirm whether VAT applies to the amount lent (VAT normally applies to fees).',
    area: 'Borrowing (tried by hand)',
  },
  {
    title: 'Times are shown an hour behind Nigerian time',
    severity: 'Medium',
    owner: 'Engineering (mobile app, admin portal and API)',
    impact: 'Transaction and application times look wrong to customers and staff, which matters for disputes and audits.',
    saw: 'The loan payout made at about 3:30 PM (WAT) on 2 November appears in the app’s activity as 02:30 PM. The admin portal shows the application created at 1:56 PM when it was submitted at about 2:56 PM. Still the same on 3 November: an investment made from the admin portal just before 6 PM shows as 04:58 PM, and a loan paid out at about 7:30 PM shows as 06:30 PM.',
    expected: 'Times should be shown in Nigerian time (WAT, UTC+1).',
    area: 'Times and dates (tried by hand)',
  },
  // Found by hand on 3 November (3 November build): Public Sector loan application.
  {
    title: 'Public Sector loans accept amounts outside the allowed range',
    severity: 'High',
    owner: 'Engineering (loans and mobile app)',
    impact: 'Customers can apply for, and be shown offers on, loans the product does not allow, so the lending limits are not enforced.',
    saw: 'The Public Sector product’s corridor (Lagos Civil Servants) allows ₦200,000 to ₦10,000,000. The app accepted ₦100,000 and ₦11,000,000, quoted them (₦11,000,000 over 6 months: ₦12,540,000 to repay), and went on to the documents step without any message.',
    expected: 'Amounts below the minimum or above the maximum should be refused with a clear message, before documents are asked for.',
    area: 'Borrowing: Public Sector (tried by hand)',
  },
  {
    title: 'The Public Sector application skips the employer and payroll steps',
    severity: 'High',
    owner: 'Product and Engineering (loans and mobile app)',
    impact: 'Loans meant to be repaid through the employer’s payroll can be applied for without saying who the employer is or checking the customer can afford the deductions.',
    saw: 'The app goes straight from amount, tenure and purpose to documents. It never asks the customer to find their employer (corridor), for an IPPIS or staff number, or for a retirement date. No affordability (salary × DTI) check is shown. Above the ₦1,000,000 control-gate threshold set in the admin portal, it asked for the same 6 documents, with no house visit, cheques or utility bill.',
    expected: 'As the Public Sector loan specification (§3–§4) describes: employer search and corridor confirmation, the corridor’s ID number, a retirement date (tenor capped at the months left before retirement), a live affordability cap, and the extra requirements above the corridor threshold.',
    area: 'Borrowing: Public Sector (tried by hand)',
  },
];

/** Activities done by hand in the app on 2 November (30 October build), with the outcome. */
const MOBILE_JOURNEYS = {
  when: '2–24 November, 30 October, 3, 4, 9, 18 and 23 November builds',
  intro: 'A tester used the app like a customer with the Tier 1 and Tier 3 test accounts (Tier 2 is on hold). Real records were created on the test system; test data was removed where possible. The main journeys are now automated checks (Investing, Borrowing, Profile and Account in the table above), so they re-run on every new build.',
  items: [
    ['24 Nov (23 November build): wallet — account number, fund, balance and send (tickets 720, 739, 741–743)', 'bad', 'Account number: all three test accounts have a dedicated Wema account number, shown on Fund → Bank Transfer with a Copy button. Fund: a ₦1,000 test bank transfer into the Tier 2 account number credited the wallet at once; the balance and Recent Activity (“Wallet Funded +₦1,000.00”) updated correctly, but no notification was sent. Balance: the Home balance matched the back end after each step. Send: ₦100 to the Tier 3 account (Wema Bank) — bank search, name lookup, PIN and receipt work, the money arrived and both customers were notified; the fee and stamp duty shown are wrong and not charged (see “Problems found”). The bank picker suggests only four banks (Paycom, Keystone, Hayat Trust MFB, Polaris), but search finds the rest.'],
    ['23 Nov (23 November build): book Adebanjo REAP, RWIN and RTN as Tier 1, 2 and 3', 'bad', 'Tier 1: REAP goal booked (₦10,000 target, 3 months, 14%); RWIN and RTN correctly blocked (“This investment isn’t available on your current tier”). Tier 2: all three booked (REAP ₦10,000 target; RWIN ₦50,000 for 90 days at 14%; RTN ₦1,000,000 for 90 days at 25%). Tier 3: all three booked. None could be paid for in the app (see “Problems found”); paid through the API instead with the transaction PIN: Tier 2’s three plans and Tier 3’s REAP and RWIN went ACTIVE (Tier 2’s wallet went down by exactly ₦1,053,263.86). Tier 3’s RTN was refused for lack of funds (₦968k left) and Tier 1 has no PIN or money, so those two stay unpaid. Projections were right once RWIN was set as a lump-sum product (₦1,553.43 on ₦50,000 for 90 days at 14%, net of 10% WHT).'],
    ['23 Nov (23 November build): notifications after the bookings', 'bad', 'No notification for any booking, payment or product retirement; older loan messages show raw amounts and dates (see “Problems found”).'],
    ['18 Nov (18 November build): overdue loan with its penalty waived in admin', 'ok', 'Test account with an overdue Public Sector loan (₦3,000,000, 12 months, due 15 November) whose penalty was waived in admin. Back end: the loan’s penalty rate is 0 and it stays “Overdue” (correct — it is still unpaid). App: Borrow shows ₦3,780,000 outstanding, “Your Repayment is Overdue (3 days) ₦370,000”, and Pay Now opens a sheet asking for ₦370,000 — exactly the back end’s schedule with no penalty added. Nothing was paid. Two smaller problems: wrong figures for a moment after sign-in, and no mention of the waiver (see “Problems found”).'],
    ['18 Nov (18 November build): Payday loan past its due date (Tier 3)', 'bad', 'Due 12 November, still “ACTIVE” with no overdue warning six days later (see “Problems found”).'],
    ['11 Nov (9 November build): sign up as a new customer with the Smile ID selfie', 'bad', 'A new account was started with a real phone number, BVN and email, with the tester’s face on the laptop webcam. Steps 1–3 worked: SMS code, email, a 6-digit passcode, and the BVN, which matched NIBSS and showed the customer’s name, date of birth and gender to confirm. The Smile ID selfie screen opened and took the selfie, but every submission was refused with “Your selfie failed to process — Unauthorized”, so sign-up stopped at step 3 of 6. Steps 4–6 could not be reached. The fallback selfie upload was never offered. See “Problems found”.'],
    ['4 Nov (4 November build): invest in RWIN, REAP and RTN from the wallet (Tier 2)', 'bad', 'Created an RWIN goal (#85: ₦100,000 target, 90 days, 3 × ₦32,587.54 + ₦2,237.38 interest at 14%, maturity 2 February 2027), a REAP goal (#86: ₦50,000 target, 30 days, ₦48,796.80 + ₦1,203.21 interest at 30%, maturity 4 December 2026) and an RTN note (#87: ₦100,000, 90 days, upfront, ₦4,931.51 interest at 20%, maturity 2 February 2027). Every figure matches the product rules. None could be paid for: “Add ₦…” does nothing, and the wallet stayed at ₦9,900,707.51. Also seen: the REAP amount shown as “₦48,796.8”; the “Earn Up to 20% P.A.” REAP card is back on Grow (REAP itself shows 30%); RTN for 90 days gives 20% while its card says 25% (the rate table has two overlapping rows for 0–120 days). Payouts, withdrawals and early exits could not be tried, as no plan could be paid for. Checked again on 6 November: still nothing taken. The scheduled payment run moved the RWIN and REAP goals’ next payment from 4 November to 5 December without collecting anything or counting a missed payment, and the two RTN notes are still open, marked “Underfunded”, a day after their payment deadline passed. See “Problems found”.'],
    ['4 Nov (4 November build): check a Public Sector loan offer (#194)', 'ok', 'Application #194 (₦300,000, 9 months, 4% a month on a reducing balance) was approved and waiting for the customer. The offer screen showed ₦60,000 interest and ₦360,000 to repay, which matches the reducing-balance schedule. The ₦1,086,004.29 interest shown on the #191 offer is no longer seen. The offer was left for the team to accept or decline.'],
    ['4 Nov (4 November build): apply for a Nano or Payday loan', 'ok', 'Fixed. All four short-term loans on the Borrow screen (Adebanjo Nano, Adebanjo Payday, nano-loan-v2 and payday-loan-v2) open their amount screen, with the limits set in the admin portal. Nano: ₦5,000 for 30 days showed 10% interest (₦500) and ₦5,500 to repay. Stopped before “Submit application”, so nothing was applied for.'],
    ['4 Nov: accept the approved Public Sector offer (#191)', 'bad', 'After admin approved #191, the Borrow tab showed “Offer ready” with Accept and Decline buttons. Accepting worked: the app showed “Your disbursement is in progress”, and in the admin portal #191 changed to “Accepted by customer” with a Disburse button. That matches the rule that the customer must accept before admin can pay out. Problem: the offer screen showed interest of ₦1,086,004.29 and a repayment of ₦1,386,004.29 on ₦300,000 (the schedule totals ₦342,000), and the Loans card already shows ₦312,000 owed although nothing has been paid out. Payout was left to the admin team. See “Problems found”.'],
    ['3 Nov: apply for a Public Sector loan (Adebanjo Public Sector, ₦300,000, 6 months)', 'bad', 'Submitted as application #191, which is waiting for approval in the admin portal. What matched the admin set-up: tenors of 3, 6, 9, 12 and 18 months; the reducing-balance interest model at 4% a month (schedule ₦62,000 down to ₦52,000); the 6 required documents; and the approval workflow (level 1). Problems: no employer, IPPIS or staff number, retirement date or affordability step; ₦100,000 and ₦11,000,000 accepted; a 1% fee shown but ₦0 fee and 7.5% VAT saved; and “Total Repayable” (₦345,000) doesn’t match the schedule (₦342,000). The repayment breakdown took about 10 seconds to open. The first try was refused with “You have an active loan running currently” while the customer’s previous loan was being closed; a minute later it went through. See “Problems found”.'],
    ['3 Nov: check the Borrow screen lists the right products', 'ok', 'Shows the active products from the admin portal, including both active Public Sector products (Adebanjo Public Sector and public-sector-loan-v2). The draft “Auto-public” is correctly hidden.'],
    ['3 Nov: apply for a Nano or Payday loan', 'bad', 'Still crashes on the first screen (“useFocusEffect doesn’t exist”).'],
    ['3 Nov: Tier 3 profile and identity', 'bad', 'Still “2/3, 1 key identity step left”, and the list includes “Upgrade to Tier 2” for a Tier 3 customer. SmileID still reports its settings file missing.'],
    ['2 Nov: apply for a Personal loan (₦100,000, 3 months), accept it and receive it', 'bad', 'Full journey done: applied in the app (after uploading three documents), approved in the admin portal (#189), offer accepted in the app, paid out from the admin portal. The repayment schedule (3 × about ₦41,833, ₦125,500 in total) follows the “Monthly equal” rule correctly, and the Borrow screen correctly blocks new loans until this one is repaid. But the offer showed ₦865,000 to repay, ₦7,500 “Loan VAT” was taken from the payout, and the next-payment countdown is wrong — see “Problems found”.'],
    ['2 Nov: apply for a Nano or Payday loan', 'bad', 'Crashes on the first screen — see “Problems found”.'],
    ['2 Nov: invest in RWIN, REAP or RTN as a Tier 3 customer', 'ok', 'Blocked as “not available on your current tier” in the early afternoon, with an upgrade screen saying “You are on Tier 3 … upgrade to Tier 3”. By the automated run later that day all three products opened, so it now passes.'],
    ['2 Nov: create, top up and delete an RWIN goal as a Tier 1 customer', 'bad', 'Goal created (₦100,000 over 90 days, maturity 31 January 2027 — correct) and deleted. The top-up could not be paid: the wallet was empty and card funding does not work.'],
    ['2 Nov: edit employment details', 'ok', 'Job title changed, saved and still there after restarting the app; then changed back.'],
    ['2 Nov: add a home address', 'bad', 'Not saved: the app briefly shows “You can no longer update your residential address”, although no address is on file — see “Problems found”.'],
    ['2 Nov: add a next of kin', 'bad', 'Cannot be saved (“City cannot be empty”, no City field).'],
    ['2 Nov: fund the wallet', 'bad', 'Card payment does nothing. Bank transfer (dedicated account) and USSD are offered but were not used, as they move real money.'],
    ['2 Nov: send money and pay bills', 'idle', 'Screens open; not completed, as they move real money. Send Money shows recipients the customer never added.'],
    ['2 Nov: log out and switch account', 'bad', '“Log out” does nothing; “Switch Account” on the sign-in screen works.'],
  ],
};

/** Shown on the Mobile tab: what this run found different from the previous one. */
const MOBILE_CHANGES = {
  since: '3 November',
  items: [
    ['23 November: new build (code 97) re-run, and the new products booked', 'Tested the 23 November build (version 1.1.55, code 97). It is the first build made for the test emulator\'s processor (x86_64), so it installed as it is and runs at normal speed. The version name still has not changed. Results: 24 passed, 8 problems, 23 not run. The sign-in, profile and borrowing checks were run a second time because the dev API was unstable during the first run (it stopped answering several times today); a check counts as passed if it passed on either try. Fixed or no longer seen: employment details and home address save correctly again (they failed only while the API was down). The build removed the hidden label the checks used to recognise the passcode screen; the check now uses the screen title, and a 080… number reaches the passcode screen (under 3 seconds by hand, but 53 seconds during the slow-API run). Still not fixed: +234… numbers are refused (“Please enter a valid email or phone number”), next of kin (“City cannot be empty”), card funding, Log out, Tier 3 shows 2/3 identity steps, RWIN tenors outside the rate table (old RWIN product), and top-up does nothing. The Personal loan quote check could not read an interest rate on the quote screen (the text has no “%” figure); not yet confirmed by hand. The Borrow tab now lists only the four Adebanjo loans, and Grow only the three Adebanjo investments, after the admin clean-up. The new Adebanjo REAP, RWIN and RTN were booked by hand with the Tier 1, 2 and 3 accounts, and the in-app notifications were checked (see “Problems found”).'],
    ['18 November: new build re-run, and penalty waiver checked', 'Tested the 18 November build (version 1.1.55, code 95). It is again built for ARM phones only and closes at launch on the test emulator; it was run from a copy re-packed so the emulator can load its libraries (app code unchanged), which makes it slow there — timings from this run are not reliable. Home’s “TOTAL BALANCE” is now “WALLET BALANCE”, and Payday loans have a new Borrow layout (“TOTAL REPAYABLE”); the checks were updated for both. Fixed: Send Money no longer shows recipients the customer never added. Penalty waiver: on a test account whose overdue Public Sector loan had its penalty waived in admin, the app shows ₦3,780,000 outstanding and ₦370,000 overdue, and Pay Now asks for ₦370,000 — the back end’s own figures with no penalty added, so the waiver holds. New problems: see “An overdue Payday loan is not marked overdue” and “Borrow shows wrong amounts for a moment after sign-in”. Not checked this time: the loan product list and the Personal loan quote, because the Tier 3 test account now has an active Payday loan, so Borrow shows that loan instead.'],
    ['16 November: not re-run', 'No new build that runs on the test emulator: the 11 November build was made for ARM phones only (no x86_64), so it closes at launch on the emulator; a build with x86_64 has been requested. It also keeps version 1.1.55 (code 92). From about 14:00 the dev API stopped answering requests from the test office’s network (connections open, but no reply comes; outside locations got normal answers). A re-run at 14:38 was blocked again after about 7 minutes. The results below are therefore still those of 10 November; the team has been asked to allow the test network.'],
    ['11 November: Smile ID sign-up tried (9 November build)', 'A new customer sign-up was tried by hand with a real phone number, BVN and the tester’s face. The Smile ID check now starts (the “settings file missing” error is gone) and the camera, selfie and smile prompts work. But Smile ID refuses the app’s credentials (“Unauthorized”), so no selfie can be submitted and sign-up can’t be finished. Also found: an unfinished sign-up leaves an account that can’t sign in, and the selfie screen never times out. See “Problems found”.'],
    ['Re-run on 10 November (9 November build)', 'The 9 November build was installed and every check was run again. The results are the same as on 6 November: 23 passed, the same 10 problems, nothing newly broken or fixed. The build again keeps the same version number (1.1.55, code 92), so the test tools treated it as already installed until it was removed and installed by hand. This build adds the Smile ID selfie check during sign-up (using the two new onboarding liveness endpoints), a BVN prompt when the server asks for one, and a fallback to the old selfie upload if the check cannot start. That sign-up check was tried by hand on 11 November (see above).'],
    ['Re-run on 6 November (same 4 November build)', 'No new app build was available, so the 4 November build was tested against the latest back end. No crashes. New problem: the Personal loan “See Breakdown” no longer opens (see “Problems found”). Everything else is as on 4 November. The Nano and Payday checks did not run, because the Tier 1 test account now has a ₦4,000,000 Personal loan (#199) waiting to be paid out, so its Borrow screen shows that loan instead of the products. Screenshots of the app now show the screen (they used to come out black).'],
    ['App build', 'Tested the 4 November build. It still has the same version number as the earlier builds (1.1.55, code 92). The version should go up with each build so testers and devices can tell them apart.'],
    ['Fixed: Nano and Payday crash', 'All four short-term loans (Adebanjo Nano, Adebanjo Payday, nano-loan-v2 and payday-loan-v2) now open their amount screen. Checked by the automated run and by hand. No crashes were seen anywhere else in the app during the full run.'],
    ['New: investing tried by hand with the Tier 2 account', 'Plans can be created with correct figures, but none can be paid for in the app. See “Problems found”.'],
    ['Phone sign-in re-checked', 'A number written 080… does work, but takes 20 seconds or more; the automated check used to give up after 15 seconds, which is why it was reported as not working. A number written +234… did not work.'],
    ['Fixed: loan offer interest', 'The Public Sector offer (#194) shows ₦60,000 interest and ₦360,000 to repay on ₦300,000 over 9 months, matching the reducing-balance schedule. The #191 offer had shown ₦1,086,004.29 interest. The offer screen also now shows the tenor in months and a repayment date.'],
    ['Still seen: VAT taken from the payout', '#191 (₦300,000) was paid out as ₦277,500, and #193 (₦250,000) as ₦231,250: 7.5% VAT is still deducted at payout although no fee is charged. See “Problems found”.'],
    ['Still not fixed', 'Card funding and Log out still do nothing, and next of kin still can’t be saved (“City cannot be empty”). The Tier 3 account still shows 2/3 identity steps. RWIN goals still offer tenors not in the rate table, and topping up from an empty wallet still doesn’t say why it can’t be paid.'],
  ],
}

const MOBILE_MISMATCHES = [
  ['App version', 'Settings shows “v2.0.0”, but the installed app is version 1.1.55.'],
  ['Public Sector loan rate', 'The app quotes “4% / month”. That is the corridor’s “booked average interim rate”. The corridor’s “policy rate” is 0.03, which the admin portal shows as “0.03%”.'],
  ['Public Sector management fee', 'The review screen adds a 1% management fee (₦3,000 on ₦300,000), as the corridor sets. The product’s fee structure (“Public sector fee”) says 0%, and the saved application has a ₦0 fee plus 7.5% VAT, which the app never shows.'],
  ['Password error wording', 'After a wrong password, the app says “Incorrect passcode. 3 attempt(s) left.” — it should say password; “passcode” is the 6-digit code used with a phone number.'],
  ['Shared attempt counter', 'Wrong attempts with email + password and with phone + passcode count towards the same limit (4 attempts in total). Product should confirm this is intended.'],
];

const MOBILE_QUESTIONS = [
  'Is the “Complete your profile” card meant to follow the customer’s KYC tier? The Tier 3 test account shows 2 of 3 steps done.',
  'How should RWIN goal interest be projected? The app shows ₦2,237.38 on ₦100,000 over 90 days at 14% — interest up to the goal’s end date. Our reading of the calculator rules (each contribution earning for a full 90-day cycle) gives about ₦3,375.',
  'Should 7.5% VAT be charged on the amount lent? It is currently taken from every loan payout as “Loan VAT”. And is there a management fee on Personal loans (the app says 1%, the admin portal says ₦0)?',
  'Which KYC tier does each investment product need? The product documents do not say.',
  'For Public Sector loans, which corridor setting is the customer’s interest rate: the “policy rate” or the “booked average interim rate”? And which fee applies: the corridor’s 1% management fee and 1% quarterly fee, or the product’s fee structure (0%)?',
  'Is the Public Sector application meant to ask for the employer (corridor), IPPIS or staff number, and retirement date, as the specification describes? This build goes straight from amount and tenure to documents.',
];

const MOBILE_SKIP_REASONS = [
  [/onboarding-login\.spec\.ts/, 'Not run: needs backend test tools (to create fresh test customers and control the clock) that the backend team has not provided yet.'],
  [/HELD/, 'Held back on purpose: this test account has only 1 sign-in attempt left, and a wrong try would lock it. It will run once the account is confirmed or reset.'],
  [/phone \+ passcode/, 'Not run: no phone number and passcode are on file for this test account yet.'],
  [/email \+ password/, 'Not run: no email and password are on file for this test account.'],
  [/home-grow-borrow\.spec\.ts .*(offers Nano, Payday|groups loans into|recommended offer stays)/, 'Not run: the Tier 3 test account has a loan in progress (one at a time), so its Borrow tab shows that loan instead of the product list. It runs again once the loan is repaid.'],
  [/schedule follows the interest rule/,'Not run: the Tier 3 test account already has a loan, and only one loan can be held at a time. It runs again once that loan is repaid.'],
  [/Loan offer shows the same terms/, 'Not run: only checked while an approved loan offer is waiting to be accepted.'],
  [/next payment countdown/, 'Not run: only checked while a loan is being repaid.'],
  [/topping up from an empty wallet/, 'Not run: only checked while the Tier 1 test wallet is empty, so the check can never move money.'],
];

/* ================================================================== helpers */

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const strip = (s) => (s || '').replace(/\x1b\[[0-9;]*m/g, '');
const cleanTitle = (t) => t.replace(/\s@\S+/g, '').replace(/\bT(\d) customer\b/g, 'Tier $1 test account').trim();
const count = (st, list) => list.filter((t) => t.status === st).length;
const fmt = (d) => d.toLocaleString('en-GB', { timeZone: 'Africa/Lagos', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
/** Problem priorities, most severe first. Anything unrecognised is treated as Medium. */
const SEVS = ['Critical', 'High', 'Medium', 'Low'];
const SEV_MEANING = {
  Critical: 'blocks a core journey for every customer (for example no one can sign up or invest)',
  High: 'affects customers’ money, security or a compliance requirement',
  Medium: 'a feature is broken, wrong or misleading, but there is a way round it',
  Low: 'minor or cosmetic; worth fixing when convenient',
};
const sevOf = (f) => (SEVS.includes(f.severity) ? f.severity : 'Medium');
const sevKey = (f) => sevOf(f).toLowerCase();
const sevRank = (s) => { const i = SEVS.indexOf(s); return i < 0 ? 2 : i; };
const sevCounts = (list) => Object.fromEntries(SEVS.map((s) => [s, list.filter((f) => sevOf(f) === s).length]));

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
          errorFull: strip(((res.errors || [])[0] || res.error || {}).message || ''),
          screenshot: (res.attachments || []).find((a) => a.name === 'screenshot' && a.path)?.path,
          video: (res.attachments || []).find((a) => a.name === 'video' && a.path)?.path,
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
    let video = null;
    if (t.video && fs.existsSync(t.video)) {
      fs.mkdirSync(path.join(outDir, 'videos'), { recursive: true });
      video = `videos/${path.basename(path.dirname(t.video)).slice(0, 40)}.webm`;
      fs.copyFileSync(t.video, path.join(outDir, video));
    }
    return { ...f, area: AREAS[t.file]?.name || t.file, shot, video, snippet: errorSnippet(t.errorFull) };
  }).concat(ADMIN_EXTRA_FINDINGS).sort((a, b) => sevRank(a.severity) - sevRank(b.severity));

  return {
    id: 'admin',
    label: 'Admin portal',
    runAt: new Date(results.stats.startTime),
    heading: 'Admin Portal Test Results',
    context: 'Chrome browser · dev environment',
    runText: `Automated check run on ${fmt(new Date(results.stats.startTime))} (WAT) · took about ${Math.round(results.stats.duration / 60000)} minutes`,
    intro: 'An automated tester used the admin portal the way a staff member would — opening pages, filling in forms and checking the results against the product documents.',
    tests, findings, areas: AREAS, mismatches: MISMATCHES, questions: QUESTIONS, changes: ADMIN_CHANGES,
    extraCount: ADMIN_EXTRA_FINDINGS.length, extraNote: 'found by hand', journeys: ADMIN_JOURNEYS, preProd: ADMIN_PRE_PROD,
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
    detail: r.detail || '',
  }));
  const fromChecks = tests.filter((t) => t.status === 'problem').map((t) => ({
    ...(MOBILE_FINDINGS.find((x) => x.match.test(t.rawTitle)) || genericFinding(t)),
    area: MOBILE_AREAS[t.file]?.name || t.file,
    // A bare matcher line ("expect(received).toBe(expected)") explains nothing, so it isn't shown.
    snippet: /^expect\(received\)[^\n]*$/.test(errorSnippet(t.detail || t.error)) ? '' : errorSnippet(t.detail || t.error),
  }));
  // One card per problem: several checks can fail for the same reason (e.g. Nano and Payday both crash),
  // and a problem found by hand may also be caught by a check.
  const seen = new Set();
  const findings = [...fromChecks, ...MOBILE_EXTRA_FINDINGS]
    .filter((f) => !seen.has(f.title) && seen.add(f.title))
    .sort((a, b) => sevRank(a.severity) - sevRank(b.severity));

  const times = rows.map((r) => new Date(r.at)).sort((a, b) => a - b);
  const mins = Math.max(1, Math.round((times[times.length - 1] - times[0]) / 60000));
  return {
    id: 'mobile',
    label: 'Mobile app',
    runAt: times[0],
    heading: 'Mobile App Test Results',
    context: mobileContext(rows),
    runText: `Automated check run on ${fmt(times[0])} (WAT) · took about ${mins} minutes`,
    intro: 'An automated tester used the Rosabon app on an Android phone the way a customer would — signing in, moving between screens and checking what they show against the product documents. Nothing was booked, borrowed or paid during these checks.',
    tests, findings, extraCount: MOBILE_EXTRA_FINDINGS.length, journeys: MOBILE_JOURNEYS,
    areas: MOBILE_AREAS, mismatches: MOBILE_MISMATCHES, questions: MOBILE_QUESTIONS, changes: MOBILE_CHANGES,
    notRunReason: (t) => (MOBILE_SKIP_REASONS.find(([re]) => re.test(`${t.held ? 'HELD ' : ''}${t.file} ${t.rawTitle}`)) || [null, 'Not run in this round.'])[1],
    techInternal: '<p class="muted">The mobile app blocks screenshots for security, so failures are recorded as the screen’s layout instead. These are in <code>reports/mobile-screens/</code> with the QA team.</p>',
    techPublic: '<p class="muted">Step-by-step technical detail is kept internally. Ask the QA team for access.</p>',
  };
}

/** The failing check's own error, trimmed to the lines that explain it (no stack, no code frame). */
function errorSnippet(msg) {
  const lines = strip(msg).split('\n').map((l) => l.replace(/\s+$/, '')).filter((l) => l.trim() && !/^\s+at /.test(l) && !/^\s*>?\s*\d* \|/.test(l));
  return lines.slice(0, 10).join('\n').slice(0, 1200);
}

/**
 * Public copy of an error: emails and phone numbers masked and "Received" values dropped. On lines the
 * test wrote itself (not locator/expect lines, which hold UI labels), anything that looks like a name is masked.
 */
function publicSnippet(s) {
  return s.split('\n').filter((l) => !/^\s*Received/.test(l)).map((l) => {
    const m = maskPII(l);
    return /^\s*(Locator:|Expected:|Call log:|- |expect\()|getBy|TimeoutError/.test(m) ? m : m.replace(/\b[A-Z][a-z]+(?: [A-Z][a-z]+)+\b|\b[A-Z]{2,}(?: [A-Z]{2,})+\b/g, '<name>');
  }).join('\n');
}

/** Two overlapping sheets; inherits the text colour. */
const COPY_ICON = '<svg class="copy-ico" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><rect x="9" y="9" width="11" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

/** "View": what the check saw when it failed. Screenshots and videos stay on the internal page. */
function evidence(f, i, pub) {
  const snippet = pub ? (f.sawPublic ? '' : f.snippet && publicSnippet(f.snippet)) : f.snippet;
  const shot = !pub && f.shot;
  const video = !pub && f.video;
  if (!snippet && !shot && !video) {
    return pub && (f.shot || f.video || f.snippet) ? '<p class="muted small">The evidence for this problem is kept in the internal report.</p>' : '';
  }
  const what = [snippet && 'error details', shot && 'screenshot', video && 'video'].filter(Boolean).join(', ');
  return `<details class="evidence"><summary>View <span class="muted">(${what})</span></summary>
          ${snippet ? `<div class="snippet-wrap">
            <button type="button" class="copy-btn" aria-label="Copy the error details for problem ${i + 1}" title="Copy error details">${COPY_ICON}<span class="copy-label">Copy</span></button>
            <pre class="snippet">${esc(snippet)}</pre>
          </div>` : ''}
          ${shot ? `<a href="${f.shot}" target="_blank" rel="noopener"><img src="${f.shot}" alt="Screenshot taken when problem ${i + 1} was found" loading="lazy"></a>` : ''}
          ${video ? `<video controls preload="none" src="${f.video}" aria-label="Recording of the check for problem ${i + 1}"></video>` : ''}
        </details>`;
}

/**
 * A collapsible list under a document-gap item: [[area, "METHOD /path", "field, field (list), …"], …].
 * Grouped by area; each endpoint shows a method badge, a path that only breaks at "/", and its fields as tags.
 * A filter box narrows the list (by area, path or field) without touching the page's own search.
 */
function gapTable(rows) {
  const groups = new Map();
  for (const r of rows) { if (!groups.has(r[0])) groups.set(r[0], []); groups.get(r[0]).push(r); }
  const endpoint = (ep) => {
    const [method, ...rest] = ep.split(' ');
    const p = esc(rest.join(' ')).replace(/\//g, '/<wbr>');
    return `<span class="gm gm-${esc(method.toLowerCase())}">${esc(method)}</span><code class="gp">${p}</code>`;
  };
  const tags = (detail) => detail.split(/,\s*/).filter(Boolean).map((f) => `<li>${esc(f)}</li>`).join('');
  const groupHtml = [...groups].map(([area, rs]) => `<section class="gg"><h4>${esc(area)} <span class="gg-n">${rs.length}</span></h4><ul class="ge">${rs.map(([a, ep, d]) => {
    const n = d.split(/,\s*/).filter(Boolean).length;
    return `<li data-q="${esc(`${a} ${ep} ${d}`.toLowerCase())}"><div class="ge-ep">${endpoint(ep)}</div><div class="ge-f"><span class="ge-fl">${n} field${n === 1 ? '' : 's'}</span><ul class="ftags">${tags(d)}</ul></div></li>`;
  }).join('')}</ul></section>`).join('');
  return `<details class="ref gaps"><summary>Show all ${rows.length} <span class="muted">· grouped by area, with the fields each request body accepts (none marked required)</span></summary>
    <div class="gaps-tools"><input type="search" class="gaps-filter" placeholder="Filter by area, endpoint or field" aria-label="Filter these ${rows.length} endpoints"><span class="gaps-count muted" aria-live="polite">${rows.length} endpoints in ${groups.size} areas</span></div>
    ${groupHtml}
    <p class="gaps-none muted" hidden>No endpoint matches the filter.</p>
    <button type="button" class="gaps-close">Hide this list</button>
  </details>`;
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
  const high = findings.filter((f) => f.severity === 'High' || f.severity === 'Critical').length;
  const n = findings.length;
  const extra = d.extraCount ? ` (including ${d.extraCount} ${d.extraNote || 'found by hand or in the app’s error log'})` : '';
  const verdict = n === 0
    ? { tone: 'good', head: 'Everything checked is working as expected', sub: `All ${checked} checks passed.` }
    : { tone: high >= 3 ? 'bad' : 'warn', head: `${high >= 3 ? 'Not ready for release' : 'Mostly working'} — ${n} problem${n > 1 ? 's' : ''} need attention${extra}`, sub: high ? `${high} of them are Critical or High priority and should be fixed before release.` : 'None of them is Critical or High priority.' };

  const areaRows = Object.entries(d.areas).map(([file, a]) => {
    const list = tests.filter((t) => t.file === file);
    if (!list.length) return '';
    const p = count('problem', list);
    const nr = count('not-run', list);
    const ran = list.length - nr;
    const badge = p ? `<span class="badge bad">${p} problem${p > 1 ? 's' : ''}</span>` : ran ? '<span class="badge ok">All good</span>' : '<span class="badge idle">Not run yet</span>';
    return `<tr><td class="area"><strong>${esc(a.name)}</strong><div class="muted">${esc(a.what)}</div></td><td class="num" data-label="Checks run">${ran}</td><td class="num" data-label="Worked">${count('passed', list)}</td><td class="result">${badge}${nr ? `<div class="muted small">${nr} not run</div>` : ''}</td></tr>`;
  }).join('');

  const sc = sevCounts(findings);
  const cards = findings.map((f, i) => `
      <article class="card finding s-${sevKey(f)}" data-sev="${sevKey(f)}">
        <header>
          <div class="finding-meta"><span class="sev s-${sevKey(f)}">${esc(sevOf(f))}</span><span class="chip">${esc(f.area)}</span><span class="finding-no muted">#${i + 1}</span></div>
          <h3>${esc(f.title)}</h3>
          <p class="muted small">Who should look at this: ${esc(f.owner)}</p>
        </header>
        ${f.status ? `<p class="status-note"><strong>Status:</strong> ${esc(f.status)}</p>` : ''}
        <p class="impact">${esc(f.impact)}</p>
        <dl>
          <dt>What we saw</dt><dd>${esc(pub && f.sawPublic ? f.sawPublic : f.saw)}</dd>
          <dt>What should happen</dt><dd>${esc(f.expected)}</dd>
        </dl>
        ${evidence(f, i, pub)}
      </article>`).join('');

  const notRunRows = tests.filter((t) => t.status === 'not-run')
    .map((t) => `<li><strong>${esc(t.title)}</strong> <span class="muted">(${esc(d.areas[t.file]?.name || t.file)})</span><br><span class="muted">${esc(d.notRunReason(t))}</span></li>`)
    .join('');

  // Checks that worked, grouped by area, in the same order as "What was checked".
  const passedGroups = Object.entries(d.areas).map(([file, a]) => {
    const list = tests.filter((t) => t.file === file && t.status === 'passed');
    if (!list.length) return '';
    return `<details class="ref passed-group"><summary>${esc(a.name)} <span class="muted">· ${list.length} worked</span></summary><ul class="clean checks">${list.map((t) => `<li><span class="tick" aria-hidden="true">✓</span> ${esc(t.title)}</li>`).join('')}</ul></details>`;
  }).join('');
  const passedOther = tests.filter((t) => t.status === 'passed' && !d.areas[t.file]);
  const passedList = passedGroups + (passedOther.length ? `<details class="ref passed-group"><summary>Other <span class="muted">· ${passedOther.length} worked</span></summary><ul class="clean checks">${passedOther.map((t) => `<li><span class="tick" aria-hidden="true">✓</span> ${esc(t.title)}</li>`).join('')}</ul></details>` : '');

  // Sub-tabs inside this area: one per kind of result, so the page doesn't scroll forever.
  const subs = [
    { id: 'overview', label: 'Overview' },
    { id: 'problems', label: 'Problems', n: n, tone: n ? 'bad' : 'ok' },
    { id: 'passed', label: 'Passed', n: passed, tone: 'ok' },
    { id: 'notrun', label: 'Not run', n: notRun, tone: 'idle' },
    ...(d.journeys ? [{ id: 'byhand', label: d.id === 'admin' ? 'Checked by hand' : 'Tried by hand', n: d.journeys.items.length, tone: 'idle' }] : []),
    ...(d.reference ? [{ id: 'endpoints', label: 'Endpoints' }] : []),
    { id: 'notes', label: 'Notes & questions' },
  ];
  const subBody = {
    overview: `${d.changes ? `
    <div class="sec">
    <h2>${d.changes.heading ? esc(d.changes.heading) : `What changed since the last run (${esc(d.changes.since)})`}</h2>
    <ul class="clean">${d.changes.items.map(([t, x]) => `<li><strong>${esc(t)}.</strong> ${esc(x)}</li>`).join('')}</ul>
    </div>` : ''}
    <div class="sec">
    <h2>What was checked</h2>
    <p class="muted">${esc(d.intro)}</p>
    <div class="table-wrap">
    <table>
      <thead><tr><th>Area</th><th class="num">Checks run</th><th class="num">Worked</th><th>Result</th></tr></thead>
      <tbody>${areaRows}</tbody>
    </table>
    </div>
    </div>`,
    problems: `
    <div class="sec">
    <h2>Problems found</h2>
    <p class="muted">These did not behave the way the product documents say they should. Most severe first.</p>
    ${n ? `<div class="sev-filter" role="group" aria-label="Show problems by priority" data-panel="${d.id}">
      <span class="sev-filter-label">Priority</span>
      <button type="button" class="fchip" data-sev="all" aria-pressed="true">All <span class="count">${n}</span></button>
      ${SEVS.map((s) => `<button type="button" class="fchip s-${s.toLowerCase()}" data-sev="${s.toLowerCase()}" aria-pressed="false" title="${esc(s)}: ${esc(SEV_MEANING[s])}"${sc[s] ? '' : ' disabled'}><i class="sev-dot" aria-hidden="true"></i>${s} <span class="count">${sc[s]}</span></button>`).join('\n      ')}
    </div>
    <p class="muted small sev-filter-status" aria-live="polite"></p>
    <details class="ref sev-help"><summary>What the priorities mean</summary><dl class="sev-defs">${SEVS.map((s) => `<dt><span class="sev s-${s.toLowerCase()}">${s}</span></dt><dd>${esc(SEV_MEANING[s][0].toUpperCase() + SEV_MEANING[s].slice(1))}.</dd>`).join('')}</dl></details>` : ''}
    ${cards || '<p>No problems were found.</p>'}
    </div>`,
    passed: `
    <div class="sec">
    <h2>Checks that worked</h2>
    <p class="muted">${passed} check${passed === 1 ? '' : 's'} behaved as the product documents say. Open an area to see each one.</p>
    ${passedList || '<p>No check passed in this run.</p>'}
    </div>`,
    notrun: `
    <div class="sec">
    <h2>Not run in this round</h2>
    <ul class="clean">${notRunRows || '<li>Everything was run.</li>'}</ul>
    </div>`,
    byhand: d.journeys ? `
    <div class="sec">
    <h2>${d.id === 'admin' ? 'What we checked by hand' : 'What we tried by hand'} (${esc(d.journeys.when)})</h2>
    <p class="muted">${esc(d.journeys.intro)}</p>
    <div class="table-wrap">
    <table>
      <thead><tr><th>Activity</th><th>Result</th></tr></thead>
      <tbody>${d.journeys.items.map(([t, tone, x]) => `<tr><td class="area"><strong>${esc(t)}</strong><div class="muted">${esc(x)}</div></td><td class="result"><span class="badge ${tone}">${tone === 'ok' ? 'Worked' : tone === 'bad' ? 'Problem' : 'Partly checked'}</span></td></tr>`).join('')}</tbody>
    </table>
    </div>
    </div>` : '',
    endpoints: d.reference ? `<div class="sec">${d.reference(pub)}</div>` : '',
    notes: `${d.preProd && d.preProd.length ? `
    <div class="sec">
    <h2>Remove before production</h2>
    <p class="muted">Test-only shortcuts the team confirmed are deliberate on the dev system. They are not counted as problems here, but each must be gone before go-live.</p>
    <ul class="clean">${d.preProd.map(([t, x]) => `<li><strong>${esc(t)}.</strong> ${esc(x)}</li>`).join('')}</ul>
    </div>` : ''}
    <div class="sec">
    <h2>${esc(d.mismatchesHeading || 'Differences from the documents (not failures)')}</h2>
    <p class="muted">${esc(d.mismatchesIntro || 'These work, but don’t match what the specifications say. Product should confirm which is correct.')}</p>
    <ul class="clean">${d.mismatches.map(([t, x, rows]) => `<li><strong>${esc(t)}.</strong> ${esc(x)}${rows ? gapTable(rows) : ''}</li>`).join('')}</ul>
    </div>

    <div class="sec">
    <h2>Questions for the product team</h2>
    <ul class="clean">${d.questions.map((q) => `<li>${esc(q)}</li>`).join('')}</ul>
    </div>

    <h2>Need the technical detail?</h2>
    ${pub ? d.techPublic : d.techInternal}`,
  };

  return `
    <p class="muted small">${esc(d.context)}</p>
    <h2 class="panel-title">${esc(d.heading)}</h2>
    <p class="muted">${esc(d.runText)}</p>

    <div class="search" role="search">
      <label for="q-${d.id}">Search the ${esc(d.label)} results</label>
      <input id="q-${d.id}" type="search" data-panel="${d.id}" autocomplete="off" spellcheck="false" placeholder="Area, problem, ${d.id === 'api' ? 'endpoint' : 'screen'}… (press / to start, Esc to clear)">
      <p class="muted small search-count" aria-live="polite"></p>
    </div>

    <section class="card verdict ${verdict.tone}">
      <h3>${esc(verdict.head)}</h3>
      <p>${esc(verdict.sub)}</p>
    </section>

    <div class="stats">
      <a class="stat" href="#${d.id}"><div class="n">${total}</div><div class="muted">checks in total</div></a>
      <a class="stat ok" href="#${d.id}/passed"><div class="n">${passed}</div><div class="muted">worked as expected <span class="go" aria-hidden="true">→</span></div></a>
      <a class="stat bad" href="#${d.id}/problems"><div class="n">${failed}</div><div class="muted">checks with a problem <span class="go" aria-hidden="true">→</span></div></a>
      <a class="stat" href="#${d.id}/notrun"><div class="n">${notRun}</div><div class="muted">not run <span class="go" aria-hidden="true">→</span></div></a>
    </div>
    ${resultBar(passed, failed, notRun)}
    <div class="legend muted"><span><i class="dot" style="background:var(--good)"></i>Worked (${passRate}% of checks that ran)</span><span><i class="dot" style="background:var(--bad)"></i>Problem</span><span><i class="dot dot-idle"></i>Not run</span></div>
    ${n ? `<h3 class="kicker">Problems by priority</h3>${sevTiles(d.id, sc)}` : ''}

    <div class="subtabs" role="tablist" aria-label="${esc(d.label)} results by kind">
      ${subs.map((s, i) => `<button class="subtab${s.tone ? ' t-' + s.tone : ''}" role="tab" id="sub-${d.id}-${s.id}" aria-controls="subpanel-${d.id}-${s.id}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}" data-panel="${d.id}" data-sub="${s.id}">${esc(s.label)}${s.n !== undefined ? ` <span class="count">${s.n}</span>` : ''}</button>`).join('\n      ')}
    </div>
    ${subs.map((s, i) => `<div class="subpanel${i === 0 ? ' on' : ''}" role="tabpanel" id="subpanel-${d.id}-${s.id}" aria-labelledby="sub-${d.id}-${s.id}" data-sub="${s.id}">
      <p class="subpanel-label">${esc(s.label)}</p>
      ${subBody[s.id]}
    </div>`).join('\n    ')}`;
}

function emptyPanel(label, how) {
  return `<h2 class="panel-title">${esc(label)} Test Results</h2><section class="card verdict"><h3>No results yet</h3><p class="muted">${esc(how)}</p></section>`;
}

/** Thin segmented bar: worked | problem | not run. Each part names itself on hover and to screen readers. */
function resultBar(passed, failed, notRun) {
  const total = passed + failed + notRun;
  const part = (cls, x, what) => (x ? `<span class="${cls}" style="flex-grow:${x}" title="${x} ${what} (${Math.round((x / total) * 100)}%)"></span>` : '');
  return `<div class="bar" role="img" aria-label="${passed} worked, ${failed} with a problem, ${notRun} not run">${part('p', passed, 'worked')}${part('f', failed, 'with a problem')}${part('s', notRun, 'not run')}</div>`;
}

/** Four priority tiles; with an area id, each opens that area's Problems tab filtered to the priority. */
function sevTiles(areaId, sc) {
  return `<div class="sev-tiles">${SEVS.map((s) => {
    const k = s.toLowerCase();
    const body = `<span class="sev-tile-n">${sc[s]}</span><span class="sev-tile-l"><i class="sev-dot" aria-hidden="true"></i>${s}</span>`;
    return sc[s] && areaId
      ? `<a class="sev-tile s-${k}" href="#${areaId}/problems/${k}" title="${esc(SEV_MEANING[s])}">${body}</a>`
      : `<span class="sev-tile s-${k} zero">${body}</span>`;
  }).join('')}</div>`;
}

/* ================================================================== central dashboard */

const MONTH_NO = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
/** The date an activity title starts with or names first ("23 November: …", "Re-run on 6 November", "5 Nov: …"). */
function activityDate(title, year) {
  const m = title.match(/\b(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\b/);
  return m ? new Date(Date.UTC(year, MONTH_NO[m[2].toLowerCase()], +m[1])) : null;
}
const stripDate = (t) => {
  const s = t.replace(/^\d{1,2}\s+[A-Z][a-z]+\.?\s*(\([^)]*\))?\s*:\s*/, '');
  return s[0].toUpperCase() + s.slice(1);
};
/** What kind of activity a change-log entry is, from its wording. */
function activityKind(title) {
  if (/not fixed|still seen|still not/i.test(title)) return ['Unresolved', 'bad'];
  if (/\bfixed\b/i.test(title)) return ['Fixed', 'ok'];
  if (/re-run|not re-run|re-checked|looked at again/i.test(title)) return ['Re-run', 'idle'];
  if (/\bnew\b|added|set up|created|switched off|removed/i.test(title)) return ['Change', 'info'];
  return ['Update', 'idle'];
}
const firstSentence = (s, max = 240) => {
  const m = s.match(/^.*?[.!?](\s|$)/);
  const one = (m ? m[0] : s).trim();
  return one.length > max ? one.slice(0, max).replace(/\s+\S*$/, '') + '…' : one;
};

/** Every dated activity across the three areas: change logs (incl. API updates) and work done by hand. */
function activities(areas, year) {
  const out = [];
  for (const d of areas) {
    for (const [title, text] of (d.changes?.items || [])) {
      const date = activityDate(title, year) || (d.id === 'api' && !API_UPDATES.some(([t]) => t === title) ? new Date(Date.UTC(d.runAt.getUTCFullYear(), d.runAt.getUTCMonth(), d.runAt.getUTCDate())) : null);
      if (!date) continue;
      const [kind, tone] = activityKind(title);
      out.push({ date, d, title: stripDate(title), text, kind, tone });
    }
    for (const [title, tone, text] of (d.journeys?.items || [])) {
      const date = activityDate(title, year);
      if (!date) continue;
      out.push({ date, d, title: stripDate(title), text, kind: d.id === 'admin' ? 'Checked by hand' : 'Tried by hand', tone: tone === 'ok' ? 'ok' : tone === 'bad' ? 'bad' : 'idle', result: tone === 'ok' ? 'Worked' : tone === 'bad' ? 'Problem' : 'Partly checked' });
    }
  }
  const order = { admin: 0, mobile: 1, api: 2 };
  return out.sort((a, b) => b.date - a.date || order[a.d.id] - order[b.d.id]);
}

function dashboard(areas, pub) {
  if (!areas.length) return emptyPanel('Overview', 'Run any of the checks to fill this in.');
  const all = areas.flatMap((d) => d.tests);
  const passed = count('passed', all), failed = count('problem', all), notRun = count('not-run', all);
  const ran = all.length - notRun;
  const rate = ran ? Math.round((passed / ran) * 100) : 0;
  const findings = areas.flatMap((d) => d.findings.map((f) => ({ ...f, src: d })));
  const sc = sevCounts(findings);
  const urgent = sc.Critical + sc.High;
  const latest = new Date(Math.max(...areas.map((d) => +d.runAt)));
  const notReady = sc.Critical > 0 || sc.High >= 3;
  const verdict = !findings.length
    ? { tone: 'good', head: 'Everything checked is working as expected', sub: `All ${ran} checks that ran passed across ${areas.length} area${areas.length > 1 ? 's' : ''}.` }
    : {
      tone: notReady ? 'bad' : 'warn',
      head: `${notReady ? 'Not ready for release' : 'Mostly working'} — ${findings.length} open problem${findings.length > 1 ? 's' : ''}`,
      sub: [sc.Critical && `${sc.Critical} Critical (a core journey is blocked)`, sc.High && `${sc.High} High (money, security or compliance)`, sc.Medium && `${sc.Medium} Medium`, sc.Low && `${sc.Low} Low`].filter(Boolean).join(' · '),
    };

  const kpis = [
    ['Checks in total', all.length, '', `${areas.length} area${areas.length > 1 ? 's' : ''}: ${areas.map((d) => d.label).join(', ')}`],
    ['Pass rate', `${rate}%`, rate >= 90 ? 'ok' : '', `${passed} of ${ran} checks that ran worked`],
    ['Open problems', findings.length, findings.length ? 'bad' : 'ok', `from ${failed} failing check${failed === 1 ? '' : 's'}, plus problems found by hand`],
    ['Critical & High', urgent, urgent ? 'bad' : 'ok', urgent ? 'fix before release' : 'nothing blocking release'],
    ['Not run', notRun, '', 'switched-off pages, missing test data or held on purpose'],
  ];

  // Priority × area: where the problems are. Each count opens that area's problems at that priority.
  const cell = (d, s) => {
    const x = d.findings.filter((f) => sevOf(f) === s).length;
    return x ? `<td class="num"><a class="mcell s-${s.toLowerCase()}" href="#${d.id}/problems/${s.toLowerCase()}" aria-label="${x} ${s} in ${esc(d.label)}">${x}</a></td>` : '<td class="num"><span class="muted" aria-label="none">–</span></td>';
  };
  const matrix = `<div class="table-wrap scroll"><table class="matrix">
      <thead><tr><th>Area</th>${SEVS.map((s) => `<th class="num"><span class="th-sev"><i class="sev-dot s-${s.toLowerCase()}" aria-hidden="true"></i>${s}</span></th>`).join('')}<th class="num">Total</th></tr></thead>
      <tbody>${areas.map((d) => `<tr><th scope="row"><a href="#${d.id}">${esc(d.label)}</a></th>${SEVS.map((s) => cell(d, s)).join('')}<td class="num"><a href="#${d.id}/problems"><strong>${d.findings.length}</strong></a></td></tr>`).join('')}</tbody>
      <tfoot><tr><th scope="row">All areas</th>${SEVS.map((s) => `<td class="num"><strong>${sc[s] || '–'}</strong></td>`).join('')}<td class="num"><strong>${findings.length}</strong></td></tr></tfoot>
    </table></div>`;

  const areaCards = areas.map((d) => {
    const t = d.tests;
    const p = count('passed', t), f = count('problem', t), nr = count('not-run', t);
    const r = t.length - nr ? Math.round((p / (t.length - nr)) * 100) : 0;
    const asc = sevCounts(d.findings);
    return `<a class="area-card" href="#${d.id}">
        <div class="area-head"><span class="area-icon" aria-hidden="true">${tabs.find((x) => x.id === d.id).icon}</span><div><h3>${esc(d.label)}</h3><p class="muted small">${esc(d.context)}</p></div></div>
        <p class="area-rate"><span class="big">${r}%</span> <span class="muted">of checks that ran worked</span></p>
        ${resultBar(p, f, nr)}
        <ul class="area-nums"><li><strong>${p}</strong> worked</li><li><strong>${f}</strong> failed</li><li><strong>${nr}</strong> not run</li></ul>
        <p class="area-sev">${d.findings.length ? SEVS.filter((s) => asc[s]).map((s) => `<span class="sev s-${s.toLowerCase()}">${asc[s]} ${s}</span>`).join(' ') : '<span class="badge ok">No open problems</span>'}</p>
        <p class="muted small">Last run ${esc(fmt(d.runAt))}</p>
        <span class="go">Open ${esc(d.label)} results <span aria-hidden="true">→</span></span>
      </a>`;
  }).join('');

  const top = findings.filter((f) => sevRank(sevOf(f)) <= 1).sort((a, b) => sevRank(sevOf(a)) - sevRank(sevOf(b)));
  const attItem = (f) => `<li>
        <span class="sev s-${sevKey(f)}">${esc(sevOf(f))}</span>
        <div><a href="#${f.src.id}/problems/${sevKey(f)}">${esc(f.title)}</a><div class="muted small">${esc(f.src.label)} · ${esc(f.area)} · ${esc(f.owner)}</div></div>
      </li>`;
  const SHOW_TOP = 6;
  const attention = top.length ? `<ol class="attention">${top.slice(0, SHOW_TOP).map(attItem).join('')}</ol>
      ${top.length > SHOW_TOP ? `<details class="ref"><summary>Show all ${top.length} <span class="muted">· ${top.length - SHOW_TOP} more</span></summary><ol class="attention">${top.slice(SHOW_TOP).map(attItem).join('')}</ol></details>` : ''}` : '<p class="muted">No Critical or High problems are open.</p>';

  const acts = activities(areas, latest.getUTCFullYear());
  const dayKey = (dt) => dt.toISOString().slice(0, 10);
  const days = [];
  for (const a of acts) {
    const last = days[days.length - 1];
    if (last && last.key === dayKey(a.date)) last.items.push(a); else days.push({ key: dayKey(a.date), date: a.date, items: [a] });
  }
  const dayLabel = (dt) => dt.toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'long' });
  const actItem = (a) => {
    const lead = firstSentence(a.text);
    const more = a.text.length > lead.length + 2;
    return `<li class="act">
          <div class="act-tags"><span class="src src-${a.d.id}">${esc(a.d.label)}</span><span class="badge ${a.tone}">${esc(a.kind)}</span>${a.result ? `<span class="badge ${a.tone}">${esc(a.result)}</span>` : ''}</div>
          <p class="act-title"><strong>${esc(a.title)}</strong></p>
          <p class="muted act-lead">${esc(lead)}</p>
          ${more ? `<details class="act-more"><summary>Read more</summary><p>${esc(a.text)}</p></details>` : ''}
        </li>`;
  };
  const dayBlock = (g) => `<li class="day"><h3 class="day-label"><time datetime="${g.key}">${esc(dayLabel(g.date))}</time> <span class="muted small">· ${g.items.length} ${g.items.length === 1 ? 'activity' : 'activities'}</span></h3><ul class="acts">${g.items.map(actItem).join('')}</ul></li>`;
  const SHOW_DAYS = 4;
  const older = days.slice(SHOW_DAYS);
  const timeline = days.length ? `<ol class="timeline">${days.slice(0, SHOW_DAYS).map(dayBlock).join('')}</ol>
    ${older.length ? `<details class="ref older"><summary>Show earlier activity <span class="muted">· ${older.reduce((x, g) => x + g.items.length, 0)} more, back to ${esc(dayLabel(older[older.length - 1].date))}</span></summary><ol class="timeline">${older.map(dayBlock).join('')}</ol></details>` : ''}` : '<p class="muted">No dated activity recorded yet.</p>';
  const actCounts = ['Fixed', 'Unresolved', 'Change', 'Re-run'].map((k) => [k, acts.filter((a) => a.kind === k).length]).concat([['By hand', acts.filter((a) => /by hand/.test(a.kind)).length]]);

  return `
    <p class="muted small">All areas · dev environment · latest run ${esc(fmt(latest))} (WAT)</p>
    <h2 class="panel-title">System overview</h2>
    <p class="muted">Everything the automated and hand checks found across the admin portal, the mobile app and the API, and what has changed recently. Select any number to see the detail behind it.</p>

    <section class="card verdict ${verdict.tone}">
      <h3>${esc(verdict.head)}</h3>
      <p>${esc(verdict.sub)}</p>
    </section>

    <div class="kpis">${kpis.map(([label, v, tone, sub]) => `<div class="kpi ${tone}"><div class="kpi-l">${esc(label)}</div><div class="kpi-v">${esc(v)}</div><div class="muted small">${esc(sub)}</div></div>`).join('')}</div>

    <div class="dash-grid">
      <section class="dash-col">
        <h2>Open problems by priority</h2>
        ${sevTiles(null, sc)}
        <p class="muted small">By area — select a number to open those problems.</p>
        ${matrix}
      </section>
      <section class="dash-col">
        <h2>Fix first</h2>
        <p class="muted small">Critical and High problems across every area, most severe first.</p>
        ${attention}
      </section>
    </div>

    <h2>Areas</h2>
    <div class="area-cards">${areaCards}</div>

    <h2>Recent activity</h2>
    <p class="muted">New builds and re-runs, fixes, set-up changes and checks done by hand, newest first.</p>
    <ul class="act-summary">${actCounts.filter(([, x]) => x).map(([k, x]) => `<li><strong>${x}</strong> ${esc(k === 'By hand' ? 'checked by hand' : k === 'Change' ? 'changes' : k === 'Re-run' ? 're-runs' : k.toLowerCase())}</li>`).join('')}</ul>
    ${timeline}`;
}

/* ================================================================== API — vocabulary and results */

const apiDir = path.join(root, 'reports/api-results');
const apiSnapshot = path.join(root, 'api-dev/openapi.snapshot.json');
const API_METHODS = ['get', 'post', 'put', 'patch', 'delete'];
/** What a few endpoints hold, so findings don't read as bare paths (internal page only). */
const API_NOTES = {
  'GET /api/v3/leads': 'sales leads: names, phone numbers, email and home addresses, net salary',
  'GET /api/v3/loan-applications/{userId}/user': 'loan applications',
  'GET /api/v3/loan-approval-workflows': 'loan approval set-up: approvers, amount limits, credit-score thresholds',
  'GET /api/v3/general-approval-workflows': 'general approval set-up and approvers',
  'GET /api/v3/referral-histories/admin': 'referral history for all customers',
};
/** Public by design (leads, countries and states; confirmed 19 November): answering without sign-in is a documentation gap there, not a leak. */
const PUBLIC_REFERENCE = /^\/api\/v3\/(leads|country|state|lga)(\/|$)/;
/** Same rule as api-dev/spec.ts isAdminOnly. */
const API_ADMIN_TAGS = ['Account Control Endpoints', 'General Approval Workflow Endpoints', 'Investment Management Endpoints', 'Investment Report Endpoints', 'Loan Report Endpoints', 'Loan Approval Workflow Endpoints', 'System-Wide Audit Log Endpoints', 'Portal Admin User Endpoints', 'Message Template Endpoints'];
const apiAdminOnly = (op) => API_ADMIN_TAGS.includes(op.tag) || /\/admin(\/|-|$)/.test(op.path);
/** Found by hand while building the checks (2026-11-03). */
const API_DOC_NOTES = [
  ['Paging starts at 1', 'List endpoints take pageNo starting at 1 — pageNo=0 is rejected as “pageNo is required”. Leaving out the optional pageNo on GET /api/v3/loan-products fails with “Page index must not be less than zero”. The API document says neither.'],
];
const API_QUESTIONS = [
  'Where in the app does a customer re-enter their BVN and agree to a credit check (POST /api/v3/loan-products/credit-check)? On 24 November no loan had a bureau report because no customer had done this step.',
  'Should Payday products have a debt-to-income limit? On 24 November their bank assessments say “Product has no DTI limit” and pass at any level.',
  'Where should NIN verification happen in the app? The ticket says during onboarding, but the app has no NIN step. (The API itself verifies a NIN correctly since 24 November.)',
  'Should the completed KYC steps (GET /api/v3/users/completed-user-tier) include NIN once it is verified? On 24 November it did not, and it listed email and phone as completed although the profile shows them as not verified.',
  'Which roles may call each staff-only area? The API document does not say, so these checks treat Investment Management, the Investment and Loan reports, the approval workflows, the audit log, account controls and portal admin users as staff-only.',
  'Can the API document mark which parameters and request fields are required? Many are only enforced by the server.',
];
const maskPII = (s) => String(s).replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '<email>').replace(/(\+?234|0)[789][01]\d{8}/g, '<phone>');
const apiAreaName = (tag) => (tag === 'lead-api-resource' ? 'Leads' : tag.replace(/ Endpoints$/, ''));

/** What the latest backend update changed, written up after each re-run (shown above the live comparison). */
const API_UPDATES = [
  ['24 November: re-run, wallet (Wema) and loan decisioning checked', 'Re-run after a dev outage interrupted the first attempt: 149 checks passed, nothing new broken. Fixed: credit reports for a loan (GET /api/v3/loan-applications/{id}/credit-reports) no longer fail for the loan the check uses — but they still fail for a declined loan (see “Problems found”). New in the API document: a Freshdesk webhook (POST /api/v3/webhooks/freshdesk); it correctly refuses calls without its secret or with a wrong one (401). Wallet tickets (720, 739, 741–743): every test customer has a Wema account number; a test bank transfer (POST /api/v3/simulation/wallet-inflows) credits the wallet at once; a wallet-to-wallet send settles in about 7 seconds and both sides are notified; Wema account balance (GET /api/v3/wema/{accountNumber}/balance) still answers 400 “Vendor not found”. Loan decisioning tickets (422, 423, 424): the Mono endpoints (link a bank account, linked accounts, direct-debit mandate, bank-statement assessment for staff) answer correctly; there are no separate endpoints for underwriting or routing, so their effect was checked on the latest 40 loans — the same credit score everywhere and assessments that pass failed checks (see “Problems found”).'],
  ['24 November: NIN verification fixed', 'PATCH /api/v3/users/verify-nin now accepts the account holder’s own NIN: “Operation successful” (200) in about 1 second, and the profile then shows the NIN as verified. On 23 November the same account and NIN were refused with “First name does not match NIN details”. A NIN that belongs to someone else is still refused with that message, and a malformed NIN with “Your NIN is invalid” (both correct). One open question: the customer’s list of completed KYC steps (GET /api/v3/users/completed-user-tier) does not include NIN after verification, and it lists “Email Address” and “Phone Number” although the profile shows both as not verified.'],
  ['23 November: NIN, investment funding and loan calculator', 'NIN verification now reaches the identity provider, but refuses the owner’s own NIN (fixed 24 November). Investment funding works through the API (POST /api/v3/investments/{id}/funding) when the transaction PIN is sent; without it the answer is “Your transaction PIN is required”, and a customer who has no PIN gets “Set up a transaction PIN before funding an investment”. The loan calculator matches the specification’s worked examples for monthly loans (₦6M over 6 months at 2% a month: ₦6,720,000 flat, ₦6,420,000 reducing balance) but not for daily loans (see the admin problem about Nano and Payday). New in the API document: POST /api/v3/loan-calculations/overdue-loan. Re-run on 23 November (the 19 November results were lost when the test sign-in was refreshed): 26 endpoints added since 19 November — plan break requests (customer request; staff list, approve, decline), credit-bureau reports and credit checks for loans, customer upload of documents requested for a loan, sanctions and PEP screening (queue, clear, confirm, escalate, enhanced due diligence), and simulation endpoints for test transfers into a wallet. New problem: GET /api/v3/loan-applications/{id}/credit-reports fails with a server error (500); the new break-request answers send dates in a different format from the API document. Nothing reported earlier is fixed.'],
  ['19 November: “not run” checks looked at again', 'Four checks that used to be skipped now run, and all four work: LGAs for a state, KYC tier by name, one field classification, and the auto-rollover default preview. They were skipped because the check couldn’t find a value to call them with (the lists name it differently, or answered later in the run); the check now finds it. Still not run, because dev has no records to try them with: account-control requests, rollover, unlock and withdrawal requests, auto-rollover and statutory-rate propagations, a customer’s referral history by code (no referral code on the test customers), media details and media by URL, and Wema transaction status. “Generate user account number” stays out on purpose (a GET that creates data).'],
  ['19 November: 6 problems fixed; both server errors remain', 'Re-run after the team reported the fixes (run 11:28, no slow or timed-out answers). Fixed: a customer is now refused (403) by general approval workflows, loan approval workflows, message templates and the staff referral history; a customer can no longer read another customer’s loans (loan-applications/{userId}/user answers 403); residential address now answers 401 without sign-in (it was 400). Saved beneficiaries now refuse any currency other than NGN. Still not fixed: server error 500 on /api/v3/users/pending-address-verification (for staff too) and /api/v3/wema/bills; Wema account balance still answers 400 “Vendor not found”; attestation and PEP declaration still answer 400 instead of 401 without sign-in; a made-up bank code is still accepted for a beneficiary, and there is still no way to edit one (405); the response-format mismatches are unchanged. New in the API document: POST /api/v3/loan-calculations/overdue-loan (changes nothing, but not part of the read-only checks).'],
  ['18 November: 11 endpoints added; beneficiary rule fixed', 'New: discovery banners (add, list, update, publish, unpublish, mark as pending, delete — a new “DISCOVERY_BANNER” approval type comes with them), “completed KYC tiers” for a customer, “upgrade user tier”, and “all wallet histories”. The two new read-only endpoints (completed tiers, all wallet histories) work. “Upgrade user tier” and the banner endpoints change data, so the read-only checks don’t call them; testing “upgrade tier” needs a spare customer account, because it permanently moves a customer up a tier. Saved beneficiaries: the 10-digit rule moved from the account name to the account number, so real names can now be saved and an account number like “abc” is refused. Results (run 08:41, no slow or timed-out answers): 133 worked, 17 problems (was 18). “Verify loan product with corridor” now answers successfully (possibly because of a data change). No other earlier problem is fixed.'],
  ['17 November: re-run; no API change', 'The API document was identical to 16 November’s, so the announced changes (beneficiaries, account creation and tier assignment, “human metrics”) were not yet on dev. Saved beneficiaries were tried by hand: saving a recipient with a real name was refused (“Account name must contain exactly 10 digits”), any text was accepted as the account number, and there was no way to update a saved recipient. No endpoint called “human metrics” exists on dev. Seven endpoints were slow during this run (5–19 s) but answered in about 0.2 s straight after, so that was a passing slowdown.'],
  ['16 November: 20 endpoints added, 3 removed', 'New: Wema bank services (account lookup, balance, name enquiry, transfers, transaction status, and bill payments), saved account beneficiaries, a new address verification (register location, complete phase one), audit-log coverage and fallback replay, and “generate user account number”. Removed: the old residential address, physical verification and validate-address endpoints. Results (run at 13:34, before the network problem below): none of the 16 earlier problems is fixed; two of the new read-only endpoints fail — Wema bills (server error 500) and Wema account balance (400 “Vendor not found”). “Generate user account number” is a GET that creates an account number: the check called it once as the test customer, and it is now left out of the checks (a GET should never change data).'],
  ['16 November: NIN verification tried again', 'A malformed NIN is now refused properly (400 “Your NIN is invalid”; it used to be a server error). A valid-looking NIN (from the tester) waits about 60 seconds and ends in a 504 Gateway Time-out, twice: the call to the NIN provider seems never to return. Not yet working.'],
  ['16 November: dev API stopped answering the test network', 'From about 14:00 the dev API accepted connections from the test office but sent no reply, on and off, while outside locations got normal answers. This looks like rate limiting or a temporary block of that address on the dev server; the team has been asked to check and allow it.'],
  ['10 November: re-run', 'No endpoints added or removed since 9 November afternoon. Same results: the same 16 problems; nothing was fixed.'],
  ['9 November (afternoon): 2 new endpoints', 'Start and verify an onboarding liveliness check (the selfie check during sign-up, before the account is finished). Both expect the short-lived token issued during sign-up, so they could not be tried end to end without creating a new account. Two small problems: with no token they answer 400 “Authorization token is required” instead of the 401 the document promises, and a normal signed-in customer’s token gets the same message, which wrongly suggests no token was sent. The saved copy was refreshed.'],
  ['9 November (afternoon): re-run', 'Same results as this morning: 126 checks passed and the same 16 problems remain; nothing was fixed. NIN verification still fails with a server error for any NIN, and the customer’s pending address verifications still fail.'],
  ['9 November: NIN verification tried', 'Called as the Tier 1 and Tier 3 test customers with values that can’t belong to a real person. Without a NIN it answers “nin is required” (correct). With any NIN — too short (123), letters, or 11 digits (00000000000, 12345678901) — it fails with a server error (500), returning the web server’s own error page instead of the API’s JSON. A malformed NIN should be refused with a clear message, and an unknown one reported as not found; the identity provider may not be connected on the test system. Not tried with a real NIN. None of the three test accounts has a verified NIN, including Tier 3.'],
  ['9 November: re-run', 'No endpoints added or removed. Fixed: the notification inbox now answers (it used to fail with a server error); its document now says it returns a normal JSON page instead of a live stream. Everything else answers as on 6 November, including the server error on the customer’s pending address verifications.'],
  ['6 November: 6 new endpoints', 'Liveness checks (a provider callback and “start a liveliness check”), residential address verification (list pending, request a physical check, validate) and “mark notification as read”. The saved copy was refreshed. The one read-only endpoint among them, the customer’s pending address verifications, fails with a server error (see “Problems found”). The notification inbox’s answer format also changed.'],
  ['6 November: re-run', 'Everything else answers as on 4 November. A customer can read the message templates; this is now reported as a security problem. One check that couldn’t run before (a loan’s additional documents) now runs and passes.'],
  ['5 November: backlog status check', 'Force close, write off and waive penalty are live: they refuse a signed-out caller and a customer, and accept staff (tried only with a loan number that doesn’t exist, so nothing changed). The general approval workflow (create, edit, delete, approve, reject, withdraw, pending actions) and message templates (add, list, update, delete) are live. NIN verification answers “nin is required” without a NIN, but fails with a server error for any NIN (see 9 November). There is nothing for human metrics. A customer can read the message templates as well as the approval set-up; message templates are now treated as staff-only, so the next full run checks this.'],
  ['3 November: 7 new notification endpoints', 'The saved copy was refreshed and the 4 read-only ones were checked. The notifications list works; the notification inbox fails with a server error (see “Problems found”); the live notification stream stays open by design, so it is listed as not run; a single notification needs an ID that no list provided.'],
  ['3 November: fixed', 'The overdue-loans list now answers. It used to fail with “Principal must be greater than zero”.'],
  ['3 November: still not fixed', 'Customer leads are still readable without signing in, and a customer can still read other customers’ loan applications and the approval set-up. Everything else is also as before.'],
];

function readApi() {
  const recFile = path.join(apiDir, 'records.jsonl');
  if (!fs.existsSync(recFile) || !fs.existsSync(apiSnapshot)) return null;
  const spec = JSON.parse(fs.readFileSync(apiSnapshot, 'utf8'));
  const schemas = spec.components?.schemas || {};
  const ops = [];
  for (const [p, item] of Object.entries(spec.paths)) {
    for (const m of API_METHODS) {
      const o = item[m];
      if (!o) continue;
      ops.push({
        method: m.toUpperCase(), path: p, tag: (o.tags && o.tags[0]) || 'Other', summary: o.summary || o.operationId || '',
        secured: Array.isArray(o.security) && o.security.length > 0, params: [...(item.parameters || []), ...(o.parameters || [])],
        body: o.requestBody && Object.values(o.requestBody.content || {})[0]?.schema,
      });
    }
  }
  const byKey = new Map();
  for (const line of fs.readFileSync(recFile, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const r = JSON.parse(line);
    byKey.set(`${r.method} ${r.path}`, r); // a re-run keeps its last result
  }
  const recs = [...byKey.values()];
  if (!recs.length) return null;
  const key = (r) => `${r.method} ${r.path}`;
  const isReference = (r) => PUBLIC_REFERENCE.test(r.path);
  /** A record's real failures (public reference data answering without sign-in is a doc gap, not a failure). */
  const failures = (r) => Object.entries(r.checks).filter(([k, v]) => v === 'fail' && !(k === 'noAuth' && isReference(r))).map(([k]) => k);

  const tests = recs.map((r) => ({
    file: r.tag, title: key(r), rawTitle: key(r), skipReason: r.reason || '',
    status: r.outcome === 'not-run' ? 'not-run' : failures(r).length ? 'problem' : 'passed',
  }));

  const counts = {};
  for (const op of ops) {
    const c = (counts[op.tag] = counts[op.tag] || { all: 0, reads: 0 });
    c.all++;
    if (op.method === 'GET') c.reads++;
  }
  const areas = Object.fromEntries(Object.entries(counts).sort(([a], [b]) => apiAreaName(a).localeCompare(apiAreaName(b))).map(([tag, c]) => [tag, {
    name: apiAreaName(tag),
    what: `${c.all} endpoint${c.all > 1 ? 's' : ''}: ${c.reads} read-only (checked)${c.all - c.reads ? `, ${c.all - c.reads} that create, change or delete data (documented, not called)` : ''}.`,
  }]));

  // ---- Problems: one card per kind. Security cards name no endpoints on the public page.
  const named = (rs, extra = () => '') => rs.map((r) => `${key(r)}${API_NOTES[key(r)] ? ` (${API_NOTES[key(r)]})` : ''}${extra(r)}`).join('; ');
  const failing = (check) => recs.filter((r) => failures(r).includes(check));
  const warning = (check) => recs.filter((r) => r.checks[check] === 'warn');
  const offPublic = 'The endpoint list is in the internal report — kept off this public page on purpose.';
  const findings = [];
  // "View" evidence: the redacted request/answer each record kept for the check behind the card.
  const CHECKS_FOR = {
    'Data is available without signing in': ['noAuth'], 'A customer can read another customer’s records': ['otherCustomer'],
    'A customer sign-in can read staff-only data': ['customerOnAdmin'], 'Some endpoints fail instead of answering': ['call'],
    'Some answers don’t match their documented format': ['schema'], 'Some endpoints are slow': ['speed'],
    'Some endpoints refuse with the wrong error code': ['noAuth', 'customerOnAdmin'],
  };
  const apiSnippet = (rs, checks) => rs.flatMap((r) => checks.map((c) => r.evidence?.[c]).filter(Boolean)).slice(0, 6).map(maskPII).join('\n\n────────\n\n');
  // The public page names the exact endpoints too (asked for on 19 November); sawPublic stays set so the
  // request/answer samples, which can hold customer data, are still kept off it.
  const add = (rs, f) => { if (rs.length) findings.push({ area: 'API', owner: 'Engineering (backend)', snippet: apiSnippet(rs, CHECKS_FOR[f.title] || []), ...f, ...(f.sawPublic ? { sawPublic: f.saw } : {}) }); };
  const noAuth = failing('noAuth');
  add(noAuth, {
    title: 'Data is available without signing in', severity: 'High', owner: 'Engineering (backend) and Security',
    impact: 'Anyone who knows the address can read this data — no account needed. It includes personal data.',
    saw: `${noAuth.length} endpoint${noAuth.length > 1 ? 's' : ''} answered with data to a request with no sign-in: ${named(noAuth)}.`,
    sawPublic: `${noAuth.length} endpoint${noAuth.length > 1 ? 's' : ''} answered with data to a request with no sign-in. ${offPublic}`,
    expected: 'Every endpoint holding customer or business data should refuse requests that are not signed in (401).',
  });
  const other = failing('otherCustomer');
  add(other, {
    title: 'A customer can read another customer’s records', severity: 'High', owner: 'Engineering (backend) and Security',
    impact: 'Any signed-in customer can read other customers’ records by changing the ID in the request.',
    saw: `Signed in as the Tier 3 test customer and asking for the Tier 1 test customer’s ID returned Tier 1’s records: ${named(other)}.`,
    sawPublic: `Signed in as one test customer and asking for another test customer’s ID returned the other customer’s records on ${other.length} endpoint${other.length > 1 ? 's' : ''}. ${offPublic}`,
    expected: 'A customer should only ever get their own records (403 or 404 for anyone else’s).',
  });
  const staff = failing('customerOnAdmin');
  add(staff, {
    title: 'A customer sign-in can read staff-only data', severity: 'High', owner: 'Engineering (backend) and Security',
    impact: 'Customers can see internal set-up meant for staff, such as who approves loans and the limits used.',
    saw: `A customer sign-in got data from ${staff.length} staff-only endpoint${staff.length > 1 ? 's' : ''}: ${named(staff)}.`,
    sawPublic: `A customer sign-in got data from ${staff.length} staff-only endpoint${staff.length > 1 ? 's' : ''}. ${offPublic}`,
    expected: 'Staff-only areas should refuse customer sign-ins (403).',
  });
  const broken = failing('call');
  add(broken, {
    title: 'Some endpoints fail instead of answering', severity: 'Medium',
    impact: 'The app or portal screens that use these endpoints will show errors or empty data.',
    saw: named(broken, (r) => {
      const msg = (r.problems.find((p) => /^(answered|server|no answer)/.test(p)) || '').match(/“.*”/)?.[0];
      return ` → ${r.status === 0 ? 'no answer' : r.status}${msg ? `: ${maskPII(msg)}` : ''}`;
    }) + '.',
    expected: 'A correct request should get a successful answer (2xx).',
  });
  const format = failing('schema');
  add(format, {
    title: 'Some answers don’t match their documented format', severity: 'Medium',
    impact: 'Apps built from the API document will misread these answers — for example dates sent as lists of numbers instead of text.',
    saw: named(format, (r) => ` → ${r.problems.filter((p) => p.startsWith('format:')).slice(0, 2).map((p) => p.slice(8)).join('; ')}`) + '.',
    expected: 'Each answer should match the format the API document gives for it, or the document should be corrected.',
  });
  const slow = failing('speed');
  add(slow, {
    title: 'Some endpoints are slow', severity: 'Medium',
    impact: 'Screens using them will feel slow.',
    saw: named(slow, (r) => ` (${(r.ms / 1000).toFixed(1)} s)`) + '.',
    expected: 'Answers within 5 seconds on the dev system.',
  });
  const wrongCode = [...warning('noAuth'), ...warning('customerOnAdmin')];
  add(wrongCode, {
    title: 'Some endpoints refuse with the wrong error code', severity: 'Low', owner: 'Engineering (backend)',
    impact: 'The request is refused, but with “bad request” (400) instead of “not signed in” (401) or “not allowed” (403), so apps can’t tell the customer to sign in again.',
    saw: `${wrongCode.length} endpoint${wrongCode.length > 1 ? 's' : ''}: ${named(wrongCode)}.`,
    sawPublic: `${wrongCode.length} endpoint${wrongCode.length > 1 ? 's' : ''}. ${offPublic}`,
    expected: 'Refuse unsigned requests with 401 and wrong-role requests with 403.',
  });

  // Tried by hand on 18 November (beneficiary save / list / search / delete round trip, cleaned up after).
  findings.push({
    area: 'API', owner: 'Engineering (backend)', severity: 'Medium',
    title: 'Saved beneficiaries accept a bank that doesn’t exist, and can’t be edited',
    impact: 'Customers can save recipients that can never be paid (a bank that doesn’t exist), and must delete and re-add a recipient to correct a typo.',
    saw: 'Signed in as a test customer: POST /api/v3/user-account-beneficiaries saved a recipient with bank code “999” and bank name “Not A Bank” (201; still so on 19 November). Currency is fixed: since 19 November anything other than NGN is refused (“Currency can only be NGN”). There is no endpoint to change a saved recipient: PUT and PATCH on /api/v3/user-account-beneficiaries/{id} answer 405. What works: a recipient with a real-style name and a 10-digit account number saves; “abc” or a 5-digit number is refused; the same recipient can’t be saved twice; another customer can’t see, search or delete it; delete works, and deleting again gives 404. The test recipients were deleted afterwards.',
    expected: 'Only accept bank codes from the supported bank list (ideally with an account-name check), and offer an update endpoint as announced.',
  });

  // 'NIN verification refuses the NIN owner’s own account' (High, 23 Nov) — fixed 24 November, see API_UPDATES.

  // Loan decisioning (tickets 422, 423, 424), checked by hand on 24 November against the last 40 loans.
  findings.push({
    area: 'API', owner: 'Engineering (backend, loan decisioning)', severity: 'High',
    title: 'Every loan gets the same credit score, 569',
    impact: 'Automated underwriting can’t tell a good borrower from a bad one if the score never changes; it looks like a fixed placeholder.',
    saw: '24 November: GET /api/v3/loan-applications (staff) — all of the latest 40 loans, from 15 different customers, products and dates (11 to 24 November), have creditScore 569. No credit bureau report has been pulled for any of them (see the next problem), so the score can’t come from the bureaus.',
    expected: 'Work out the score per customer and application from the bureau and bank-statement data, as the decisioning ticket (423) describes, or leave it empty until it can be worked out.',
  });
  findings.push({
    area: 'API', owner: 'Engineering (backend, loan decisioning)', severity: 'High',
    title: 'The bank-statement check passes loans whose creditworthiness check failed or never ran',
    impact: 'Loans can be approved even though the Mono check failed, so the automated decision doesn’t protect Rosabon from risky lending.',
    saw: '24 November, GET /api/v3/mono/admin/loan-applications/{id}/bank-assessment: loans #205 and #206 show creditworthinessStatus “FAILED” (“Mono: BVN does not match sandbox BVN”) but passed: true; loans #207, #217 and #219 show “SKIPPED_NO_BVN” and passed: true. canAfford is empty on every assessment. Payday loans have no debt-to-income limit (“Product has no DTI limit”), so #207 passed at 39% of income. Bureau reports: GET /api/v3/loan-applications/{id}/credit-reports says for every loan “The customer hasn’t re-entered their BVN and agreed to a credit check yet”, so no bureau check has run on any loan. On dev every bank assessment uses the same Mono test account and name, which is expected for the Mono sandbox.',
    expected: 'Fail or hold for review a loan whose creditworthiness check failed or was skipped, fill canAfford, and require the bureau check (or a staff decision) before approval.',
  });
  findings.push({
    area: 'API', owner: 'Engineering (backend)', severity: 'Medium',
    title: 'Credit reports for a declined loan fail with a server error',
    impact: 'Staff looking at a closed application get a crash page instead of the reports or a clear message.',
    saw: '24 November: GET /api/v3/loan-applications/218/credit-reports (a declined Personal loan) answers 500 with the web server’s own error page, twice. The same call works for other loans, which is why the automatic check — that uses a different loan — now passes.',
    expected: 'Return the reports, or a 4xx with a clear message if reports are not available for a closed loan.',
  });
  findings.push({
    area: 'API', owner: 'Engineering (backend, wallet)', severity: 'Low',
    title: 'Wallet history puts credits in the “debit” field',
    impact: 'Anything that adds up credits and debits from the API (reports, exports, reconciliation) will get wrong totals.',
    saw: '24 November, GET /api/v3/wallet-histories (customer): a ₦1,000 incoming bank transfer is returned as transactionType “CREDIT” with credit: null and debit: 1000; every entry, credit or debit, has its amount in “debit”. The app shows the direction correctly because it reads transactionType. The incoming transfer also has wemaInflow: false and no sender name (“Simulated inflow”), and on the receiving side of a wallet-to-wallet transfer the description names the receiver (“Transfer to Rosabon/<receiver>”) instead of the sender.',
    expected: 'Put the amount in “credit” for credits, mark Wema inflows, and describe a received transfer with the sender’s name.',
  });

  // ---- Documentation gaps (not failures)
  const docGaps = [...API_DOC_NOTES];
  const requiredButOptional = recs.filter((r) => r.problems.some((p) => /is required”/.test(p)));
  if (requiredButOptional.length) docGaps.push(['Parameters documented as optional but required', named(requiredButOptional, (r) => ` (${maskPII(r.problems.find((p) => /is required”/.test(p)).match(/“(.*)”/)[1])})`) + '.']);
  const publicRefs = recs.filter((r) => isReference(r) && r.checks.noAuth === 'fail');
  if (publicRefs.length) docGaps.push(['Public endpoints documented as needing sign-in', `${named(publicRefs)} answer without sign-in, which is intended (confirmed 19 November), but the API document still says sign-in is required.`]);
  const loginSecured = ops.filter((o) => /\/login$/.test(o.path) && o.secured);
  if (loginSecured.length) docGaps.push(['Sign-in endpoints documented as needing a sign-in token', `${loginSecured.map((o) => `${o.method} ${o.path}`).join(' and ')} — tools generated from the document will try to send a token that doesn't exist yet.`]);
  const leaky = ops.filter((o) => o.params.some((p) => /^(principal|credentials|authorities|details|authenticated)/.test(p.name)));
  if (leaky.length) docGaps.push(['Internal sign-in fields shown as request parameters', `${leaky.length} endpoint${leaky.length > 1 ? 's list' : ' lists'} the server’s own sign-in fields (principal, credentials, authorities…) as parameters a caller could send. They should be hidden from the document.`]);
  const resolve = (s) => (s && s.$ref ? schemas[s.$ref.split('/').pop()] : s);
  const withBody = ops.map((o) => ({ o, s: resolve(o.body) })).filter((x) => x.s && x.s.properties);
  const noRequired = withBody.filter((x) => !(x.s.required && x.s.required.length));
  const fieldList = (sch) => Object.entries(sch.properties).map(([k, v]) => { const t = resolve(v); return t && t.type === 'array' ? `${k} (list)` : k; }).join(', ');
  if (noRequired.length) {
    const rows = noRequired
      .sort((a, b) => apiAreaName(a.o.tag).localeCompare(apiAreaName(b.o.tag)) || a.o.path.localeCompare(b.o.path))
      .map(({ o, s: sch }) => [apiAreaName(o.tag), `${o.method} ${o.path}`, fieldList(sch)]);
    docGaps.push(['Required fields are not marked', `${noRequired.length} of ${withBody.length} request bodies don’t say which of their fields are mandatory, so callers only find out from errors. For example, the customer sign-in (POST /api/v3/users/login) lists email and password with neither marked required. Each endpoint below needs its mandatory fields listed in the document’s “required”.`, rows]);
  }

  // ---- What changed since the saved copy
  let changes = null;
  const liveFile = path.join(apiDir, 'live-spec.json');
  if (fs.existsSync(liveFile)) {
    const live = JSON.parse(fs.readFileSync(liveFile, 'utf8'));
    const sig = (item, m) => JSON.stringify([(item.parameters || []).concat(item[m].parameters || []).map((p) => [p.name, p.in, !!p.required]).sort(), !!item[m].requestBody, Object.keys(item[m].responses || {}).sort(), item[m].summary]);
    const index = (s) => new Map(Object.entries(s.paths).flatMap(([p, item]) => API_METHODS.filter((m) => item[m]).map((m) => [`${m.toUpperCase()} ${p}`, sig(item, m)])));
    const a = index(spec), b = index(live);
    const added = [...b.keys()].filter((k) => !a.has(k));
    const removed = [...a.keys()].filter((k) => !b.has(k));
    const changed = [...b.keys()].filter((k) => a.has(k) && a.get(k) !== b.get(k));
    const items = [];
    if (added.length) items.push([`${added.length} new endpoint${added.length > 1 ? 's' : ''}`, `${added.slice(0, 20).join('; ')}${added.length > 20 ? '; …' : ''}. They are checked once the saved copy is refreshed (npm run api:snapshot).`]);
    if (removed.length) items.push([`${removed.length} endpoint${removed.length > 1 ? 's' : ''} removed`, `${removed.slice(0, 20).join('; ')}${removed.length > 20 ? '; …' : ''}.`]);
    if (changed.length) items.push([`${changed.length} endpoint${changed.length > 1 ? 's' : ''} changed`, `Parameters, request body, responses or description changed: ${changed.slice(0, 20).join('; ')}${changed.length > 20 ? '; …' : ''}.`]);
    if (!items.length) items.push(['No changes', `The live API matches the saved copy (${ops.length} endpoints, version ${live.info?.version}).`]);
    changes = { heading: 'What changed in the API since its saved copy', items: [...API_UPDATES, ...items] };
  }

  // ---- Endpoint reference (results only on the internal page)
  const result = (op) => {
    const r = byKey.get(`${op.method} ${op.path}`);
    if (op.method !== 'GET') return '<span class="badge idle">Not called</span>';
    if (!r || r.outcome === 'not-run') return '<span class="badge idle">Not run</span>';
    return failures(r).length ? '<span class="badge bad">Problem</span>' : '<span class="badge ok">Worked</span>';
  };
  const signIn = (op) => {
    const r = byKey.get(`${op.method} ${op.path}`);
    if (!op.secured) return 'None';
    if (apiAdminOnly(op) || r?.role === 'admin') return 'Staff';
    return r?.role === 'customer' ? 'Customer' : 'Signed in';
  };
  const reference = (pub) => {
    const groups = Object.keys(areas).map((tag) => {
      const list = ops.filter((o) => o.tag === tag).sort((x, y) => x.path.localeCompare(y.path) || API_METHODS.indexOf(x.method.toLowerCase()) - API_METHODS.indexOf(y.method.toLowerCase()));
      const rows = list.map((o) => `<tr><td class="area"><span class="method m-${o.method.toLowerCase()}">${o.method}</span> <code>${esc(o.path)}</code><div class="muted">${esc(o.summary)}</div></td><td class="num" data-label="Sign-in:">${signIn(o)}</td>${pub ? '' : `<td class="result">${result(o)}</td>`}</tr>`).join('');
      return `<details class="ref"><summary>${esc(areas[tag].name)} <span class="muted">· ${list.length} endpoint${list.length > 1 ? 's' : ''}</span></summary><div class="table-wrap"><table><thead><tr><th>Endpoint</th><th>Sign-in</th>${pub ? '' : '<th>Result</th>'}</tr></thead><tbody>${rows}</tbody></table></div></details>`;
    }).join('\n');
    return `
    <h2>Endpoint reference</h2>
    <p class="muted">All ${ops.length} endpoints in the API document (${spec.info?.title} ${spec.info?.version}), by area. Sign-in: “Customer” or “Staff” is the sign-in that worked; “Signed in” means the document requires one. The live document is at <code>/v3/api-docs</code> on the API server.</p>
    ${groups}`;
  };

  const reads = ops.filter((o) => o.method === 'GET').length;
  const times = recs.map((r) => new Date(r.at)).sort((a, b) => a - b);
  const mins = Math.max(1, Math.round((times[times.length - 1] - times[0]) / 60000));
  return {
    id: 'api',
    label: 'API',
    runAt: times[0],
    heading: 'API Test Results',
    context: `${spec.info?.title} ${spec.info?.version} · ${ops.length} endpoints · dev environment`,
    runText: `Automated check run on ${fmt(times[0])} (WAT) · took about ${mins} minute${mins > 1 ? 's' : ''}`,
    intro: `Each of the ${reads} read-only endpoints was called the way the app and portal call it: refused without signing in, refused to the wrong customer or role, answered with the right sign-in, and checked against the format the API document promises. The ${ops.length - reads} endpoints that create, change or delete data are listed in the reference below but not called, so testing never changes the system.`,
    tests, findings: findings.sort((a, b) => sevRank(a.severity) - sevRank(b.severity)), areas,
    mismatches: docGaps, mismatchesHeading: 'Gaps in the API document',
    mismatchesIntro: 'The API works here, but its document is missing or contradicts something. Developers building against it will trip over these.',
    questions: API_QUESTIONS, changes, reference,
    notRunReason: (t) => `Not run: ${t.skipReason || 'see technical report'}.`,
    techInternal: '<p class="muted">Each endpoint’s checks (status, timing and every problem) are in <code>reports/api-results/records.jsonl</code>, and the Playwright results in <code>reports/api-final.json</code>. Re-run with <code>npm run test:api:dev</code>.</p>',
    techPublic: '<p class="muted">Security details and the per-endpoint results are kept internally. Ask the QA team for access.</p>',
  };
}

/* ================================================================== page */

const admin = readAdmin();
const mobile = readMobile();
const api = readApi();
const tabs = [
  { id: 'dashboard', label: 'Overview', icon: '📊', dashboard: true },
  { id: 'admin', label: 'Admin portal', icon: '🖥', data: admin, empty: 'Run the admin portal checks (npm run test:admin:dev) to fill this in.' },
  { id: 'mobile', label: 'Mobile app', icon: '📱', data: mobile, empty: 'Run the mobile checks (npx wdio run mobile/config/wdio.android.conf.ts) to fill this in.' },
  { id: 'api', label: 'API', icon: '🔌', data: api, empty: 'Run the API checks (npm run test:api:dev) to fill this in.' },
];
const areaData = [admin, mobile, api].filter(Boolean);
const emptyText = (id) => tabs.find((t) => t.id === id).empty;
const pill = (d, t) => {
  if (t && t.dashboard) {
    const sc = sevCounts(areaData.flatMap((x) => x.findings));
    const urgent = sc.Critical + sc.High;
    return urgent ? `<span class="pill bad">${urgent} urgent</span>` : '<span class="pill ok">no urgent</span>';
  }
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
<link rel="icon" href="favicon.svg" type="image/svg+xml">
<link rel="icon" href="favicon.ico" sizes="16x16 32x32 48x48">
<link rel="apple-touch-icon" href="apple-touch-icon.png">
<link rel="manifest" href="site.webmanifest">
<meta name="theme-color" content="#1f3a6d" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#11151c" media="(prefers-color-scheme: dark)">
${pub ? '<meta name="robots" content="noindex, nofollow">' : ''}
<style>
  :root {
    --bg: #f3f5f8; --surface: #ffffff; --surface-2: #f8f9fb; --text: #18202e; --muted: #5b6474; --line: #e2e6ec;
    --accent: #1f3a6d; --accent-2: #2d559a; --on-accent: #ffffff; --shadow: 0 1px 2px rgba(16,24,40,.05), 0 1px 3px rgba(16,24,40,.06);
    --good: #1d7a46; --good-bg: #e6f4ec; --warn: #9a5b00; --warn-bg: #fff4e0;
    --bad: #b42318; --bad-bg: #fdecea; --med: #8a5a00; --med-bg: #fff4e0; --idle-bg: #eceef2; --info: #1f5fae; --info-bg: #e7f0fb;
    /* Priorities: stripe/dot colour, tinted background, readable ink */
    --s-critical: #d03b3b; --s-critical-bg: #fbe4e4; --s-critical-ink: #9b1c1c;
    --s-high: #ec835a; --s-high-bg: #fdede5; --s-high-ink: #9c3d0c;
    --s-medium: #fab219; --s-medium-bg: #fff5dc; --s-medium-ink: #765000;
    --s-low: #8a94a6; --s-low-bg: #eef0f4; --s-low-ink: #4a5363;
    --mast-a: #1f3a6d; --mast-b: #2d559a;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --bg: #0f131a; --surface: #181e27; --surface-2: #1d2430; --text: #e7eaf0; --muted: #9aa4b5; --line: #2a3240;
      --accent: #9db8ec; --accent-2: #b9cdf3; --on-accent: #0f131a; --shadow: 0 1px 2px rgba(0,0,0,.4);
      --good: #6fd29b; --good-bg: #173326; --warn: #ffc56b; --warn-bg: #3a2c12;
      --bad: #ff8a80; --bad-bg: #3d1d1b; --med: #ffc56b; --med-bg: #3a2c12; --idle-bg: #252c38; --info: #8fbaf0; --info-bg: #1a2b42;
      --s-critical: #ff6b6b; --s-critical-bg: #3d1d1d; --s-critical-ink: #ffa19b;
      --s-high: #f08f62; --s-high-bg: #3b2418; --s-high-ink: #ffb894;
      --s-medium: #fab219; --s-medium-bg: #3a2c12; --s-medium-ink: #ffd27a;
      --s-low: #8a94a6; --s-low-bg: #252c38; --s-low-ink: #bcc4d1;
      --mast-a: #16213a; --mast-b: #1d2f52;
    }
  }
  :root[data-theme="dark"] {
    --bg: #0f131a; --surface: #181e27; --surface-2: #1d2430; --text: #e7eaf0; --muted: #9aa4b5; --line: #2a3240;
    --accent: #9db8ec; --accent-2: #b9cdf3; --on-accent: #0f131a; --shadow: 0 1px 2px rgba(0,0,0,.4);
    --good: #6fd29b; --good-bg: #173326; --warn: #ffc56b; --warn-bg: #3a2c12;
    --bad: #ff8a80; --bad-bg: #3d1d1b; --med: #ffc56b; --med-bg: #3a2c12; --idle-bg: #252c38; --info: #8fbaf0; --info-bg: #1a2b42;
    --s-critical: #ff6b6b; --s-critical-bg: #3d1d1d; --s-critical-ink: #ffa19b;
    --s-high: #f08f62; --s-high-bg: #3b2418; --s-high-ink: #ffb894;
    --s-medium: #fab219; --s-medium-bg: #3a2c12; --s-medium-ink: #ffd27a;
    --s-low: #8a94a6; --s-low-bg: #252c38; --s-low-ink: #bcc4d1;
    --mast-a: #16213a; --mast-b: #1d2f52;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.6 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; -webkit-font-smoothing: antialiased; }
  main { max-width: 1120px; margin: 0 auto; padding: 0 16px 104px; }
  h1 { font-size: 1.9rem; line-height: 1.2; margin: 0; letter-spacing: -.01em; }
  h2 { font-size: 1.25rem; margin: 40px 0 6px; letter-spacing: -.005em; }
  h2.panel-title { margin-top: 2px; font-size: 1.55rem; }
  h3 { font-size: 1.06rem; margin: 6px 0 2px; }
  p { margin: 6px 0; }
  .muted { color: var(--muted); }
  .small { font-size: .85rem; }
  a { color: var(--accent); }
  code { font-size: .9em; }

  /* Masthead */
  .masthead { background: linear-gradient(135deg, var(--mast-a), var(--mast-b)); color: #fff; padding: 28px 16px 64px; }
  .masthead-in { max-width: 1120px; margin: 0 auto; }
  .brand { display: flex; align-items: center; gap: 10px; font-size: .85rem; font-weight: 600; letter-spacing: .02em; opacity: .9; margin-bottom: 10px; }
  .brand img { width: 26px; height: 26px; border-radius: 6px; background: #fff; padding: 2px; }
  .masthead p { margin: 8px 0 0; max-width: 70ch; color: rgba(255,255,255,.82); }
  .mast-meta { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
  .mast-meta span { font-size: .8rem; font-weight: 600; padding: 3px 10px; border-radius: 999px; background: rgba(255,255,255,.14); color: #fff; }

  /* Area switch */
  .tabs { display: flex; gap: 4px; padding: 5px; margin: -40px 0 24px; background: var(--surface); border: 1px solid var(--line); border-radius: 14px; position: sticky; top: 8px; z-index: 5; box-shadow: 0 4px 18px rgba(16,24,40,.10); }
  .tab { flex: 1; display: flex; align-items: center; justify-content: center; flex-wrap: wrap; gap: 8px; padding: 11px 12px; min-height: 44px; border: 0; border-radius: 10px; background: transparent; color: var(--muted); font: inherit; font-weight: 600; cursor: pointer; }
  .tab:hover { background: var(--surface-2); color: var(--text); }
  .tab[aria-selected="true"] { background: var(--accent); color: var(--on-accent); }
  .tab:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
  .pill { font-size: .72rem; font-weight: 700; padding: 1px 9px; border-radius: 999px; white-space: nowrap; }
  .pill.bad { background: var(--bad-bg); color: var(--bad); } .pill.ok { background: var(--good-bg); color: var(--good); } .pill.idle { background: var(--idle-bg); color: var(--muted); }
  .tab[aria-selected="true"] .pill { background: var(--surface); }
  [role="tabpanel"][hidden] { display: none; }
  .nojs-divider { border: 0; border-top: 2px dashed var(--line); margin: 48px 0; }
  .js .nojs-divider { display: none; }

  .card { background: var(--surface); border: 1px solid var(--line); border-radius: 14px; padding: 20px; margin: 14px 0; box-shadow: var(--shadow); }
  .verdict { border-left: 6px solid var(--warn); background: var(--warn-bg); box-shadow: none; }
  .verdict.good { border-left-color: var(--good); background: var(--good-bg); }
  .verdict.bad { border-left-color: var(--bad); background: var(--bad-bg); }
  .verdict h3 { margin: 0 0 4px; font-size: 1.2rem; }
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-top: 14px; }
  .stat { background: var(--surface); border: 1px solid var(--line); border-radius: 14px; padding: 16px; box-shadow: var(--shadow); }
  .stat .n { font-size: 2rem; font-weight: 700; line-height: 1.1; font-variant-numeric: tabular-nums; }
  a.stat { display: block; color: inherit; text-decoration: none; }
  .js a.stat:hover { border-color: var(--accent); }
  .js a.stat:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
  .stat .go { display: none; }
  .js .stat .go { display: inline; color: var(--accent); }
  .stat.ok .n { color: var(--good); } .stat.bad .n { color: var(--bad); }
  /* Thin segmented bar, 2px surface gap between parts */
  .bar { display: flex; gap: 2px; height: 8px; margin-top: 16px; }
  .bar span { display: block; flex-basis: 0; border-radius: 999px; min-width: 4px; }
  .bar .p { background: var(--good); } .bar .f { background: var(--bad); } .bar .s { background: var(--s-low); opacity: .55; }
  .legend { display: flex; flex-wrap: wrap; gap: 16px; font-size: .85rem; margin-top: 8px; }
  .dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 6px; vertical-align: middle; }
  .dot-idle { background: var(--s-low); opacity: .55; }
  .kicker { margin: 22px 0 8px; font-size: .78rem; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); }
  .table-wrap { overflow-x: auto; }
  /* "Show all" list under a gap in the API document: grouped by area, path + field tags. */
  details.gaps[open] > summary { margin-bottom: 4px; }
  .gaps-tools { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; margin: 10px 0 4px; }
  .gaps-filter { flex: 1 1 260px; min-width: 0; padding: 9px 12px; font: inherit; color: var(--text); background: var(--surface); border: 1px solid var(--line); border-radius: 10px; }
  .gaps-filter:focus-visible { outline: 3px solid var(--accent); outline-offset: 1px; }
  .gaps-count { font-size: .85rem; }
  .gg { margin-top: 16px; }
  .gg h4 { margin: 0 0 6px; font-size: .78rem; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--muted); }
  .gg-n { display: inline-block; min-width: 1.6em; margin-left: 4px; padding: 0 6px; border-radius: 999px; background: var(--surface-2); border: 1px solid var(--line); text-align: center; letter-spacing: 0; }
  ul.ge { list-style: none; margin: 0; padding: 0; background: var(--surface); border: 1px solid var(--line); border-radius: 12px; overflow: hidden; }
  details.gaps { line-height: 1.45; }
  details.gaps ul.ge li, details.gaps ul.ftags li { margin: 0; } /* undo "ul.clean li" spacing from the note around it */
  ul.ge > li { display: grid; grid-template-columns: minmax(0, 5fr) minmax(0, 6fr); gap: 6px 20px; align-items: center; padding: 9px 14px; border-top: 1px solid var(--line); }
  ul.ge > li:first-child { border-top: 0; }
  .ge-ep { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
  .gm { flex: none; padding: 1px 7px; border-radius: 6px; border: 1px solid var(--line); background: var(--surface-2); color: var(--muted); font: 700 .68rem/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; letter-spacing: .03em; }
  .gm-post { color: var(--accent); border-color: var(--accent); }
  code.gp { min-width: 0; padding: 0; background: none; font-size: .84rem; line-height: 1.5; overflow-wrap: anywhere; }
  .ge-f { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .ge-fl { flex: none; font-size: .75rem; color: var(--muted); white-space: nowrap; }
  ul.ftags { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 4px; min-width: 0; }
  ul.ftags li { padding: 1px 8px; border-radius: 999px; background: var(--surface-2); border: 1px solid var(--line); font: .75rem/1.6 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; overflow-wrap: anywhere; }
  .gaps-none { margin-top: 12px; }
  .gaps-close { margin-top: 14px; padding: 8px 14px; font: inherit; font-size: .9rem; color: var(--accent); background: var(--surface); border: 1px solid var(--line); border-radius: 10px; cursor: pointer; }
  .gaps-close:hover { border-color: var(--accent); }
  .gaps-close:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
  @media (max-width: 760px) {
    ul.ge > li { grid-template-columns: minmax(0, 1fr); padding: 10px 12px; }
    .ge-f { align-items: flex-start; }
    .ge-fl { padding-top: 2px; }
  }
  table { width: 100%; border-collapse: collapse; background: var(--surface); border: 1px solid var(--line); border-radius: 14px; overflow: hidden; }
  th, td { text-align: left; padding: 12px 14px; border-bottom: 1px solid var(--line); vertical-align: top; }
  thead th { font-size: .76rem; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); background: var(--surface-2); }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  tbody tr:last-child td, tbody tr:last-child th { border-bottom: 0; }
  .badge { display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: .82rem; font-weight: 600; white-space: nowrap; }
  .badge.ok { background: var(--good-bg); color: var(--good); } .badge.bad { background: var(--bad-bg); color: var(--bad); } .badge.idle { background: var(--idle-bg); color: var(--muted); } .badge.info { background: var(--info-bg); color: var(--info); }

  /* Priority labels: always a word, never colour alone */
  .sev { display: inline-flex; align-items: center; gap: 6px; padding: 2px 10px; border-radius: 999px; font-size: .74rem; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; white-space: nowrap; }
  .sev::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: currentColor; }
  .sev-dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; flex: none; }
  .s-critical { --s: var(--s-critical); --s-bg: var(--s-critical-bg); --s-ink: var(--s-critical-ink); }
  .s-high { --s: var(--s-high); --s-bg: var(--s-high-bg); --s-ink: var(--s-high-ink); }
  .s-medium { --s: var(--s-medium); --s-bg: var(--s-medium-bg); --s-ink: var(--s-medium-ink); }
  .s-low { --s: var(--s-low); --s-bg: var(--s-low-bg); --s-ink: var(--s-low-ink); }
  .sev.s-critical, .sev.s-high, .sev.s-medium, .sev.s-low { background: var(--s-bg); color: var(--s-ink); }
  .sev.s-critical::before, .sev.s-high::before, .sev.s-medium::before, .sev.s-low::before { background: var(--s); }
  .s-critical .sev-dot, .s-high .sev-dot, .s-medium .sev-dot, .s-low .sev-dot, .sev-dot.s-critical, .sev-dot.s-high, .sev-dot.s-medium, .sev-dot.s-low { background: var(--s); }

  /* Problem cards */
  .finding { border-left: 5px solid var(--s, var(--line)); }
  .finding-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  .finding-no { margin-left: auto; font-size: .85rem; font-variant-numeric: tabular-nums; }
  .finding h3 { font-size: 1.1rem; margin-top: 10px; }
  .chip { display: inline-block; padding: 1px 10px; border-radius: 999px; font-size: .8rem; font-weight: 600; background: var(--idle-bg); color: var(--muted); }
  .finding .impact { font-weight: 600; }
  .status-note { margin: 10px 0 8px; padding: 8px 12px; border-radius: 10px; background: var(--info-bg); color: var(--text); font-size: .93rem; }
  .status-note strong { color: var(--info); }
  .finding.filtered-out { display: none; }

  /* Priority filter */
  .sev-filter { display: none; flex-wrap: wrap; align-items: center; gap: 8px; margin: 16px 0 2px; padding: 10px 12px; background: var(--surface); border: 1px solid var(--line); border-radius: 14px; position: sticky; top: 84px; z-index: 4; box-shadow: var(--shadow); }
  .js .sev-filter { display: flex; }
  .sev-filter-label { font-size: .78rem; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); margin-right: 4px; }
  .fchip { display: inline-flex; align-items: center; gap: 7px; min-height: 38px; padding: 6px 13px; border: 1px solid var(--line); border-radius: 999px; background: var(--surface); color: var(--text); font: inherit; font-size: .9rem; font-weight: 600; cursor: pointer; }
  .fchip:hover:not([disabled]) { border-color: var(--s, var(--accent)); background: var(--s-bg, var(--surface-2)); }
  .fchip[aria-pressed="true"] { background: var(--s-bg, var(--accent)); color: var(--s-ink, var(--on-accent)); border-color: var(--s, var(--accent)); box-shadow: inset 0 0 0 1px var(--s, var(--accent)); }
  .fchip[aria-pressed="true"]::after { content: "✓"; font-weight: 700; }
  .fchip.all[aria-pressed="true"]::after, .fchip[data-sev="all"][aria-pressed="true"]::after { content: none; }
  .fchip[disabled] { opacity: .45; cursor: not-allowed; }
  .fchip:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
  .fchip .count { font-size: .75rem; font-weight: 700; padding: 0 7px; border-radius: 999px; background: var(--idle-bg); color: var(--muted); font-variant-numeric: tabular-nums; }
  .sev-filter-status { min-height: 1.2em; }
  .sev-defs { display: grid; grid-template-columns: max-content 1fr; gap: 8px 14px; align-items: center; margin: 4px 0 8px; }
  .sev-defs dt, .sev-defs dd { margin: 0; }

  /* Priority tiles */
  .sev-tiles { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 6px 0 14px; }
  .sev-tile { display: block; padding: 12px 14px; border-radius: 12px; background: var(--surface); border: 1px solid var(--line); border-top: 4px solid var(--s); color: inherit; text-decoration: none; box-shadow: var(--shadow); }
  a.sev-tile:hover { background: var(--s-bg); }
  a.sev-tile:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
  .sev-tile.zero { opacity: .55; box-shadow: none; }
  .sev-tile-n { display: block; font-size: 1.7rem; font-weight: 700; line-height: 1.1; font-variant-numeric: tabular-nums; }
  .sev-tile-l { display: inline-flex; align-items: center; gap: 6px; font-size: .85rem; font-weight: 600; color: var(--muted); }

  .method { display: inline-block; min-width: 3.6em; font: 700 .72rem/1.6 ui-monospace, monospace; text-align: center; padding: 0 6px; border-radius: 6px; background: var(--idle-bg); color: var(--muted); }
  .method.m-get { background: var(--good-bg); color: var(--good); } .method.m-delete { background: var(--bad-bg); color: var(--bad); } .method.m-post, .method.m-put, .method.m-patch { background: var(--med-bg); color: var(--med); }
  dl { margin: 10px 0 0; } dt { font-weight: 600; margin-top: 10px; } dd { margin: 2px 0 0; }
  details { margin-top: 8px; } summary { cursor: pointer; color: var(--accent); font-weight: 600; padding: 10px 0; min-height: 44px; }
  pre.snippet { white-space: pre-wrap; overflow-wrap: anywhere; background: var(--surface-2); color: var(--text); border: 1px solid var(--line); border-radius: 8px; padding: 12px; font-size: .85rem; line-height: 1.45; max-height: 420px; overflow: auto; margin: 6px 0 0; }
  .snippet-wrap { position: relative; }
  .js .snippet-wrap pre.snippet { padding-top: 44px; }
  .copy-btn { display: none; position: absolute; top: 6px; right: 6px; z-index: 1; align-items: center; gap: 6px; min-height: 32px; padding: 4px 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); color: var(--muted); font: inherit; font-size: .82rem; font-weight: 600; cursor: pointer; }
  .js .copy-btn { display: inline-flex; }
  .copy-btn:hover { color: var(--accent); border-color: var(--accent); }
  .copy-btn:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
  .copy-btn.copied { color: var(--good); border-color: var(--good); background: var(--good-bg); }
  .copy-btn.failed { color: var(--bad); border-color: var(--bad); background: var(--bad-bg); }
  details.evidence video { display: block; width: 100%; border: 1px solid var(--line); border-radius: 8px; margin-top: 10px; background: #000; }
  details img { width: 100%; height: auto; border: 1px solid var(--line); border-radius: 8px; margin-top: 10px; }
  ul.clean { padding-left: 20px; } ul.clean li { margin: 10px 0; }
  .tech { display: inline-block; margin-top: 8px; padding: 10px 16px; border-radius: 8px; border: 1px solid var(--line); background: var(--surface); text-decoration: none; font-weight: 600; }

  /* Dashboard */
  .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; margin: 16px 0 8px; }
  .kpi { background: var(--surface); border: 1px solid var(--line); border-radius: 14px; padding: 16px; box-shadow: var(--shadow); }
  .kpi-l { font-size: .85rem; font-weight: 600; color: var(--muted); }
  .kpi-v { font-size: 2.1rem; font-weight: 700; line-height: 1.15; margin: 2px 0 4px; font-variant-numeric: tabular-nums; }
  .kpi.bad .kpi-v { color: var(--bad); } .kpi.ok .kpi-v { color: var(--good); }
  .dash-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; align-items: start; }
  .dash-col > h2 { margin-top: 32px; }
  table.matrix th, table.matrix td { padding: 10px 12px; }
  table.matrix tbody th, table.matrix tfoot th { font-weight: 600; }
  table.matrix tfoot th, table.matrix tfoot td { background: var(--surface-2); border-bottom: 0; }
  .th-sev { display: inline-flex; align-items: center; gap: 6px; }
  .mcell { display: inline-block; min-width: 2.2em; padding: 1px 8px; border-radius: 999px; text-align: center; font-weight: 700; text-decoration: none; background: var(--s-bg); color: var(--s-ink); box-shadow: inset 0 0 0 1px var(--s); }
  .mcell:hover { text-decoration: underline; }
  ol.attention { list-style: none; padding: 0; margin: 10px 0 0; background: var(--surface); border: 1px solid var(--line); border-radius: 14px; box-shadow: var(--shadow); }
  ol.attention li { display: grid; grid-template-columns: 6.5em 1fr; gap: 10px; align-items: start; padding: 12px 14px; border-bottom: 1px solid var(--line); }
  ol.attention li:last-child { border-bottom: 0; }
  ol.attention a { font-weight: 600; text-decoration: none; color: var(--text); }
  ol.attention a:hover { color: var(--accent); text-decoration: underline; }
  ol.attention .sev { justify-self: start; margin-top: 2px; }
  .area-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 14px; margin-top: 10px; }
  .area-card { display: flex; flex-direction: column; gap: 4px; padding: 18px; background: var(--surface); border: 1px solid var(--line); border-radius: 14px; color: inherit; text-decoration: none; box-shadow: var(--shadow); transition: border-color .15s, transform .15s; }
  .area-card:hover { border-color: var(--accent); transform: translateY(-1px); }
  .area-card:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
  .area-head { display: flex; gap: 12px; align-items: flex-start; }
  .area-head h3 { margin: 0; font-size: 1.1rem; }
  .area-head p { margin: 0; }
  .area-icon { font-size: 1.4rem; line-height: 1; width: 40px; height: 40px; display: grid; place-items: center; border-radius: 10px; background: var(--surface-2); border: 1px solid var(--line); flex: none; }
  .area-rate { margin: 10px 0 0; }
  .area-rate .big { font-size: 1.8rem; font-weight: 700; font-variant-numeric: tabular-nums; }
  .area-card .bar { margin-top: 6px; }
  .area-nums { display: flex; gap: 16px; list-style: none; padding: 0; margin: 8px 0 0; font-size: .9rem; color: var(--muted); }
  .area-nums strong { color: var(--text); font-variant-numeric: tabular-nums; }
  .area-sev { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0 2px; }
  .area-card .go { margin-top: auto; padding-top: 8px; color: var(--accent); font-weight: 600; }
  ul.act-summary { display: flex; flex-wrap: wrap; gap: 8px; list-style: none; padding: 0; margin: 10px 0 4px; }
  ul.act-summary li { padding: 3px 12px; border-radius: 999px; background: var(--surface); border: 1px solid var(--line); font-size: .88rem; color: var(--muted); }
  ul.act-summary strong { color: var(--text); }
  ol.timeline { list-style: none; padding: 0; margin: 10px 0 0; }
  li.day { position: relative; padding: 0 0 6px 26px; }
  li.day::before { content: ""; position: absolute; left: 7px; top: 12px; bottom: 0; width: 2px; background: var(--line); }
  li.day::after { content: ""; position: absolute; left: 1px; top: 6px; width: 14px; height: 14px; border-radius: 50%; background: var(--surface); border: 3px solid var(--accent); }
  .day-label { margin: 0 0 8px; font-size: 1rem; }
  ul.acts { list-style: none; padding: 0; margin: 0 0 18px; display: grid; gap: 10px; }
  li.act { background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px; box-shadow: var(--shadow); }
  .act-tags { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .src { font-size: .74rem; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; padding: 2px 9px; border-radius: 6px; background: var(--accent); color: var(--on-accent); }
  .src-mobile { background: var(--accent-2); }
  .src-api { background: var(--muted); color: var(--surface); }
  .act-title { margin: 8px 0 2px; }
  .act-lead { margin: 0; font-size: .93rem; }
  .act-more { margin-top: 2px; }
  .act-more summary { padding: 6px 0; min-height: 0; font-size: .9rem; }
  .act-more p { font-size: .93rem; }
  details.older > summary { padding-left: 2px; }

  /* Search within a tab (shown only when JavaScript runs) */
  .search { display: none; margin: 18px 0 4px; }
  .js .search { display: block; }
  .search label { display: block; font-weight: 600; margin-bottom: 6px; }
  .search input { width: 100%; box-sizing: border-box; font: inherit; padding: 12px 14px; min-height: 44px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); color: inherit; box-shadow: var(--shadow); }
  .search input:focus-visible { outline: 3px solid var(--accent); outline-offset: 1px; }
  .search-count { margin: 6px 0 0; min-height: 1.2em; }
  .sec[hidden], .sec [hidden] { display: none !important; }
  /* Result kinds inside a tab: Overview | Problems | Passed | Not run | … */
  .subtabs { display: flex; flex-wrap: wrap; gap: 4px; margin: 28px 0 4px; padding: 0; border-bottom: 2px solid var(--line); }
  .subtab { display: inline-flex; align-items: center; gap: 8px; padding: 10px 14px; min-height: 44px; border: 0; border-bottom: 3px solid transparent; margin-bottom: -2px; background: transparent; color: var(--muted); font: inherit; font-weight: 600; cursor: pointer; border-radius: 8px 8px 0 0; }
  .subtab:hover { color: var(--text); background: var(--surface); }
  .subtab[aria-selected="true"] { color: var(--accent); border-bottom-color: var(--accent); background: var(--surface); }
  .subtab:focus-visible { outline: 3px solid var(--accent); outline-offset: -3px; }
  .subtab .count { font-size: .75rem; font-weight: 700; padding: 1px 8px; border-radius: 999px; background: var(--idle-bg); color: var(--muted); font-variant-numeric: tabular-nums; }
  .subtab.t-bad .count { background: var(--bad-bg); color: var(--bad); }
  .subtab.t-ok .count { background: var(--good-bg); color: var(--good); }
  .subpanel > .sec:first-of-type > h2, .subpanel > h2:first-of-type { margin-top: 20px; }
  .subpanel-label { margin: 36px 0 0; font-size: .8rem; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); }
  /* Without JavaScript every kind shows, one after another, each with its label. */
  .subtabs { display: none; }
  .js .subtabs { display: flex; }
  .js .subpanel:not(.on) { display: none; }
  .js .subpanel-label { display: none; }
  /* While searching, every kind is searched and shown at once. */
  .js .searching .subpanel { display: block; }
  .js .searching .subpanel-label { display: block; margin-top: 28px; }
  .js .searching .subpanel.empty { display: none; }
  .js .searching .subtabs { opacity: .45; }
  ul.checks { list-style: none; padding-left: 4px; margin: 4px 0 8px; }
  ul.checks li { margin: 6px 0; }
  .tick { color: var(--good); font-weight: 700; margin-right: 6px; }

  /* Back to top */
  .to-top { position: fixed; right: 20px; bottom: 20px; z-index: 6; display: inline-flex; align-items: center; gap: 6px; min-height: 44px; padding: 10px 16px; border: 1px solid var(--line); border-radius: 999px; background: var(--accent); color: var(--on-accent); font: inherit; font-weight: 600; cursor: pointer; box-shadow: 0 4px 14px rgba(0,0,0,.18); opacity: 0; transform: translateY(12px); pointer-events: none; transition: opacity .2s, transform .2s; }
  .to-top.show { opacity: 1; transform: none; pointer-events: auto; }
  .to-top:focus-visible { outline: 3px solid var(--text); outline-offset: 2px; }
  @media (prefers-reduced-motion: reduce) { .to-top, .area-card { transition: none; } .area-card:hover { transform: none; } }

  footer { margin-top: 56px; padding-top: 18px; border-top: 1px solid var(--line); font-size: .85rem; color: var(--muted); }
  dd, li, .finding h3 { overflow-wrap: anywhere; }

  @media (max-width: 860px) {
    .dash-grid { grid-template-columns: 1fr; gap: 0; }
  }
  /* Phones and narrow windows */
  @media (max-width: 600px) {
    body { font-size: 15px; }
    main { padding: 0 16px 96px; }
    .masthead { padding: 16px 16px 52px; }
    .masthead p { font-size: .88rem; line-height: 1.45; }
    .brand { margin-bottom: 6px; }
    .mast-meta { margin-top: 10px; gap: 6px; }
    .mast-meta span { font-size: .74rem; }
    /* Result kinds: one row that scrolls sideways instead of wrapping */
    .js .subtabs { flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; -webkit-overflow-scrolling: touch; margin-left: -16px; margin-right: -16px; padding: 0 16px; }
    .js .subtabs::-webkit-scrollbar { display: none; }
    .subtab { flex: 0 0 auto; padding: 10px 12px; }
    .to-top { right: 16px; bottom: 16px; }
    h1 { font-size: 1.5rem; }
    h2 { font-size: 1.12rem; margin-top: 32px; }
    h2.panel-title { font-size: 1.3rem; }
    .verdict h3 { font-size: 1.06rem; }
    .card { padding: 16px; }
    /* Compact sticky switch: label and count on one line, icon dropped */
    .tabs { gap: 3px; padding: 4px; margin: -36px 0 16px; top: 4px; border-radius: 12px; }
    .tab { padding: 8px 4px; gap: 2px 5px; font-size: .86rem; border-radius: 9px; min-height: 44px; }
    .tab > span[aria-hidden] { display: none; }
    .pill { font-size: .66rem; padding: 0 6px; }
    .stats { grid-template-columns: 1fr 1fr; gap: 8px; }
    .stat { padding: 12px; }
    .stat .n { font-size: 1.6rem; }
    .kpis { grid-template-columns: 1fr 1fr; gap: 8px; }
    .kpi { padding: 12px; }
    .kpi-v { font-size: 1.6rem; }
    .sev-tiles { grid-template-columns: 1fr 1fr; gap: 8px; }
    .sev-filter { position: static; padding: 8px; gap: 6px; }
    .sev-filter-label { width: 100%; }
    .fchip { padding: 5px 10px; font-size: .85rem; }
    ol.attention li { grid-template-columns: 1fr; gap: 4px; }
    li.day { padding-left: 22px; }
    /* Results tables: each row becomes a small card (the priority matrix stays a table) */
    .table-wrap:not(.scroll) { overflow: visible; }
    table:not(.matrix), table:not(.matrix) tbody, table:not(.matrix) tr, table:not(.matrix) td { display: block; width: 100%; }
    table:not(.matrix) { background: transparent; border: 0; }
    table:not(.matrix) thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
    table:not(.matrix) tr { display: grid; grid-template-columns: auto auto 1fr; align-items: center; gap: 4px 16px;
         background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 14px; margin-bottom: 10px; }
    table:not(.matrix) td { padding: 0; border: 0; }
    table:not(.matrix) td.area { grid-column: 1 / -1; margin-bottom: 6px; }
    table:not(.matrix) td.num { text-align: left; white-space: nowrap; }
    table:not(.matrix) td.num::before { content: attr(data-label) " "; color: var(--muted); font-size: .85rem; }
    table:not(.matrix) td.result { justify-self: end; text-align: right; }
    table.matrix th, table.matrix td { padding: 9px 8px; font-size: .9rem; }
    table.matrix thead th { font-size: .66rem; letter-spacing: .02em; }
    .th-sev .sev-dot { display: none; }
    ul.clean { padding-left: 18px; }
  }
  @media (max-width: 340px) {
    .tab { flex-direction: column; }
    table:not(.matrix) tr { grid-template-columns: 1fr 1fr; }
    table:not(.matrix) td.result { grid-column: 1 / -1; justify-self: start; text-align: left; }
  }
</style>
</head>
<body>
<header class="masthead">
  <div class="masthead-in">
    <div class="brand"><img src="favicon.svg" alt="" width="26" height="26"> Rosabon Unified · Quality dashboard</div>
    <h1>Automated Test Results</h1>
    <p>Start with the Overview for the whole picture, or open one part of the product. The admin portal is the staff website; the mobile app is what customers use; the API is the service both of them talk to.</p>
    <div class="mast-meta"><span>Test environment (dev)</span>${areaData.length ? `<span>Latest run ${esc(fmt(new Date(Math.max(...areaData.map((d) => +d.runAt)))))} WAT</span>` : ''}${pub ? '' : '<span>Internal copy</span>'}</div>
  </div>
</header>
<main>
  <div class="tabs" role="tablist" aria-label="Which results to show">
    ${tabs.map((t, i) => `<button class="tab" role="tab" id="tab-${t.id}" aria-controls="panel-${t.id}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}"><span aria-hidden="true">${t.icon}</span> ${esc(t.label)} ${pill(t.data, t)}</button>`).join('\n    ')}
  </div>

  ${tabs.map((t, i) => `${i ? '<hr class="nojs-divider">' : ''}<section role="tabpanel" id="panel-${t.id}" aria-labelledby="tab-${t.id}" tabindex="0">
    ${t.dashboard ? dashboard(areaData, pub) : t.data ? panel(t.data, pub) : emptyPanel(t.label, t.empty)}
  </section>`).join('\n  ')}

  <footer>
    Generated automatically from the test results by <code>scripts/build-summary.js</code>. Sources: Admin PRD, Unified app PRD, the backend’s API document (/v3/api-docs), Investment and Loan product specifications, KYC specification, QA Strategy.
  </footer>
</main>
<button class="to-top" type="button" aria-label="Back to top"><span aria-hidden="true">↑</span> Top</button>
<script>
  (function () {
    document.documentElement.classList.add('js');
    var tabs = Array.prototype.slice.call(document.querySelectorAll('.tabs [role="tab"]'));
    var current = {}; // area id -> selected sub-tab id
    var filters = {}; // area id -> priorities shown on Problems (empty = all)
    var SEV_NAMES = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' };
    function setHash(id) {
      var f = current[id] === 'problems' && filters[id] && filters[id].length ? '/' + filters[id].join('+') : '';
      var h = '#' + id + (current[id] && current[id] !== 'overview' ? '/' + current[id] : '') + f;
      if (location.hash !== h) history.replaceState(null, '', h);
    }
    // Priority filter on an area's Problems tab. Several priorities can be on at once; none (or "All") shows every problem.
    function applyFilter(area) {
      var bar = document.querySelector('.sev-filter[data-panel="' + area + '"]');
      if (!bar) return;
      var panel = document.getElementById('panel-' + area);
      var sel = filters[area] || [];
      Array.prototype.forEach.call(bar.querySelectorAll('.fchip'), function (b) {
        var k = b.getAttribute('data-sev');
        b.setAttribute('aria-pressed', k === 'all' ? sel.length === 0 : sel.indexOf(k) > -1);
      });
      var cards = panel.querySelectorAll('article.finding');
      var shown = 0;
      Array.prototype.forEach.call(cards, function (c) {
        var off = sel.length > 0 && sel.indexOf(c.getAttribute('data-sev')) < 0;
        c.classList.toggle('filtered-out', off);
        if (!off) shown++;
      });
      var status = panel.querySelector('.sev-filter-status');
      if (status) status.textContent = sel.length ? 'Showing ' + shown + ' of ' + cards.length + ' problems: ' + sel.map(function (k) { return SEV_NAMES[k]; }).join(', ') + ' priority.' : '';
      var input = panel.querySelector('.search input');
      if (input && input.value.trim()) input.dispatchEvent(new Event('input'));
    }
    Array.prototype.forEach.call(document.querySelectorAll('.sev-filter'), function (bar) {
      var area = bar.getAttribute('data-panel');
      bar.addEventListener('click', function (e) {
        var b = e.target.closest('.fchip');
        if (!b || b.disabled) return;
        var k = b.getAttribute('data-sev');
        var sel = (filters[area] || []).slice();
        if (k === 'all') sel = [];
        else if (sel.indexOf(k) > -1) sel.splice(sel.indexOf(k), 1);
        else sel.push(k);
        var available = bar.querySelectorAll('.fchip:not([data-sev="all"]):not([disabled])').length;
        if (sel.length >= available) sel = [];
        sel.sort(function (a, b2) { return Object.keys(SEV_NAMES).indexOf(a) - Object.keys(SEV_NAMES).indexOf(b2); });
        filters[area] = sel;
        applyFilter(area);
        setHash(area);
      });
    });
    // Sub-tabs (Overview, Problems, Passed, Not run …) inside one area.
    function showSub(area, sub, focus) {
      var btns = Array.prototype.slice.call(document.querySelectorAll('.subtab[data-panel="' + area + '"]'));
      if (!btns.some(function (b) { return b.getAttribute('data-sub') === sub; })) sub = 'overview';
      btns.forEach(function (b) {
        var on = b.getAttribute('data-sub') === sub;
        b.setAttribute('aria-selected', on);
        b.tabIndex = on ? 0 : -1;
        document.getElementById(b.getAttribute('aria-controls')).classList.toggle('on', on);
        if (on && focus) b.focus();
        if (on) { var bar = b.parentNode; var x = b.offsetLeft - (bar.clientWidth - b.offsetWidth) / 2; if (bar.scrollWidth > bar.clientWidth) bar.scrollLeft = Math.max(0, x); }
      });
      current[area] = sub;
    }
    Array.prototype.forEach.call(document.querySelectorAll('.subtabs'), function (bar) {
      var btns = Array.prototype.slice.call(bar.querySelectorAll('.subtab'));
      btns.forEach(function (b, i) {
        var area = b.getAttribute('data-panel');
        b.addEventListener('click', function () {
          showSub(area, b.getAttribute('data-sub'), false);
          setHash(area);
          // Keep the sub-tab row in view after switching from far down the page.
          var top = bar.getBoundingClientRect().top - document.querySelector('.tabs').offsetHeight - 16;
          if (top < 0) window.scrollTo({ top: window.scrollY + top, behavior: 'smooth' });
        });
        b.addEventListener('keydown', function (e) {
          var d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
          var j = e.key === 'Home' ? 0 : e.key === 'End' ? btns.length - 1 : d ? (i + d + btns.length) % btns.length : -1;
          if (j < 0) return;
          e.preventDefault();
          showSub(area, btns[j].getAttribute('data-sub'), true);
          setHash(area);
        });
      });
    });
    function show(id, focus) {
      tabs.forEach(function (t) {
        var on = t.id === 'tab-' + id;
        t.setAttribute('aria-selected', on);
        t.tabIndex = on ? 0 : -1;
        document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
        if (on && focus) t.focus();
      });
      setHash(id);
      var bar = document.querySelector('.tabs');
      var panel = document.getElementById('panel-' + id);
      if (focus !== undefined && panel.getBoundingClientRect().top < bar.offsetHeight) {
        window.scrollTo({ top: window.scrollY + panel.getBoundingClientRect().top - bar.offsetHeight - 12, behavior: 'smooth' });
      }
    }
    tabs.forEach(function (t, i) {
      t.addEventListener('click', function () { show(t.id.slice(4), false); });
      t.addEventListener('keydown', function (e) {
        var d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (d) { e.preventDefault(); show(tabs[(i + d + tabs.length) % tabs.length].id.slice(4), true); }
      });
    });
    // Filter inside a "Show all" list of API document gaps: every word must appear in the area, path or fields.
    Array.prototype.forEach.call(document.querySelectorAll('details.gaps'), function (box) {
      var input = box.querySelector('.gaps-filter');
      var count = box.querySelector('.gaps-count');
      var none = box.querySelector('.gaps-none');
      var groups = box.querySelectorAll('.gg');
      var total = box.querySelectorAll('ul.ge > li').length;
      var label = count.textContent;
      input.addEventListener('input', function () {
        var terms = input.value.toLowerCase().split(' ').filter(Boolean);
        var shown = 0, areas = 0;
        Array.prototype.forEach.call(groups, function (g) {
          var inGroup = 0;
          Array.prototype.forEach.call(g.querySelectorAll('ul.ge > li'), function (li) {
            var q = li.getAttribute('data-q');
            var ok = terms.every(function (t) { return q.indexOf(t) !== -1; });
            li.hidden = !ok; if (ok) inGroup++;
          });
          g.hidden = inGroup === 0; shown += inGroup; if (inGroup) areas++;
        });
        none.hidden = shown !== 0;
        count.textContent = terms.length ? shown + ' of ' + total + ' endpoints' + (areas ? ' in ' + areas + ' area' + (areas === 1 ? '' : 's') : '') : label;
      });
      input.addEventListener('keydown', function (e) { if (e.key === 'Escape' && input.value) { input.value = ''; input.dispatchEvent(new Event('input')); e.stopPropagation(); } });
      box.querySelector('.gaps-close').addEventListener('click', function () {
        box.open = false;
        var s = box.querySelector('summary'); s.scrollIntoView({ block: 'center' }); s.focus();
      });
    });
    // Search within a tab: every word must appear (any order). Rows in the API reference also match on
    // their area's name, and groups with a match open. Sections with nothing left are hidden.
    Array.prototype.forEach.call(document.querySelectorAll('.search input'), function (input) {
      var panel = document.getElementById('panel-' + input.getAttribute('data-panel'));
      var count = input.parentNode.querySelector('.search-count');
      var items = Array.prototype.map.call(panel.querySelectorAll('.sec tbody tr, .sec article.finding, .sec ul.clean > li'), function (el) {
        var group = el.closest('details.ref');
        var text = el.textContent + (group ? ' ' + group.querySelector('summary').textContent : '');
        return { el: el, text: text.toLowerCase() };
      });
      function run() {
        var raw = input.value.trim();
        var terms = raw.toLowerCase().split(/\\s+/).filter(Boolean); // \\s: this script sits in a JS template string
        var shown = 0;
        items.forEach(function (it) {
          var hit = terms.every(function (t) { return it.text.indexOf(t) > -1; });
          it.el.hidden = !hit;
          if (hit && terms.length && !it.el.classList.contains('filtered-out')) shown++;
        });
        Array.prototype.forEach.call(panel.querySelectorAll('details.ref'), function (d) {
          var any = d.querySelector('tbody tr:not([hidden])');
          d.hidden = terms.length > 0 && !any;
          d.open = terms.length > 0 && !!any;
        });
        Array.prototype.forEach.call(panel.querySelectorAll('.sec'), function (sec) {
          sec.hidden = terms.length > 0 && !sec.querySelector('tbody tr:not([hidden]), article.finding:not([hidden]):not(.filtered-out), ul.clean > li:not([hidden])');
        });
        // Search every kind of result at once; open the "Passed" groups that matched.
        panel.classList.toggle('searching', terms.length > 0);
        Array.prototype.forEach.call(panel.querySelectorAll('.subpanel'), function (sp) {
          sp.classList.toggle('empty', terms.length > 0 && !sp.querySelector('.sec:not([hidden])'));
        });
        Array.prototype.forEach.call(panel.querySelectorAll('details.passed-group'), function (g) {
          var any = g.querySelector('li:not([hidden])');
          g.hidden = terms.length > 0 && !any;
          g.open = terms.length > 0 && !!any;
        });
        count.textContent = !terms.length ? '' : shown ? shown + (shown > 1 ? ' matches' : ' match') + ' for “' + raw + '”' : 'No matches for “' + raw + '”';
      }
      input.addEventListener('input', run);
      input.addEventListener('keydown', function (e) { if (e.key === 'Escape') { input.value = ''; run(); } });
    });
    document.addEventListener('keydown', function (e) {
      var tag = (document.activeElement && document.activeElement.tagName) || '';
      if (e.key !== '/' || /^(INPUT|TEXTAREA|SELECT)$/.test(tag)) return;
      var box = document.querySelector('section[role="tabpanel"]:not([hidden]) .search input');
      if (box) { e.preventDefault(); box.focus(); }
    });

    // Copy a problem's error details. The Clipboard API needs a secure page (https); elsewhere
    // (e.g. the internal report opened from disk) fall back to a hidden textarea and execCommand.
    function copyText(text) {
      if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
      return new Promise(function (resolve, reject) {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed'; ta.style.top = '-1000px'; ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        var ok = false;
        try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
        document.body.removeChild(ta);
        if (ok) resolve(); else reject(new Error('copy refused'));
      });
    }
    document.addEventListener('click', function (e) {
      var btn = e.target.closest && e.target.closest('.copy-btn');
      if (!btn) return;
      var pre = btn.parentNode.querySelector('pre.snippet');
      var label = btn.querySelector('.copy-label');
      var card = btn.closest('article.finding');
      var title = card && card.querySelector('h3') ? card.querySelector('h3').textContent.trim() : '';
      var text = (title ? title + '\\n\\n' : '') + pre.textContent;
      function done(ok) {
        btn.classList.remove('copied', 'failed');
        btn.classList.add(ok ? 'copied' : 'failed');
        label.textContent = ok ? 'Copied' : 'Copy failed';
        clearTimeout(btn._t);
        btn._t = setTimeout(function () { btn.classList.remove('copied', 'failed'); label.textContent = 'Copy'; }, 2000);
      }
      copyText(text).then(function () { done(true); }, function () {
        // Last resort: select the text so Ctrl+C / long-press copy works.
        var r = document.createRange(); r.selectNodeContents(pre);
        var s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
        done(false);
      });
    });

    // Back to top: appears once the page has scrolled a screen or so.
    var up = document.querySelector('.to-top');
    var still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    function onScroll() { up.classList.toggle('show', window.scrollY > Math.max(600, window.innerHeight)); }
    window.addEventListener('scroll', onScroll, { passive: true });
    up.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: still ? 'auto' : 'smooth' });
      var sel = document.querySelector('.tabs [aria-selected="true"]');
      if (sel) sel.focus({ preventScroll: true });
    });
    onScroll();

    // #dashboard, #api, #mobile/problems, #mobile/problems/critical+high, #admin/passed …
    function fromHash() {
      var parts = (location.hash || '').slice(1).split('/');
      var area = document.getElementById('tab-' + parts[0]) ? parts[0] : 'dashboard';
      if (parts[1]) showSub(area, parts[1], false);
      if (parts[1] === 'problems') {
        filters[area] = (parts[2] || '').split('+').filter(function (k) { return SEV_NAMES[k]; });
        applyFilter(area);
      }
      show(area);
      if (parts[1]) {
        // Bring the sub-tab row up under the sticky area switch (from a count tile or a shared link).
        var bar = document.querySelector('#panel-' + area + ' .subtabs');
        var top = bar.getBoundingClientRect().top - document.querySelector('.tabs').offsetHeight - 16;
        if (Math.abs(top) > 4) window.scrollTo({ top: window.scrollY + top, behavior: still ? 'auto' : 'smooth' });
      }
    }
    window.addEventListener('hashchange', function () {
      fromHash();
      // A link to a whole area (e.g. an Overview card) opens it at its top, not where the page was scrolled to.
      if (!(location.hash || '').split('/')[1]) {
        var p = document.querySelector('section[role="tabpanel"]:not([hidden])');
        var top = p.getBoundingClientRect().top - document.querySelector('.tabs').offsetHeight - 16;
        if (top < 0) window.scrollTo({ top: window.scrollY + top, behavior: still ? 'auto' : 'smooth' });
      }
    });
    fromHash();
  })();
</script>
</body>
</html>
`;

const summarise = (d) => (d ? `${count('passed', d.tests)} passed, ${count('problem', d.tests)} problems, ${count('not-run', d.tests)} not run` : 'no results');
fs.writeFileSync(path.join(outDir, 'index.html'), render(false));
writeIcons(outDir);
console.log(`Wrote ${path.relative(root, path.join(outDir, 'index.html'))}`);
console.log(`  Admin portal: ${summarise(admin)}`);
console.log(`  Mobile app:   ${summarise(mobile)}`);
console.log(`  API:          ${summarise(api)}`);
if (admin) console.log(`Technical report: ${path.relative(root, path.join(outDir, 'report.html'))}`);

// Public site for Netlify: the summary page only — no screenshots, traces, videos or technical report.
const siteDir = path.join(root, 'site');
const sitePage = path.join(siteDir, 'index.html');

// PUBLISH_GUARD=1 (CI): never replace a good public page with a broken run.
// No admin check passing means sign-in or setup failed (e.g. missing DEV_ADMIN_* secrets), and a run
// without mobile results must not blank out mobile results that are already published.
function publishBlockers() {
  const blockers = [];
  if (!admin) blockers.push('no admin results were produced');
  else if (!count('passed', admin.tests)) blockers.push('no admin check passed: sign-in or setup likely failed (check DEV_ADMIN_URL, DEV_ADMIN_EMAIL, DEV_ADMIN_PASSWORD)');
  const current = fs.existsSync(sitePage) ? fs.readFileSync(sitePage, 'utf8') : '';
  if (!mobile && current.includes('id="panel-mobile"') && !current.includes(emptyText('mobile'))) {
    blockers.push('no mobile results were produced and the published page already has some (check MOBILE_APK_URL)');
  }
  if (!api && current.includes('id="panel-api"') && !current.includes(emptyText('api'))) {
    blockers.push('no API results were produced and the published page already has some (check API_BASE_URL and the CUSTOMER_T3_* / DEV_ADMIN_* secrets)');
  }
  return blockers;
}
const blockers = process.env.PUBLISH_GUARD === '1' ? publishBlockers() : [];
if (blockers.length) {
  for (const b of blockers) console.log(`${process.env.GITHUB_ACTIONS ? '::warning::' : ''}Public page kept as it was: ${b}`);
} else {
  fs.mkdirSync(siteDir, { recursive: true });
  fs.writeFileSync(sitePage, render(true));
  writeIcons(siteDir);
  console.log(`Public site (Netlify / Vercel — commit it to publish): ${path.relative(root, siteDir)}/index.html`);
}
