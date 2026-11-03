# Rosabon Unified: automation suite

Automated tests for the **Rosabon Unified mobile app** and the **Admin Portal**. The suite follows the Rosabon QA & Testing Framework Strategy v1.0:

- Effort is risk-based (§7).
- Tests run shift-left on the API first, then shift-right on real devices (§13).
- Every financial figure is checked against an independent oracle (§21, §32).
- Results go to TestRail, with Jira traceability (§13 stage 4–5).

| Layer | Tooling | Location |
|---|---|---|
| Calculation oracle and its self-tests | TypeScript + `decimal.js`, Playwright Test runner | [shared/calc/](shared/calc/), [unit/](unit/) |
| API contract (shift-left) | Playwright `request` | [api-tests/](api-tests/) |
| Admin Portal E2E | Playwright | [admin/](admin/) |
| Mobile app E2E (Android + iOS) | WebdriverIO 9 + Appium 3 + Mocha; TestMu AI / LambdaTest real devices | [mobile/](mobile/) |
| CI | GitHub Actions → TestRail (`trcli`) | [.github/workflows/qa.yml](.github/workflows/qa.yml) |

## Quick start

```bash
npm ci
cp .env.example .env          # fill in from the team vault — never commit .env
npm run typecheck
npm run test:unit             # oracle self-tests; runs anywhere, needs no app or credentials
npm run test:api              # needs API_BASE_URL (+ QA hooks for most cases)
npm run test:admin            # needs ADMIN_BASE_URL + ADMIN_* persona credentials
npm run test:mobile:android   # local Appium + emulator + ANDROID_APP_PATH
npm run test:mobile:cloud     # LambdaTest real devices (LT_* vars)
npx wdio run mobile/config/wdio.android.conf.ts --suite rwin   # one module
```

You can filter by tag in both runners. Playwright uses `--grep @crit`. WebdriverIO uses `--mochaOpts.grep @smoke`.

### Mobile on a Windows machine (Android)

1. **One-time setup.** Set the user environment variables `ANDROID_HOME` (`%LOCALAPPDATA%\Android\Sdk`) and `JAVA_HOME` (Android Studio's `jbr`). Add `platform-tools`, `emulator`, `cmdline-tools\latest\bin` and `%JAVA_HOME%\bin` to `PATH`. Then install Appium 3 and its Android driver:
   ```bash
   npm i -g appium && appium driver install uiautomator2
   appium driver doctor uiautomator2    # expect "0 required fixes"
   ```
2. **App build.** Put the dev APK at `apps/rosabon-dev.apk`. The `apps/` folder is git-ignored. The package is `com.optisoft.rosabon`.
3. **`.env`.** Fill in the `CUSTOMER_T1/T2/T3_EMAIL` and `_PASSWORD` values. Sign-in accepts either email + password or phone + passcode/PIN. The phone tests run only when `_PHONE` and `_PIN` are set. Set `ANDROID_AVD` to the emulator's name and `MOBILE_ID_STRATEGY=resource-id`, because React Native maps `testID` to the Android resource-id.
4. **First run.** Sign in with each persona. This needs no backend hooks:
   ```bash
   npx wdio run mobile/config/wdio.android.conf.ts --spec mobile/specs/auth/persona-login.spec.ts
   ```
5. **Customer journeys.** `--suite journeys` runs investing, borrowing, profile and account journeys with the Tier 1 and Tier 3 accounts. They make real changes on the dev system, all small and mostly undone:
   - An RWIN goal is created and then deleted.
   - A job title is edited and then changed back.
   - A test next of kin is saved, once the app allows it.
   - Nothing is paid or sent.

   A Personal loan application is only submitted with `MOBILE_ALLOW_LOAN_APPLY=1`. Without it, the check stops at the review screen. The loan checks run whichever stage the Tier 3 account's loan is at, because a customer can hold one loan at a time.

Screens the app hasn't tagged with contract IDs yet are mapped to the live UI in [mobile/screens/live-ids.ts](mobile/screens/live-ids.ts). On failure, the element tree is saved to `reports/mobile-screens/*.xml`. Screenshots come out black because the app blocks screen capture.

### Testing the API (dev backend)

The backend publishes its API document (OpenAPI/Swagger) at `https://treasury-api-dev.rosabon-finance.com/v3/api-docs`. A saved copy, [api-dev/openapi.snapshot.json](api-dev/openapi.snapshot.json), generates one check per read-only (GET) endpoint. Each check confirms that the endpoint:
1. refuses requests without a sign-in;
2. refuses customers in staff-only areas;
3. doesn't return another customer's records. The Tier 3 test customer asks for the Tier 1 test customer's ID, so only our own test accounts are involved;
4. answers with the right sign-in, within 5 seconds;
5. answers in the format the document promises.

Endpoints that create, change or delete data are listed in the report but never called.

```bash
npm run test:api:dev   # needs API_BASE_URL, CUSTOMER_T3_* (and T1, for the other-customer check), DEV_ADMIN_*
npm run report:summary # results appear on the third tab, "API", with an endpoint reference
npm run api:snapshot   # after reviewing "What changed in the API", save the live document as the new copy
```

IDs in paths come from the list endpoints' own answers. Endpoints for which no ID could be found show as "not run". On the public page, security problems are counted but don't name endpoints; the internal page (`reports/summary`) has the details. Note: page numbers on this API start at 1 (`pageNo=0` is rejected).

## How the suite is organised

```
shared/
  calc/          independent expected-value oracle (RWIN, REAP, RTN, loans, WHT, tiers, rounding)
  api/           API client, investments API, QA test-hook client
  config/env.ts  env + product-config defaults + KYC tier limits
  support/tags.ts  tag convention + register of open clarity questions
unit/            oracle self-tests (worked examples from the specs)
api-tests/       contract tests: catalog/calculate/create, auth, wallet idempotency & limits
api-dev/         live dev API: one read-only check per GET endpoint, from the saved OpenAPI document
admin/
  fixtures/      persona auth (one stored session per role), `asPersona`, `hooks`
  pages/         page objects + shared components (EvidencePanel, ActionModal, Approval Queue, Portfolio)
  specs/<module>/  one folder per Admin PRD module
mobile/
  config/        wdio shared / android / ios / lambdatest
  screens/       screen objects (one file per product)
  specs/<module>/  one folder per app module (WDIO suites mirror these)
docs/            test-hook contract, selector contract, traceability
```

## Conventions

- **Tags in titles:** risk tags `@crit` / `@high` / `@med` / `@low`, plus `@smoke`. Source references look like `@spec:RWIN§9`. A test whose expected value depends on an unanswered clarity question carries `@open:W2`. See [shared/support/tags.ts](shared/support/tags.ts). When TestRail cases are imported, add `@C1234` to the title. The CI uploader matches on name.
- **Money:** expected values always come from the oracle and are compared as `toFixed(2)` strings. Rounding is half-up to the kobo per posting (Clarity X3 default).
- **Isolation:** each test seeds its own customer and data through the QA hooks. Tests never share a mutable account, and live customer data is never used (§28.2).
- **Selectors:** the mobile app uses test IDs shaped like `<module>.<screen>.<element>`. The admin portal uses role + accessible name from the PRD, plus `data-testid` for page regions. The full list is in [docs/SELECTOR-CONTRACT.md](docs/SELECTOR-CONTRACT.md). Regenerate it with `node scripts/extract-selectors.js`.
- **Dual approval:** the proposer and the approver always use different personas (`asPersona`). Self-approval is asserted as blocked.

## Prerequisites outside this repo

1. **QA hooks on the backend.** See [docs/TEST-HOOKS.md](docs/TEST-HOOKS.md). Time travel, seeding and provider stubs are needed for every time-based rule. Until the hooks exist, those tests **skip with a reason**; they do not fail.
2. **Test IDs in the app builds.** See [docs/SELECTOR-CONTRACT.md](docs/SELECTOR-CONTRACT.md).
3. **Persona accounts** for every admin role in `.env.example`, in dev and staging.
4. **Answers to the open calculation questions.** Tests tagged `@open:*` assert the *suggested default* from the Clarity Questions document. Update the oracle and flip `confirmed` in `openQuestions` once Product and Finance decide.

## Traceability

[docs/TRACEABILITY.md](docs/TRACEABILITY.md) maps each source document section to its spec files, risk level and test count.

## Publishing the results page (Netlify or Vercel)

`npm run report:summary` builds two copies of the plain-English results page (Admin portal | Mobile app tabs):

- `reports/summary/index.html` is the internal copy, with screenshots and a link to the technical report. It's git-ignored.
- `site/index.html` is the public copy, with no screenshots, names or emails. It **is committed**.

Netlify (`netlify.toml`) and Vercel (`vercel.json`) both publish `site/` straight from the repo with no build step. In either host, import the GitHub repo and keep the defaults; the config files set everything. CI refreshes and commits `site/index.html` after each main or nightly run, and the host redeploys on that commit. To publish a local run, run `npm run report:summary`, then commit `site/index.html` and push.
