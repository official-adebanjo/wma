import { BaseScreen, allById } from '../BaseScreen';

export class WalletScreen extends BaseScreen {
  protected readonly root = 'wallet.home.screen';
  balance() { return this.amount('wallet.home.balance'); }
  tapFund() { return this.tap('wallet.home.fund'); }
  tapTransfer() { return this.tap('wallet.home.transfer'); }
  tapHistory() { return this.tap('wallet.home.history'); }
  tierBadge() { return this.text('wallet.home.tierBadge'); }
  // Live Home tab (see live-ids.ts)
  greeting() { return this.text('wallet.home.greeting'); }
  customerName() { return this.text('wallet.home.customerName'); }
  earnedText() { return this.text('wallet.home.earned'); }
  tapBills() { return this.tap('wallet.home.bills'); }
  tapInvest() { return this.tap('wallet.home.invest'); }
  quickActionShown(a: 'transfer' | 'fund' | 'bills' | 'invest') { return this.exists(`wallet.home.${a}`); }
  openSegment(s: 'home' | 'loans' | 'invest') { return this.tap(`wallet.home.segment.${s}`); }
  /** "Complete your profile" progress as { done, total }, or null when the card isn't shown (all steps done). */
  async kycProgress(): Promise<{ done: number; total: number } | null> {
    if (!(await this.exists('wallet.home.kycProgress.card', 8_000))) return null;
    // Card is up — its n/n count must be readable, otherwise fail rather than pass vacuously.
    const [done, total] = (await this.text('wallet.home.kycProgress')).split('/').map(Number);
    if (!Number.isInteger(done) || !Number.isInteger(total)) throw new Error('Profile progress card shown but count unreadable');
    return { done, total };
  }
  async recentActivityCount(): Promise<number> {
    return (await allById('wallet.home.recent.item')).length;
  }
}

export class FundWalletScreen extends BaseScreen {
  protected readonly root = 'wallet.fund.screen';
  virtualAccountNumber() { return this.text('wallet.fund.accountNumber'); }
  virtualAccountName() { return this.text('wallet.fund.accountName'); }
  copyAccountNumber() { return this.tap('wallet.fund.copy'); }
  chooseCard() { return this.tap('wallet.fund.method.card'); }
  enterAmount(v: number) { return this.type('wallet.fund.amount.input', v); }
  submit() { return this.tap('wallet.fund.submit'); }
}

export class TransferScreen extends BaseScreen {
  protected readonly root = 'wallet.transfer.screen';
  enterAccount(acct: string) { return this.type('wallet.transfer.account.input', acct); }
  pickBank(name: string) {
    return this.tap('wallet.transfer.bank.select').then(() => this.type('wallet.transfer.bank.search', name)).then(() => this.tap('wallet.transfer.bank.option.0'));
  }
  resolvedName() { return this.text('wallet.transfer.resolvedName'); }
  enterAmount(v: number | string) { return this.type('wallet.transfer.amount.input', v); }
  enterNarration(n: string) { return this.type('wallet.transfer.narration.input', n); }
  continue() { return this.tap('wallet.transfer.continue'); }
  continueEnabled() { return this.isEnabled('wallet.transfer.continue'); }
  amountError() { return this.text('wallet.transfer.amount.input.error'); }
  confirmWithPin(pin: string) { return this.type('wallet.transfer.pin.input', pin).then(() => this.tap('wallet.transfer.confirm')); }
  doubleTapConfirm() { return this.tap('wallet.transfer.confirm').then(() => this.tap('wallet.transfer.confirm').catch(() => undefined)); }
  resultStatus() { return this.text('wallet.transfer.result.status'); }
  resultReference() { return this.text('wallet.transfer.result.reference'); }
}

export class TransactionHistoryScreen extends BaseScreen {
  protected readonly root = 'wallet.history.screen';
  rowAmount(i = 0) { return this.amount(`wallet.history.item.${i}.amount`); }
  rowDescription(i = 0) { return this.text(`wallet.history.item.${i}.description`); }
  rowStatus(i = 0) { return this.text(`wallet.history.item.${i}.status`); }
  openRow(i = 0) { return this.tap(`wallet.history.item.${i}`); }
  detailReference() { return this.text('wallet.history.detail.reference'); }
  detailAmount() { return this.amount('wallet.history.detail.amount'); }
  filter(kind: 'all' | 'credit' | 'debit') { return this.tap(`wallet.history.filter.${kind}`); }
}
