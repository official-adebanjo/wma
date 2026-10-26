import { Page, expect } from '@playwright/test';
import { ActionModal, DetailView, Portfolio, Sidebar } from './components';

export type TeamTab = 'Admin Directory' | 'Roles List';
/** Approval class markers on a module's approve grant ([M] / [C]) — Admin PRD seed-role constraint. */
export type ApproveClass = '[M]' | '[C]';

/** Team Management — Admin PRD "Team Management" (Admin Directory, Roles List, Role Builder). */
export class TeamManagementPage {
  readonly portfolio: Portfolio;
  readonly detail: DetailView;
  readonly modal: ActionModal;

  constructor(private readonly page: Page) {
    this.portfolio = new Portfolio(page);
    this.detail = new DetailView(page);
    this.modal = new ActionModal(page);
  }

  async goto(tab: TeamTab = 'Admin Directory') {
    await new Sidebar(this.page).open('team-management', tab);
    await expect(this.page.getByRole('tab', { name: tab })).toHaveAttribute('aria-selected', 'true');
  }

  row(text: string) { return this.portfolio.rows().filter({ hasText: text }).first(); }

  // ── Admin directory ───────────────────────────────────────────────────────
  async createAdmin(opts: { name: string; email: string; role: string }) {
    await this.page.getByRole('button', { name: /create admin/i }).click();
    await this.modal.expectOpen();
    await this.modal.fill(/name/i, opts.name);
    await this.modal.fill(/email/i, opts.email);
    await this.modal.select(/role/i, opts.role);
    return this.modal;
  }

  async openAdmin(emailOrName: string) {
    await this.portfolio.search(emailOrName);
    await this.row(emailOrName).click();
    await expect(this.detail.state()).toBeVisible();
  }

  async startAction(name: string | RegExp) {
    await this.detail.action(name);
    await this.modal.expectOpen();
    return this.modal;
  }

  async viewPermissions() { await this.detail.action(/view permissions/i); }
  permissionMatrix() { return this.page.getByTestId('permission-matrix'); }

  // ── Roles / Role Builder ──────────────────────────────────────────────────
  async openRole(name: string) {
    await this.row(name).click();
    await expect(this.roleBuilder()).toBeVisible();
  }
  roleBuilder() { return this.page.getByTestId('role-builder'); }
  /** Checkbox for a grant cell, e.g. grant('Investment Management', 'approve [M]'). */
  grant(module: string, permission: string) {
    return this.roleBuilder().getByRole('checkbox', { name: new RegExp(`${module}.*${permission.replace(/[[\]]/g, '\\$&')}`, 'i') });
  }
  async startCreateRole(name: string) {
    await this.page.getByRole('button', { name: /create role/i }).click();
    await expect(this.roleBuilder()).toBeVisible();
    await this.roleBuilder().getByLabel(/role name|name/i).first().fill(name);
  }
  async editRole() { await this.roleBuilder().getByRole('button', { name: /^edit/i }).click(); }
  async submitRole() { await this.roleBuilder().getByRole('button', { name: /submit|save|send for approval/i }).click(); }
  roleValidationError() { return this.roleBuilder().getByRole('alert').or(this.roleBuilder().getByTestId('field-error')).first(); }
}
