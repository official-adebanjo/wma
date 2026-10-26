import { Page, expect } from '@playwright/test';

export class LoginPage {
  constructor(private readonly page: Page) {}

  async goto() {
    await this.page.goto('/login');
  }

  async login(email: string, password: string) {
    await this.page.getByLabel(/email/i).fill(email);
    await this.page.getByLabel(/password/i).fill(password);
    await this.page.getByRole('button', { name: /sign in|log in/i }).click();
  }

  async expectLoggedIn() {
    await expect(this.page.getByTestId('sidebar')).toBeVisible({ timeout: 30_000 });
  }

  async expectError(text: RegExp | string) {
    await expect(this.page.getByRole('alert')).toContainText(text);
  }
}
