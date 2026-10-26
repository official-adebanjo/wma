import { test, expect } from '../../fixtures/fixtures';
import { AuditLogPage } from '../../pages/AuditLogPage';
import { expectCsvExport } from '../../pages/components';
import { asRole, closeRoleSessions } from '../../fixtures/platform-personas';
import { Tag, title } from '../../../shared/support/tags';

/**
 * Admin PRD › Audit Log. Append-only (no edit/delete anywhere), filterable by admin, module, action type,
 * date, customer, amount; drill-in; Export CSV — and the export itself is audited.
 */
const today = () => new Date().toISOString().slice(0, 10);
const amountOf = (s: string) => Number(s.replace(/[^0-9.]/g, '') || 'NaN');

test.describe('Audit Log', () => {
  test.afterEach(closeRoleSessions);

  test(title('Compliance can view the audit log', Tag.med, Tag.smoke, Tag.spec('AdminPRD:AuditLog')), async ({ asPersona }) => {
    const page = await asPersona('compliance');
    const log = new AuditLogPage(page);
    await log.goto();
    await expect(log.rows().first()).toBeVisible();
  });

  test(title('Auditor can view the audit log', Tag.high, Tag.spec('AdminPRD:AuditLog')), async ({ browser }) => {
    const page = await asRole(browser, 'auditor');
    const log = new AuditLogPage(page);
    await log.goto();
    await expect(log.rows().first()).toBeVisible();
  });

  test(title('Append-only: no edit/delete controls on list or entry detail', Tag.crit, Tag.spec('AdminPRD:AuditLog')), async ({ asPersona }) => {
    const page = await asPersona('superAdmin');
    const log = new AuditLogPage(page);
    await log.goto();
    await expect(log.mutatingControls()).toHaveCount(0);
    await log.openEntry(0);
    await expect(log.mutatingControls()).toHaveCount(0);
    await expect(log.entryDetail().getByRole('textbox')).toHaveCount(0);
  });

  test(title('Filter by admin shows only that actor', Tag.high, Tag.spec('AdminPRD:AuditLog')), async ({ asPersona }) => {
    const page = await asPersona('compliance');
    const log = new AuditLogPage(page);
    await log.goto();
    const actor = (await log.portfolio.columnValues('Admin'))[0].trim();
    await log.filter('Admin', actor);
    for (const a of await log.portfolio.columnValues('Admin')) expect(a.trim()).toBe(actor);
  });

  test(title('Filter by module', Tag.med, Tag.spec('AdminPRD:AuditLog')), async ({ asPersona }) => {
    const page = await asPersona('compliance');
    const log = new AuditLogPage(page);
    await log.goto();
    await log.filter('Module', 'Settings');
    for (const m of await log.portfolio.columnValues('Module')) expect(m).toMatch(/settings/i);
  });

  test(title('Filter by action type', Tag.med, Tag.spec('AdminPRD:AuditLog')), async ({ asPersona }) => {
    const page = await asPersona('compliance');
    const log = new AuditLogPage(page);
    await log.goto();
    const action = (await log.portfolio.columnValues('Action'))[0].trim();
    await log.filter('Action type', action);
    for (const a of await log.portfolio.columnValues('Action')) expect(a.trim()).toBe(action);
  });

  test(title('Filter by date restricts to the range', Tag.med, Tag.spec('AdminPRD:AuditLog')), async ({ asPersona }) => {
    const page = await asPersona('compliance');
    const log = new AuditLogPage(page);
    await log.goto();
    await log.filter('Date from', today());
    await log.filter('Date to', today());
    const stamps = await log.portfolio.columnValues('Timestamp');
    for (const t of stamps) expect(new Date(t).toISOString().slice(0, 10)).toBe(today());
  });

  test(title('Filter by customer shows only entries targeting that customer', Tag.high, Tag.spec('AdminPRD:AuditLog')), async ({ asPersona }) => {
    const page = await asPersona('compliance');
    const log = new AuditLogPage(page);
    await log.goto();
    const customer = (await log.portfolio.columnValues('Customer')).map((c) => c.trim()).find((c) => c && c !== '—' && c !== '-');
    test.skip(!customer, 'No customer-targeted entries on the first page');
    await log.filter('Customer', customer!);
    const values = await log.portfolio.columnValues('Customer');
    expect(values.length).toBeGreaterThan(0);
    for (const t of values) expect(t).toContain(customer!);
  });

  test(title('Filter by amount (minimum) excludes smaller amounts', Tag.med, Tag.spec('AdminPRD:AuditLog')), async ({ asPersona }) => {
    const page = await asPersona('compliance');
    const log = new AuditLogPage(page);
    await log.goto();
    await log.filter('Amount min', '1000000');
    for (const a of await log.portfolio.columnValues('Amount')) expect(amountOf(a)).toBeGreaterThanOrEqual(1_000_000);
  });

  test(title('Drill into entry shows actor, timestamp, action, target, amount, evidence, approvers', Tag.high, Tag.spec('AdminPRD:AuditLog')), async ({ asPersona }) => {
    const page = await asPersona('compliance');
    const log = new AuditLogPage(page);
    await log.goto();
    await log.openEntry(0);
    for (const f of ['actor', 'timestamp', 'action', 'target', 'amount', 'evidence', 'approvers'] as const) {
      await expect(log.entryField(f)).toBeVisible();
    }
  });

  test(title('Export CSV downloads current filter and the export itself creates an audit entry', Tag.crit, Tag.spec('AdminPRD:AuditLog')), async ({ asPersona, hooks }) => {
    const page = await asPersona('compliance');
    const log = new AuditLogPage(page);
    await log.goto();
    await log.filter('Module', 'Settings');
    await expectCsvExport(page, () => log.exportCsvButton().click(), /actor|admin/i);
    const audit = await hooks.auditEntries({ action: 'audit_log.export', limit: 1 });
    expect(audit).toHaveLength(1);
    expect(Date.now() - new Date(audit[0].createdAt).getTime()).toBeLessThan(5 * 60_000);
    await page.reload();
    await log.goto();
    await expect(log.rows().first()).toContainText(/export/i);
  });

  test(title('Roles without audit permission cannot access the audit log', Tag.crit, Tag.spec('AdminPRD:AuditLog')), async ({ asPersona }) => {
    const page = await asPersona('marketing');
    await page.goto('/');
    await expect(page.getByTestId('nav-audit-log')).toHaveCount(0);
    await page.goto('/audit-log');
    await expect(page.getByRole('heading', { name: /audit log/i }).and(page.getByRole('heading', { level: 1 }))).toHaveCount(0);
  });
});
