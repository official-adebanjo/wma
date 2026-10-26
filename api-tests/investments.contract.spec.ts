import { test, expect } from '@playwright/test';
import { randomUUID } from 'crypto';
import { ApiClient } from '../shared/api/client';
import { InvestmentsApi } from '../shared/api/investments.api';
import { QaHooks } from '../shared/api/qa-hooks';
import * as rwin from '../shared/calc/rwin';
import * as rtn from '../shared/calc/rtn';
import { env } from '../shared/config/env';
import { Tag, title } from '../shared/support/tags';

/**
 * Shift-left contract tests for the investment yield engine (Calculator Spec §5; QA Strategy §13 stage 2, §16).
 * The engine must agree with the independent oracle to the kobo.
 */
test.describe('API › Investments', () => {
  test.skip(!env.apiBaseUrl || !QaHooks.isConfigured(), 'API_BASE_URL and QA hooks required');

  let hooks: QaHooks;
  let api: ApiClient;
  let inv: InvestmentsApi;
  let customerId: string;

  test.beforeAll(async () => {
    hooks = await QaHooks.create();
    const c = await hooks.seedCustomer({ tier: 2, walletBalance: 20_000_000 });
    customerId = c.customerId;
    api = await ApiClient.create(c.accessToken);
    inv = new InvestmentsApi(api);
    await hooks.setProductConfig({ product: 'RWIN', patch: { ratePct: 14 } });
  });

  test.afterAll(async () => {
    await api?.dispose();
    await hooks?.dispose();
  });

  test(title('GET /catalog lists REAP, RWIN and RTN with config-driven rates', Tag.high, Tag.smoke, Tag.spec('Calc§5')), async () => {
    const res = await inv.catalog();
    expect(res.status).toBe(200);
    const codes = res.body.products.map((p) => p.code).sort();
    expect(codes).toEqual(['REAP', 'RTN', 'RWIN']);
    for (const p of res.body.products) {
      expect(p.rates.length).toBeGreaterThan(0);
      expect(typeof p.minAmount).toBe('number');
      expect(p.whtRatePct).toBeGreaterThan(0);
    }
    expect(res.body.products.find((p) => p.code === 'RWIN')!.rates[0].ratePct).toBe(14);
  });

  test(title('GET /catalog requires authentication', Tag.crit, Tag.spec('QAStrategy§17')), async () => {
    const anon = await ApiClient.create();
    const res = await anon.get('/api/v1/investments/catalog');
    expect([401, 403]).toContain(res.status);
    await anon.dispose();
  });

  for (const principal of [50_000, 1_000_000, 12_345_678.9]) {
    test(title(`POST /calculate RWIN ₦${principal.toLocaleString()} matches oracle (gross, WHT, net)`, Tag.crit, Tag.spec('Calc§3.2')), async () => {
      const res = await inv.calculate({ productCode: 'RWIN', principal, tenorDays: 90 });
      expect(res.status).toBe(200);
      const exp = rwin.cycleInterest(principal, 14);
      expect(res.body.grossYield.toFixed(2)).toBe(exp.gross.toFixed(2));
      expect(res.body.wht.toFixed(2)).toBe(exp.wht.toFixed(2));
      expect(res.body.netPayout.toFixed(2)).toBe(rwin.maturityPayout(principal, 14).toFixed(2));
    });
  }

  test(title('POST /calculate RTN uses matrix rate for amount × tenor and both interest timings', Tag.crit, Tag.open('T1'), Tag.open('T2'), Tag.spec('RTN§4')), async () => {
    const matrix: rtn.RateMatrix = {
      bands: [{ min: 1_000_000, max: 5_000_000 }, { min: 5_000_000 }],
      tenorsDays: [90, 180],
      rates: [[12, 13], [13, 14]],
    };
    await hooks.setProductConfig({ product: 'RTN', patch: { rateMatrix: matrix } });
    for (const timing of ['AT_MATURITY', 'UPFRONT'] as const) {
      const res = await inv.calculate({ productCode: 'RTN', principal: 5_000_000, tenorDays: 180, interestTiming: timing });
      expect(res.status).toBe(200);
      expect(res.body.ratePct).toBe(rtn.lookupRate(matrix, 5_000_000, 180));
      const exp = rtn.interest(5_000_000, 14, 180);
      expect(res.body.grossYield.toFixed(2)).toBe(exp.gross.toFixed(2));
      expect(res.body.wht.toFixed(2)).toBe(exp.wht.toFixed(2));
    }
  });

  test(title('POST /calculate rejects invalid input with a structured error model', Tag.high, Tag.spec('QAStrategy§28.2')), async () => {
    for (const bad of [
      { productCode: 'RWIN', principal: -1, tenorDays: 90 },
      { productCode: 'RWIN', principal: 0, tenorDays: 90 },
      { productCode: 'RWIN', principal: 'abc', tenorDays: 90 },
      { productCode: 'NOPE', principal: 100_000, tenorDays: 90 },
      { productCode: 'RTN', principal: 2_000_000, tenorDays: 45 },
    ]) {
      const res = await api.post<{ code?: string; message?: string }>('/api/v1/investments/calculate', bad);
      expect(res.status, JSON.stringify(bad)).toBeGreaterThanOrEqual(400);
      expect(res.status, JSON.stringify(bad)).toBeLessThan(500);
      expect(res.body?.message ?? res.body?.code, 'error model present').toBeTruthy();
    }
  });

  test(title('POST /create is idempotent: same Idempotency-Key never double-debits the wallet', Tag.crit, Tag.spec('QAStrategy§20.3'), Tag.spec('QAStrategy§32')), async () => {
    const key = randomUUID();
    const body = { productCode: 'RWIN' as const, principal: 100_000, tenorDays: 90, planName: 'Idem', autoRollover: true, fundingSource: 'WALLET' as const, idempotencyKey: key };
    const [a, b] = await Promise.all([inv.create(body), inv.create(body)]);
    expect([200, 201]).toContain(a.status);
    expect([200, 201, 409]).toContain(b.status);
    if (b.status !== 409) expect(b.body.id).toBe(a.body.id);
    const wallet = await api.get<{ balance: number }>('/api/v1/wallet');
    expect(wallet.body.balance).toBe(20_000_000 - 100_000);
  });

  test(title('POST /create with insufficient wallet balance fails safely (no plan, no debit)', Tag.crit, Tag.spec('QAStrategy§20.3')), async () => {
    await hooks.setWalletBalance(customerId, 10_000);
    const res = await inv.create({ productCode: 'RWIN', principal: 100_000, tenorDays: 90, planName: 'NSF', fundingSource: 'WALLET', idempotencyKey: randomUUID() });
    expect(res.status).toBeGreaterThanOrEqual(400);
    const wallet = await api.get<{ balance: number }>('/api/v1/wallet');
    expect(wallet.body.balance).toBe(10_000);
    await hooks.setWalletBalance(customerId, 20_000_000);
  });

  test(title('POST /create blocked below KYC Tier 2 for RWIN/REAP', Tag.crit, Tag.spec('Calc§2')), async () => {
    const t1 = await hooks.seedCustomer({ tier: 1, walletBalance: 1_000_000 });
    const t1api = await ApiClient.create(t1.accessToken);
    const res = await new InvestmentsApi(t1api).create({ productCode: 'RWIN', principal: 100_000, tenorDays: 90, planName: 'T1', fundingSource: 'WALLET', idempotencyKey: randomUUID() });
    expect([403, 422]).toContain(res.status);
    await t1api.dispose();
  });

  test(title('POST /create enforces RWIN ₦100M cap and minimum deposit server-side', Tag.crit, Tag.open('W4'), Tag.spec('RWIN§4.2')), async () => {
    await hooks.setWalletBalance(customerId, 150_000_000);
    const tooSmall = await inv.create({ productCode: 'RWIN', principal: 49_999, tenorDays: 90, planName: 'Small', fundingSource: 'WALLET', idempotencyKey: randomUUID() });
    expect(tooSmall.status).toBeGreaterThanOrEqual(400);
    const tooBig = await inv.create({ productCode: 'RWIN', principal: 100_000_001, tenorDays: 90, planName: 'Big', fundingSource: 'WALLET', idempotencyKey: randomUUID() });
    expect(tooBig.status).toBeGreaterThanOrEqual(400);
    await hooks.setWalletBalance(customerId, 20_000_000);
  });

  test(title('responses carry security headers and never echo PII', Tag.high, Tag.spec('QAStrategy§17')), async () => {
    const res = await inv.catalog();
    expect(res.headers['strict-transport-security']).toBeTruthy();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(JSON.stringify(res.body)).not.toMatch(/\b\d{11}\b/); // no BVN/NIN-shaped values
  });
});
