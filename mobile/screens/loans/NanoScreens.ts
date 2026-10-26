import { BaseScreen } from '../BaseScreen';
import { LoanLandingScreen, LoanOnLoanScreen } from './BorrowCommon';

/** Nano — Nano_Customer_App_Spec §3–§10. */

export class NanoLandingScreen extends LoanLandingScreen {
  constructor() { super('nano'); }
  // Pre-check eligibility badge (§3, §10)
  eligibilityBadgeShown() { return this.exists('nano.landing.eligibility'); }
  eligibilityText() { return this.text('nano.landing.eligibility'); }
  eligibleMin() { return this.amount('nano.landing.eligibility.min'); }
  eligibleMax() { return this.amount('nano.landing.eligibility.max'); }
  eligibilityRate() { return this.text('nano.landing.eligibility.rate'); }
  // Not-eligible variant
  notEligibleShown() { return this.exists('nano.landing.notEligible'); }
  notEligibleReason() { return this.text('nano.landing.notEligible.reason'); }
  notEligibleGuidance() { return this.text('nano.landing.notEligible.guidance'); }
  resolveAction() { return this.tap('nano.landing.notEligible.action'); }
  resolveActionLabel() { return this.text('nano.landing.notEligible.action'); }
  resolveActionShown() { return this.exists('nano.landing.notEligible.action', 1_500); }
}

export class NanoBookingScreen extends BaseScreen {
  protected readonly root = 'nano.booking.screen';
  // Step 1 — Amount (bounded slider / chip picker)
  enterAmount(v: number | string) { return this.type('nano.booking.amount.input', v); }
  amountValue() { return this.amount('nano.booking.amount.input'); }
  amountError() { return this.text('nano.booking.amount.input.error'); }
  amountRange() { return this.text('nano.booking.amount.range'); }
  tapChip(amount: number) { return this.tap(`nano.booking.amount.chip.${amount}`); }
  chipShown(amount: number) { return this.exists(`nano.booking.amount.chip.${amount}`, 1_500); }
  // Step 2 — Tenor cards
  tenorCard(days: number) {
    const p = `nano.booking.tenor.${days}`;
    return {
      shown: () => this.exists(p, 2_000),
      select: () => this.tap(p),
      label: () => this.text(`${p}.label`),
      interest: () => this.amount(`${p}.interest`),
      total: () => this.amount(`${p}.total`),
    };
  }
  // Step 3 — Purpose (optional)
  pickPurpose(slug: string) { return this.tap(`nano.booking.purpose.option.${slug}`); }
  purposeOptionShown(slug: string) { return this.exists(`nano.booking.purpose.option.${slug}`, 1_500); }
  skipPurpose() { return this.tap('nano.booking.purpose.skip'); }
  // Step 4 — Consent
  consentText() { return this.text('nano.booking.consent.text'); }
  tickConsent() { return this.tap('nano.booking.consent.checkbox'); }
  consentTicked() { return this.isChecked('nano.booking.consent.checkbox'); }
  // Navigation
  continue() { return this.tap('nano.booking.continue'); }
  continueEnabled() { return this.isEnabled('nano.booking.continue'); }
  submit() { return this.tap('nano.booking.submit'); }
  submitEnabled() { return this.isEnabled('nano.booking.submit'); }
}

/** Steps 5–6c: auto-decisioning loading → approved / pending (declined uses LoanDeclineScreen('nano')). */
export class NanoDecisionScreen extends BaseScreen {
  protected readonly root = 'nano.decision.screen';
  loadingShown() { return this.exists('nano.decision.loading', 5_000); }
  loadingText() { return this.text('nano.decision.loading'); }
  approvedShown(timeout = 20_000) { return this.exists('nano.decision.approved', timeout); }
  approvedHeadline() { return this.text('nano.decision.approved.headline'); }
  approved() {
    const p = 'nano.decision.approved';
    return {
      amount: () => this.amount(`${p}.amount`),
      tenor: () => this.text(`${p}.tenor`),
      total: () => this.amount(`${p}.total`),
      dueDate: () => this.text(`${p}.dueDate`),
      destination: () => this.text(`${p}.destination`),
    };
  }
  pendingShown(timeout = 20_000) { return this.exists('nano.decision.pending', timeout); }
  pendingMessage() { return this.text('nano.decision.pending.message'); }
  viewWallet() { return this.tap('nano.decision.approved.viewWallet'); }
  viewLoan() { return this.tap('nano.decision.approved.viewLoan'); }
}

export class NanoLoanScreen extends LoanOnLoanScreen {
  constructor() { super('nano'); }
  streak() { return this.text('nano.loan.streak'); }
  streakCount() { return this.text('nano.loan.streak.count'); }
}

/** §7 "View loyalty streak". */
export class NanoStreakScreen extends BaseScreen {
  protected readonly root = 'nano.streak.screen';
  count() { return this.text('nano.streak.count'); }
  onTimeCount() { return this.text('nano.streak.onTime'); }
  currentTier() { return this.text('nano.streak.tier'); }
  nextTierRequirement() { return this.text('nano.streak.nextTier'); }
}
