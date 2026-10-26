import { test, expect } from '../../fixtures/fixtures';
import { AppShellPage } from '../../pages/AppShellPage';
import { LoginPage } from '../../pages/LoginPage';
import { Module } from '../../pages/components';
import { Persona, credsFor } from '../../fixtures/personas';
import { anonymousPage, closeRoleSessions } from '../../fixtures/platform-personas';
import { Tag, title } from '../../../shared/support/tags';

/**
 * Admin PRD › Cross-cutting navigation & access.
 *   Home: deferred and removed from the codebase (no nav item, no route).
 *   Support & Tickets: "SOON" in sidebar. Rewards & Referrals: in redesign.
 *   Each persona sees only permitted modules (from the PRD "Roles" columns).
 */
const visibility: Array<{ persona: Persona; visible: Module[]; hidden: Module[] }> = [
  { persona: 'marketing', visible: ['communications'], hidden: ['wallet-management', 'team-management', 'audit-log'] },
  { persona: 'treasuryOfficer', visible: ['wallet-management', 'transactions-ledger'], hidden: ['communications', 'team-management'] },
  { persona: 'headOfOps', visible: ['wallet-management', 'team-management', 'audit-log', 'settings'], hidden: [] },
  { persona: 'supportAgent', visible: [], hidden: ['team-management', 'settings', 'wallet-management', 'audit-log'] },
];

const protectedUrls = ['/', '/audit-log', '/customer/any-id', '/investments/any-id'];

test.describe('Cross-cutting › Navigation & access', () => {
  test.afterEach(closeRoleSessions);

  test(title('Home is deferred: no Home nav item and no Home route', Tag.low, Tag.smoke, Tag.spec('AdminPRD:Home')), async ({ asPersona }) => {
    const page = await asPersona('superAdmin');
    const shell = new AppShellPage(page);
    await shell.gotoRoot();
    await expect(shell.homeNav()).toHaveCount(0);
    await page.goto('/home');
    await expect(page).not.toHaveURL(/\/home$/);
  });

  test(title('Support & Tickets shows "SOON" in the sidebar', Tag.low, Tag.spec('AdminPRD:SupportTickets')), async ({ asPersona }) => {
    const page = await asPersona('superAdmin');
    const shell = new AppShellPage(page);
    await shell.gotoRoot();
    await shell.sidebar.expectSoonBadge('support-tickets');
  });

  test(title('Rewards & Referrals is in redesign state', Tag.low, Tag.spec('AdminPRD:RewardsReferrals')), async ({ asPersona }) => {
    const page = await asPersona('superAdmin');
    const shell = new AppShellPage(page);
    await shell.gotoRoot();
    await shell.sidebar.open('rewards-referrals');
    await expect(shell.placeholder()).toBeVisible();
    await expect(page.getByRole('button', { name: /configure|save/i })).toHaveCount(0);
  });

  for (const { persona, visible, hidden } of visibility) {
    test(title(`${persona} sees only permitted modules`, Tag.crit, Tag.spec('AdminPRD:RBAC')), async ({ asPersona }) => {
      const page = await asPersona(persona);
      const shell = new AppShellPage(page);
      await shell.gotoRoot();
      for (const m of visible) await expect(shell.navItem(m), `${persona} should see ${m}`).toBeVisible();
      for (const m of hidden) await expect(shell.navItem(m), `${persona} must not see ${m}`).toHaveCount(0);
    });
  }

  for (const url of protectedUrls) {
    test(title(`Unauthenticated direct URL ${url} redirects to /login`, Tag.crit, Tag.spec('AdminPRD:Auth')), async ({ browser }) => {
      const page = await anonymousPage(browser);
      await page.goto(url);
      await expect(page).toHaveURL(/\/login/);
      await expect(page.getByTestId('sidebar')).toHaveCount(0);
    });
  }

  test(title('Logout ends the session; protected pages redirect to /login afterwards', Tag.crit, Tag.spec('AdminPRD:Auth')), async ({ browser }) => {
    const creds = credsFor('readOnly');
    test.skip(!creds, 'No credentials configured for readOnly');
    const page = await anonymousPage(browser); // fresh session so stored persona sessions are not revoked
    const login = new LoginPage(page);
    await login.goto();
    await login.login(creds!.email, creds!.password);
    await login.expectLoggedIn();
    const shell = new AppShellPage(page);
    await shell.logout();
    await expect(page).toHaveURL(/\/login/);
    await page.goto('/audit-log');
    await expect(page).toHaveURL(/\/login/);
  });
});
