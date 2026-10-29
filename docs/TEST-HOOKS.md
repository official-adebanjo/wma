# QA test hooks — backend contract

**Audience:** backend engineers. **Status:** requested; not yet built.

Most rules in the product specs depend on time or on outside parties. Examples: the RWIN day-30 hold, 90-day cycles, REAP maturity, the RTN 24-hour underfunded window, loan due dates, bureau timeouts and Remita mandate failures. Without these hooks, those tests skip (they do not fail), and you will see "QA hooks not configured" in the report.

## Safety requirements

- Expose the hooks **only** in `dev` and `staging` builds. Gate them by build flag, and return `404` in production.
- Every call must carry an `X-QA-Token` header. The token comes from CI secrets.
- Every hook writes an audit entry with `record_source = qa_hook`.
- Use synthetic data only (QA Strategy §28.2).

## Endpoints

All endpoints use `POST`, take JSON and return JSON. They sit under `QA_HOOKS_BASE_URL`. The client lives in [shared/api/qa-hooks.ts](../shared/api/qa-hooks.ts).

| Path | Body | Returns | Used for |
|---|---|---|---|
| `/seed/customer` | `{ tier, walletBalance?, accountType?, salaryDetected?, monthlySalary?, employer? }` | `{ customerId, email, password, phone, pin, accessToken }` (both sign-in methods usable) | A fresh, isolated customer for every test |
| `/seed/wallet-balance` | `{ customerId, balance }` | — | Funding and insufficient-balance cases |
| `/seed/investment` | `{ customerId, product, state, principal, ratePct?, fundedDaysAgo?, extra? }` | `{ investmentId, reference }` | Back-dated plans and placements (day 29 / day 30, T-7, maturity) |
| `/seed/loan` | `{ customerId, product, state, amount, extra? }` | `{ loanId, reference }` | Loans in any lifecycle state |
| `/seed/product-config` | `{ product, patch }` | — | Pin the rates, matrix, thresholds and bands so the oracle and the app agree |
| `/seed/account-restriction` | `{ customerId, restriction }` | — | Frozen or withdrawal-only accounts |
| `/seed/kyc-review` | `{ customerId, outcome, toTier?, reason?, document? }` | — | Admin KYC decisions, as seen from the app |
| `/clock/advance` | `{ customerId?, days, runBatch? }` | `{ businessDate }` | Moves the business date, then runs the daily batch (accrual, maturity, rollover, autosave, auto-debit, expiry) |
| `/clock/reset` | `{}` | — | Cleanup |
| `/simulate/inbound-transfer` | `{ reference, amount, customerId?, late? }` | `{ transferId }` | RTN bank-transfer funding, wallet funding, payroll credits |
| `/stub/provider` | `{ provider, outcome, customerId? }` | — | Forced outcomes from third parties. Providers: `BUREAU`, `REMITA`, `NIBSS`, `NIMC`, `MONO`, `DOC_VERIFY`, `IPPIS`, `OTP`. Outcomes include `MATCH`, `TIMEOUT`, `NOT_FOUND`, `NAME_DOB_MISMATCH`, `UPLOAD_FAIL_ONCE`, `TRANSFER_FAILED_AFTER_DEBIT`, `MANDATE_FAIL` and `LINK_SUCCESS` |
| `/inspect/notifications` | `{ customerId, limit }` | `[{ channel, title, body, createdAt }]` | Checks notification wording without reading the device's notification shade |
| `/inspect/audit` | `{ targetId?, action?, limit? }` | `[{ actor, action, targetId, amount, evidence, approvers, prominent, createdAt }]` | Checks evidence, approvers and the prominent-audit flag |

### Additional endpoints used by module specs

The admin customer-management specs call these through `CustomerHooks` in [admin/pages/CustomerManagementPage.ts](../admin/pages/CustomerManagementPage.ts). The mobile REAP and RTN specs call them through `QaAdminHooks` in [mobile/helpers/investment-fixtures.ts](../mobile/helpers/investment-fixtures.ts). They follow the same auth and safety rules as the endpoints above.

| Path | Purpose |
|---|---|
| `/seed/kyc-submission` | Puts a customer into the KYC review queue with chosen documents |
| `/seed/auto-grant` | Creates an automatic tier-grant event for the Auto Grants feed |
| `/seed/screening-hit` | Creates a sanctions or PEP hit with a confidence score |
| `/seed/restriction` | Creates an account restriction for the Account Controls tab |
| `/seed/support-ticket` | Creates ticket history for the Customer 360 Support tab |
| `/seed/corporate-docs` | `{ customerId, status }`: corporate documents verified or pending (RTN corporate) |
| `/seed/linked-bank-account` | `{ customerId, bankName, accountNumber }`: payout destination for RTN or loans |
| `/admin/reap/break-request/decide` | `{ investmentId, decision, reason? }`: admin decision on a break request, as seen from the app |
| `/inspect/customer` | Customer state, including `loginBlocked` and tier |
| `/inspect/tier-changes` | Tier-change records, including their source |
| `/inspect/screening-hit` | Hit state after clear, escalate or freeze |

### Seed vocabulary the specs rely on

Confirm or rename these with the backend team. Every spec's header comment lists the values it uses.

- **`seedInvestment` states:** `ACTIVE`, `TOPUP`, `LOCKED`, `MATURED`, `UNDERFUNDED`, `CLOSED`, `WITHDRAWAL_REQUESTED`, `BREAK_REQUESTED`.
- **`seedLoan` states:** `APPLICATION`, `UNDERWRITING`, `READY_TO_DISBURSE`, `LIVE_SERVICING`, `COLLECTIONS`, `WRITTEN_OFF`, `AUTO_DECLINED`, `AUTO_APPROVED`, `BUREAU_TIMEOUT`, `DTI_EDGE`, `MANDATE_FAILED`.
- **`setProductConfig` products:** `RWIN`, `REAP`, `RTN`, `NANO`, `PAYDAY`, `PERSONAL`, `PUBLIC_SECTOR`, `LOANS` (holds `crossLoanBlockEnabled` and `dualThreshold`), `PAYROLL_RECONCILIATION` and `GROW` (the discovery banner).
- **`setProductConfig` keys:** `ratePct`, `ratesByTenorMonths`, `rateMatrix`, `penaltyLadder`, `liquidationAutoReleaseThreshold`, `allowsTopUp` / `topUpEnabled`, `maxPlansPerCustomer`, `referral.mediumFrom` / `referral.highFrom`, `approvalBands`, `corridors`, `qaEligibilityOverride`.
- **`stubProvider` outcomes:** see each spec's header comment. Examples are `MANDATE_FAILED`, `INSUFFICIENT_FUNDS`, `UNREADABLE`, `NOT_SIGNED`, `BATCH_LATE`, `EMPLOYEE_NOT_FOUND`, `MULTIPLE_SALARY_CREDITS`, `GOOD_SCORE`, `POOR_SCORE`, `DEBIT_OK` and `DEBIT_FAILED`.

## Clock semantics

- Business dates use WAT and roll over at midnight (Clarity X7 default).
- `/clock/advance` is scoped to one customer when `customerId` is given. That lets tests run in parallel.
- `runBatch: true` runs every end-of-day job in production order. With `days: 0` it runs today's batch without moving the date.
