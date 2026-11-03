#!/usr/bin/env node
/**
 * Refresh the saved copy of the backend's API document (api-dev/openapi.snapshot.json) from
 * API_BASE_URL/v3/api-docs. Run it after reviewing "What changed in the API" on the results page —
 * the API checks are generated from this copy, so new endpoints are only checked once it's saved.
 *
 *   npm run api:snapshot
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const base = (process.env.API_BASE_URL || '').replace(/\/$/, '');
if (!base) { console.error('API_BASE_URL is not set (see .env.example).'); process.exit(1); }
const out = path.resolve(__dirname, '../api-dev/openapi.snapshot.json');

(async () => {
  const res = await fetch(`${base}/v3/api-docs`);
  if (!res.ok) { console.error(`GET ${base}/v3/api-docs → ${res.status}`); process.exit(1); }
  const spec = await res.json();
  fs.writeFileSync(out, JSON.stringify(spec, null, 1) + '\n');
  const ops = Object.values(spec.paths).reduce((n, item) => n + Object.keys(item).filter((m) => ['get', 'post', 'put', 'patch', 'delete'].includes(m)).length, 0);
  console.log(`Saved ${path.relative(process.cwd(), out)}: ${spec.info?.title} ${spec.info?.version}, ${ops} endpoints.`);
})();
