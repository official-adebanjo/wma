# Dev system status

Last check: **23 Nov, 16:49** (Lagos time) · 77 checked · 🟢 all up · 42 not checked (no monitor customer account set)

Checks run every 15 minutes, Monday to Friday, 6am–7pm. Something counts as down after 2 failed checks in a row. The browser check opens the main admin pages after each new portal version and otherwise about once an hour; a page counts as broken when it fails twice in the same check.

Admin portal version: `index-DyIx7SeL.css index-KhDdGGiK.js`, first seen 23 Nov, 16:49 · last browser check: 23 Nov, 16:49

## Failed the last check (not yet counted as down)

| Area | What | Answer | |
|---|---|---|---|
| Investment Management Endpoints | The approval queue (GET /api/v3/investment-management/approval-queue) | no answer within 15 s |  |
| Investment Management Endpoints | List investment requests (GET /api/v3/investment-management/investment-requests) | no answer within 15 s |  |
| Investment Management Endpoints | List investments (GET /api/v3/investment-management/investments) | no answer within 15 s |  |
| Investment Management Endpoints | List system alerts (GET /api/v3/investment-management/system-alerts) | no answer within 15 s |  |
| Investment Product Catalogue Endpoints | Get catalogue metrics (GET /api/v3/investment-products/metrics) | no answer within 15 s |  |
| Investment Report Endpoints | Get total active investment amount (GET /api/v3/investment-reports/active-investment-amount) | no answer within 15 s |  |
| Investment Report Endpoints | Get total investments (GET /api/v3/investment-reports/investments) | no answer within 15 s |  |
| Investment Report Endpoints | Get total matured investment amount (GET /api/v3/investment-reports/matured-investment-amount) | no answer within 15 s |  |
| Investment Report Endpoints | Get total matured investments (GET /api/v3/investment-reports/matured-investments) | no answer within 15 s |  |
| Loan Repayment Endpoints | Get loan collections (GET /api/v3/loan-repayments/collections) | no answer within 15 s |  |
| Loan Report Endpoints | Get total due loans between (GET /api/v3/loan-reports/due-loans-between) | no answer within 15 s |  |
| Referral History Endpoints | Get referral histories on admin (GET /api/v3/referral-histories/admin) | no answer within 15 s |  |
| Account Control Endpoints | A customer's freezes (GET /api/v3/account-controls/customers/{id}) | no answer within 15 s |  |
| Account Control Endpoints | Can this account close? (GET /api/v3/account-controls/customers/{id}/closure-check) | no answer within 15 s |  |
| System-Wide Audit Log Endpoints | Retrieve audit logs for Customer 360 (GET /api/v3/audit-logs/customer/{customerId}) | no answer within 15 s |  |
| Document Library Endpoints | Get user documents (GET /api/v3/document-libraries/{userId}) | no answer within 15 s |  |
| General Approval Workflow Endpoints | Get general pending actions created by me (GET /api/v3/general-approval-workflows/{userId}/pending-action/created-by) | no answer within 15 s |  |
| Investment Management Endpoints | Get investment request (GET /api/v3/investment-management/investment-requests/{id}) | no answer within 15 s |  |
| Investment Management Endpoints | Get investment details (GET /api/v3/investment-management/investments/{id}) | no answer within 15 s |  |
| Investment Management Endpoints | Get allowed transitions (GET /api/v3/investment-management/investments/{id}/transitions) | no answer within 15 s |  |
| Investment Management Endpoints | Get system alert (GET /api/v3/investment-management/system-alerts/{id}) | no answer within 15 s |  |
| Investment Product Catalogue Endpoints | Preview retiring a product (GET /api/v3/investment-products/{slug}/retirement-impact) | no answer within 15 s |  |
| Investment Product Catalogue Endpoints | Get withdrawal rules (GET /api/v3/investment-products/{slug}/withdrawal-rules) | no answer within 15 s |  |
| Product Management Endpoints | Get resolved operating terms (GET /api/v3/products/{productKey}/terms) | no answer within 15 s |  |
| Wallet History Endpoints | Get user wallet histories (GET /api/v3/wallet-histories/{userId}) | no answer within 15 s |  |
| System-Wide Audit Log Endpoints | Retrieve audit logs for a specific entity target (GET /api/v3/audit-logs/target/{targetType}/{targetId}) | no answer within 15 s |  |

## Slow (over 5 s)

- Export audit log CSV (GET /api/v3/audit-logs/export): 9.6 s
- Retrieve audit log metrics strip (GET /api/v3/audit-logs/metrics): 6.0 s
- Query the audit trail (GET /api/v3/investment-management/audit-trail): 6.8 s
- Get total accrued interest amount (GET /api/v3/investment-reports/accrued-interest-amount): 9.5 s
- Get total active investments (GET /api/v3/investment-reports/active-investments): 13.1 s
- Get total liquidated investments (GET /api/v3/investment-reports/liquidated-investments): 13.4 s
- Get total pending funding investment amount (GET /api/v3/investment-reports/pending-funding-investment-amount): 13.1 s
- Get total pending funding investments (GET /api/v3/investment-reports/pending-funding-investments): 12.9 s
- Get total pending funding investment amount (GET /api/v3/investment-reports/pending-investment-amount): 9.4 s
- Get total pending funding investments (GET /api/v3/investment-reports/pending-investments): 14.2 s
- Get total rolled over investments (GET /api/v3/investment-reports/rolled-over-investments): 11.5 s
- Get total investments under review (GET /api/v3/investment-reports/under-review-investments): 9.8 s
- Get tax rates (GET /api/v3/investment-tax-configs): 13.0 s
- Get withholding tax remittance (GET /api/v3/investment-tax-configs/remittance): 6.6 s
- Get loan fees (GET /api/v3/loan-approval-workflows): 12.0 s
- Get total active loans (GET /api/v3/loan-reports/active-loans): 7.5 s
- Get total default loan amount (GET /api/v3/loan-reports/default-loan-amount): 6.5 s
- Get total default loans (GET /api/v3/loan-reports/default-loans): 11.3 s
- Get total loans (GET /api/v3/loan-reports/loans): 13.3 s
- Get total overdue loan amount (GET /api/v3/loan-reports/overdue-loan-amount): 6.7 s
- Get total overdue loans (GET /api/v3/loan-reports/overdue-loans): 7.1 s
- Get total pending customer decision loans (GET /api/v3/loan-reports/pending-customer-decision-loans): 10.1 s
- Get total pending loan amount (GET /api/v3/loan-reports/pending-loan-amount): 10.0 s
- Get total pending loans (GET /api/v3/loan-reports/pending-loans): 10.8 s
- Get total ready to disburse loans (GET /api/v3/loan-reports/ready-to-disburse-loans): 8.8 s
- Get general pending actions (GET /api/v3/general-approval-workflows/{userId}/pending-action): 7.0 s
- Get lifecycle table (GET /api/v3/investment-products/{slug}/state-machine): 11.5 s
- Get tax rate (GET /api/v3/investment-tax-configs/{id}): 12.6 s
- Get configuration change history (GET /api/v3/products/{productKey}/config/history): 12.0 s
- Get user documents for loan product (GET /api/v3/document-libraries/{userId}/loan-product/{loanProductId}): 14.5 s

## Recent changes

| When | What | Change |
|---|---|---|
| 23 Nov, 16:49 | Admin portal | 🔵 new version deployed (index-DyIx7SeL.css index-KhDdGGiK.js) |
| 20 Nov, 22:44 | Admin portal | 🔵 new version deployed (index--u03vIMd.css index-Clj8a3xd.js) |
| 20 Nov, 14:55 | Admin portal | 🔵 new version deployed (index-CHp9cCpx.css index-FljamXDP.js) |
| 18 Nov, 14:45 | Admin portal | 🔵 new version deployed (index-CYnmrrSE.css index-D6NROtJ5.js) |
| 17 Nov, 15:14 | Admin portal | 🔵 new version deployed (index-CLrYGvS7.js index-XcE4N3So.css) |
| 17 Nov, 00:00 | Admin portal sign-in (in the browser) | 🟢 back up after 572 min |
| 17 Nov, 00:00 | Admin portal | 🔵 new version deployed (index-CBmwQ25T.js index-PGXXf3wZ.css) |
| 16 Nov, 14:28 | Admin portal sign-in (in the browser) | 🔴 down: the sign-in page didn’t move on within 30 s |
| 9 Nov, 14:44 | Admin portal | 🔵 new version deployed (index-9chHSX_N.js index-DjyodVZp.css) |
| 6 Nov, 13:49 | Admin portal | 🔵 new version deployed (index-DjyodVZp.css index-u3PfbocH.js) |
| 5 Nov, 14:00 | Admin portal | 🔵 new version deployed (index-BereZNZH.js index-DjyodVZp.css) |
