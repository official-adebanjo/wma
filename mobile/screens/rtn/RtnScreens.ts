import { BaseScreen } from '../BaseScreen';

/** RTN — RTN_Customer_App_Spec §3–§7, §9–§11. */

export type RtnAccountType = 'individual' | 'corporate';
export type RtnTiming = 'upfront' | 'maturity';
export type RtnSource = 'wallet' | 'bankTransfer';
export type RtnPayout = 'wallet' | 'bank';

export class RtnLandingScreen extends BaseScreen {
  protected readonly root = 'rtn.landing.screen';
  header() { return this.text('rtn.landing.header'); }
  valueProps() { return this.text('rtn.landing.valueProps'); }
  /** Rate matrix preview: cell for amount band index × tenor in days. */
  matrixShown() { return this.exists('rtn.landing.matrix'); }
  matrixCell(band: number, tenorDays: number) { return this.text(`rtn.landing.matrix.${band}.${tenorDays}`); }
  corporateNote() { return this.text('rtn.landing.corporateNote'); }
  corporateNoteShown() { return this.exists('rtn.landing.corporateNote', 1_500); }
  startPlacement() { return this.tap('rtn.landing.startPlacement'); }
  startAnother() { return this.tap('rtn.landing.startAnother'); }
  placementCardShown(i = 0) { return this.exists(`rtn.landing.placement.${i}`, 2_000); }
  placementCard(i = 0) {
    const p = `rtn.landing.placement.${i}`;
    return {
      id: () => this.text(`${p}.id`),
      amount: () => this.amount(`${p}.amount`),
      tenor: () => this.text(`${p}.tenor`),
      rate: () => this.text(`${p}.rate`),
      maturityDate: () => this.text(`${p}.maturityDate`),
      timing: () => this.text(`${p}.timing`),
      status: () => this.text(`${p}.status`),
    };
  }
  openPlacement(i = 0) { return this.tap(`rtn.landing.placement.${i}`); }
  kycUpgradePromptShown() { return this.exists('kyc.upgrade.prompt'); }
  kycUpgradePromptText() { return this.text('kyc.upgrade.prompt.message'); }
}

export class RtnBookingScreen extends BaseScreen {
  protected readonly root = 'rtn.booking.screen';
  // Step 1 — account type
  accountTypeStepShown() { return this.exists('rtn.booking.accountType', 2_000); }
  accountType(t: RtnAccountType) { return this.tap(`rtn.booking.accountType.${t}`); }
  accountTypeError() { return this.text('rtn.booking.accountType.error'); }
  corporateDocsBlockShown() { return this.exists('rtn.booking.accountType.corporateDocs', 2_000); }
  corporateDocsBlockText() { return this.text('rtn.booking.accountType.corporateDocs'); }
  uploadCorporateDocs() { return this.tap('rtn.booking.accountType.corporateDocs.upload'); }
  // Step 2 — amount
  enterAmount(v: number | string) { return this.type('rtn.booking.amount.input', v); }
  amountValue() { return this.amount('rtn.booking.amount.input'); }
  tapAmountChip(amount: number) { return this.tap(`rtn.booking.amount.chip.${amount}`); }
  amountChipShown(amount: number) { return this.exists(`rtn.booking.amount.chip.${amount}`, 1_500); }
  amountError() { return this.text('rtn.booking.amount.input.error'); }
  matrixBandHighlighted(band: number) { return this.exists(`rtn.booking.amount.matrix.${band}.highlighted`, 1_500); }
  matrixCell(band: number, tenorDays: number) { return this.text(`rtn.booking.amount.matrix.${band}.${tenorDays}`); }
  // Step 3 — tenor
  tenorCard(days: number) {
    const p = `rtn.booking.tenor.card.${days}`;
    return {
      shown: () => this.exists(p, 2_000),
      length: () => this.text(`${p}.length`),
      rate: () => this.text(`${p}.rate`),
      projectedTotal: () => this.amount(`${p}.projectedTotal`),
      select: () => this.tap(p),
      selected: () => this.isChecked(p),
    };
  }
  // Step 4 — interest timing
  timing(t: RtnTiming) { return this.tap(`rtn.booking.timing.${t}`); }
  timingExplanation() { return this.text('rtn.booking.timing.explanation'); }
  whtNote() { return this.text('rtn.booking.timing.whtNote'); }
  // Step 5 — source of funds
  source(s: RtnSource) { return this.tap(`rtn.booking.source.${s}`); }
  sourceSelected(s: RtnSource) { return this.isChecked(`rtn.booking.source.${s}`); }
  sourceExplanation() { return this.text('rtn.booking.source.explanation'); }
  // Step 6 — payout destination
  payout(d: RtnPayout) { return this.tap(`rtn.booking.payout.${d}`); }
  payoutSelected(d: RtnPayout) { return this.isChecked(`rtn.booking.payout.${d}`); }
  payoutOptionShown(d: RtnPayout) { return this.exists(`rtn.booking.payout.${d}`, 1_500); }
  // Step 7 — review
  reviewValue(field: 'accountType' | 'amount' | 'tenor' | 'rate' | 'timing' | 'source' | 'payout' | 'maturityDate') {
    return this.text(`rtn.booking.review.${field}`);
  }
  reviewAmount(field: 'amount' | 'grossInterest' | 'wht' | 'netInterest') { return this.amount(`rtn.booking.review.${field}`); }
  rateLockNotice() { return this.text('rtn.booking.review.rateLock'); }
  rateChangedShown() { return this.exists('rtn.booking.review.rateChanged', 2_000); }
  rateChangedMessage() { return this.text('rtn.booking.review.rateChanged'); }
  createPlacement() { return this.tap('rtn.booking.review.create'); }
  // Navigation
  continue() { return this.tap('rtn.booking.continue'); }
  continueEnabled() { return this.isEnabled('rtn.booking.continue'); }
  // Step 8a — wallet funding
  insufficientFundsShown() { return this.exists('rtn.booking.funding.insufficient'); }
  insufficientFundsText() { return this.text('rtn.booking.funding.insufficient'); }
  tapFundWallet() { return this.tap('rtn.booking.funding.fundWallet'); }
  // Step 8b — bank transfer instructions
  transfer() {
    const p = 'rtn.booking.transfer';
    return {
      shown: () => this.exists(p, 5_000),
      bankName: () => this.text(`${p}.bankName`),
      accountNumber: () => this.text(`${p}.accountNumber`),
      accountName: () => this.text(`${p}.accountName`),
      reference: () => this.text(`${p}.reference`),
      amount: () => this.amount(`${p}.amount`),
      countdown: () => this.text(`${p}.countdown`),
      copy: (field: 'accountNumber' | 'reference') => this.tap(`${p}.${field}.copy`),
      done: () => this.tap(`${p}.done`),
    };
  }
  // Step 9 — success
  successHeadline() { return this.text('rtn.booking.success.headline'); }
  successCountdown() { return this.text('rtn.booking.success.countdown'); }
  successUpfrontPaidShown() { return this.exists('rtn.booking.success.upfrontPaid', 2_000); }
  successUpfrontPaid() { return this.amount('rtn.booking.success.upfrontPaid'); }
  successPlacementId() { return this.text('rtn.booking.success.placementId'); }
  successViewPlacement() { return this.tap('rtn.booking.success.viewPlacement'); }
}

export class RtnPlacementScreen extends BaseScreen {
  protected readonly root = 'rtn.placement.screen';
  // Header
  placementId() { return this.text('rtn.placement.header.id'); }
  countdown() { return this.text('rtn.placement.header.countdown'); }
  // Hero
  placedAmount() { return this.amount('rtn.placement.hero.amount'); }
  rate() { return this.text('rtn.placement.hero.rate'); }
  maturityDate() { return this.text('rtn.placement.hero.maturityDate'); }
  netInterest() { return this.amount('rtn.placement.hero.netInterest'); }
  // Details
  detail(field: 'bookingDate' | 'tenor' | 'timing' | 'upfrontPaid' | 'source' | 'payout' | 'autoRollover') {
    return this.text(`rtn.placement.details.${field}`);
  }
  upfrontPaidAmount() { return this.amount('rtn.placement.details.upfrontPaid.amount'); }
  upfrontPaidShown() { return this.exists('rtn.placement.details.upfrontPaid', 1_500); }
  // Actions
  rollover() { return this.tap('rtn.placement.action.rollover'); }
  rolloverEnabled() { return this.isEnabled('rtn.placement.action.rollover'); }
  forceLiquidate() { return this.tap('rtn.placement.action.forceLiquidate'); }
  forceLiquidateEnabled() { return this.isEnabled('rtn.placement.action.forceLiquidate'); }
  toggleAutoRollover() { return this.tap('rtn.placement.action.autoRollover'); }
  autoRolloverOn() { return this.isChecked('rtn.placement.action.autoRollover'); }
  autoRolloverEnabled() { return this.isEnabled('rtn.placement.action.autoRollover'); }
  topUpShown() { return this.exists('rtn.placement.action.topUp', 1_500); }
  disabledActionTooltip(action: 'rollover' | 'forceLiquidate' | 'autoRollover') {
    return this.tap(`rtn.placement.action.${action}.info`).then(() => this.text('common.tooltip'));
  }
  // State + banners
  stateLabel() { return this.text('rtn.placement.state'); }
  banner() { return this.text('rtn.placement.banner'); }
  bannerShown() { return this.exists('rtn.placement.banner', 2_000); }
  linkedPlacementId() { return this.text('rtn.placement.linked.id'); }
  // Underfunded — transfer instructions shown on the placement itself
  transfer() {
    const p = 'rtn.placement.transfer';
    return {
      bankName: () => this.text(`${p}.bankName`),
      accountNumber: () => this.text(`${p}.accountNumber`),
      accountName: () => this.text(`${p}.accountName`),
      reference: () => this.text(`${p}.reference`),
      countdown: () => this.text(`${p}.countdown`),
      received: () => this.text(`${p}.received`),
    };
  }
  /** IDs that must NOT exist — RTN §11 "cannot do". */
  forbiddenControlShown(id: 'editRate' | 'editTenor' | 'editTiming' | 'editPayout' | 'waivePenalty' | 'waiveExpiry') {
    return this.exists(`rtn.placement.action.${id}`, 1_000);
  }
}

export class RtnForceLiquidateScreen extends BaseScreen {
  protected readonly root = 'rtn.liquidate.screen';
  // Screen 1 — warning + penalty preview
  warningText() { return this.text('rtn.liquidate.warning.text'); }
  penaltyPreview() { return this.amount('rtn.liquidate.warning.penalty'); }
  upfrontRecoveryPreview() { return this.amount('rtn.liquidate.warning.upfrontRecovery'); }
  sameDayWarningShown() { return this.exists('rtn.liquidate.warning.maturityToday', 2_000); }
  sameDayWarning() { return this.text('rtn.liquidate.warning.maturityToday'); }
  primaryCtaText() { return this.text('rtn.liquidate.warning.cta.primary'); }
  secondaryCtaText() { return this.text('rtn.liquidate.warning.cta.secondary'); }
  keepPlacement() { return this.tap('rtn.liquidate.warning.keep'); }
  continue() { return this.tap('rtn.liquidate.warning.continue'); }
  // Screen 2 — confirm: amount + accrued − penalty − WHT = net
  line(l: 'principal' | 'accrued' | 'penalty' | 'upfrontRecovery' | 'wht' | 'net') { return this.amount(`rtn.liquidate.confirm.${l}`); }
  lineShown(l: 'upfrontRecovery') { return this.exists(`rtn.liquidate.confirm.${l}`, 1_500); }
  confirm() { return this.tap('rtn.liquidate.confirm.submit'); }
  // Screen 3 — success
  successText() { return this.text('rtn.liquidate.success.text'); }
  successAmount() { return this.amount('rtn.liquidate.success.amount'); }
}

export class RtnRolloverScreen extends BaseScreen {
  protected readonly root = 'rtn.rollover.screen';
  rolloverAmount() { return this.amount('rtn.rollover.amount.input'); }
  enterAmount(v: number) { return this.type('rtn.rollover.amount.input', v); }
  tenor(days: number) { return this.tap(`rtn.rollover.tenor.${days}`); }
  tenorSelected(days: number) { return this.isChecked(`rtn.rollover.tenor.${days}`); }
  rate() { return this.text('rtn.rollover.rate'); }
  netInterest() { return this.amount('rtn.rollover.netInterest'); }
  confirm() { return this.tap('rtn.rollover.confirm'); }
  successText() { return this.text('rtn.rollover.success.text'); }
  successNewId() { return this.text('rtn.rollover.success.newId'); }
}

/** Corporate documentation upload — target of RTN Step 1 routing for unverified corporates. */
export class CorporateDocsScreen extends BaseScreen {
  protected readonly root = 'kyc.corporateDocs.screen';
  checklistItem(i: number) { return this.text(`kyc.corporateDocs.item.${i}`); }
}
