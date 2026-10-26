import { Page, expect } from '@playwright/test';
import { Module, Sidebar } from './components';

/** App shell — sidebar visibility, user menu / logout, placeholder modules (cross-cutting navigation & access). */
export class AppShellPage {
  readonly sidebar: Sidebar;

  constructor(private readonly page: Page) {
    this.sidebar = new Sidebar(page);
  }

  async gotoRoot() {
    await this.page.goto('/');
    await expect(this.sidebar.root()).toBeVisible();
  }

  navItem(module: Module) { return this.sidebar.item(module); }
  homeNav() { return this.sidebar.root().getByTestId('nav-home').or(this.sidebar.root().getByRole('link', { name: /^home$/i })); }
  notFoundOrRedirect() { return this.page.getByText(/not found|404|page doesn.t exist/i); }
  placeholder() { return this.page.getByTestId('module-placeholder').or(this.page.getByText(/redesign|coming soon/i)).first(); }

  async logout() {
    await this.page.getByRole('button', { name: /account|profile|user menu/i }).click();
    await this.page.getByRole('menuitem', { name: /log ?out|sign ?out/i }).click();
  }
}
