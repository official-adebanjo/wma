import type { Options } from '@wdio/types';
import * as path from 'path';
import * as fs from 'fs';
import '../../shared/config/env';

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
  connectionRetryTimeout: 120_000,
  connectionRetryCount: 2,
  framework: 'mocha',
  mochaOpts: { ui: 'bdd', timeout: 300_000, retries: 0 },
  specFileRetries: 1,
  reporters: [
    'spec',
    ['junit', {
      outputDir: path.resolve(__dirname, '../../reports/mobile-junit'),
      outputFileFormat: (opts: { cid: string }) => `results-${opts.cid}.xml`,
      addFileAttribute: true,
    }],
  ],
  afterTest: async function (test, _context, { passed }) {
    if (!passed && !test.pending) {
      const safe = test.title.replace(/[^a-z0-9]+/gi, '_').slice(0, 80);
      const dir = path.resolve(__dirname, '../../reports/mobile-screens');
      fs.mkdirSync(dir, { recursive: true });
      await browser.saveScreenshot(path.join(dir, `${safe}.png`)).catch(() => undefined);
      // Element tree at the moment of failure — what selectors would have matched.
      await browser.getPageSource().then((xml) => fs.writeFileSync(path.join(dir, `${safe}.xml`), xml)).catch(() => undefined);
    }
  },
};
