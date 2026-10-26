import { request, APIRequestContext } from 'playwright-core';
import { env, required } from '../config/env';

/**
 * Client for the QA-only seeding / clock-control endpoints described in docs/TEST-HOOKS.md.
 *
 * Many spec rules are time-based (RWIN day-30 hold, 90-day cycles, REAP maturity, RTN
 * underfunded 24h window, loan due dates). Waiting real days is impossible, so the backend
 * must expose these hooks in dev/staging ONLY. Until they exist, specs that depend on them
 * call `QaHooks.requireAvailable()` and are skipped with a clear reason rather than failing.
 */
export class QaHooks {
  private constructor(private readonly ctx: APIRequestContext) {}

  static isConfigured(): boolean {
    return Boolean(env.qaHooksBaseUrl && env.qaHooksToken);
  }

  static async create(): Promise<QaHooks> {
    const ctx = await request.newContext({
      baseURL: env.qaHooksBaseUrl || required('QA_HOOKS_BASE_URL'),
      extraHTTPHeaders: { 'X-QA-Token': required('QA_HOOKS_TOKEN'), Accept: 'application/json' },
    });
    return new QaHooks(ctx);
  }

  private async call<T>(path: string, data: unknown): Promise<T> {
    const res = await this.ctx.post(path, { data });
    if (!res.ok()) throw new Error(`QA hook ${path} failed: ${res.status()} ${await res.text()}`);
    return (await res.json()) as T;
  }

  /** Customer with wallet balance at a given KYC tier. Returns credentials for login. */
  seedCustomer(opts: { tier: 1 | 2 | 3; walletBalance?: number; accountType?: 'INDIVIDUAL' | 'CORPORATE'; salaryDetected?: boolean; monthlySalary?: number; employer?: string }) {
    return this.call<{ customerId: string; phone: string; pin: string; accessToken: string }>('/seed/customer', opts);
  }

  setWalletBalance(customerId: string, balance: number) {
    return this.call<void>('/seed/wallet-balance', { customerId, balance });
  }

  /** Seed an investment in a given lifecycle state, optionally back-dated. */
  seedInvestment(opts: {
    customerId: string; product: 'REAP' | 'RWIN' | 'RTN'; state: string; principal: number; ratePct?: number;
    fundedDaysAgo?: number; extra?: Record<string, unknown>;
  }) {
    return this.call<{ investmentId: string; reference: string }>('/seed/investment', opts);
  }

  seedLoan(opts: { customerId: string; product: 'NANO' | 'PAYDAY' | 'PERSONAL' | 'PUBLIC_SECTOR'; state: string; amount: number; extra?: Record<string, unknown> }) {
    return this.call<{ loanId: string; reference: string }>('/seed/loan', opts);
  }

  /** Moves the business clock for a customer's products forward, then runs the daily batch (accrual, maturity, autosave, auto-debit). */
  advanceClock(opts: { customerId?: string; days: number; runBatch?: boolean }) {
    return this.call<{ businessDate: string }>('/clock/advance', { runBatch: true, ...opts });
  }

  resetClock() {
    return this.call<void>('/clock/reset', {});
  }

  /** Simulate an inbound bank transfer (RTN funding, wallet funding, payroll credits). */
  simulateInboundTransfer(opts: { reference: string; amount: number; customerId?: string; late?: boolean }) {
    return this.call<{ transferId: string }>('/simulate/inbound-transfer', opts);
  }

  /** Force the next third-party response (bureau timeout, mandate failure, NIN mismatch, etc.). */
  stubProvider(opts: { provider: 'BUREAU' | 'REMITA' | 'NIBSS' | 'NIMC' | 'MONO' | 'DOC_VERIFY' | 'IPPIS' | 'OTP'; outcome: string; customerId?: string }) {
    return this.call<void>('/stub/provider', opts);
  }

  /** Apply an account restriction as Compliance would (freeze, withdrawal-only, …) — for app-side assertions. */
  setAccountRestriction(opts: { customerId: string; restriction: 'NONE' | 'FROZEN' | 'WITHDRAWAL_ONLY' }) {
    return this.call<void>('/seed/account-restriction', opts);
  }

  /** Resolve a pending KYC upgrade as a reviewer would (Admin PRD › Review Queues). */
  resolveKycReview(opts: { customerId: string; outcome: 'APPROVE' | 'DECLINE' | 'REQUEST_REUPLOAD'; toTier?: 2 | 3; reason?: string; document?: string }) {
    return this.call<void>('/seed/kyc-review', opts);
  }

  setProductConfig(opts: { product: string; patch: Record<string, unknown> }) {
    return this.call<void>('/seed/product-config', opts);
  }

  latestNotifications(customerId: string, limit = 5) {
    return this.call<Array<{ channel: 'PUSH' | 'SMS' | 'EMAIL'; title: string; body: string; createdAt: string }>>('/inspect/notifications', { customerId, limit });
  }

  auditEntries(filter: { targetId?: string; action?: string; limit?: number }) {
    return this.call<Array<{ actor: string; action: string; targetId: string; amount?: number; evidence?: unknown; approvers?: string[]; prominent?: boolean; createdAt: string }>>('/inspect/audit', filter);
  }

  async dispose(): Promise<void> {
    await this.ctx.dispose();
  }
}
