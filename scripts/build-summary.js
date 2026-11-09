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
const ADMIN_EXTRA_FINDINGS = [
  {
    title: 'Notifications sent by the system are not recorded anywhere staff can see',
    severity: 'Medium',
    owner: 'Engineering (backend and admin portal) and Customer Support',
    impact: 'Staff cannot see what a customer was told, or when, about their loans, investments or account (for example “loan approved”, “offer ready”, “paid out”), so support cannot answer “I never got the message” and there is no record for audit or disputes.',
    saw: 'Checked 9 November. Communications → Campaigns, and the notification list behind it, only hold messages staff wrote and sent by hand (each has an admin sender and a recipient segment). Nothing the system sends by itself appears there, although the Tier 1 and Tier 3 test accounts had several loans applied for, approved, offered, accepted, paid out and repaid in the past week. The “Delivery log” on the Campaigns page was removed on 6 November, the bell-style icon in the header is “Approvals awaiting you”, and the portal makes no notification requests at all. The customers’ own in-app inbox is also empty for all three test accounts.',
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
  {
    title: 'Public Sector corridor rates are stored and shown in different units',
    severity: 'Medium',
    owner: 'Product and Engineering (loans)',
    impact: 'Staff cannot tell from the portal what rate customers will be charged, and a rate typed in the wrong unit would go live unnoticed.',
    saw: 'Corridors & partners shows the Lagos Civil Servants rate as “0.03%” (stored as 0.03, with a booked average interim rate of 4), and lagos-v1 as “25%” (booked average 2.5). Its management fee (0.01) and quarterly fee (0.01) are stored as fractions; lagos-v1’s management fee is 2.5. The app quotes Lagos Civil Servants loans at 4% a month.',
    expected: 'One unit for every rate and fee, labelled in the portal (for example “% per month”), with the customer’s rate clearly identified.',
    area: 'Product Management: corridors (checked by hand)',
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
    title: 'Identity verification (SmileID) fails to start in this app build',
    severity: 'High',
    owner: 'Engineering (mobile app build)',
    impact: 'Selfie / ID verification for upgrading a customer’s KYC tier is likely to fail in this build.',
    saw: 'Every time the app starts, its error log reports “SmileID initialize error: smile_config.json not found in assets”. The file is missing from the app package.',
    expected: 'The SmileID configuration file should be included in the build so identity checks can run.',
    area: 'App start-up (seen in the app’s error log)',
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
  when: '2–4 November, 30 October, 3 November and 4 November builds',
  intro: 'A tester used the app like a customer with the Tier 1 and Tier 3 test accounts (Tier 2 is on hold). Real records were created on the test system; test data was removed where possible. The main journeys are now automated checks (Investing, Borrowing, Profile and Account in the table above), so they re-run on every new build.',
  items: [
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
    ['Re-run on 6 November (same 4 November build)', 'No new app build was available, so the 4 November build was tested against the latest back end. No crashes. New problem: the Personal loan “See Breakdown” no longer opens (see “Problems found”). Everything else is as on 4 November. The Nano and Payday checks did not run, because the Tier 1 test account now has a ₦4,000,000 Personal loan (#199) waiting to be paid out, so its Borrow screen shows that loan instead of the products. Screenshots of the app now show the screen (they used to come out black).'],
    ['App build', 'Tested the 4 November build. It still has the same version number as the earlier builds (1.1.55, code 92). The version should go up with each build so testers and devices can tell them apart.'],
    ['Fixed: Nano and Payday crash', 'All four short-term loans (Adebanjo Nano, Adebanjo Payday, nano-loan-v2 and payday-loan-v2) now open their amount screen. Checked by the automated run and by hand. No crashes were seen anywhere else in the app during the full run.'],
    ['New: investing tried by hand with the Tier 2 account', 'Plans can be created with correct figures, but none can be paid for in the app. See “Problems found”.'],
    ['Phone sign-in re-checked', 'A number written 080… does work, but takes 20 seconds or more; the automated check used to give up after 15 seconds, which is why it was reported as not working. A number written +234… did not work.'],
    ['Fixed: loan offer interest', 'The Public Sector offer (#194) shows ₦60,000 interest and ₦360,000 to repay on ₦300,000 over 9 months, matching the reducing-balance schedule. The #191 offer had shown ₦1,086,004.29 interest. The offer screen also now shows the tenor in months and a repayment date.'],
    ['Still seen: VAT taken from the payout', '#191 (₦300,000) was paid out as ₦277,500, and #193 (₦250,000) as ₦231,250: 7.5% VAT is still deducted at payout although no fee is charged. See “Problems found”.'],
    ['Still not fixed', 'Send Money still shows recipients the customer never added. Card funding and Log out still do nothing, and next of kin still can’t be saved (“City cannot be empty”). The Tier 3 account still shows 2/3 identity steps. SmileID still can’t start (its settings file is missing). RWIN goals still offer tenors not in the rate table, and topping up from an empty wallet still doesn’t say why it can’t be paid.'],
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
const sevRank = (s) => (s === 'High' ? 0 : s === 'Low' ? 2 : 1);

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
    heading: 'Admin Portal Test Results',
    context: 'Chrome browser · dev environment',
    runText: `Automated check run on ${fmt(new Date(results.stats.startTime))} (WAT) · took about ${Math.round(results.stats.duration / 60000)} minutes`,
    intro: 'An automated tester used the admin portal the way a staff member would — opening pages, filling in forms and checking the results against the product documents.',
    tests, findings, areas: AREAS, mismatches: MISMATCHES, questions: QUESTIONS, changes: ADMIN_CHANGES,
    extraCount: ADMIN_EXTRA_FINDINGS.length, extraNote: 'found by hand', journeys: ADMIN_JOURNEYS,
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
          ${snippet ? `<pre class="snippet">${esc(snippet)}</pre>` : ''}
          ${shot ? `<a href="${f.shot}" target="_blank" rel="noopener"><img src="${f.shot}" alt="Screenshot taken when problem ${i + 1} was found" loading="lazy"></a>` : ''}
          ${video ? `<video controls preload="none" src="${f.video}" aria-label="Recording of the check for problem ${i + 1}"></video>` : ''}
        </details>`;
}

/** A collapsible table under a document-gap item: [[area, endpoint, detail], …]. */
function gapTable(rows) {
  const body = rows.map(([area, ep, detail]) => `<tr><td>${esc(area)}</td><td><code>${esc(ep)}</code></td><td>${esc(detail)}</td></tr>`).join('');
  return `<details class="ref"><summary>Show all ${rows.length} <span class="muted">· endpoint and the fields its request body accepts</span></summary><div class="table-wrap"><table><thead><tr><th>Area</th><th>Endpoint</th><th>Fields in the request body (none marked required)</th></tr></thead><tbody>${body}</tbody></table></div></details>`;
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
  const extra = d.extraCount ? ` (including ${d.extraCount} ${d.extraNote || 'found by hand or in the app’s error log'})` : '';
  const verdict = n === 0
    ? { tone: 'good', head: 'Everything checked is working as expected', sub: `All ${checked} checks passed.` }
    : { tone: 'warn', head: `${high >= 3 ? 'Not ready for release' : 'Mostly working'} — ${n} problem${n > 1 ? 's' : ''} need attention${extra}`, sub: high ? `${high} of them affect money or compliance and should be fixed before release.` : 'None of them affect money or compliance.' };

  const areaRows = Object.entries(d.areas).map(([file, a]) => {
    const list = tests.filter((t) => t.file === file);
    if (!list.length) return '';
    const p = count('problem', list);
    const nr = count('not-run', list);
    const ran = list.length - nr;
    const badge = p ? `<span class="badge bad">${p} problem${p > 1 ? 's' : ''}</span>` : ran ? '<span class="badge ok">All good</span>' : '<span class="badge idle">Not run yet</span>';
    return `<tr><td class="area"><strong>${esc(a.name)}</strong><div class="muted">${esc(a.what)}</div></td><td class="num" data-label="Checks run">${ran}</td><td class="num" data-label="Worked">${count('passed', list)}</td><td class="result">${badge}${nr ? `<div class="muted small">${nr} not run</div>` : ''}</td></tr>`;
  }).join('');

  const cards = findings.map((f, i) => `
      <article class="card finding">
        <header>
          <span class="sev ${f.severity === 'High' ? 'high' : f.severity === 'Low' ? 'low' : 'med'}">${esc(f.severity)} priority</span>
          <h3>${i + 1}. ${esc(f.title)}</h3>
          <p class="muted">Area: ${esc(f.area)} · Who should look at this: ${esc(f.owner)}</p>
        </header>
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

  const pct = (x) => (total ? (x / total) * 100 : 0);
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
      <div class="stat"><div class="n">${total}</div><div class="muted">checks in total</div></div>
      <div class="stat ok"><div class="n">${passed}</div><div class="muted">worked as expected</div></div>
      <div class="stat bad"><div class="n">${failed}</div><div class="muted">checks with a problem</div></div>
      <div class="stat"><div class="n">${notRun}</div><div class="muted">not run (see below)</div></div>
    </div>
    <div class="bar" role="img" aria-label="${passed} passed, ${failed} problems, ${notRun} not run">
      <span class="p" style="width:${pct(passed)}%"></span><span class="f" style="width:${pct(failed)}%"></span><span class="s" style="width:${pct(notRun)}%"></span>
    </div>
    <div class="legend muted"><span><i class="dot" style="background:var(--good)"></i>Worked (${passRate}% of checks that ran)</span><span><i class="dot" style="background:var(--bad)"></i>Problem</span><span><i class="dot" style="background:var(--muted)"></i>Not run</span></div>
${d.changes ? `
    <div class="sec">
    <h2>${d.changes.heading ? esc(d.changes.heading) : `What changed since the last run (${esc(d.changes.since)})`}</h2>
    <ul class="clean">${d.changes.items.map(([t, x]) => `<li><strong>${esc(t)}.</strong> ${esc(x)}</li>`).join('')}</ul>
    </div>
` : ''}${d.journeys ? `
    <div class="sec">
    <h2>${d.id === 'admin' ? 'What we checked by hand' : 'What we tried by hand'} (${esc(d.journeys.when)})</h2>
    <p class="muted">${esc(d.journeys.intro)}</p>
    <div class="table-wrap">
    <table>
      <thead><tr><th>Activity</th><th>Result</th></tr></thead>
      <tbody>${d.journeys.items.map(([t, tone, x]) => `<tr><td class="area"><strong>${esc(t)}</strong><div class="muted">${esc(x)}</div></td><td class="result"><span class="badge ${tone}">${tone === 'ok' ? 'Worked' : tone === 'bad' ? 'Problem' : 'Partly checked'}</span></td></tr>`).join('')}</tbody>
    </table>
    </div>
    </div>
` : ''}
    <div class="sec">
    <h2>What was checked</h2>
    <p class="muted">${esc(d.intro)}</p>
    <div class="table-wrap">
    <table>
      <thead><tr><th>Area</th><th class="num">Checks run</th><th class="num">Worked</th><th>Result</th></tr></thead>
      <tbody>${areaRows}</tbody>
    </table>
    </div>
    </div>

    <div class="sec">
    <h2>Problems found</h2>
    <p class="muted">These did not behave the way the product documents say they should. “High priority” means it affects customers’ money or a compliance requirement.</p>
    ${cards || '<p>No problems were found.</p>'}
    </div>

    <div class="sec">
    <h2>${esc(d.mismatchesHeading || 'Differences from the documents (not failures)')}</h2>
    <p class="muted">${esc(d.mismatchesIntro || 'These work, but don’t match what the specifications say. Product should confirm which is correct.')}</p>
    <ul class="clean">${d.mismatches.map(([t, x, rows]) => `<li><strong>${esc(t)}.</strong> ${esc(x)}${rows ? gapTable(rows) : ''}</li>`).join('')}</ul>
    </div>

    <div class="sec">
    <h2>Questions for the product team</h2>
    <ul class="clean">${d.questions.map((q) => `<li>${esc(q)}</li>`).join('')}</ul>
    </div>

${d.reference ? `<div class="sec">${d.reference(pub)}</div>` : ''}

    <div class="sec">
    <h2>Not run in this round</h2>
    <ul class="clean">${notRunRows || '<li>Everything was run.</li>'}</ul>
    </div>

    <h2>Need the technical detail?</h2>
    ${pub ? d.techPublic : d.techInternal}`;
}

function emptyPanel(label, how) {
  return `<h2 class="panel-title">${esc(label)} Test Results</h2><section class="card verdict"><h3>No results yet</h3><p class="muted">${esc(how)}</p></section>`;
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
/** Reference lists that are fine to be public: answering without sign-in is a documentation gap there, not a leak. */
const PUBLIC_REFERENCE = /^\/api\/v3\/(country|state|lga)(\/|$)/;
/** Same rule as api-dev/spec.ts isAdminOnly. */
const API_ADMIN_TAGS = ['Account Control Endpoints', 'General Approval Workflow Endpoints', 'Investment Management Endpoints', 'Investment Report Endpoints', 'Loan Report Endpoints', 'Loan Approval Workflow Endpoints', 'System-Wide Audit Log Endpoints', 'Portal Admin User Endpoints', 'Message Template Endpoints'];
const apiAdminOnly = (op) => API_ADMIN_TAGS.includes(op.tag) || /\/admin(\/|-|$)/.test(op.path);
/** Found by hand while building the checks (2026-11-03). */
const API_DOC_NOTES = [
  ['Paging starts at 1', 'List endpoints take pageNo starting at 1 — pageNo=0 is rejected as “pageNo is required”. Leaving out the optional pageNo on GET /api/v3/loan-products fails with “Page index must not be less than zero”. The API document says neither.'],
];
const API_QUESTIONS = [
  'Where should NIN verification happen in the app? The ticket says during onboarding, but the app has no NIN step. Can the developers share the provider’s sandbox test NIN so the success path can be checked?',
  'Which roles may call each staff-only area? The API document does not say, so these checks treat Investment Management, the Investment and Loan reports, the approval workflows, the audit log, account controls and portal admin users as staff-only.',
  'Should reference lists such as countries and states be public? They answer without sign-in although the document says sign-in is needed.',
  'Can the API document mark which parameters and request fields are required? Many are only enforced by the server.',
];
const maskPII = (s) => String(s).replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '<email>').replace(/(\+?234|0)[789][01]\d{8}/g, '<phone>');
const apiAreaName = (tag) => (tag === 'lead-api-resource' ? 'Leads' : tag.replace(/ Endpoints$/, ''));

/** What the latest backend update changed, written up after each re-run (shown above the live comparison). */
const API_UPDATES = [
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
  const add = (rs, f) => { if (rs.length) findings.push({ area: 'API', owner: 'Engineering (backend)', snippet: apiSnippet(rs, CHECKS_FOR[f.title] || []), ...f }); };
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

  // ---- Documentation gaps (not failures)
  const docGaps = [...API_DOC_NOTES];
  const requiredButOptional = recs.filter((r) => r.problems.some((p) => /is required”/.test(p)));
  if (requiredButOptional.length) docGaps.push(['Parameters documented as optional but required', named(requiredButOptional, (r) => ` (${maskPII(r.problems.find((p) => /is required”/.test(p)).match(/“(.*)”/)[1])})`) + '.']);
  const publicRefs = recs.filter((r) => isReference(r) && r.checks.noAuth === 'fail');
  if (publicRefs.length) docGaps.push(['Public lists documented as needing sign-in', `${named(publicRefs)} answer without sign-in (reasonable for reference lists), but the document says sign-in is required.`]);
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
  { id: 'admin', label: 'Admin portal', icon: '🖥', data: admin, empty: 'Run the admin portal checks (npm run test:admin:dev) to fill this in.' },
  { id: 'mobile', label: 'Mobile app', icon: '📱', data: mobile, empty: 'Run the mobile checks (npx wdio run mobile/config/wdio.android.conf.ts) to fill this in.' },
  { id: 'api', label: 'API', icon: '🔌', data: api, empty: 'Run the API checks (npm run test:api:dev) to fill this in.' },
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
<link rel="icon" href="favicon.svg" type="image/svg+xml">
<link rel="icon" href="favicon.ico" sizes="16x16 32x32 48x48">
<link rel="apple-touch-icon" href="apple-touch-icon.png">
<link rel="manifest" href="site.webmanifest">
<meta name="theme-color" content="#1f3a6d" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#11151c" media="(prefers-color-scheme: dark)">
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
  .sev.high { background: var(--bad-bg); color: var(--bad); } .sev.med { background: var(--med-bg); color: var(--med); } .sev.low { background: var(--idle-bg); color: var(--muted); }
  .method { display: inline-block; min-width: 3.6em; font: 700 .72rem/1.6 ui-monospace, monospace; text-align: center; padding: 0 6px; border-radius: 6px; background: var(--idle-bg); color: var(--muted); }
  .method.m-get { background: var(--good-bg); color: var(--good); } .method.m-delete { background: var(--bad-bg); color: var(--bad); } .method.m-post, .method.m-put, .method.m-patch { background: var(--med-bg); color: var(--med); }
  .finding .impact { font-weight: 600; }
  dl { margin: 10px 0 0; } dt { font-weight: 600; margin-top: 10px; } dd { margin: 2px 0 0; }
  details { margin-top: 8px; } summary { cursor: pointer; color: var(--accent); font-weight: 600; padding: 10px 0; min-height: 44px; }
  pre.snippet { white-space: pre-wrap; overflow-wrap: anywhere; background: var(--bg); color: var(--text); border: 1px solid var(--line); border-radius: 8px; padding: 12px; font-size: .85rem; line-height: 1.45; max-height: 420px; overflow: auto; margin: 6px 0 0; }
  details.evidence video { display: block; width: 100%; border: 1px solid var(--line); border-radius: 8px; margin-top: 10px; background: #000; }
  details img { width: 100%; height: auto; border: 1px solid var(--line); border-radius: 8px; margin-top: 10px; }
  ul.clean { padding-left: 20px; } ul.clean li { margin: 10px 0; }
  a { color: var(--accent); }
  code { font-size: .9em; }
  .tech { display: inline-block; margin-top: 8px; padding: 10px 16px; border-radius: 8px; border: 1px solid var(--line); background: var(--surface); text-decoration: none; font-weight: 600; }
  /* Search within a tab (shown only when JavaScript runs) */
  .search { display: none; margin: 18px 0 4px; }
  .js .search { display: block; }
  .search label { display: block; font-weight: 600; margin-bottom: 6px; }
  .search input { width: 100%; box-sizing: border-box; font: inherit; padding: 12px 14px; min-height: 44px; border: 1px solid var(--line); border-radius: 10px; background: var(--surface); color: inherit; }
  .search input:focus-visible { outline: 3px solid var(--accent); outline-offset: 1px; }
  .search-count { margin: 6px 0 0; min-height: 1.2em; }
  .sec[hidden], .sec [hidden] { display: none !important; }
  footer { margin-top: 48px; font-size: .85rem; color: var(--muted); }
  dd, li, .finding h3 { overflow-wrap: anywhere; }

  /* Phones and narrow windows */
  @media (max-width: 600px) {
    body { font-size: 15px; }
    main { padding: 20px 16px 48px; }
    h1 { font-size: 1.55rem; }
    h2 { font-size: 1.15rem; margin-top: 32px; }
    h2.panel-title { font-size: 1.3rem; }
    .verdict h3 { font-size: 1.08rem; }
    .card { padding: 16px; }
    /* Compact sticky switch: label and count on one line, icon dropped */
    .tabs { gap: 4px; padding: 4px; margin: 18px 0 16px; top: 4px; border-radius: 12px; }
    .tab { padding: 9px 6px; gap: 4px 6px; font-size: .92rem; border-radius: 9px; min-height: 44px; }
    .tab > span[aria-hidden] { display: none; }
    .pill { font-size: .7rem; padding: 1px 7px; }
    .stats { grid-template-columns: 1fr 1fr; gap: 8px; }
    .stat { padding: 12px; }
    .stat .n { font-size: 1.6rem; }
    /* "What was checked": each row becomes a small card */
    .table-wrap { overflow: visible; }
    table, tbody, tr, td { display: block; width: 100%; }
    table { background: transparent; border: 0; }
    thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
    tr { display: grid; grid-template-columns: auto auto 1fr; align-items: center; gap: 4px 16px;
         background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 14px; margin-bottom: 10px; }
    td { padding: 0; border: 0; }
    td.area { grid-column: 1 / -1; margin-bottom: 6px; }
    td.num { text-align: left; white-space: nowrap; }
    td.num::before { content: attr(data-label) " "; color: var(--muted); font-size: .85rem; }
    td.result { justify-self: end; text-align: right; }
    ul.clean { padding-left: 18px; }
  }
  @media (max-width: 340px) {
    .tab { flex-direction: column; }
    tr { grid-template-columns: 1fr 1fr; }
    td.result { grid-column: 1 / -1; justify-self: start; text-align: left; }
  }
</style>
</head>
<body>
<main>
  <p class="muted small">Rosabon Unified · Test environment (dev)</p>
  <h1>Automated Test Results</h1>
  <p class="muted">Choose which part of the product to see. The admin portal is the staff website; the mobile app is what customers use; the API is the service both of them talk to.</p>

  <div class="tabs" role="tablist" aria-label="Which results to show">
    ${tabs.map((t, i) => `<button class="tab" role="tab" id="tab-${t.id}" aria-controls="panel-${t.id}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}"><span aria-hidden="true">${t.icon}</span> ${esc(t.label)} ${pill(t.data)}</button>`).join('\n    ')}
  </div>

  ${tabs.map((t, i) => `${i ? '<hr class="nojs-divider">' : ''}<section role="tabpanel" id="panel-${t.id}" aria-labelledby="tab-${t.id}" tabindex="0">
    ${t.data ? panel(t.data, pub) : emptyPanel(t.label, t.empty)}
  </section>`).join('\n  ')}

  <footer>
    Generated automatically from the test results by <code>scripts/build-summary.js</code>. Sources: Admin PRD, Unified app PRD, the backend’s API document (/v3/api-docs), Investment and Loan product specifications, KYC specification, QA Strategy.
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
          if (hit && terms.length) shown++;
        });
        Array.prototype.forEach.call(panel.querySelectorAll('details.ref'), function (d) {
          var any = d.querySelector('tbody tr:not([hidden])');
          d.hidden = terms.length > 0 && !any;
          d.open = terms.length > 0 && !!any;
        });
        Array.prototype.forEach.call(panel.querySelectorAll('.sec'), function (sec) {
          sec.hidden = terms.length > 0 && !sec.querySelector('tbody tr:not([hidden]), article.finding:not([hidden]), ul.clean > li:not([hidden])');
        });
        count.textContent = !terms.length ? '' : shown ? shown + (shown > 1 ? ' matches' : ' match') + ' for “' + raw + '”' : 'No matches for “' + raw + '”';
      }
      input.addEventListener('input', run);
      input.addEventListener('keydown', function (e) { if (e.key === 'Escape') { input.value = ''; run(); } });
    });
    document.addEventListener('keydown', function (e) {
      var tag = (document.activeElement && document.activeElement.tagName) || '';
      if (e.key !== '/' || /^(INPUT|TEXTAREA|SELECT)$/.test(tag)) return;
      var box = document.querySelector('[role="tabpanel"]:not([hidden]) .search input');
      if (box) { e.preventDefault(); box.focus(); }
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
  if (!mobile && current.includes('id="panel-mobile"') && !current.includes(tabs[1].empty)) {
    blockers.push('no mobile results were produced and the published page already has some (check MOBILE_APK_URL)');
  }
  if (!api && current.includes('id="panel-api"') && !current.includes(tabs[2].empty)) {
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
