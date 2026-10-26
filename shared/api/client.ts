import { APIRequestContext, request } from 'playwright-core';
import { env, required } from '../config/env';

/**
 * Thin typed wrapper around Playwright's APIRequestContext. Used by:
 *  - api-tests/ (shift-left contract tests, QA Strategy §13 stage 2)
 *  - admin + mobile specs to verify backend state after a UI action
 */
export class ApiClient {
  private constructor(private readonly ctx: APIRequestContext) {}

  static async create(token?: string, baseURL = env.apiBaseUrl || required('API_BASE_URL')): Promise<ApiClient> {
    const ctx = await request.newContext({
      baseURL,
      extraHTTPHeaders: {
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    return new ApiClient(ctx);
  }

  get raw(): APIRequestContext {
    return this.ctx;
  }

  async get<T>(path: string, params?: Record<string, string | number>): Promise<{ status: number; body: T; headers: Record<string, string> }> {
    const res = await this.ctx.get(path, { params });
    return { status: res.status(), body: (await safeJson(res)) as T, headers: res.headers() };
  }

  async post<T>(path: string, data?: unknown, headers?: Record<string, string>): Promise<{ status: number; body: T; headers: Record<string, string> }> {
    const res = await this.ctx.post(path, { data, headers });
    return { status: res.status(), body: (await safeJson(res)) as T, headers: res.headers() };
  }

  async dispose(): Promise<void> {
    await this.ctx.dispose();
  }
}

async function safeJson(res: { text(): Promise<string> }): Promise<unknown> {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : undefined;
  } catch {
    return text;
  }
}
