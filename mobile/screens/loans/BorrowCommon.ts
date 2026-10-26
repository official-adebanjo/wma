import * as fs from 'fs';
import * as path from 'path';
import { browser } from '@wdio/globals';
import { BaseScreen, byText, driver } from '../BaseScreen';
import { BorrowHomeScreen } from '../common/HomeScreens';
import { abs, ensureTestFiles } from '../../../shared/data/files';
import type { LoanModule } from '../../helpers/loans';

/**
 * Shared loan widgets used by Nano / Payday / Personal / Public Sector.
 * Every widget is parameterised by module so the test-ID contract stays
 *     <module>.<screen>.<element>     e.g. personal.loan.hero.outstanding
 */

/** Borrow home with the per-tile constraint / status lines (extends the common BorrowHomeScreen). */
export class BorrowHubScreen extends BorrowHomeScreen {
  tileSubtitle(product: LoanModule) { return this.text(`borrow.home.tile.${product}.subtitle`); }
  tileStreakShown() { return this.exists('borrow.home.tile.nano.streak', 2_000); }
  tileConstraint(product: LoanModule) { return this.text(`borrow.home.tile.${product}.constraint`); }
  tileConstraintShown(product: LoanModule) { return this.exists(`borrow.home.tile.${product}.constraint`, 2_000); }
  tileActiveBadgeShown(product: LoanModule) { return this.exists(`borrow.home.tile.${product}.activeBadge`, 2_000); }
}

/** Landing screen elements common to all loan products (§3 of each spec). */
export class LoanLandingScreen extends BaseScreen {
  protected readonly root: string;
  constructor(protected readonly m: LoanModule) { super(); this.root = `${m}.landing.screen`; }
  header() { return this.text(`${this.m}.landing.header`); }
  valueProps() { return this.text(`${this.m}.landing.valueProps`); }
  requirements() { return this.text(`${this.m}.landing.requirements`); }
  apply() { return this.tap(`${this.m}.landing.apply`); }
  applyEnabled() { return this.isEnabled(`${this.m}.landing.apply`); }
  applyShown() { return this.exists(`${this.m}.landing.apply`, 2_000); }
  /** One-active / cross-loan / written-off / re-apply-wait message. */
  constraint() { return this.text(`${this.m}.landing.constraint`); }
  constraintShown() { return this.exists(`${this.m}.landing.constraint`, 2_000); }
  constraintContact() { return this.tap(`${this.m}.landing.constraint.contact`); }
  activeLoanShown() { return this.exists(`${this.m}.landing.activeLoan`); }
  activeLoan() {
    const p = `${this.m}.landing.activeLoan`;
    return {
      amount: () => this.amount(`${p}.amount`),
      outstanding: () => this.amount(`${p}.outstanding`),
      nextDate: () => this.text(`${p}.nextDate`),
      remaining: () => this.text(`${p}.remaining`),
      open: () => this.tap(p),
    };
  }
  activeLoanAction(action: 'repayNow' | 'viewSchedule' | 'repayEarly' | 'repayNext' | 'earlySettlement') {
    return this.tap(`${this.m}.landing.activeLoan.${action}`);
  }
}

/** Decline screen (Nano §4 6b, Payday §4 7b, Personal/PSL notifications) — reason from managed vocab + wait period. */
export class LoanDeclineScreen extends BaseScreen {
  protected readonly root: string;
  constructor(protected readonly m: LoanModule) { super(); this.root = `${m}.decline.screen`; }
  headline() { return this.text(`${this.m}.decline.headline`); }
  reason() { return this.text(`${this.m}.decline.reason`); }
  guidance() { return this.text(`${this.m}.decline.guidance`); }
  guidanceAction() { return this.tap(`${this.m}.decline.guidance.action`); }
  reapplyWait() { return this.text(`${this.m}.decline.reapplyWait`); }
  overrideActionExists() { return this.exists(`${this.m}.decline.appeal`, 1_000); }
  done() { return this.tap(`${this.m}.decline.done`); }
}

export type ReviewStepState = 'done' | 'active' | 'pending';

/** Under-review screen (Payday §4 7c, Personal §4 step 7, PSL §4 step 8) with progress steps. */
export class LoanUnderReviewScreen extends BaseScreen {
  protected readonly root: string;
  constructor(protected readonly m: LoanModule) { super(); this.root = `${m}.underReview.screen`; }
  message() { return this.text(`${this.m}.underReview.message`); }
  submittedAt() { return this.text(`${this.m}.underReview.submittedAt`); }
  expectedBy() { return this.text(`${this.m}.underReview.expectedBy`); }
  stepLabel(step: string) { return this.text(`${this.m}.underReview.step.${step}`); }
  stepShown(step: string) { return this.exists(`${this.m}.underReview.step.${step}`, 2_000); }
  async stepState(step: string): Promise<ReviewStepState> {
    return (await this.text(`${this.m}.underReview.step.${step}.state`)).toLowerCase() as ReviewStepState;
  }
  async stepOrder(): Promise<string[]> {
    const out: string[] = [];
    for (let i = 0; i < 6; i++) {
      if (!(await this.exists(`${this.m}.underReview.steps.${i}`, 500))) break;
      out.push(await this.text(`${this.m}.underReview.steps.${i}`));
    }
    return out;
  }
}

export type LoanAction =
  | 'repayNow' | 'repayEarly' | 'repayNext' | 'earlySettlement' | 'catchUp' | 'viewSchedule' | 'support' | 'contact'
  | 'outOfCycle' | 'requestRestructure' | 'changeSalaryAccount' | 'changeTenor' | 'changeRepaymentDay' | 'cancelMandate' | 'viewStreak';

/** On-loan view (§5 of each spec): header, hero, details, banner, actions. */
export class LoanOnLoanScreen extends BaseScreen {
  protected readonly root: string;
  constructor(protected readonly m: LoanModule) { super(); this.root = `${m}.loan.screen`; }
  reference() { return this.text(`${this.m}.loan.header.reference`); }
  countdown() { return this.text(`${this.m}.loan.header.countdown`); }
  stateLabel() { return this.text(`${this.m}.loan.state`); }
  outstanding() { return this.amount(`${this.m}.loan.hero.outstanding`); }
  totalToRepay() { return this.amount(`${this.m}.loan.hero.total`); }
  dueDate() { return this.text(`${this.m}.loan.hero.dueDate`); }
  nextAmount() { return this.amount(`${this.m}.loan.hero.nextAmount`); }
  nextDate() { return this.text(`${this.m}.loan.hero.nextDate`); }
  progress() { return this.text(`${this.m}.loan.hero.progress`); }
  detail(field: 'disbursedOn' | 'amount' | 'interest' | 'repaymentMethod' | 'tenor' | 'rate' | 'totalInterest' | 'monthly' | 'salaryAccount' | 'mandateProvider' | 'mandateStatus') {
    return this.text(`${this.m}.loan.details.${field}`);
  }
  detailAmount(field: 'amount' | 'interest' | 'totalInterest' | 'monthly') { return this.amount(`${this.m}.loan.details.${field}`); }
  schedulePreviewRow(i: number) {
    const p = `${this.m}.loan.schedulePreview.${i}`;
    return {
      shown: () => this.exists(p, 1_500),
      date: () => this.text(`${p}.date`),
      amount: () => this.amount(`${p}.amount`),
    };
  }
  banner() { return this.text(`${this.m}.loan.banner`); }
  bannerShown() { return this.exists(`${this.m}.loan.banner`, 2_000); }
  bannerKind() { return this.text(`${this.m}.loan.banner.kind`); }
  bannerCta() { return this.tap(`${this.m}.loan.banner.cta`); }
  action(a: LoanAction) { return this.tap(`${this.m}.loan.action.${a}`); }
  actionExists(a: LoanAction) { return this.exists(`${this.m}.loan.action.${a}`, 1_500); }
  actionEnabled(a: LoanAction) { return this.isEnabled(`${this.m}.loan.action.${a}`); }
  successMessage() { return this.text(`${this.m}.loan.success`); }
}

/** Full schedule / history / mandate status (§7 "View schedule"). */
export class LoanScheduleScreen extends BaseScreen {
  protected readonly root: string;
  constructor(protected readonly m: LoanModule) { super(); this.root = `${m}.schedule.screen`; }
  row(i: number) {
    const p = `${this.m}.schedule.row.${i}`;
    return {
      shown: () => this.exists(p, 1_500),
      date: () => this.text(`${p}.date`),
      instalment: () => this.amount(`${p}.amount`),
      interest: () => this.amount(`${p}.interest`),
      principal: () => this.amount(`${p}.principal`),
      balance: () => this.amount(`${p}.balance`),
      status: () => this.text(`${p}.status`),
    };
  }
  async rowCount(max = 60): Promise<number> {
    let n = 0;
    while (n < max && (await this.exists(`${this.m}.schedule.row.${n}`, 500))) n++;
    return n;
  }
  mandateStatus() { return this.text(`${this.m}.schedule.mandateStatus`); }
  nextDebitDate() { return this.text(`${this.m}.schedule.nextDebitDate`); }
  repaymentHistory(i: number) { return this.text(`${this.m}.schedule.history.${i}`); }
  supportNote() { return this.text(`${this.m}.schedule.supportNote`); }
}

/**
 * Repay-from-wallet flow (Nano "Repay now", Payday "Repay early", Personal "Repay next instalment" /
 * "Catch up", PSL "Out-of-cycle"). Amount defaults to the full figure; editable where allowed.
 */
export class RepayFromWalletScreen extends BaseScreen {
  protected readonly root: string;
  constructor(protected readonly m: LoanModule) { super(); this.root = `${m}.repay.screen`; }
  repayAmount() { return this.amount(`${this.m}.repay.amount`); }
  amountEditable() { return this.exists(`${this.m}.repay.amount.input`, 1_500); }
  enterAmount(v: number | string) { return this.type(`${this.m}.repay.amount.input`, v); }
  amountError() { return this.text(`${this.m}.repay.amount.input.error`); }
  source() { return this.text(`${this.m}.repay.source`); }
  note() { return this.text(`${this.m}.repay.note`); }
  confirm() { return this.tap(`${this.m}.repay.confirm`); }
  confirmEnabled() { return this.isEnabled(`${this.m}.repay.confirm`); }
  insufficientShown() { return this.exists(`${this.m}.repay.insufficient`); }
  fundWallet() { return this.tap(`${this.m}.repay.insufficient.fundWallet`); }
  successText() { return this.text(`${this.m}.repay.success.text`); }
  successDone() { return this.tap(`${this.m}.repay.success.done`); }
}

/** Early settlement (Personal §7, PSL §7): warning with breakdown → confirm source → success. */
export class EarlySettlementScreen extends BaseScreen {
  protected readonly root: string;
  constructor(protected readonly m: 'personal' | 'publicSector') { super(); this.root = `${m}.settlement.screen`; }
  total() { return this.amount(`${this.m}.settlement.amount`); }
  principal() { return this.amount(`${this.m}.settlement.breakdown.principal`); }
  accruedInterest() { return this.amount(`${this.m}.settlement.breakdown.accrued`); }
  fee() { return this.amount(`${this.m}.settlement.breakdown.fee`); }
  warning() { return this.text(`${this.m}.settlement.warning`); }
  continue() { return this.tap(`${this.m}.settlement.continue`); }
  chooseSource(s: 'wallet' | 'bankTransfer') { return this.tap(`${this.m}.settlement.source.${s}`); }
  sourceAvailable(s: 'wallet' | 'bankTransfer') { return this.exists(`${this.m}.settlement.source.${s}`, 1_500); }
  confirmNote() { return this.text(`${this.m}.settlement.confirm.note`); }
  confirmAmount() { return this.amount(`${this.m}.settlement.confirm.amount`); }
  confirm() { return this.tap(`${this.m}.settlement.confirm`); }
  bankTransfer() {
    const p = `${this.m}.settlement.bankTransfer`;
    return {
      accountNumber: () => this.text(`${p}.accountNumber`),
      bank: () => this.text(`${p}.bank`),
      reference: () => this.text(`${p}.reference`),
      amount: () => this.amount(`${p}.amount`),
      status: () => this.text(`${p}.status`),
    };
  }
  successText() { return this.text(`${this.m}.settlement.success.text`); }
}

/** Mandate authorisation step (Payday §4 step 4, Personal §4 step 5, PSL §4 step 6). */
export class MandateConsentScreen extends BaseScreen {
  protected readonly root: string;
  constructor(protected readonly m: LoanModule) { super(); this.root = `${m}.booking.mandate.screen`; }
  explanation() { return this.text(`${this.m}.booking.mandate.explanation`); }
  provider() { return this.text(`${this.m}.booking.mandate.provider`); }
  providerSelectorShown() { return this.exists(`${this.m}.booking.mandate.provider.select`, 1_000); }
  tickConsent() { return this.tap(`${this.m}.booking.mandate.consent`); }
  consentTicked() { return this.isChecked(`${this.m}.booking.mandate.consent`); }
  errorText() { return this.text(`${this.m}.booking.mandate.error`); }
  retry() { return this.tap(`${this.m}.booking.mandate.retry`); }
}

/** KYC gate shown when a loan step needs a tier upgrade / ID renewal (Personal §9, KYC Spec V4 §1). */
export class LoanKycGateScreen extends BaseScreen {
  protected readonly root = 'borrow.kycGate.screen';
  message() { return this.text('borrow.kycGate.message'); }
  upgrade() { return this.tap('borrow.kycGate.upgrade'); }
}

export type UploadState = 'default' | 'uploading' | 'uploaded' | 'error';

/**
 * Shared Upload State Card (KYC Spec V4 §4): Default/Picker → Uploading (progress) → Uploaded
 * (file metadata) → Error (with explicit Retry). `prefix` is the card's test ID, e.g.
 * personal.booking.docs.statement3m.
 *
 * ASSUMPTION: the native document picker lists files pushed to the device Downloads (Android) /
 * app Documents (iOS) folder by file name.
 */
export class DocUploadCard extends BaseScreen {
  protected readonly root: string;
  constructor(readonly prefix: string) { super(); this.root = prefix; }
  label() { return this.text(`${this.prefix}.label`); }
  acceptedFormats() { return this.text(`${this.prefix}.formats`); }
  guidance() { return this.text(`${this.prefix}.guidance`); }
  templateDownload() { return this.tap(`${this.prefix}.template`); }
  templateShown() { return this.exists(`${this.prefix}.template`, 1_500); }
  fileMeta() { return this.text(`${this.prefix}.fileMeta`); }
  errorText() { return this.text(`${this.prefix}.error`); }
  retry() { return this.tap(`${this.prefix}.retry`); }
  async state(): Promise<UploadState> {
    if (await this.exists(`${this.prefix}.error`, 300)) return 'error';
    if (await this.exists(`${this.prefix}.uploaded`, 300)) return 'uploaded';
    if (await this.exists(`${this.prefix}.progress`, 300)) return 'uploading';
    return 'default';
  }
  async waitForState(s: UploadState, timeout = 30_000): Promise<void> {
    await browser.waitUntil(async () => (await this.state()) === s, { timeout, timeoutMsg: `${this.prefix} never reached ${s}` });
  }
  async upload(relPath: string): Promise<void> {
    ensureTestFiles();
    const name = path.basename(relPath);
    const data = fs.readFileSync(abs(relPath)).toString('base64');
    const remote = driver.isAndroid
      ? `/sdcard/Download/${name}`
      : `@${process.env.APP_BUNDLE_ID ?? 'com.rosabon.unified'}:documents/${name}`;
    await driver.pushFile(remote, data);
    await this.tap(`${this.prefix}.picker`);
    const file = byText(name);
    await file.waitForDisplayed({ timeout: 15_000 });
    await file.click();
  }
}
