import { test, expect } from '@playwright/test';
import { randomUUID } from 'crypto';
import { ApiClient } from '../shared/api/client';
import { QaHooks } from '../shared/api/qa-hooks';
import { env, tierLimits } from '../shared/config/env';
import { Tag, title } from '../shared/support/tags';

/**
 * Authentication & wallet contract tests — the two CRIT areas in QA Strategy §7.
 * Endpoint paths are the expected shape; align with the backend OpenAPI document.
 */
test.describe('API › Auth', () => {
  test.skip(!env.apiBaseUrl, 'API_BASE_URL required');

  test(title('login with wrong PIN is rejected without revealing which field was wrong', Tag.crit, Tag.spec('QAStrategy§17')), async () => {
    test.skip(!QaHooks.isConfigured(), 'QA hooks required');
    const hooks = await QaHooks.create();
    const c = await hooks.seedCustomer({ tier: 1 });
    const anon = await ApiClient.create();
    const res = await anon.post<{ message?: string }>('/api/v1/auth/login', { phone: c.phone, pin: '0000' === c.pin ? '1111' : '0000' });
    expect(res.status).toBe(401);
    expect(res.body?.message ?? '').not.toMatch(/pin is wrong|phone not found/i);
    await anon.dispose();
    await hooks.dispose();
  });

  test(title('repeated failed logins lock the account', Tag.crit, Tag.spec('QAStrategy§17')), async () => {
    test.skip(!QaHooks.isConfigured(), 'QA hooks required');
    const hooks = await QaHooks.create();
    const c = await hooks.seedCustomer({ tier: 1 });
    const anon = await ApiClient.create();
    let last = 0;
    for (let i = 0; i < 6; i++) last = (await anon.post('/api/v1/auth/login', { phone: c.phone, pin: '9999' })).status;
    expect([423, 429, 403]).toContain(last);
    const good = await anon.post('/api/v1/auth/login', { phone: c.phone, pin: c.pin });
    expect(good.status).not.toBe(200);
    await anon.dispose();
    await hooks.dispose();
  });

  test(title('expired / tampered bearer token is rejected', Tag.crit, Tag.spec('QAStrategy§17')), async () => {
    const bad = await ApiClient.create('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.tampered');
    const res = await bad.get('/api/v1/wallet');
    expect(res.status).toBe(401);
    await bad.dispose();
  });

  test(title('a customer cannot read another customer\'s wallet (IDOR)', Tag.crit, Tag.spec('QAStrategy§17')), async () => {
    test.skip(!QaHooks.isConfigured(), 'QA hooks required');
    const hooks = await QaHooks.create();
    const a = await hooks.seedCustomer({ tier: 2 });
    const b = await hooks.seedCustomer({ tier: 2 });
    const apiA = await ApiClient.create(a.accessToken);
    const res = await apiA.get(`/api/v1/customers/${b.customerId}/wallet`);
    expect([403, 404]).toContain(res.status);
    await apiA.dispose();
    await hooks.dispose();
  });
});

test.describe('API › Wallet', () => {
  test.skip(!env.apiBaseUrl || !QaHooks.isConfigured(), 'API_BASE_URL and QA hooks required');

  test(title('transfer above tier single limit is rejected; at limit succeeds', Tag.crit, Tag.spec('KYC§1')), async () => {
    const hooks = await QaHooks.create();
    const c = await hooks.seedCustomer({ tier: 2, walletBalance: 30_000_000 });
    const api = await ApiClient.create(c.accessToken);
    const over = await api.post('/api/v1/wallet/transfers', { amount: tierLimits[2].singleTransfer + 1, destinationAccount: '0000000000', bankCode: '999', idempotencyKey: randomUUID() });
    expect(over.status).toBeGreaterThanOrEqual(400);
    const at = await api.post('/api/v1/wallet/transfers', { amount: tierLimits[2].singleTransfer, destinationAccount: '0000000000', bankCode: '999', idempotencyKey: randomUUID() });
    expect([200, 201, 202]).toContain(at.status);
    await api.dispose();
    await hooks.dispose();
  });

  test(title('concurrent duplicate transfer requests debit once (idempotency)', Tag.crit, Tag.spec('QAStrategy§20.3')), async () => {
    const hooks = await QaHooks.create();
    const c = await hooks.seedCustomer({ tier: 2, walletBalance: 100_000 });
    const api = await ApiClient.create(c.accessToken);
    const key = randomUUID();
    const body = { amount: 10_000, destinationAccount: '0000000000', bankCode: '999', idempotencyKey: key };
    await Promise.all(Array.from({ length: 5 }, () => api.post('/api/v1/wallet/transfers', body, { 'Idempotency-Key': key })));
    const wallet = await api.get<{ balance: number }>('/api/v1/wallet');
    expect(wallet.body.balance).toBe(90_000);
    await api.dispose();
    await hooks.dispose();
  });

  test(title('every wallet movement appears exactly once in transaction history with a reference', Tag.crit, Tag.spec('QAStrategy§20.2')), async () => {
    const hooks = await QaHooks.create();
    const c = await hooks.seedCustomer({ tier: 2, walletBalance: 0 });
    await hooks.simulateInboundTransfer({ reference: `QA-${randomUUID().slice(0, 8)}`, amount: 25_000, customerId: c.customerId });
    const api = await ApiClient.create(c.accessToken);
    const hist = await api.get<{ items: Array<{ reference: string; amount: number; type: string }> }>('/api/v1/wallet/transactions');
    const credits = hist.body.items.filter((t) => t.amount === 25_000);
    expect(credits).toHaveLength(1);
    expect(credits[0].reference).toBeTruthy();
    const wallet = await api.get<{ balance: number }>('/api/v1/wallet');
    expect(wallet.body.balance).toBe(25_000);
    await api.dispose();
    await hooks.dispose();
  });
});
