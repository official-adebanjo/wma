import Decimal from 'decimal.js';
import type { ChainablePromiseElement } from 'webdriverio';
import { parseNaira } from '../../../shared/calc/money';
import { BaseScreen, allById, byId, driver, swipeUp } from '../BaseScreen';

/**
 * Screens used by the hands-on customer journeys (mobile/specs/journeys). Selectors: live-ids.ts.
 *
 * Two quirks of the live build shape these helpers:
 *  - Most screens lay out a label and its value as sibling TextViews, so values are read by label.
 *  - Hiding the keyboard sends BACK on Android, which closes the modal being typed into
 *    (e.g. Edit Address). Inputs here are finished with Enter instead.
 */

/**
 * The TextView after a label TextView, e.g. "Total Repayable" → "₦126,500". `label` matches the start
 * of the text; the last match wins (forms repeat a label above the input and again in the summary).
 */
export function valueAfterLabel(label: string) {
  return driver.$(`(//android.widget.TextView[starts-with(@text,"${label}")])[last()]/following-sibling::android.widget.TextView[1]`);
}

export async function readValue(label: string): Promise<string> {
  const e = valueAfterLabel(label);
  await e.waitForDisplayed({ timeout: 15_000 });
  return (await e.getText()).trim();
}

export async function readAmount(label: string): Promise<Decimal> {
  return parseNaira(await readValue(label));
}

/** Type into a field and press Enter (keeps any modal open — see file comment). */
export async function typeAndEnter(target: WebdriverIO.Element | ChainablePromiseElement, text: string): Promise<void> {
  const el = (await target) as WebdriverIO.Element;
  await el.waitForDisplayed();
  await el.click();
  await el.clearValue();
  await el.addValue(text);
  await driver.pressKeyCode(66);
}

/** React Native's red error screen (debug builds) — returns its first line, or null when not shown. */
export async function redboxMessage(): Promise<string | null> {
  if (!(await byId('common.redbox').isDisplayed().catch(() => false))) return null;
  const msg = await byId('common.redbox.message').getText().catch(() => 'unknown error');
  return msg.split('\n')[0];
}

const STATUS_WORDS = /\b(cannot|can ?not|can't|no longer|unable|failed|error|invalid|required|insufficient|not allowed|success(ful(ly)?)?|saved|updated|added)\b/i;

/**
 * Run an action and return the first new status message ("City cannot be empty", "Profile
 * updated") that appears within `timeout`. Toasts vanish in about two seconds and their container
 * is not a reliable anchor, so this diffs the screen's texts before and after instead.
 */
export async function messageAfter(action: () => Promise<void>, timeout = 8_000): Promise<string | null> {
  const texts = async () => new Set(
    [...(await driver.getPageSource()).matchAll(/ text="([^"]+)"/g)].map((m) => m[1].replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')),
  );
  const before = await texts();
  await action();
  let found: string | null = null;
  await driver.waitUntil(async () => {
    for (const t of await texts()) {
      // Only status sentences count — labels and typed values scrolling back into view must not.
      if (!before.has(t) && STATUS_WORDS.test(t)) { found = t; return true; }
    }
    return false;
  }, { timeout, interval: 300 }).catch(() => undefined);
  return found;
}

/** Tap an element by accessibility label / text at its centre (RN touchables often aren't `clickable`). */
export async function tapLabel(label: string, timeout = 15_000): Promise<void> {
  const e = driver.$(`~${label}`);
  await e.waitForDisplayed({ timeout });
  const { x, y, width, height } = await driver.getElementRect(await e.elementId);
  await driver.execute('mobile: clickGesture', { x: Math.round(x + width / 2), y: Math.round(y + height / 2) });
}

/** Scroll until an element is on screen (returns false instead of throwing). */
export async function scrollToShown(id: string, maxSwipes = 6): Promise<boolean> {
  for (let i = 0; i <= maxSwipes; i++) {
    if (await byId(id).isDisplayed().catch(() => false)) return true;
    if (i < maxSwipes) await swipeUp();
  }
  return false;
}

/* ------------------------------------------------------------------ Grow */

export type ProductPageResult = { kind: 'page' } | { kind: 'tierGate'; message: string };

export class InvestProductEntry extends BaseScreen {
  protected readonly root = 'grow.home.screen';
  /**
   * Open a product's "View full details": either its page (titled e.g. "Rosabon Win Note (RWIN)"),
   * or the tier-gate modal. The modal opens over Grow, so the page needs Grow gone *and* the
   * product title shown — "Grow is gone" alone proves nothing while the modal animates in.
   */
  async open(product: 'rwin' | 'reap' | 'rtn'): Promise<ProductPageResult> {
    await this.tap(`grow.home.tile.${product}.open`);
    const title = driver.$(`//android.widget.TextView[contains(@text,"(${product.toUpperCase()})")]`);
    let result: ProductPageResult | null = null;
    await driver.waitUntil(async () => {
      if (await byId('grow.tierGate').isDisplayed().catch(() => false)) {
        const msg = await byId('grow.tierGate.message').getText().catch(() => '');
        result = { kind: 'tierGate', message: msg || 'Upgrade Your Account' };
        return true;
      }
      if (!(await this.isShown()) && (await title.isDisplayed().catch(() => false))) { result = { kind: 'page' }; return true; }
      return false;
    }, { timeout: 15_000, timeoutMsg: `${product} details opened neither its page nor a tier message` });
    return result!;
  }
  /** Close the tier-gate modal by tapping the backdrop above it. */
  async dismissGate(): Promise<void> {
    const { width } = await driver.getWindowSize();
    await driver.execute('mobile: clickGesture', { x: Math.round(width / 2), y: 300 });
    await byId('grow.tierGate').waitForDisplayed({ timeout: 5_000, reverse: true }).catch(() => undefined);
  }
}

export type GoalProjection = { target: Decimal; monthly: Decimal; interest: Decimal; ratePct: Decimal; tenorDays: number };

/** RWIN product page → "New Goal" → 3-step creation flow → goal page. */
export class RwinGoalFlow extends BaseScreen {
  protected readonly root = 'rwin.product.screen';
  async start(name: string) {
    await this.tap('rwin.product.newGoal');
    await byId('rwin.create.step').waitForDisplayed();
    await typeAndEnter(byId('rwin.create.name.input'), name);
    await this.tap('rwin.create.continue');
    await byId('rwin.create.target.input').waitForDisplayed();
  }
  /** Step 2: target, tenor chip (e.g. "90 Days") and payment preference; returns the live projection. */
  async plan(target: number, tenor: string, preference: 'Daily' | 'Weekly' | 'Monthly' | 'On Demand'): Promise<GoalProjection> {
    await typeAndEnter(byId('rwin.create.target.input'), String(target));
    await tapLabel(tenor);
    await swipeUp();
    await tapLabel(preference);
    const rateText = await driver.$('//android.widget.TextView[starts-with(@text,"Interest earned")]').getText();
    return {
      target: await readAmount('Target Amount'),
      monthly: await readAmount('Monthly Contribution'),
      interest: parseNaira((await readValue('Interest earned')).replace('+', '')),
      ratePct: new Decimal(rateText.match(/([\d.]+)%/)![1]),
      tenorDays: Number(tenor.match(/\d+/)![0]),
    };
  }
  /** Tenor chips offered on step 2, e.g. [60, 90, 120]. */
  async tenorChoices(): Promise<number[]> {
    const chips = await driver.$$('android=new UiSelector().descriptionMatches("^[0-9]+ Days$")');
    const out: number[] = [];
    for (const c of chips) out.push(Number((await c.getAttribute('content-desc')).match(/\d+/)![0]));
    return out;
  }
  async continueToSummary() {
    await this.tap('rwin.create.continue');
    await byId('rwin.create.summary').waitForDisplayed({ timeout: 15_000 });
  }
  maturityDate() { return readValue('Maturity Date'); }
  async create() {
    await scrollToShown('rwin.create.terms');
    await this.tap('rwin.create.terms');
    await scrollToShown('rwin.create.submit'); // below the fold until scrolled
    await this.tap('rwin.create.submit');
    await byId('rwin.create.success').waitForDisplayed({ timeout: 20_000 });
  }
  successNote() { return this.text('rwin.create.success.note'); }
  async viewGoal() {
    await this.tap('rwin.create.viewGoal');
    await byId('rwin.goal.delete').waitForDisplayed();
  }
  async openTopUp() {
    await this.tap('rwin.goal.topUp');
    await byId('rwin.topUp.submit').waitForDisplayed();
  }
  submitTopUp() { return this.tap('rwin.topUp.submit'); }
  async deleteGoal() {
    await this.tap('rwin.goal.delete');
    await byId('rwin.goal.deleteConfirm').waitForDisplayed();
    await this.tap('rwin.goal.deleteConfirm');
    await byId('rwin.goal.deleted').waitForDisplayed({ timeout: 15_000 });
  }
}

/* ------------------------------------------------------------------ Borrow */

export type BorrowState = 'products' | 'underReview' | 'offer' | 'disbursing' | 'active';

export async function borrowState(timeout = 20_000): Promise<BorrowState> {
  const states: [BorrowState, string][] = [
    ['products', 'borrow.home.tile.any'], ['underReview', 'loan.state.underReview'], ['offer', 'loan.state.offer'],
    ['disbursing', 'loan.state.disbursing'], ['active', 'loan.dashboard.outstanding'],
  ];
  let found: BorrowState | null = null;
  await driver.waitUntil(async () => {
    for (const [s, id] of states) if (await byId(id).isDisplayed().catch(() => false)) { found = s; return true; }
    return false;
  }, { timeout, timeoutMsg: 'Borrow tab showed neither products nor a loan state' });
  return found!;
}

export type ScheduleLine = { label: string; amount: Decimal };

export class LoanApplication extends BaseScreen {
  protected readonly root = 'loan.apply.amountScreen';
  /** Wait for the amount screen, or return the red-screen error that replaced it. */
  async openedOrCrash(timeout = 15_000): Promise<{ opened: true } | { opened: false; error: string }> {
    let out: { opened: true } | { opened: false; error: string } | null = null;
    await driver.waitUntil(async () => {
      const err = await redboxMessage();
      if (err) { out = { opened: false, error: err }; return true; }
      if (await this.isShown()) { out = { opened: true }; return true; }
      return false;
    }, { timeout, timeoutMsg: 'Loan amount screen did not open' });
    return out!;
  }
  async choose(amountChip: string, tenorChip: string) {
    await tapLabel(amountChip);
    await tapLabel(tenorChip);
    await this.tap('loan.apply.continue');
  }
  /** Upload the test PDF for every requested document (file pushed by helpers/files.ts). */
  async uploadAll(fileName: string) {
    await byId('loan.docs.screen').waitForDisplayed();
    for (let i = 0; i < 6; i++) {
      const pending = await allById('loan.docs.upload');
      if (!pending.length) break;
      const { x, y, width, height } = await driver.getElementRect(await pending[0].elementId);
      await driver.execute('mobile: clickGesture', { x: Math.round(x + width / 2), y: Math.round(y + height / 2) });
      await tapLabel('Choose a PDF or document');
      const file = driver.$(`android=new UiSelector().text("${fileName}")`);
      await file.waitForDisplayed({ timeout: 20_000 });
      await file.click();
      await driver.waitUntil(async () => (await allById('loan.docs.upload')).length < pending.length, { timeout: 30_000 });
    }
  }
  documentStatuses() { return allById('loan.docs.uploaded'); }
  async submitDocuments() {
    await this.tap('loan.docs.submit');
    await byId('loan.review.screen').waitForDisplayed({ timeout: 20_000 });
  }
  totalRepayable() { return readAmount('Total Repayable'); }
  interestRateText() { return readValue('Interest Rate'); }
  async managementFee(): Promise<Decimal | null> {
    return valueAfterLabel('Management Fee').isDisplayed().then((s) => (s ? readAmount('Management Fee') : null), () => null);
  }
  /** Open "See Breakdown" (it can take a few seconds) and read every "(Month n)" line. */
  async schedule(): Promise<ScheduleLine[]> {
    await this.tap('loan.review.seeBreakdown');
    await byId('loan.review.breakdownSheet').waitForDisplayed({ timeout: 15_000 });
    const rows = await allById('loan.review.breakdownRow');
    const out: ScheduleLine[] = [];
    for (const r of rows) {
      const label = await r.getText();
      const amount = await driver.$(`//android.widget.TextView[@text="${label}"]/following-sibling::android.widget.TextView[1]`).getText();
      out.push({ label, amount: parseNaira(amount) });
    }
    return out;
  }
  async closeSheet() {
    const { width } = await driver.getWindowSize();
    await driver.execute('mobile: clickGesture', { x: Math.round(width / 2), y: 500 });
  }
  async submit() {
    await this.tap('loan.review.declaration');
    await this.tap('loan.review.submit');
    await byId('loan.state.underReview').waitForDisplayed({ timeout: 30_000 });
  }
}

/* ------------------------------------------------------------------ Settings / Profile */

export class SettingsScreen extends BaseScreen {
  protected readonly root = 'settings.profile';
  openProfile() { return this.tap('settings.profile'); }
  logout() { return this.tap('settings.logout'); }
}

export class ProfileScreen extends BaseScreen {
  protected readonly root = 'profile.tab.personal';
  openTab(tab: 'personal' | 'kin' | 'employment') { return this.tap(`profile.tab.${tab}`); }

  /** Personal Info: the Address row reads "Add your address" when none is on file. */
  async addressText(): Promise<string> {
    const el = driver.$('//android.widget.TextView[@text="Address"]/following-sibling::*[1]');
    await scrollToShown('profile.personal.save');
    return (await el.getAttribute('content-desc')) || (await el.getText());
  }
  async enterAddress(street: string, state: string, city: string) {
    const row = driver.$('//android.widget.TextView[@text="Address"]/following-sibling::*[1]');
    const { x, y, width, height } = await driver.getElementRect(await row.elementId);
    await driver.execute('mobile: clickGesture', { x: Math.round(x + width / 2), y: Math.round(y + height / 2) });
    await byId('profile.address.modal').waitForDisplayed();
    await typeAndEnter(byId('profile.address.street'), street);
    await this.tap('profile.address.state');
    await tapLabel(state);
    await this.tap('profile.address.city');
    await tapLabel(city);
    await this.tap('profile.address.done');
  }
  savePersonal() { return this.tap('profile.personal.save'); }

  /** Empty fields show their placeholder as text; scroll it into view (the keyboard can push it off). */
  private field(placeholder: string) {
    return driver.$(`android=new UiScrollable(new UiSelector().scrollable(true)).scrollIntoView(new UiSelector().text("${placeholder}"))`);
  }
  async fillKin(k: { name: string; relationship: string; phone: string; address: string }) {
    await typeAndEnter(this.field('e.g. Chidi Okafor'), k.name);
    await this.tap('profile.kin.relationship');
    await tapLabel(k.relationship);
    await typeAndEnter(this.field('e.g. +234 800 000 0000'), k.phone);
    await typeAndEnter(this.field('e.g. 12 Unity Close, Lekki'), k.address);
  }
  saveKin() { return this.tap('profile.kin.save'); }

  async jobTitle(): Promise<string> {
    const e = byId('profile.employment.jobTitle');
    await e.waitForDisplayed();
    return (await e.getText()).trim();
  }
  async setJobTitle(value: string) {
    await typeAndEnter(byId('profile.employment.jobTitle'), value);
  }
  async saveEmployment() {
    await scrollToShown('profile.employment.save');
    await this.tap('profile.employment.save');
  }
}

/* ------------------------------------------------------------------ Send / Fund */

export class SendMoneyScreen extends BaseScreen {
  protected readonly root = 'send.screen';
  async savedRecipientCount(): Promise<number> {
    const saved = await allById('send.beneficiary').length;
    return saved + ((await byId('send.recent').isDisplayed().catch(() => false)) ? 1 : 0);
  }
}

export class FundWalletCard extends BaseScreen {
  protected readonly root = 'fund.screen';
  async payByCard(amount: number) {
    await this.tap('fund.card');
    const input = byId('common.anyInput');
    await typeAndEnter(input, String(amount));
    await this.tap('fund.card.pay');
  }
  gatewayOpened(timeout = 20_000) {
    return byId('fund.card.gateway').waitForDisplayed({ timeout }).then(() => true, () => false);
  }
}
