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

  onRunnerStart(runner: RunnerStats) {
    this.file = path.basename(runner.specs[0] ?? '');
  }

  onTestPass(t: TestStats) { this.record(t, 'passed'); }
  onTestFail(t: TestStats) { this.record(t, 'failed'); }
  onTestSkip(t: TestStats) { this.record(t, 'skipped'); }

  private record(t: TestStats, status: 'passed' | 'failed' | 'skipped') {
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
    const line = {
      file: this.file, suite: t.parent, title: t.title, status,
      error: status === 'failed' ? String(t.error?.message ?? '').split('\n')[0] : undefined,
      duration: t.duration, at: new Date().toISOString(),
    };
    fs.appendFileSync(path.join(RESULTS_DIR, `results-${process.pid}.jsonl`), JSON.stringify(line) + '\n');
  }
}
