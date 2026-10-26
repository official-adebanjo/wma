import { Page } from '@playwright/test';
import { test, expect } from '../../fixtures/fixtures';
import { TeamManagementPage } from '../../pages/TeamManagementPage';
import { ApprovalQueuePage } from '../../pages/ApprovalQueuePage';
import { LoginPage } from '../../pages/LoginPage';
import { anonymousPage, closeRoleSessions, requireRoleCreds } from '../../fixtures/platform-personas';
import { uid } from '../../../shared/data/factories';
import { Tag, title } from '../../../shared/support/tags';

/**
 * Admin PRD › Team Management (Admin Directory, Roles List, Role Builder).
 * All writes: Head of Ops proposes → Compliance approves. Role changes are Dual + Compliance with prominent audit.
 * Seed-role constraint: no role may hold both [M] and [C] approve on the same module.
 *
 * @open:TM1 — PRD does not define the [M]/[C] markers; the Role Builder is assumed to expose them as
 *             separate checkboxes labelled "<Module> approve [M]" / "<Module> approve [C]".
 */
const MODULE = 'Investment Management';
const BASE_ROLE = 'Support agent';

async function approveWithCompliance(compliance: Page, matching: RegExp, note = 'Compliance approved') {
  const q = new ApprovalQueuePage(compliance);
  await q.goto();
  await q.open(matching);
  await q.expectComplianceStepRequired();
  await q.approve(note);
  return q;
}

async function createApprovedAdmin(ops: Page, compliance: Page) {
  const email = `${uid('qa-admin')}@example.test`;
  const tm = new TeamManagementPage(ops);
  await tm.goto('Admin Directory');
  const m = await tm.createAdmin({ name: 'QA Admin', email, role: BASE_ROLE });
  await m.submit();
  await m.expectRoutedToApproval();
  const q = new ApprovalQueuePage(compliance);
  await q.goto();
  await q.open(new RegExp(email));
  await q.approve('Admin creation approved');
  return email;
}

async function createApprovedRole(ops: Page, compliance: Page) {
  const name = uid('QA Role');
  const tm = new TeamManagementPage(ops);
  await tm.goto('Roles List');
  await tm.startCreateRole(name);
  await tm.grant('Audit Log', 'view').check();
  await tm.submitRole();
  await tm.modal.expectRoutedToApproval();
  await approveWithCompliance(compliance, new RegExp(name));
  return name;
}

test.describe('Team Management', () => {
  test.afterEach(closeRoleSessions);

  test(title('Admin directory lists all admin users', Tag.med, Tag.smoke, Tag.spec('AdminPRD:TeamManagement')), async ({ asPersona }) => {
    const page = await asPersona('headOfOps');
    const tm = new TeamManagementPage(page);
    await tm.goto('Admin Directory');
    await expect(tm.portfolio.rows().first()).toBeVisible();
  });

  test(title('Create admin: Head of Ops proposes, self-approval blocked, Compliance approves; admin appears', Tag.crit, Tag.spec('AdminPRD:TeamManagement'), Tag.spec('AdminPRD:ApprovalQueue')), async ({ asPersona }) => {
    const email = `${uid('qa-admin')}@example.test`;
    const ops = await asPersona('headOfOps');
    const tm = new TeamManagementPage(ops);
    await tm.goto('Admin Directory');
    const m = await tm.createAdmin({ name: 'QA Admin', email, role: BASE_ROLE });
    await m.submit();
    await m.expectRoutedToApproval();
    await tm.goto('Admin Directory');
    await tm.portfolio.search(email);
    await expect(tm.portfolio.rows()).toHaveCount(0); // not created before approval

    const own = new ApprovalQueuePage(ops);
    await own.goto();
    await own.open(new RegExp(email));
    await own.expectSelfApprovalBlocked();

    const compliance = await asPersona('compliance');
    const q = new ApprovalQueuePage(compliance);
    await q.goto();
    await q.open(new RegExp(email));
    await q.approve('Approved');
    const check = new TeamManagementPage(compliance);
    await check.goto('Admin Directory');
    await check.portfolio.search(email);
    await expect(check.row(email)).toBeVisible();
  });

  test(title('Create role holding both [M] and [C] approve on the same module is rejected by validation', Tag.crit, Tag.open('TM1'), Tag.spec('AdminPRD:TeamManagement')), async ({ asPersona }) => {
    const ops = await asPersona('headOfOps');
    const tm = new TeamManagementPage(ops);
    await tm.goto('Roles List');
    await tm.startCreateRole(uid('QA Conflict'));
    await tm.grant(MODULE, 'approve [M]').check();
    await tm.grant(MODULE, 'approve [C]').check();
    await tm.submitRole();
    await expect(tm.roleValidationError()).toContainText(/\[M\].*\[C\]|maker.*checker|same module/i);
  });

  test(title('Edit role to hold both [M] and [C] approve on the same module is rejected by validation', Tag.crit, Tag.open('TM1'), Tag.spec('AdminPRD:TeamManagement')), async ({ asPersona }) => {
    const ops = await asPersona('headOfOps');
    const compliance = await asPersona('compliance');
    const role = await createApprovedRole(ops, compliance);
    const tm = new TeamManagementPage(ops);
    await tm.goto('Roles List');
    await tm.openRole(role);
    await tm.editRole();
    await tm.grant(MODULE, 'approve [M]').check();
    await tm.grant(MODULE, 'approve [C]').check();
    await tm.submitRole();
    await expect(tm.roleValidationError()).toContainText(/\[M\].*\[C\]|maker.*checker|same module/i);
  });

  test(title('Edit admin role: dual + Compliance, prominent audit', Tag.crit, Tag.spec('AdminPRD:TeamManagement')), async ({ asPersona, hooks }) => {
    const ops = await asPersona('headOfOps');
    const compliance = await asPersona('compliance');
    const email = await createApprovedAdmin(ops, compliance);
    const tm = new TeamManagementPage(ops);
    await tm.goto('Admin Directory');
    await tm.openAdmin(email);
    const m = await tm.startAction(/edit role/i);
    await m.select(/role/i, 'Read only');
    await m.submit();
    await m.expectRoutedToApproval();
    await approveWithCompliance(compliance, new RegExp(email), 'Role change approved');
    const audit = await hooks.auditEntries({ action: 'admin.role.edit', limit: 1 });
    expect(audit[0].prominent).toBe(true);
  });

  test(title('Suspend admin: dual + Compliance; suspended admin can no longer log in', Tag.crit, Tag.spec('AdminPRD:TeamManagement')), async ({ asPersona, browser }) => {
    const target = requireRoleCreds('suspendTarget');
    const ops = await asPersona('headOfOps');
    const tm = new TeamManagementPage(ops);
    await tm.goto('Admin Directory');
    await tm.openAdmin(target.email);
    const m = await tm.startAction(/^suspend/i);
    await m.fill(/reason/i, 'Automated suspension test');
    await m.submit();
    await m.expectValidationError(/evidence/i);
    await m.evidence.fillDefault();
    await m.submit();
    await m.expectRoutedToApproval();

    const compliance = await asPersona('compliance');
    await approveWithCompliance(compliance, new RegExp(target.email), 'Suspension approved');

    const anon = await anonymousPage(browser);
    const login = new LoginPage(anon);
    await login.goto();
    await login.login(target.email, target.password);
    await login.expectError(/suspended|disabled|not allowed/i);
    await expect(anon.getByTestId('sidebar')).toHaveCount(0);
  });

  test(title('Reset admin password sends reset link (Head of Ops, single admin)', Tag.high, Tag.spec('AdminPRD:TeamManagement')), async ({ asPersona, hooks }) => {
    const ops = await asPersona('headOfOps');
    const compliance = await asPersona('compliance');
    const email = await createApprovedAdmin(ops, compliance);
    const tm = new TeamManagementPage(ops);
    await tm.goto('Admin Directory');
    await tm.openAdmin(email);
    const m = await tm.startAction(/reset password/i);
    await m.submit();
    await m.expectApplied();
    const audit = await hooks.auditEntries({ action: 'admin.password.reset', limit: 1 });
    expect(audit[0]).toBeTruthy();
  });

  test(title('View admin permissions renders the permission matrix', Tag.med, Tag.spec('AdminPRD:TeamManagement')), async ({ asPersona }) => {
    const page = await asPersona('compliance');
    const tm = new TeamManagementPage(page);
    await tm.goto('Admin Directory');
    await tm.portfolio.rows().first().click();
    await tm.viewPermissions();
    await expect(tm.permissionMatrix()).toBeVisible();
  });

  test(title('Roles list shows seed and custom roles; Role Builder renders permission matrix', Tag.med, Tag.spec('AdminPRD:TeamManagement')), async ({ asPersona }) => {
    const page = await asPersona('headOfOps');
    const tm = new TeamManagementPage(page);
    await tm.goto('Roles List');
    await expect(tm.portfolio.rows().filter({ hasText: /seed/i }).first()).toBeVisible();
    await tm.portfolio.rows().first().click();
    await expect(tm.roleBuilder()).toBeVisible();
    await expect(tm.roleBuilder().getByRole('checkbox').first()).toBeVisible();
  });

  test(title('Create custom role: dual + Compliance, prominent audit', Tag.crit, Tag.spec('AdminPRD:TeamManagement')), async ({ asPersona, hooks }) => {
    const ops = await asPersona('headOfOps');
    const compliance = await asPersona('compliance');
    const role = await createApprovedRole(ops, compliance);
    const tm = new TeamManagementPage(compliance);
    await tm.goto('Roles List');
    await expect(tm.row(role)).toBeVisible();
    const audit = await hooks.auditEntries({ action: 'role.create', limit: 1 });
    expect(audit[0].prominent).toBe(true);
  });

  test(title('Edit role permissions: Compliance reviews a diff before approving', Tag.crit, Tag.spec('AdminPRD:TeamManagement')), async ({ asPersona, hooks }) => {
    const ops = await asPersona('headOfOps');
    const compliance = await asPersona('compliance');
    const role = await createApprovedRole(ops, compliance);
    const tm = new TeamManagementPage(ops);
    await tm.goto('Roles List');
    await tm.openRole(role);
    await tm.editRole();
    await tm.grant('Transactions & Ledger', 'view').check();
    await tm.submitRole();
    await tm.modal.expectRoutedToApproval();

    const q = new ApprovalQueuePage(compliance);
    await q.goto();
    await q.open(new RegExp(role));
    await q.expectComplianceStepRequired();
    await expect(q.reviewModal().getByTestId('permission-diff')).toContainText(/Transactions & Ledger/i);
    await q.approve('Diff reviewed');
    const audit = await hooks.auditEntries({ action: 'role.edit', limit: 1 });
    expect(audit[0].prominent).toBe(true);
  });

  test(title('Retire custom role: dual + Compliance → Retired', Tag.high, Tag.spec('AdminPRD:TeamManagement')), async ({ asPersona }) => {
    const ops = await asPersona('headOfOps');
    const compliance = await asPersona('compliance');
    const role = await createApprovedRole(ops, compliance);
    const tm = new TeamManagementPage(ops);
    await tm.goto('Roles List');
    await tm.openRole(role);
    const m = await tm.startAction(/^retire/i);
    await m.fill(/reason/i, 'No longer needed');
    await m.submit();
    await m.expectRoutedToApproval();
    await approveWithCompliance(compliance, new RegExp(role), 'Retire approved');
    await tm.goto('Roles List');
    await expect(tm.row(role)).toContainText(/retired/i);
  });

  test(title('Roles without team-management permission cannot create admins', Tag.crit, Tag.spec('AdminPRD:TeamManagement')), async ({ asPersona }) => {
    const page = await asPersona('marketing');
    await page.goto('/');
    if ((await page.getByTestId('nav-team-management').count()) === 0) return; // module hidden = no access
    const tm = new TeamManagementPage(page);
    await tm.goto('Admin Directory');
    await expect(page.getByRole('button', { name: /create admin/i })).toHaveCount(0);
  });
});
