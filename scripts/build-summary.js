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
  'Is the loan “Interest rate” shown in the portal a monthly rate (as in the specification’s 2% examples) or a yearly rate? Newer loans now treat it as monthly; loan #169 matches neither.',
  'Should monthly loan repayments be rounded to the whole naira, and if so, is the difference corrected in the last payment?',
  'Should existing loans (such as #169) be recalculated under the new interest rule, or keep their original schedule?',
  'What is the minimum customer verification level (KYC tier) for a Personal loan? The specification does not say; the tests assume Tier 2.',
];

/** Shown on the Admin tab: what this run found different from the previous one. */
const ADMIN_CHANGES = {
  since: '26 October',
  items: [
    ['Loan interest', 'Newer loans now follow the specification’s “Monthly equal” formula (8.5% a month on loan #188, rounded up to the whole naira). The older loan #169 still uses the old amount — see “Problems found” below.'],
    ['Nano and Payday loan product forms', 'The “Loyalty discount streaks” section is now called “Loyalty & repayment progression” on Nano and “Loyalty & constraints” on Payday. Its settings are unchanged. Our check was updated and passes.'],
    ['Investment plan page', 'RTN (Treasury Note) plans now appear in the list. Their page correctly has no “Contribution plan” section and no “Top up” button, as RTN is a one-off lump sum. Our check was updated and passes.'],
    ['Still not fixed', 'The empty audit log, the disappearing new biller, the unrecorded viewing of private customer details and the 7.5% deduction from loan payouts are all still happening.'],
  ],
};

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
  // Found by hand on 2 November (30 October build) — see MOBILE_JOURNEYS.
  {
    title: 'A Tier 3 customer cannot invest in anything, while a Tier 1 customer can',
    severity: 'High',
    owner: 'Engineering (mobile app and KYC) and Product',
    impact: 'Fully verified customers are locked out of every investment product, so they cannot put money in.',
    saw: 'Signed in as the Tier 3 test account (Tier 3 in the admin portal and in the app’s Settings), opening RWIN, REAP or RTN shows “This investment isn’t available on your current tier. Upgrade your account to invest.” The upgrade screen then says “You are on Tier 3 — kindly provide the information below to upgrade to Tier 3” and lists 8 unfinished steps. The Tier 1 test account can open RWIN and create a goal.',
    expected: 'A Tier 3 customer should be able to invest in every product. The app should use the same tier the admin portal shows, and the upgrade screen should not ask a Tier 3 customer to upgrade to Tier 3.',
    area: 'Investing (tried by hand)',
  },
  {
    title: 'Nano and Payday loan applications crash',
    severity: 'High',
    owner: 'Engineering (mobile app)',
    impact: 'Customers cannot apply for any short-term loan. After the crash the app shows a blank screen and has to be closed.',
    saw: 'Tapping any Nano or Payday loan on the Borrow screen (four products) shows a red error screen: “ReferenceError: Property ’useFocusEffect’ doesn’t exist” in the loan-amount screen. Dismissing or reloading leaves a blank screen.',
    expected: 'The loan-amount screen should open so the customer can choose an amount and apply.',
    area: 'Borrowing (tried by hand)',
  },
  {
    title: 'Send Money shows recipients the customer never added',
    severity: 'High',
    owner: 'Engineering (mobile app) and Compliance',
    impact: 'A customer could send money to a stranger they think they paid before.',
    saw: 'On the Tier 1 test account, which has never sent money, Send Money lists four “Recent Recipients” and saved beneficiaries with names, banks and the last four digits of their account numbers. They look like built-in sample data, but could also be another customer’s list.',
    expected: 'Only recipients this customer has actually paid or saved should be shown; a new customer should see an empty list. If these belong to another customer, it is also a data leak.',
    area: 'Sending money (tried by hand)',
  },
  {
    title: 'Next of kin cannot be saved',
    severity: 'Medium',
    owner: 'Engineering (mobile app and API)',
    impact: 'Customers cannot add a next of kin, which is normally required for KYC.',
    saw: 'After filling in every field on the Next of Kin form and pressing Save, the app shows “City cannot be empty”. The form has no City field.',
    expected: 'The form should ask for everything the system needs (add a City field, or stop requiring it).',
    area: 'Profile (tried by hand)',
  },
  {
    title: 'Changing the home address fails without telling the customer',
    severity: 'Medium',
    owner: 'Engineering (mobile app)',
    impact: 'The customer believes their address is saved when it is not.',
    saw: 'The profile shows no address (“Add your address”). Adding one and pressing “Save changes” shows no message, but the address is gone when the profile is reopened. The app’s log shows the system refused it: “You can no longer update your residential address”.',
    expected: 'If the address cannot be changed, the app should say so (and explain how to change it). It should also show the address already on file.',
    area: 'Profile (tried by hand)',
  },
  {
    title: '“Log out” does nothing',
    severity: 'Medium',
    owner: 'Engineering (mobile app)',
    impact: 'Customers cannot sign out — a risk on shared or lost phones.',
    saw: 'Tapping “Log out” in Settings (several times, waiting up to 9 seconds) has no effect. The customer stays signed in until the app times out.',
    expected: 'Log out should end the session and return to the sign-in screen.',
    area: 'Settings (tried by hand)',
  },
  {
    title: 'Funding the wallet by card does nothing',
    severity: 'Medium',
    owner: 'Engineering (mobile app and payments)',
    impact: 'Customers cannot add money by card, so they cannot fund investments or repayments that way.',
    saw: 'Fund → Card Payment → entering ₦40,000 and tapping “Pay ₦40,000” or “Add New Card” does nothing — no card form, no message, and no request is sent.',
    expected: 'The card payment page (Paystack) should open.',
    area: 'Funding the wallet (tried by hand)',
  },
  {
    title: 'Investment goals can be created and topped up with an empty wallet, with no warning',
    severity: 'Medium',
    owner: 'Engineering (mobile app) and Product',
    impact: 'Customers set up a plan whose first payment will fail, and get no message telling them why nothing happens.',
    saw: 'The Tier 1 test account (₦0.00 balance) created an RWIN goal that says “Your first debit of ₦32,587.54 will be automatically processed on 2 November 2026” (that day). Tapping “Add ₦32,587.54” to top it up then does nothing — no “insufficient balance” message and no other way to pay.',
    expected: 'The app should tell the customer their balance is too low and offer a way to fund it before (or while) creating the goal.',
    area: 'Investing (tried by hand)',
  },
  {
    title: 'Loan documents are marked “Verified” the moment they are uploaded',
    severity: 'Medium',
    owner: 'Engineering (mobile app) and Operations',
    impact: 'Customers are told their documents are verified before anyone has checked them, and are asked to upload documents already on file.',
    saw: 'Applying for a Personal loan asked for a statement of accounts, NIN document and utility bill — the admin portal shows this customer uploaded all three on 21 October. A blank test PDF uploaded for each was immediately labelled “Verified”.',
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
    saw: 'The review screen showed “Management Fee (1%) ₦1,000” and “Total Repayable ₦126,500”, while its own schedule adds up to ₦125,500. The admin portal shows a ₦0 management fee, and no fee was charged. Instead, when ₦100,000 was paid out, ₦7,500 was taken straight back as “Loan VAT” (wallet credited ₦92,500). VAT is not mentioned on the application or offer screens.',
    expected: 'Every charge should be shown, with the correct amount, before the customer accepts. Finance should confirm whether VAT applies to the amount lent (VAT normally applies to fees).',
    area: 'Borrowing (tried by hand)',
  },
  {
    title: 'The loan screen counts down to the wrong payment date',
    severity: 'Medium',
    owner: 'Engineering (mobile app)',
    impact: 'Customers may miss their first payment and be charged late penalties.',
    saw: 'After payout, the Borrow screen says “Next payment due in 90 days · ₦41,834”. The admin portal shows the next repayment on 2 December 2026 — 30 days away. (90 days is the last payment, 31 January 2027.)',
    expected: 'It should count down to the next monthly payment (2 December 2026).',
    area: 'Borrowing (tried by hand)',
  },
  {
    title: 'Times are shown an hour behind Nigerian time',
    severity: 'Medium',
    owner: 'Engineering (mobile app, admin portal and API)',
    impact: 'Transaction and application times look wrong to customers and staff, which matters for disputes and audits.',
    saw: 'The loan payout made at about 3:30 PM (WAT) appears in the app’s activity as 02:30 PM. The admin portal shows the application created at 1:56 PM when it was submitted at about 2:56 PM.',
    expected: 'Times should be shown in Nigerian time (WAT, UTC+1).',
    area: 'Times and dates (tried by hand)',
  },
];

/** Activities done by hand in the app on 2 November (30 October build), with the outcome. */
const MOBILE_JOURNEYS = {
  when: '2 November, 30 October build',
  intro: 'A tester used the app like a customer with the Tier 1 and Tier 3 test accounts (Tier 2 is on hold). Real records were created on the test system; test data was removed where possible.',
  items: [
    ['Apply for a Personal loan (₦100,000, 3 months), accept it and receive it', 'bad', 'Full journey done: applied in the app (after uploading three documents), approved in the admin portal (#189), offer accepted in the app, paid out from the admin portal. The repayment schedule (3 × about ₦41,833, ₦125,500 in total) follows the “Monthly equal” rule correctly, and the Borrow screen correctly blocks new loans until this one is repaid. But the offer showed ₦865,000 to repay, ₦7,500 “Loan VAT” was taken from the payout, and the next-payment countdown is wrong — see “Problems found”.'],
    ['Apply for a Nano or Payday loan', 'bad', 'Crashes on the first screen — see “Problems found”.'],
    ['Invest in RWIN, REAP or RTN as a Tier 3 customer', 'bad', 'Blocked as “not available on your current tier” — see “Problems found”.'],
    ['Create, top up and delete an RWIN goal as a Tier 1 customer', 'bad', 'Goal created (₦100,000 over 90 days, maturity 31 January 2027 — correct) and deleted. The top-up could not be paid: the wallet was empty and card funding does not work.'],
    ['Edit employment details', 'ok', 'Job title changed, saved and still there after restarting the app; then changed back.'],
    ['Add a home address', 'bad', 'Not saved, with no message — see “Problems found”.'],
    ['Add a next of kin', 'bad', 'Cannot be saved (“City cannot be empty”, no City field).'],
    ['Fund the wallet', 'bad', 'Card payment does nothing. Bank transfer (dedicated account) and USSD are offered but were not used, as they move real money.'],
    ['Send money and pay bills', 'idle', 'Screens open; not completed, as they move real money. Send Money shows recipients the customer never added.'],
    ['Log out and switch account', 'bad', '“Log out” does nothing; “Switch Account” on the sign-in screen works.'],
  ],
};

/** Shown on the Mobile tab: what this run found different from the previous one. */
const MOBILE_CHANGES = {
  since: '29 October',
  items: [
    ['App build', 'Tested the 30 October build. It has the same version number as the 29 October build (1.1.55, code 92); the version should be raised with each build so testers and devices can tell them apart.'],
    ['Fixed: oversized Payday offer', 'The Borrow screen’s “Recommended for you” card now offers ₦20,000 for a 30-day Payday loan, within the ₦500,000 limit. On 29 October it offered ₦5,000,000.'],
    ['Still not fixed', 'A Tier 3 account still shows its profile as 2/3 complete, a local phone number (080…) is still not accepted at sign-in, and identity verification (SmileID) still cannot start because its settings file is missing.'],
  ],
};

const MOBILE_MISMATCHES = [
  ['RWIN tenors', 'Booking an RWIN goal offers 60, 90 or 120 days, but the RWIN product page lists rates for 90, 180, 270 and 360 days.'],
  ['REAP rate', 'The Grow screen’s “Recommended for you” card says REAP earns “up to 20% p.a.”, while the REAP card below it says 30% p.a.'],
  ['App version', 'Settings shows “v2.0.0”, but the installed app is version 1.1.55.'],
  ['Password error wording', 'After a wrong password, the app says “Incorrect passcode. 3 attempt(s) left.” — it should say password; “passcode” is the 6-digit code used with a phone number.'],
  ['Shared attempt counter', 'Wrong attempts with email + password and with phone + passcode count towards the same limit (4 attempts in total). Product should confirm this is intended.'],
];

const MOBILE_QUESTIONS = [
  'Is the “Complete your profile” card meant to follow the customer’s KYC tier? The Tier 3 test account shows 2 of 3 steps done.',
  'Should sign-in accept phone numbers starting with 0, or only the +234 format?',
  'How should RWIN goal interest be projected? The app shows ₦2,237.38 on ₦100,000 over 90 days at 14% — interest up to the goal’s end date. Our reading of the calculator rules (each contribution earning for a full 90-day cycle) gives about ₦3,375.',
  'Should 7.5% VAT be charged on the amount lent? It is currently taken from every loan payout as “Loan VAT”. And is there a management fee on Personal loans (the app says 1%, the admin portal says ₦0)?',
  'Which KYC tier does each investment product need? The product documents do not say.',
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
    tests, findings, areas: AREAS, mismatches: MISMATCHES, questions: QUESTIONS, changes: ADMIN_CHANGES,
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
    tests, findings, extraCount: MOBILE_EXTRA_FINDINGS.length, journeys: MOBILE_JOURNEYS,
    areas: MOBILE_AREAS, mismatches: MOBILE_MISMATCHES, questions: MOBILE_QUESTIONS, changes: MOBILE_CHANGES,
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
  const extra = d.extraCount ? ` (including ${d.extraCount} found by hand or in the app’s error log)` : '';
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
${d.changes ? `
    <h2>What changed since the last run (${esc(d.changes.since)})</h2>
    <ul class="clean">${d.changes.items.map(([t, x]) => `<li><strong>${esc(t)}.</strong> ${esc(x)}</li>`).join('')}</ul>
` : ''}${d.journeys ? `
    <h2>What we tried by hand (${esc(d.journeys.when)})</h2>
    <p class="muted">${esc(d.journeys.intro)}</p>
    <div class="table-wrap">
    <table>
      <thead><tr><th>Activity</th><th>Result</th></tr></thead>
      <tbody>${d.journeys.items.map(([t, tone, x]) => `<tr><td class="area"><strong>${esc(t)}</strong><div class="muted">${esc(x)}</div></td><td class="result"><span class="badge ${tone}">${tone === 'ok' ? 'Worked' : tone === 'bad' ? 'Problem' : 'Partly checked'}</span></td></tr>`).join('')}</tbody>
    </table>
    </div>
` : ''}
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
  .sev.high { background: var(--bad-bg); color: var(--bad); } .sev.med { background: var(--med-bg); color: var(--med); }
  .finding .impact { font-weight: 600; }
  dl { margin: 10px 0 0; } dt { font-weight: 600; margin-top: 10px; } dd { margin: 2px 0 0; }
  details { margin-top: 8px; } summary { cursor: pointer; color: var(--accent); font-weight: 600; padding: 10px 0; min-height: 44px; }
  details img { width: 100%; height: auto; border: 1px solid var(--line); border-radius: 8px; margin-top: 10px; }
  ul.clean { padding-left: 20px; } ul.clean li { margin: 10px 0; }
  a { color: var(--accent); }
  code { font-size: .9em; }
  .tech { display: inline-block; margin-top: 8px; padding: 10px 16px; border-radius: 8px; border: 1px solid var(--line); background: var(--surface); text-decoration: none; font-weight: 600; }
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
