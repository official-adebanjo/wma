import { BaseScreen } from '../BaseScreen';

/** RWIN 2.0 — RWIN_2_0_Customer_App_Spec §3–§7. */

export class RwinLandingScreen extends BaseScreen {
  protected readonly root = 'rwin.landing.screen';
  rateHero() { return this.text('rwin.landing.rateHero'); }
  valueProps() { return this.text('rwin.landing.valueProps'); }
  startPlan() { return this.tap('rwin.landing.startPlan'); }
  startAnother() { return this.tap('rwin.landing.startAnother'); }
  expandHowItWorks() { return this.tap('rwin.landing.howItWorks'); }
  howItWorksText() { return this.text('rwin.landing.howItWorks.body'); }
  faqShown() { return this.exists('rwin.landing.faq'); }
  planCardShown(i = 0) { return this.exists(`rwin.landing.plan.${i}`); }
  planCardBalance(i = 0) { return this.amount(`rwin.landing.plan.${i}.balance`); }
  planCardCycleEnd(i = 0) { return this.text(`rwin.landing.plan.${i}.cycleEnd`); }
  planCardRollover(i = 0) { return this.text(`rwin.landing.plan.${i}.rollover`); }
  openPlan(i = 0) { return this.tap(`rwin.landing.plan.${i}`); }
}

export class RwinBookingScreen extends BaseScreen {
  protected readonly root = 'rwin.booking.screen';
  // Step 1
  enterName(v: string) { return this.type('rwin.booking.name.input', v); }
  nameValue() { return this.el('rwin.booking.name.input').getText(); }
  // Step 2
  enterDeposit(v: number | string) { return this.type('rwin.booking.deposit.input', v); }
  tapChip(amount: number) { return this.tap(`rwin.booking.deposit.chip.${amount}`); }
  projectionText() { return this.text('rwin.booking.deposit.projection'); }
  projectionAmount() { return this.amount('rwin.booking.deposit.projection.amount'); }
  depositError() { return this.text('rwin.booking.deposit.input.error'); }
  // Step 3
  rolloverOn() { return this.isChecked('rwin.booking.rollover.toggle'); }
  toggleRollover() { return this.tap('rwin.booking.rollover.toggle'); }
  rolloverExplanation() { return this.text('rwin.booking.rollover.explanation'); }
  // Step 4
  autosaveOn() { return this.isChecked('rwin.booking.autosave.toggle'); }
  toggleAutosave() { return this.tap('rwin.booking.autosave.toggle'); }
  autosaveFrequency(f: 'daily' | 'weekly' | 'monthly') { return this.tap(`rwin.booking.autosave.frequency.${f}`); }
  autosaveAmount(v: number) { return this.type('rwin.booking.autosave.amount.input', v); }
  autosaveStartDate(iso: string) { return this.type('rwin.booking.autosave.startDate.input', iso); }
  // Step 5
  payoutDestinationText() { return this.text('rwin.booking.payout.text'); }
  payoutIsSelector() { return this.exists('rwin.booking.payout.selector', 1_000); }
  // Step 6
  holdingCallout() { return this.text('rwin.booking.holding.callout'); }
  tickHoldingAck() { return this.tap('rwin.booking.holding.ack'); }
  // Step 7
  reviewValue(field: 'name' | 'deposit' | 'rollover' | 'autosave' | 'rate' | 'cycleEnd' | 'projectedInterest' | 'payout') {
    return this.text(`rwin.booking.review.${field}`);
  }
  reviewAmount(field: 'deposit' | 'projectedInterest') { return this.amount(`rwin.booking.review.${field}`); }
  createPlan() { return this.tap('rwin.booking.review.create'); }
  // Navigation
  continue() { return this.tap('rwin.booking.continue'); }
  continueEnabled() { return this.isEnabled('rwin.booking.continue'); }
  // Step 8/9
  insufficientFundsShown() { return this.exists('rwin.booking.funding.insufficient'); }
  tapFundWallet() { return this.tap('rwin.booking.funding.fundWallet'); }
  successHeadline() { return this.text('rwin.booking.success.headline'); }
  successViewPlan() { return this.tap('rwin.booking.success.viewPlan'); }
  successStartAnother() { return this.tap('rwin.booking.success.startAnother'); }
}

export class RwinPlanScreen extends BaseScreen {
  protected readonly root = 'rwin.plan.screen';
  name() { return this.text('rwin.plan.header.name'); }
  countdown() { return this.text('rwin.plan.header.countdown'); }
  rolloverIndicator() { return this.text('rwin.plan.header.rollover'); }
  totalBalance() { return this.amount('rwin.plan.hero.balance'); }
  heroRate() { return this.text('rwin.plan.hero.rate'); }
  accruedInterest() { return this.amount('rwin.plan.hero.accrued'); }
  trancheCount() { return this.text('rwin.plan.tranches.count'); }
  tranche(i: number) {
    const p = `rwin.plan.tranche.${i}`;
    return {
      date: () => this.text(`${p}.date`),
      amount: () => this.amount(`${p}.amount`),
      rate: () => this.text(`${p}.rate`),
      cycleEnd: () => this.text(`${p}.cycleEnd`),
      accrued: () => this.amount(`${p}.accrued`),
      lockedChip: () => this.exists(`${p}.locked`, 1_500),
    };
  }
  currentRateForNew() { return this.text('rwin.plan.details.currentRate'); }
  autosaveState() { return this.text('rwin.plan.details.autosave'); }
  topUp() { return this.tap('rwin.plan.action.topUp'); }
  withdraw() { return this.tap('rwin.plan.action.withdraw'); }
  withdrawEnabled() { return this.isEnabled('rwin.plan.action.withdraw'); }
  withdrawTooltip() { return this.tap('rwin.plan.action.withdraw.info').then(() => this.text('common.tooltip')); }
  toggleRollover() { return this.tap('rwin.plan.action.rolloverToggle'); }
  rolloverToggleOn() { return this.isChecked('rwin.plan.action.rolloverToggle'); }
  adjustPlan() { return this.tap('rwin.plan.action.adjust'); }
  recentActivity(i: number) { return this.text(`rwin.plan.activity.${i}`); }
  banner() { return this.text('rwin.plan.banner'); }
  bannerShown() { return this.exists('rwin.plan.banner', 2_000); }
  stateLabel() { return this.text('rwin.plan.state'); }
  breakActionExists() { return this.exists('rwin.plan.action.break', 1_000); }
}

export class RwinTopUpScreen extends BaseScreen {
  protected readonly root = 'rwin.topup.screen';
  enterAmount(v: number) { return this.type('rwin.topup.amount.input', v); }
  amountError() { return this.text('rwin.topup.amount.input.error'); }
  continue() { return this.tap('rwin.topup.continue'); }
  confirmAmount() { return this.amount('rwin.topup.confirm.amount'); }
  confirmRate() { return this.text('rwin.topup.confirm.rate'); }
  confirmCycleEnd() { return this.text('rwin.topup.confirm.cycleEnd'); }
  confirmProjected() { return this.amount('rwin.topup.confirm.projected'); }
  confirm() { return this.tap('rwin.topup.confirm.submit'); }
  successText() { return this.text('rwin.topup.success.text'); }
  successPlanTotal() { return this.amount('rwin.topup.success.planTotal'); }
}

export class RwinWithdrawScreen extends BaseScreen {
  protected readonly root = 'rwin.withdraw.screen';
  withdrawAll() { return this.tap('rwin.withdraw.all'); }
  enterAmount(v: number) { return this.type('rwin.withdraw.amount.input', v); }
  maxWithdrawable() { return this.amount('rwin.withdraw.maxWithdrawable'); }
  remainingAfter() { return this.amount('rwin.withdraw.remaining'); }
  amountError() { return this.text('rwin.withdraw.amount.input.error'); }
  continue() { return this.tap('rwin.withdraw.continue'); }
  summary() {
    return {
      gross: () => this.amount('rwin.withdraw.summary.gross'),
      interest: () => this.amount('rwin.withdraw.summary.interest'),
      wht: () => this.amount('rwin.withdraw.summary.wht'),
      net: () => this.amount('rwin.withdraw.summary.net'),
    };
  }
  confirm() { return this.tap('rwin.withdraw.confirm'); }
  successText() { return this.text('rwin.withdraw.success.text'); }
}

export class RwinAdjustScreen extends BaseScreen {
  protected readonly root = 'rwin.adjust.screen';
  autosaveOn() { return this.isChecked('rwin.adjust.autosave.toggle'); }
  toggleAutosave() { return this.tap('rwin.adjust.autosave.toggle'); }
  frequency(f: 'daily' | 'weekly' | 'monthly') { return this.tap(`rwin.adjust.autosave.frequency.${f}`); }
  autosaveAmount(v: number) { return this.type('rwin.adjust.autosave.amount.input', v); }
  startDate(iso: string) { return this.type('rwin.adjust.autosave.startDate.input', iso); }
  save() { return this.tap('rwin.adjust.save'); }
}
