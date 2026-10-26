import { BaseScreen } from '../BaseScreen';

/** Account Tiering & KYC Spec V4 §2 and §4. */

export type ChecklistItem = 'bvn' | 'nin' | 'address' | 'employment' | 'email' | 'phone' | 'governmentId' | 'proofOfAddress' | 'incomeVerification';
export type ChecklistStatus = 'verified' | 'pending' | 'incomplete';
export type UploadState = 'default' | 'uploading' | 'uploaded' | 'error';

export class KycHubScreen extends BaseScreen {
  protected readonly root = 'kyc.hub.screen';
  currentTier() { return this.text('kyc.hub.currentTier'); }
  limitsText() { return this.text('kyc.hub.limits'); }
  upgradeTo(tier: 2 | 3) { return this.tap(`kyc.hub.upgrade.tier${tier}`); }
  async itemStatus(item: ChecklistItem): Promise<ChecklistStatus> {
    for (const s of ['verified', 'pending', 'incomplete'] as const) {
      if (await this.exists(`kyc.checklist.${item}.${s}`, 500)) return s;
    }
    throw new Error(`No status badge for checklist item ${item}`);
  }
  openItem(item: ChecklistItem) { return this.tap(`kyc.checklist.${item}`); }
  submitUpgrade() { return this.tap('kyc.hub.submit'); }
  submitEnabled() { return this.isEnabled('kyc.hub.submit'); }
  bannerText() { return this.text('kyc.hub.banner'); }
}

/** BVN & NIN screens — 11-digit numeric with real-time checks and inline USSD tip (*346#). */
export class IdNumberScreen extends BaseScreen {
  protected readonly root = 'kyc.idNumber.screen';
  enter(v: string) { return this.type('kyc.idNumber.input', v); }
  value() { return this.el('kyc.idNumber.input').getText(); }
  ussdTip() { return this.text('kyc.idNumber.ussdTip'); }
  error() { return this.text('kyc.idNumber.input.error'); }
  submit() { return this.tap('kyc.idNumber.submit'); }
  submitEnabled() { return this.isEnabled('kyc.idNumber.submit'); }
}

export class AddressScreen extends BaseScreen {
  protected readonly root = 'kyc.address.screen';
  fill(a: { line1: string; city: string; state: string; lga?: string }) {
    return this.type('kyc.address.line1.input', a.line1)
      .then(() => this.type('kyc.address.city.input', a.city))
      .then(() => this.type('kyc.address.state.input', a.state))
      .then(() => (a.lga ? this.type('kyc.address.lga.input', a.lga) : undefined));
  }
  submit() { return this.tap('kyc.address.submit'); }
  fieldError(f: 'line1' | 'city' | 'state') { return this.text(`kyc.address.${f}.input.error`); }
}

export class EmploymentScreen extends BaseScreen {
  protected readonly root = 'kyc.employment.screen';
  employer(v: string) { return this.type('kyc.employment.employer.input', v); }
  sector(v: string) { return this.tap('kyc.employment.sector.select').then(() => this.tap(`kyc.employment.sector.option.${v}`)); }
  incomeRange(i: number) { return this.tap('kyc.employment.income.select').then(() => this.tap(`kyc.employment.income.option.${i}`)); }
  linkBankWithMono() { return this.tap('kyc.employment.mono.connect'); }
  submit() { return this.tap('kyc.employment.submit'); }
}

/** Reusable Government ID & Proof-of-Address form with the shared Upload State Card. */
export class DocumentUploadScreen extends BaseScreen {
  protected readonly root = 'kyc.document.screen';
  pickType(t: 'nationalId' | 'passport' | 'driversLicence' | 'votersCard' | 'utilityBill' | 'bankStatement') {
    return this.tap('kyc.document.type.select').then(() => this.tap(`kyc.document.type.option.${t}`));
  }
  docNumber(v: string) { return this.type('kyc.document.number.input', v); }
  docNumberShown() { return this.exists('kyc.document.number.input', 1_500); }
  docDate(iso: string) { return this.type('kyc.document.date.input', iso); }
  pickFile() { return this.tap('kyc.upload.card.picker'); }
  async uploadState(): Promise<UploadState> {
    for (const s of ['uploaded', 'uploading', 'error', 'default'] as const) {
      if (await this.exists(`kyc.upload.card.${s}`, 500)) return s;
    }
    throw new Error('Upload card in unknown state');
  }
  progressShown() { return this.exists('kyc.upload.card.progress', 1_000); }
  fileMeta() { return this.text('kyc.upload.card.meta'); }
  errorText() { return this.text('kyc.upload.card.errorText'); }
  retry() { return this.tap('kyc.upload.card.retry'); }
  submit() { return this.tap('kyc.document.submit'); }
  dateError() { return this.text('kyc.document.date.input.error'); }
}

export class EmailVerifyScreen extends BaseScreen {
  protected readonly root = 'kyc.email.screen';
  sendCode() { return this.tap('kyc.email.send'); }
  enterCode(c: string) { return this.type('kyc.email.code.input', c); }
  verify() { return this.tap('kyc.email.verify'); }
  error() { return this.text('kyc.email.code.input.error'); }
}
