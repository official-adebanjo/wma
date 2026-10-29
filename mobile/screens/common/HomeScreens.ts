import Decimal from 'decimal.js';
import { parseNaira } from '../../../shared/calc/money';
import { BaseScreen, allById, byId, driver, swipeUp } from '../BaseScreen';

export type Tab = 'home' | 'grow' | 'borrow' | 'wallet' | 'profile';

export class TabBar extends BaseScreen {
  protected readonly root = 'home.tabbar';
  open(tab: Tab) { return this.tap(`home.tabbar.${tab}`); }
}

/** Grow tab — investment product tiles (REAP / RWIN / RTN) and discovery banner. */
export type ActivePlan = { name: string; productCode: string; amount: Decimal; nextPayoutDays: number | null; ratePctPa: Decimal | null };

/** Live row content-desc: "Adebanjo Test (RWIN_2_0), ₦10,000.00, Next Payout: 57 days, 14% p.a." */
export function parseActivePlan(desc: string): ActivePlan {
  const m = desc.match(/^(.*?)\s*\(([^)]+)\),\s*(₦[\d,.]+)(?:,\s*Next Payout:\s*(\d+)\s*days?)?(?:,\s*([\d.]+)%\s*p\.a\.)?/i);
  if (!m) throw new Error(`Unrecognised active-plan row: "${desc}"`);
  return {
    name: m[1], productCode: m[2], amount: parseNaira(m[3]),
    nextPayoutDays: m[4] ? Number(m[4]) : null, ratePctPa: m[5] ? new Decimal(m[5]) : null,
  };
}

export class GrowHomeScreen extends BaseScreen {
  protected readonly root = 'grow.home.screen';
  openTile(product: 'reap' | 'rwin' | 'rtn') { return this.tap(`grow.home.tile.${product}.open`); }
  tileShown(product: 'reap' | 'rwin' | 'rtn') { return this.exists(`grow.home.tile.${product}`); }
  tileMetric(product: 'reap' | 'rwin' | 'rtn') { return this.text(`grow.home.tile.${product}.metric`); }
  tileHasNewBadge(product: 'reap' | 'rwin' | 'rtn') { return this.exists(`grow.home.tile.${product}.newBadge`); }
  bannerShown() { return this.exists('grow.home.banner'); }
  tapBanner() { return this.tap('grow.home.banner'); }
  totalCapital() { return this.amount('grow.home.totalCapital'); }
  accruedText() { return this.text('grow.home.accrued'); }
  /** The "Active Plans (n)" header count. */
  async activePlanCount(): Promise<number> {
    await this.scrollTo('grow.home.activePlans.header');
    return Number((await this.text('grow.home.activePlans.header')).match(/\((\d+)\)/)?.[1] ?? NaN);
  }
  /**
   * Active plan rows visible after scrolling to the end of the page. Rows can be identical
   * (same name/amount/days), so they can't be de-duplicated across scroll positions —
   * callers compare the result length with activePlanCount() to know whether it's complete.
   */
  async activePlansAtEnd(): Promise<ActivePlan[]> {
    let prev = '';
    for (let i = 0; i < 10; i++) {
      const src = await driver.getPageSource();
      if (src === prev) break;
      prev = src;
      await swipeUp();
    }
    const rows = await allById('grow.home.activePlan.row');
    const out: ActivePlan[] = [];
    for (const r of rows) out.push(parseActivePlan(await r.getAttribute('content-desc')));
    return out;
  }
}

export type LoanTile = 'nano' | 'payday' | 'personal' | 'publicSector';

/** Borrow tab — loan product tiles (names come from Admin product setup). */
export class BorrowHomeScreen extends BaseScreen {
  protected readonly root = 'borrow.home.screen';
  openTile(product: LoanTile) { return this.tap(`borrow.home.tile.${product}`); }
  async tileShown(product: LoanTile) {
    if (await this.exists(`borrow.home.tile.${product}`)) return true;
    await swipeUp();
    return this.exists(`borrow.home.tile.${product}`);
  }
  tileStreak() { return this.text('borrow.home.tile.nano.streak'); }
  /** content-desc of every visible tile: "<product name>, <tagline>". */
  async tileLabels(): Promise<string[]> {
    const out: string[] = [];
    for (const t of await allById('borrow.home.tile.any')) out.push(await t.getAttribute('content-desc'));
    return out;
  }
  recommendedShown() { return this.exists('borrow.home.recommended.title'); }
  recommendedTitle() { return this.text('borrow.home.recommended.title'); }
  recommendedSubtitle() { return this.text('borrow.home.recommended.subtitle'); }
  applyRecommended() { return this.tap('borrow.home.recommended.apply'); }
  groupShown(g: 'fastCash' | 'longTerm') { return this.exists(`borrow.home.group.${g}`); }
}

export class SearchScreen extends BaseScreen {
  protected readonly root = 'search.screen';
  query(text: string) { return this.type('search.input', text); }
  openResult(index = 0) { return this.tap(`search.result.${index}`); }
}

/** In-app notification inbox — used to assert push/in-app copy without device notification shade. */
export class NotificationsScreen extends BaseScreen {
  protected readonly root = 'notifications.screen';
  async latestTitle() { return this.text('notifications.item.0.title'); }
  async latestBody() { return this.text('notifications.item.0.body'); }
  async bodies(n = 5): Promise<string[]> {
    const out: string[] = [];
    for (let i = 0; i < n; i++) {
      const e = byId(`notifications.item.${i}.body`);
      if (!(await e.isDisplayed().catch(() => false))) break;
      out.push(await e.getText());
    }
    return out;
  }
}

/** Shared success / error / banner primitives reused by every product. */
export class Feedback extends BaseScreen {
  protected readonly root = 'common.feedback';
  toastText() { return this.text('common.toast'); }
  bannerText(kind: 'info' | 'warning' | 'error' | 'success' = 'warning') { return this.text(`common.banner.${kind}`); }
  bannerShown(kind: 'info' | 'warning' | 'error' | 'success' = 'warning') { return this.exists(`common.banner.${kind}`); }
  tooltipText() { return this.text('common.tooltip'); }
  dialogText() { return this.text('common.dialog.message'); }
  dialogConfirm() { return this.tap('common.dialog.confirm'); }
  dialogCancel() { return this.tap('common.dialog.cancel'); }
}
