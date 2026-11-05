import * as fs from 'fs';
import * as path from 'path';

/**
 * The backend's OpenAPI document ("Swagger", /v3/api-docs) and helpers to walk it.
 *
 * openapi.snapshot.json is the saved copy the tests are generated from. Each run also fetches the
 * live document, so the report can say what changed since the copy was saved; refresh the copy with
 * `npm run api:snapshot` once the changes have been reviewed.
 */
export const SNAPSHOT = path.resolve(__dirname, 'openapi.snapshot.json');
export const RESULTS_DIR = path.resolve(__dirname, '../reports/api-results');
export const RECORDS = path.join(RESULTS_DIR, 'records.jsonl');
export const LIVE_SPEC = path.join(RESULTS_DIR, 'live-spec.json');
/** Response bodies of list endpoints, used to find real IDs for endpoints that need one. Never published. */
export const CACHE_DIR = path.join(RESULTS_DIR, 'cache');
export const TOKENS = path.resolve(__dirname, '../.auth/api-tokens.json');

export const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;
export type Method = (typeof METHODS)[number];

export type Param = { name: string; in: 'path' | 'query' | 'header' | 'cookie'; required?: boolean; schema?: Schema };
export type Schema = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
export type Spec = { openapi: string; info: { title: string; version: string }; paths: Record<string, Record<string, any>>; components?: { schemas?: Record<string, Schema> } }; // eslint-disable-line @typescript-eslint/no-explicit-any

export type Operation = {
  method: Method;
  path: string;
  tag: string;
  summary: string;
  operationId?: string;
  params: Param[];
  secured: boolean;
  hasBody: boolean;
  responses: Record<string, { description?: string; content?: Record<string, { schema?: Schema }> }>;
};

export function loadSpec(file = SNAPSHOT): Spec {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function operations(spec: Spec): Operation[] {
  const out: Operation[] = [];
  for (const [p, item] of Object.entries(spec.paths)) {
    for (const m of METHODS) {
      const o = item[m];
      if (!o) continue;
      out.push({
        method: m,
        path: p,
        tag: (o.tags && o.tags[0]) || 'Other',
        summary: o.summary || o.operationId || '',
        operationId: o.operationId,
        params: [...(item.parameters || []), ...(o.parameters || [])],
        secured: Array.isArray(o.security) && o.security.length > 0,
        hasBody: !!o.requestBody,
        responses: o.responses || {},
      });
    }
  }
  return out;
}

/** Areas only staff should reach — a customer sign-in must be refused there. */
const ADMIN_TAGS = [
  'Account Control Endpoints', 'General Approval Workflow Endpoints', 'Investment Management Endpoints',
  'Investment Report Endpoints', 'Loan Report Endpoints', 'Loan Approval Workflow Endpoints',
  'System-Wide Audit Log Endpoints', 'Portal Admin User Endpoints', 'Message Template Endpoints',
];
export const isAdminOnly = (op: Operation) => ADMIN_TAGS.includes(op.tag) || /\/admin(\/|-|$)/.test(op.path);

/** The documented success body schema (200, else the first 2xx with JSON). */
export function successSchema(op: Operation): Schema | undefined {
  const codes = Object.keys(op.responses).filter((c) => /^2\d\d$/.test(c)).sort();
  for (const c of ['200', ...codes]) {
    const content = op.responses[c]?.content;
    if (!content) continue;
    const json = content['application/json'] || content['*/*'] || Object.values(content)[0];
    if (json?.schema) return json.schema;
  }
  return undefined;
}

export const opKey = (op: Pick<Operation, 'method' | 'path'>) => `${op.method.toUpperCase()} ${op.path}`;

/** Compare two documents: operations added, removed, or whose parameters, body or responses changed. */
export function diffSpecs(saved: Spec, live: Spec) {
  const fingerprint = (o: Operation) => JSON.stringify([o.params.map((p) => [p.name, p.in, !!p.required]).sort(), o.hasBody, Object.keys(o.responses).sort(), o.summary]);
  const a = new Map(operations(saved).map((o) => [opKey(o), o]));
  const b = new Map(operations(live).map((o) => [opKey(o), o]));
  const added = [...b.keys()].filter((k) => !a.has(k));
  const removed = [...a.keys()].filter((k) => !b.has(k));
  const changed = [...b.keys()].filter((k) => a.has(k) && fingerprint(a.get(k)!) !== fingerprint(b.get(k)!));
  return { added, removed, changed, savedVersion: saved.info?.version, liveVersion: live.info?.version };
}
