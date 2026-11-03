import WDIOReporter, { type RunnerStats, type TestStats } from '@wdio/reporter';
import * as fs from 'fs';
import * as path from 'path';

/**
 * One JSON line per test → reports/mobile-results/*.jsonl, read by scripts/build-summary.js.
 * A reporter (not afterTest) because tests skipped from a hook (e.g. no QA hooks) only
 * surface as reporter skip events. The JUnit reporter writes empty files for these suites.
 */
export const RESULTS_DIR = path.resolve(__dirname, '../../reports/mobile-results');

export default class JsonlReporter extends WDIOReporter {
  private file = '';
  private device = '';

  onRunnerStart(runner: RunnerStats) {
    this.file = path.basename(runner.specs[0] ?? '');
    // Session capabilities as Appium reports them, e.g. "Google sdk_gphone64_x86_64 · Android 14".
    const c = (runner.capabilities ?? {}) as Record<string, unknown>;
    const pick = (k: string) => (c[k] ?? c[`appium:${k}`]) as string | undefined;
    const model = [pick('deviceManufacturer'), pick('deviceModel') ?? pick('deviceName')].filter(Boolean).join(' ');
    const os = pick('platformVersion') ? `${pick('platformName') ?? 'Android'} ${pick('platformVersion')}` : '';
    this.device = [model, os].filter(Boolean).join(' · ');
  }

  onTestPass(t: TestStats) { this.record(t, 'passed'); }
  onTestFail(t: TestStats) { this.record(t, 'failed'); }
  onTestSkip(t: TestStats) { this.record(t, 'skipped'); }

  private record(t: TestStats, status: 'passed' | 'failed' | 'skipped') {
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
    const line = {
      file: this.file, suite: t.parent, title: t.title, status,
      error: status === 'failed' ? String(t.error?.message ?? '').split('\n')[0] : undefined,
      // The full message (expected vs received, element waited for), shown behind "View" on the results page.
      detail: status === 'failed' ? String(t.error?.message ?? '').replace(/\x1b\[[0-9;]*m/g, '').split('\n').slice(0, 12).join('\n') : undefined,
      duration: t.duration, at: new Date().toISOString(),
      device: this.device || undefined,
      // e.g. "build 1.1.55" — CI sets it from the APK; locally optional
      app: process.env.MOBILE_APP_LABEL || undefined,
    };
    fs.appendFileSync(path.join(RESULTS_DIR, `results-${process.pid}.jsonl`), JSON.stringify(line) + '\n');
  }
}
