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
| Mobile app E2E (Android + iOS) | WebdriverIO 9 + Appium 2 + Mocha; TestMu AI / LambdaTest real devices | [mobile/](mobile/) |
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

## How the suite is organised

```
shared/
  calc/          independent expected-value oracle (RWIN, REAP, RTN, loans, WHT, tiers, rounding)
  api/           API client, investments API, QA test-hook client
  config/env.ts  env + product-config defaults + KYC tier limits
  support/tags.ts  tag convention + register of open clarity questions
unit/            oracle self-tests (worked examples from the specs)
api-tests/       contract tests: catalog/calculate/create, auth, wallet idempotency & limits
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
