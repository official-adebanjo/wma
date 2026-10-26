# Traceability: source documents → automated tests

**Audience:** the QA lead, product owners and auditors.

Counts are tests at runtime, with parameterised cases expanded. Risk levels follow QA Strategy §7. For TestRail, add `@C<id>` to test titles once the cases are imported; CI uploads JUnit using name matching.

## Totals

| Layer | Spec files | Tests | Runs today without app or backend? |
|---|---|---|---|
| Calculation oracle (unit) | 3 | 38 | **Yes**: all 38 pass |
| API contract | 2 | 19 | Needs `API_BASE_URL` and QA hooks |
| Admin Portal E2E | 32 | 365 | Needs portal, persona credentials and QA hooks |
| Mobile app E2E | 22 | ≈422 | Needs app build with test IDs, Appium or LambdaTest, and QA hooks |
| **Total** | **59** | **≈844** | |

There are 351 `@crit` tags, 187 `@high`, 112 `@med` and 27 `@low`. 71 tests are tagged `@smoke`.

## Mobile app (unified app)

| Source | Module | Spec files | Tests | Risk |
|---|---|---|---|---|
| KYC Spec V4 §2 Tier 1; QA Strategy §17 | Onboarding and login | `mobile/specs/auth/onboarding-login.spec.ts` | 12 | CRIT |
| KYC Spec V4 §1–§4; Admin PRD Review Queues | KYC tier upgrades | `mobile/specs/kyc/kyc-tier-upgrade.spec.ts` | 13 | CRIT |
| QA Strategy §20; KYC Spec V4 §1 limits | Wallet | `mobile/specs/wallet/wallet.spec.ts` | 10 | CRIT |
| QA Strategy §19, §20.3 | Resilience | `mobile/specs/resilience/network-and-lifecycle.spec.ts` | 4 | HIGH |
| REAP / RWIN / RTN specs §2 | Grow home | `mobile/specs/grow/grow-home.spec.ts` | 16 | MED |
| RWIN 2.0 Spec; Calculator Spec §3.2; Clarity W1–W10 | RWIN 2.0 | `rwin/rwin-booking`, `rwin/rwin-plan-lifecycle` | 38 | CRIT |
| REAP Spec; Calculator Spec §3.1; Clarity E1–E14 | REAP | `reap/reap-booking`, `reap/reap-plan-lifecycle`, `reap/reap-break-request` | 74 | CRIT |
| RTN Spec; Calculator Spec §3.3; Clarity T1–T17 | RTN | `rtn/rtn-booking`, `rtn/rtn-bank-transfer`, `rtn/rtn-placement-lifecycle` | 72 | CRIT |
| Loan specs §2 | Borrow home | `borrow/borrow-home` | 13 | MED |
| Nano Spec | Nano | `nano/nano-application`, `nano/nano-repayment` | 37 | CRIT |
| Payday Spec | Payday | `payday/payday-application`, `payday/payday-repayment` | 41 | CRIT |
| Personal Loan Spec | Personal Loan | `personal-loan/personal-application`, `personal-loan/personal-servicing` | 49 | CRIT |
| Public Sector Loan Spec | Public Sector Loan | `public-sector-loan/public-sector-application`, `public-sector-loan/public-sector-servicing` | 43 | CRIT |

## Admin portal (Admin PRD, Section 2: action inventory)

| PRD module | Spec files | Tests |
|---|---|---|
| Customer Management: Directory, Review Queues, Auto Grants, Screening, Account Controls, Customer 360 | `customer-management/*` (5 files) | 47 |
| Investment Management: Portfolio, REAP, RWIN 2.0, RTN, cross-product | `investment-management/*` (5 files) | 47 |
| Loan Management: Portfolio, Nano, Payday, Personal, Public Sector, cross-product | `loan-management/*` (6 files) | 77 |
| Payroll Reconciliation | `payroll-reconciliation/*` | 17 |
| Wallet Management: Live board, Settlement, Manual ledger, Providers | `wallet-management/*` | 16 |
| Transactions & Ledger: Monitor, Reversals, Cashback, Billers | `transactions-ledger/*` | 12 |
| Communications: Campaigns, Discovery Banners | `communications/*` (2 files) | 33 |
| Product Management: Investment and Loan products | `product-management/*` (2 files) | 27 |
| Tiering & KYC configuration | `tiering-kyc/*` | 8 |
| Reports & Analytics: Dashboards, Regulatory | `reports-analytics/*` (2 files) | 18 |
| Team Management: Admin Directory, Roles | `team-management/*` | 13 |
| Pending Approvals (Approval Queue) | `approval-queue/*` | 8 |
| Audit Log | `audit-log/*` | 12 |
| Settings: Change Rules, Reason Codes, Thresholds, Comms Providers, Metric Definitions | `settings/*` | 7 |
| Cross-cutting: EvidencePanel, navigation and RBAC, Support (SOON), Rewards (redesign) | `cross-cutting/*` (2 files) | 23 |

Home is out of scope: the PRD marks it as deferred and removed from the codebase.

## Open questions encoded in tests

Tests tagged `@open:<id>` assert the suggested default for a question nobody has answered yet. The register is `openQuestions` in [shared/support/tags.ts](../shared/support/tags.ts). Run `--grep @open:T4` to find every test affected by one decision.

| Source | IDs |
|---|---|
| Clarity Questions document | X1, X4–X7; W2, W4–W10; E1–E7, E9, E11–E13; T1–T8, T10–T14 |
| Raised while building the suite | CALC-TIER (tier gating conflict across three docs); TIER1-LIMITS (Tier 1 single limit exceeds its daily limit); TM1 ([M]/[C] approve markers undefined); RTN-INV1–3 (rate-matrix invariants unlisted); L-* (five loan money rules not stated in the specs) |
