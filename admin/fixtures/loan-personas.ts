import { Browser, BrowserContext, Page, test } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import type { ApprovalBand, ReferralTier } from '../../shared/calc/loans';

/**
 * Loan-approval roles from the Admin PRD "Roles" column that have no entry in personas.ts
 * (personas.ts is intentionally left untouched). These roles log in on demand through
 * LoginPage instead of using a stored session from auth.setup.ts.
 *
 * New env vars (add to .env; a test needing a role whose creds are missing is skipped):
 *   ADMIN_TEAM_LEAD_EMAIL            / ADMIN_TEAM_LEAD_PASSWORD            — approval band 1 (Personal / Public Sector)
 *   ADMIN_CRM_EMAIL                  / ADMIN_CRM_PASSWORD                  — approval band 2; Payday MEDIUM referral tier
 *   ADMIN_GM_EMAIL                   / ADMIN_GM_PASSWORD                   — approval band 3
 *   ADMIN_EXECUTIVE_EMAIL            / ADMIN_EXECUTIVE_PASSWORD            — above band 3 (Personal)
 *   ADMIN_CREDIT_MANAGER_EMAIL       / ADMIN_CREDIT_MANAGER_PASSWORD       — Payday HIGH referral tier (first approver)
 *   ADMIN_MD_EMAIL                   / ADMIN_MD_PASSWORD                   — Payday HIGH referral tier (second approver)
 *   ADMIN_UNDERWRITER_EMAIL          / ADMIN_UNDERWRITER_PASSWORD          — document requests / control-gate & consent review
 *   ADMIN_HEAD_OF_COLLECTIONS_EMAIL  / ADMIN_HEAD_OF_COLLECTIONS_PASSWORD  — collections, restructures, missing repayments
 *
 * Usage (always pair with closeRoleContexts in afterEach):
 *   test.afterEach(closeRoleContexts);
 *   test('...', async ({ browser }) => { const gm = await asRole(browser, 'gm'); });
 */
export const loanRoles = {
  teamLead: 'TEAM_LEAD',
  crm: 'CRM',
  gm: 'GM',
  executive: 'EXECUTIVE',
  creditManager: 'CREDIT_MANAGER',
  md: 'MD',
  underwriter: 'UNDERWRITER',
  headOfCollections: 'HEAD_OF_COLLECTIONS',
} as const;

export type LoanRole = keyof typeof loanRoles;

export function loanRoleCreds(role: LoanRole): { email: string; password: string } | undefined {
  const key = loanRoles[role];
  const email = process.env[`ADMIN_${key}_EMAIL`];
  const password = process.env[`ADMIN_${key}_PASSWORD`];
  return email && password ? { email, password } : undefined;
}

/** Amount band (oracle approvalBand) → the role holding that authority. */
export function roleForBand(band: ApprovalBand): LoanRole {
  return ({ TEAM_LEAD: 'teamLead', CRM: 'crm', GM: 'gm', EXECUTIVE: 'executive' } as const)[band];
}

/** The role one band below the given band (an under-authority approver), or undefined for band 1. */
export function roleBelowBand(band: ApprovalBand): LoanRole | undefined {
  return ({ TEAM_LEAD: undefined, CRM: 'teamLead', GM: 'crm', EXECUTIVE: 'gm' } as const)[band];
}

/** Payday referral tier (oracle referralTier) → approver chain. LOW auto-approves (no human approver). */
export function rolesForReferralTier(tier: ReferralTier): LoanRole[] {
  return ({ LOW: [], MEDIUM: ['crm'], HIGH: ['creditManager', 'md'] } as const)[tier].slice();
}

const openContexts: BrowserContext[] = [];

/**
 * A Page logged in as `role` in its own browser context (so proposer ≠ approver flows work).
 * Skips the current test when the role's credentials are not configured.
 */
export async function asRole(browser: Browser, role: LoanRole): Promise<Page> {
  const creds = loanRoleCreds(role);
  if (!creds) test.info().skip(true, `Loan role ${role} has no credentials (ADMIN_${loanRoles[role]}_EMAIL / _PASSWORD)`);
  const ctx = await browser.newContext();
  openContexts.push(ctx);
  const page = await ctx.newPage();
  const login = new LoginPage(page);
  await login.goto();
  await login.login(creds!.email, creds!.password);
  await login.expectLoggedIn();
  return page;
}

/** Closes every context opened by asRole. Register with test.afterEach. */
export async function closeRoleContexts(): Promise<void> {
  while (openContexts.length) await openContexts.pop()!.close();
}
