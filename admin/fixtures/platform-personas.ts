import { Browser, BrowserContext, Page, test } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';

/**
 * Platform personas — Admin PRD "Roles" that are NOT in personas.ts (that file is owned by the
 * stored-session setup in auth.setup.ts and must not be edited). These roles log in on demand
 * via LoginPage; the session is cached per worker so each role logs in at most once per worker.
 *
 * Environment variables (all optional — a test needing a role whose creds are missing is skipped):
 *
 *   ADMIN_CTO_EMAIL                  / ADMIN_CTO_PASSWORD                    CTO (billers, KYC providers, comms providers)
 *   ADMIN_CMO_EMAIL                  / ADMIN_CMO_PASSWORD                    CMO (campaign template approval)
 *   ADMIN_HEAD_OF_SUPPORT_EMAIL      / ADMIN_HEAD_OF_SUPPORT_PASSWORD        Head of Support
 *   ADMIN_MARKETING_OPS_EMAIL        / ADMIN_MARKETING_OPS_PASSWORD          Marketing Ops (end banner early approval)
 *   ADMIN_RATE_COMMITTEE_EMAIL       / ADMIN_RATE_COMMITTEE_PASSWORD         Rate Committee (RTN matrix, Personal/Public Sector tables)
 *   ADMIN_CREDIT_COMMITTEE_EMAIL     / ADMIN_CREDIT_COMMITTEE_PASSWORD       Credit Committee (Payday DSR)
 *   ADMIN_BOARD_EMAIL                / ADMIN_BOARD_PASSWORD                  Board (retire product approval)
 *   ADMIN_AUDITOR_EMAIL              / ADMIN_AUDITOR_PASSWORD                Auditor (audit log, change history — read-only)
 *   ADMIN_COMPLIANCE_OFFICER_EMAIL   / ADMIN_COMPLIANCE_OFFICER_PASSWORD     Compliance officer (regulatory sign-off / submission)
 *   ADMIN_COMPLIANCE_PREPARER_EMAIL  / ADMIN_COMPLIANCE_PREPARER_PASSWORD    Compliance preparer (regulatory drafts)
 *   ADMIN_FINANCE_EMAIL              / ADMIN_FINANCE_PASSWORD                Finance (settlement view, metric definitions)
 *   ADMIN_SUSPEND_TARGET_EMAIL       / ADMIN_SUSPEND_TARGET_PASSWORD         Sacrificial admin account used by the "Suspend admin"
 *                                                                            test (gets suspended — reset it after the run)
 *
 * Usage:
 *   test.afterEach(closeRoleSessions);
 *   test('...', async ({ browser }) => { const cto = await asRole(browser, 'cto'); });
 */
export const platformRoles = {
  cto: 'CTO',
  cmo: 'CMO',
  headOfSupport: 'HEAD_OF_SUPPORT',
  marketingOps: 'MARKETING_OPS',
  rateCommittee: 'RATE_COMMITTEE',
  creditCommittee: 'CREDIT_COMMITTEE',
  board: 'BOARD',
  auditor: 'AUDITOR',
  complianceOfficer: 'COMPLIANCE_OFFICER',
  compliancePreparer: 'COMPLIANCE_PREPARER',
  finance: 'FINANCE',
  suspendTarget: 'SUSPEND_TARGET',
} as const;

export type PlatformRole = keyof typeof platformRoles;

export function credsForRole(role: PlatformRole): { email: string; password: string } | undefined {
  const key = platformRoles[role];
  const email = process.env[`ADMIN_${key}_EMAIL`];
  const password = process.env[`ADMIN_${key}_PASSWORD`];
  return email && password ? { email, password } : undefined;
}

/** Returns creds or skips the current test with a clear reason. */
export function requireRoleCreds(role: PlatformRole): { email: string; password: string } {
  const creds = credsForRole(role);
  if (!creds) test.info().skip(true, `Role ${role} has no credentials (set ADMIN_${platformRoles[role]}_EMAIL / _PASSWORD)`);
  return creds!;
}

type StorageState = Awaited<ReturnType<BrowserContext['storageState']>>;
const sessions = new Map<PlatformRole, StorageState>();
const opened: BrowserContext[] = [];

/** A Page logged in as the given platform role, in its own browser context. */
export async function asRole(browser: Browser, role: PlatformRole): Promise<Page> {
  const creds = requireRoleCreds(role);
  const cached = role === 'suspendTarget' ? undefined : sessions.get(role);
  const ctx = await browser.newContext(cached ? { storageState: cached } : {});
  opened.push(ctx);
  const page = await ctx.newPage();
  if (!cached) {
    const login = new LoginPage(page);
    await login.goto();
    await login.login(creds.email, creds.password);
    await login.expectLoggedIn();
    if (role !== 'suspendTarget') sessions.set(role, await ctx.storageState());
  }
  return page;
}

/** A fresh, unauthenticated Page (for login-blocked / redirect checks). */
export async function anonymousPage(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  opened.push(ctx);
  return ctx.newPage();
}

/** Close every context opened by asRole / anonymousPage. Register with `test.afterEach(closeRoleSessions)`. */
export async function closeRoleSessions(): Promise<void> {
  while (opened.length) await opened.pop()!.close().catch(() => undefined);
}
