import { test as setup, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { CACHE_DIR, LIVE_SPEC, RESULTS_DIR, TOKENS } from './spec';

/**
 * Before the endpoint checks: fetch the live API document, clear the last run's results, and sign
 * in once per role. Tokens go to .auth/ (git-ignored); the endpoint tests read them from there, so
 * they survive Playwright restarting its worker after a failed check.
 */
const base = () => (process.env.API_BASE_URL || '').replace(/\/$/, '');

async function signIn(pathname: string, email?: string, password?: string) {
  if (!email || !password) return null;
  const res = await fetch(base() + pathname, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }),
  });
  expect(res.status, `sign-in at ${pathname}`).toBe(200);
  const body = await res.json();
  return { token: body.token as string, id: body.id as number, email };
}

setup('fetch the API document and sign in', async () => {
  setup.skip(!base(), 'API_BASE_URL required');
  fs.rmSync(RESULTS_DIR, { recursive: true, force: true });
  fs.mkdirSync(CACHE_DIR, { recursive: true });

  const doc = await fetch(`${base()}/v3/api-docs`);
  expect(doc.status, 'GET /v3/api-docs').toBe(200);
  fs.writeFileSync(LIVE_SPEC, await doc.text());

  const tokens = {
    customer: await signIn('/api/v3/users/login', process.env.CUSTOMER_T3_EMAIL, process.env.CUSTOMER_T3_PASSWORD),
    otherCustomer: await signIn('/api/v3/users/login', process.env.CUSTOMER_T1_EMAIL, process.env.CUSTOMER_T1_PASSWORD),
    admin: await signIn('/api/v3/admin-users/login', process.env.DEV_ADMIN_EMAIL, process.env.DEV_ADMIN_PASSWORD),
  };
  expect(tokens.customer || tokens.admin, 'at least one of CUSTOMER_T3_* or DEV_ADMIN_* must be set').toBeTruthy();
  fs.mkdirSync(path.dirname(TOKENS), { recursive: true });
  fs.writeFileSync(TOKENS, JSON.stringify(tokens));
});
