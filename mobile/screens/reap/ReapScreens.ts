import { BaseScreen, browser } from '../BaseScreen';

/** REAP — REAP_Customer_App_Spec §3–§8, §10–§12. */

export type ReapFrequency = 'daily' | 'weekly' | 'monthly' | 'onDemand';

export class ReapLandingScreen extends BaseScreen {
  protected readonly root = 'reap.landing.screen';
  header() { return this.text('reap.landing.header'); }
  valueProps() { return this.text('reap.landing.valueProps'); }
  startPlan() { return this.tap('reap.landing.startPlan'); }
  startAnother() { return this.tap('reap.landing.startAnother'); }
  startAnotherShown() { return this.exists('reap.landing.startAnother', 1_500); }
  planCapMessage() { return this.text('reap.landing.planCap.message'); }
  expandHowItWorks() { return this.tap('reap.landing.howItWorks'); }
  howItWorksText() { return this.text('reap.landing.howItWorks.body'); }
  rateTableRate(tenorMonths: number) { return this.text(`reap.landing.rates.${tenorMonths}`); }
  faqShown() { return this.exists('reap.landing.faq'); }
  planCardShown(i = 0) { return this.exists(`reap.landing.plan.${i}`); }
  planCard(i = 0) {
    const p = `reap.landing.plan.${i}`;
    return {
      name: () => this.text(`${p}.name`),
      target: () => this.amount(`${p}.target`),
      balance: () => this.amount(`${p}.balance`),
      progress: () => this.text(`${p}.progress`),
      timeRemaining: () => this.text(`${p}.timeRemaining`),
    };
  }
  openPlan(i = 0) { return this.tap(`reap.landing.plan.${i}`); }
  /** Tier gate (Calc §2: investment booking requires KYC Tier 2). */
  kycUpgradePromptShown() { return this.exists('kyc.upgrade.prompt'); }
  kycUpgradePromptText() { return this.text('kyc.upgrade.prompt.message'); }
}

export class ReapBookingScreen extends BaseScreen {
  protected readonly root = 'reap.booking.screen';
  // Step 1 — name
  enterName(v: string) { return this.type('reap.booking.name.input', v); }
  nameValue() { return this.el('reap.booking.name.input').getText(); }
  namePlaceholder() { return this.el('reap.booking.name.input').getAttribute(driverPlaceholderAttr()); }
  // Step 2 — target
  enterTarget(v: number | string) { return this.type('reap.booking.target.input', v); }
  targetValue() { return this.amount('reap.booking.target.input'); }
  tapTargetChip(amount: number) { return this.tap(`reap.booking.target.chip.${amount}`); }
  targetChipShown(amount: number) { return this.exists(`reap.booking.target.chip.${amount}`, 1_500); }
  targetError() { return this.text('reap.booking.target.input.error'); }
  // Step 3 — tenor
  tenorCard(months: number) {
    const p = `reap.booking.tenor.card.${months}`;
    return {
      shown: () => this.exists(p, 2_000),
      length: () => this.text(`${p}.length`),
      rate: () => this.text(`${p}.rate`),
      projectedTotal: () => this.amount(`${p}.projectedTotal`),
      select: () => this.tap(p),
      selected: () => this.isChecked(p),
    };
  }
  // Step 4 — contribution rhythm
  frequency(f: ReapFrequency) { return this.tap(`reap.booking.rhythm.frequency.${f}`); }
  enterContribution(v: number | string) { return this.type('reap.booking.rhythm.amount.input', v); }
  contributionInputShown() { return this.exists('reap.booking.rhythm.amount.input', 1_500); }
  contributionError() { return this.text('reap.booking.rhythm.amount.input.error'); }
  autosaveShown() { return this.exists('reap.booking.rhythm.autosave.toggle', 1_500); }
  autosaveOn() { return this.isChecked('reap.booking.rhythm.autosave.toggle'); }
  toggleAutosave() { return this.tap('reap.booking.rhythm.autosave.toggle'); }
  onDemandWarning() { return this.text('reap.booking.rhythm.onDemand.warning'); }
  paceText() { return this.text('reap.booking.rhythm.pace'); }
  paceMonths() { return this.text('reap.booking.rhythm.pace.months'); }
  // Step 5 — payout
  payoutDestinationText() { return this.text('reap.booking.payout.text'); }
  payoutIsSelector() { return this.exists('reap.booking.payout.selector', 1_000); }
  // Step 6 — review
  reviewValue(field: 'name' | 'target' | 'tenor' | 'rate' | 'frequency' | 'contribution' | 'autosave' | 'maturityDate' | 'projectedInterest') {
    return this.text(`reap.booking.review.${field}`);
  }
  reviewAmount(field: 'target' | 'contribution' | 'projectedInterest') { return this.amount(`reap.booking.review.${field}`); }
  forfeitureReminder() { return this.text('reap.booking.review.forfeitureReminder'); }
  edit(field: 'name' | 'target' | 'tenor' | 'rhythm') { return this.tap(`reap.booking.review.edit.${field}`); }
  createPlan() { return this.tap('reap.booking.review.create'); }
  // Navigation
  continue() { return this.tap('reap.booking.continue'); }
  continueEnabled() { return this.isEnabled('reap.booking.continue'); }
  currentStep() { return this.text('reap.booking.step'); }
  // Step 7 — funding
  insufficientFundsShown() { return this.exists('reap.booking.funding.insufficient'); }
  insufficientFundsText() { return this.text('reap.booking.funding.insufficient'); }
  tapFundWallet() { return this.tap('reap.booking.funding.fundWallet'); }
  // Step 8 — success
  successHeadline() { return this.text('reap.booking.success.headline'); }
  successStat(stat: 'target' | 'current' | 'schedule' | 'maturityDate') { return this.text(`reap.booking.success.${stat}`); }
  successViewPlan() { return this.tap('reap.booking.success.viewPlan'); }
  successStartAnother() { return this.tap('reap.booking.success.startAnother'); }
}

export class ReapPlanScreen extends BaseScreen {
  protected readonly root = 'reap.plan.screen';
  // Header
  name() { return this.text('reap.plan.header.name'); }
  tenorProgress() { return this.text('reap.plan.header.tenorProgress'); }
  maturityDateHeader() { return this.text('reap.plan.header.maturityDate'); }
  // Hero
  heroText() { return this.text('reap.plan.hero'); }
  balance() { return this.amount('reap.plan.hero.balance'); }
  target() { return this.amount('reap.plan.hero.target'); }
  progressPct() { return this.text('reap.plan.hero.progressPct'); }
  // Projection
  paceStatus() { return this.text('reap.plan.pace.status'); }
  paceSub() { return this.text('reap.plan.pace.sub'); }
  paceSubShown() { return this.exists('reap.plan.pace.sub', 1_500); }
  // Details grid
  detail(field: 'accrued' | 'rate' | 'frequency' | 'autosave' | 'amount' | 'nextContribution' | 'maturityDate' | 'daysRemaining') {
    return this.text(`reap.plan.details.${field}`);
  }
  accruedInterest() { return this.amount('reap.plan.details.accrued'); }
  contributionAmount() { return this.amount('reap.plan.details.amount'); }
  autosaveToggleOn() { return this.isChecked('reap.plan.details.autosave.toggle'); }
  toggleAutosave() { return this.tap('reap.plan.details.autosave.toggle'); }
  // Actions
  addContribution() { return this.tap('reap.plan.action.addContribution'); }
  addContributionEnabled() { return this.isEnabled('reap.plan.action.addContribution'); }
  adjustPlan() { return this.tap('reap.plan.action.adjust'); }
  adjustEnabled() { return this.isEnabled('reap.plan.action.adjust'); }
  requestBreak() { return this.tap('reap.plan.action.break'); }
  breakEnabled() { return this.isEnabled('reap.plan.action.break'); }
  breakActionExists() { return this.exists('reap.plan.action.break', 1_000); }
  disabledActionTooltip(action: 'addContribution' | 'adjust' | 'break') {
    return this.tap(`reap.plan.action.${action}.info`).then(() => this.text('common.tooltip'));
  }
  // Recent activity
  activityShown(i: number) { return this.exists(`reap.plan.activity.${i}`, 1_500); }
  activity(i: number) {
    const p = `reap.plan.activity.${i}`;
    return {
      date: () => this.text(`${p}.date`),
      amount: () => this.amount(`${p}.amount`),
      runningBalance: () => this.amount(`${p}.runningBalance`),
    };
  }
  viewSchedule() { return this.tap('reap.plan.viewSchedule'); }
  // State banners
  banner() { return this.text('reap.plan.banner'); }
  bannerShown() { return this.exists('reap.plan.banner', 2_000); }
  bannerFundWallet() { return this.tap('reap.plan.banner.fundWallet'); }
  countdown() { return this.text('reap.plan.countdown'); }
  stateLabel() { return this.text('reap.plan.state'); }
  // Matured / missed / broken outcome
  outcomeHeadline() { return this.text('reap.plan.outcome.headline'); }
  outcomeBody() { return this.text('reap.plan.outcome.body'); }
  outcomeLine(line: 'principal' | 'grossInterest' | 'wht' | 'netInterest' | 'interestForfeited' | 'payout') {
    return this.amount(`reap.plan.outcome.${line}`);
  }
  outcomeWithdrawToWallet() { return this.tap('reap.plan.outcome.withdraw'); }
  outcomeSuggestion() { return this.text('reap.plan.outcome.suggestion'); }
  /** IDs that must NOT exist — REAP §12 "cannot do". */
  forbiddenControlShown(id: 'editTarget' | 'editTenor' | 'editName' | 'payoutSelector' | 'waiveForfeiture' | 'unlock' | 'selfBreak') {
    return this.exists(`reap.plan.action.${id}`, 1_000);
  }
}

export class ReapAddContributionScreen extends BaseScreen {
  protected readonly root = 'reap.contribute.screen';
  enterAmount(v: number | string) { return this.type('reap.contribute.amount.input', v); }
  amountValue() { return this.amount('reap.contribute.amount.input'); }
  amountError() { return this.text('reap.contribute.amount.input.error'); }
  fundWallet() { return this.tap('reap.contribute.amount.input.error.fundWallet'); }
  exceedTargetWarning() { return this.text('reap.contribute.exceedTarget.warning'); }
  exceedTargetWarningShown() { return this.exists('reap.contribute.exceedTarget.warning', 2_000); }
  continue() { return this.tap('reap.contribute.continue'); }
  continueEnabled() { return this.isEnabled('reap.contribute.continue'); }
  confirmAmount() { return this.amount('reap.contribute.confirm.amount'); }
  confirmProjection() { return this.text('reap.contribute.confirm.projection'); }
  confirmRemaining() { return this.amount('reap.contribute.confirm.remaining'); }
  confirm() { return this.tap('reap.contribute.confirm.submit'); }
  successText() { return this.text('reap.contribute.success.text'); }
  successBalance() { return this.amount('reap.contribute.success.balance'); }
  done() { return this.tap('reap.contribute.success.done'); }
}

export class ReapAdjustScreen extends BaseScreen {
  protected readonly root = 'reap.adjust.screen';
  frequency(f: ReapFrequency) { return this.tap(`reap.adjust.frequency.${f}`); }
  enterAmount(v: number) { return this.type('reap.adjust.amount.input', v); }
  autosaveOn() { return this.isChecked('reap.adjust.autosave.toggle'); }
  toggleAutosave() { return this.tap('reap.adjust.autosave.toggle'); }
  projection() { return this.text('reap.adjust.projection'); }
  shortfallWarning() { return this.text('reap.adjust.shortfall.warning'); }
  shortfallWarningShown() { return this.exists('reap.adjust.shortfall.warning', 2_000); }
  /** Tenor and target are immutable after creation (REAP §7, §12) — these inputs must not exist or be editable. */
  tenorEditable() { return this.exists('reap.adjust.tenor.input', 1_000); }
  targetEditable() { return this.exists('reap.adjust.target.input', 1_000); }
  save() { return this.tap('reap.adjust.save'); }
  saveEnabled() { return this.isEnabled('reap.adjust.save'); }
}

export type BreakReason = 'emergency' | 'changeOfPlans' | 'financialDifficulty' | 'other';

export class ReapBreakScreen extends BaseScreen {
  protected readonly root = 'reap.break.screen';
  // Step 1 — warning
  warningText() { return this.text('reap.break.warning.text'); }
  maturityDayWarningShown() { return this.exists('reap.break.warning.maturityToday', 2_000); }
  maturityDayWarning() { return this.text('reap.break.warning.maturityToday'); }
  keepSaving() { return this.tap('reap.break.warning.keepSaving'); }
  continueWithBreak() { return this.tap('reap.break.warning.continue'); }
  /** Label of whichever CTA occupies the primary (prominent) slot — must be "Keep saving" (REAP §8 step 1). */
  primaryCtaText() { return this.text('reap.break.warning.cta.primary'); }
  secondaryCtaText() { return this.text('reap.break.warning.cta.secondary'); }
  // Step 2 — reason
  reason(r: BreakReason) { return this.tap(`reap.break.reason.option.${r}`); }
  enterReasonNote(v: string) { return this.type('reap.break.reason.note.input', v); }
  reasonNoteError() { return this.text('reap.break.reason.note.input.error'); }
  // Step 3 — summary
  summaryPlanName() { return this.text('reap.break.summary.planName'); }
  summaryLine(line: 'principal' | 'interestForfeited' | 'net') { return this.amount(`reap.break.summary.${line}`); }
  acknowledged() { return this.isChecked('reap.break.summary.ack'); }
  tickAck() { return this.tap('reap.break.summary.ack'); }
  submit() { return this.tap('reap.break.summary.submit'); }
  submitEnabled() { return this.isEnabled('reap.break.summary.submit'); }
  // Step 4 — submitted
  submittedText() { return this.text('reap.break.submitted.text'); }
  backToPlan() { return this.tap('reap.break.submitted.backToPlan'); }
  // Navigation
  continue() { return this.tap('reap.break.continue'); }
  continueEnabled() { return this.isEnabled('reap.break.continue'); }
}

export class ReapScheduleScreen extends BaseScreen {
  protected readonly root = 'reap.schedule.screen';
  pastShown(i: number) { return this.exists(`reap.schedule.past.${i}`, 1_500); }
  past(i: number) {
    const p = `reap.schedule.past.${i}`;
    return { date: () => this.text(`${p}.date`), amount: () => this.amount(`${p}.amount`), runningBalance: () => this.amount(`${p}.runningBalance`) };
  }
  projectedShown(i: number) { return this.exists(`reap.schedule.projected.${i}`, 1_500); }
  projected(i: number) {
    const p = `reap.schedule.projected.${i}`;
    return { date: () => this.text(`${p}.date`), amount: () => this.amount(`${p}.amount`) };
  }
  maturityDate() { return this.text('reap.schedule.maturityDate'); }
  projectedTotal() { return this.amount('reap.schedule.projectedTotal'); }
}

/** Attribute that carries a TextInput placeholder on each platform. */
function driverPlaceholderAttr(): string {
  return browser.isAndroid ? 'hint' : 'placeholderValue';
}

