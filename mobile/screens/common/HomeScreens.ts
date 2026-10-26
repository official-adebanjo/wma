import { BaseScreen, byId } from '../BaseScreen';

export type Tab = 'home' | 'grow' | 'borrow' | 'wallet' | 'profile';

export class TabBar extends BaseScreen {
  protected readonly root = 'home.tabbar';
  open(tab: Tab) { return this.tap(`home.tabbar.${tab}`); }
}

/** Grow tab — investment product tiles (REAP / RWIN / RTN) and discovery banner. */
export class GrowHomeScreen extends BaseScreen {
  protected readonly root = 'grow.home.screen';
  openTile(product: 'reap' | 'rwin' | 'rtn') { return this.tap(`grow.home.tile.${product}`); }
  tileMetric(product: 'reap' | 'rwin' | 'rtn') { return this.text(`grow.home.tile.${product}.metric`); }
  tileHasNewBadge(product: 'reap' | 'rwin' | 'rtn') { return this.exists(`grow.home.tile.${product}.newBadge`); }
  bannerShown() { return this.exists('grow.home.banner'); }
  tapBanner() { return this.tap('grow.home.banner'); }
}

/** Borrow tab — loan product tiles. */
export class BorrowHomeScreen extends BaseScreen {
  protected readonly root = 'borrow.home.screen';
  openTile(product: 'nano' | 'payday' | 'personal' | 'publicSector') { return this.tap(`borrow.home.tile.${product}`); }
  tileShown(product: 'nano' | 'payday' | 'personal' | 'publicSector') { return this.exists(`borrow.home.tile.${product}`); }
  tileStreak() { return this.text('borrow.home.tile.nano.streak'); }
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
