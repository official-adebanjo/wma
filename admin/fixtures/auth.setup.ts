import { test as setup } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { LoginPage } from '../pages/LoginPage';
import { credsFor, Persona, personas, storageStatePath } from './personas';
import { ensureTestFiles } from '../../shared/data/files';

/**
 * Logs in once per persona that has credentials configured and saves the session.
 * Personas without credentials are skipped; specs needing them self-skip (see fixtures.ts).
 */
setup('generate upload fixtures', async () => {
  ensureTestFiles();
});

for (const persona of Object.keys(personas) as Persona[]) {
  setup(`authenticate ${persona}`, async ({ page }) => {
    const creds = credsFor(persona);
    setup.skip(!creds, `No credentials configured for ${persona}`);
    const login = new LoginPage(page);
    await login.goto();
    await login.login(creds!.email, creds!.password);
    await login.expectLoggedIn();
    const file = storageStatePath(persona);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    await page.context().storageState({ path: file });
  });
}
