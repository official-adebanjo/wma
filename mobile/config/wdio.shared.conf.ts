import type { Options } from '@wdio/types';
import * as path from 'path';
import * as fs from 'fs';
import '../../shared/config/env';
import JsonlReporter, { RESULTS_DIR } from './jsonl-reporter';

/**
 * Shared WebdriverIO config for the Rosabon Unified mobile app.
 * Platform/cloud configs spread this and add capabilities.
 *
 * Suites map 1:1 to app modules so a Class B change can run a targeted sweep
 * (QA Strategy §8): e.g. `--suite rwin`.
 */
export const sharedConfig: Options.Testrunner = {
  runner: 'local',
  tsConfigPath: path.resolve(__dirname, '../../tsconfig.json'),
  specs: [path.resolve(__dirname, '../specs/**/*.spec.ts')],
  suites: {
    auth: ['../specs/auth/**/*.spec.ts'],
    navigation: ['../specs/navigation/**/*.spec.ts'],
    journeys: ['../specs/journeys/**/*.spec.ts'],
    kyc: ['../specs/kyc/**/*.spec.ts'],
    wallet: ['../specs/wallet/**/*.spec.ts'],
    grow: ['../specs/grow/**/*.spec.ts'],
    reap: ['../specs/reap/**/*.spec.ts'],
    rwin: ['../specs/rwin/**/*.spec.ts'],
    rtn: ['../specs/rtn/**/*.spec.ts'],
    borrow: ['../specs/borrow/**/*.spec.ts'],
    nano: ['../specs/nano/**/*.spec.ts'],
    payday: ['../specs/payday/**/*.spec.ts'],
    personal: ['../specs/personal-loan/**/*.spec.ts'],
    publicSector: ['../specs/public-sector-loan/**/*.spec.ts'],
    resilience: ['../specs/resilience/**/*.spec.ts'],
  },
  maxInstances: 1,
  logLevel: 'warn',
  bail: 0,
  waitforTimeout: 15_000,
  connectionRetryTimeout: 300_000, // opening a session installs and resets a ~350 MB app
  connectionRetryCount: 2,
  framework: 'mocha',
  mochaOpts: { ui: 'bdd', timeout: 300_000, retries: 0 },
  specFileRetries: 1,
  reporters: [
    'spec',
    // Plain-English report input (scripts/build-summary.js)
    [JsonlReporter, {}],
    ['junit', {
      outputDir: path.resolve(__dirname, '../../reports/mobile-junit'),
      outputFileFormat: (opts: { cid: string }) => `results-${opts.cid}.xml`,
      addFileAttribute: true,
    }],
  ],
  onPrepare: function () {
    // Each run starts clean, but earlier runs' results are kept in reports/mobile-results-history/<time>,
    // newest 10 (one "previous" copy wasn't enough: a couple of single-spec re-runs pushed out a full run).
    const history = `${RESULTS_DIR}-history`;
    if (fs.existsSync(RESULTS_DIR) && fs.readdirSync(RESULTS_DIR).length) {
      fs.mkdirSync(history, { recursive: true });
      fs.renameSync(RESULTS_DIR, path.join(history, new Date().toISOString().replace(/[:.]/g, '-')));
      for (const old of fs.readdirSync(history).sort().reverse().slice(10)) fs.rmSync(path.join(history, old), { recursive: true, force: true });
    }
    fs.rmSync(RESULTS_DIR, { recursive: true, force: true });
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
  },
  afterTest: async function (test, _context, { passed, error }) {
    const skipped = test.pending || /skip/i.test(String(error?.message ?? ''));
    if (!passed && !skipped) {
      const safe = test.title.replace(/[^a-z0-9]+/gi, '_').slice(0, 80);
      const dir = path.resolve(__dirname, '../../reports/mobile-screens');
      fs.mkdirSync(dir, { recursive: true });
      await browser.saveScreenshot(path.join(dir, `${safe}.png`)).catch(() => undefined);
      // Element tree at the moment of failure — what selectors would have matched.
      await browser.getPageSource().then((xml) => fs.writeFileSync(path.join(dir, `${safe}.xml`), xml)).catch(() => undefined);
    }
  },
};
