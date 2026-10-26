import { expect } from '@wdio/globals';
import { Tag, title } from '../../../shared/support/tags';
import { QaHooks } from '../../../shared/api/qa-hooks';
import { freshCustomer, openTab, requireHooks } from '../../helpers/session';
import {
  LoanModule, LoanProduct, moduleOf, openBorrowTile, productDisplayName, seedNanoEligibility, seedNanoTerms, setCrossLoanBlock,
} from '../../helpers/loans';
import { BorrowHubScreen, LoanLandingScreen } from '../../screens/loans/BorrowCommon';

/**
 * Borrow tab — four loan tiles, Nano loyalty streak on tile, cross-loan constraint messaging
 * (Nano §2 / §12, Payday §2 / §9, Personal §2 / §9, Public Sector §2).
 */
describe('Borrow › Home', () => {
  let hooks: QaHooks;
  let customerId: string;
  const borrow = new BorrowHubScreen();

  const tiles: LoanModule[] = ['nano', 'payday', 'personal', 'publicSector'];

  beforeEach(async function () {
    requireHooks(this);
    ({ hooks, customerId } = await freshCustomer({ tier: 2, walletBalance: 100_000, salaryDetected: true, monthlySalary: 450_000, employer: 'Access Bank Nigeria' }));
    await setCrossLoanBlock(hooks, false);
  });

  afterEach(async () => {
    await hooks?.dispose();
  });

  it(title('Borrow tab shows the four loan tiles: Nano, Payday, Personal Loan, Public Sector Loan', Tag.high, Tag.smoke, Tag.spec('Nano§2'), Tag.spec('Payday§2'), Tag.spec('Personal§2'), Tag.spec('PublicSector§2')), async () => {
    await openTab('borrow');
    await borrow.waitForShown();
    for (const t of tiles) await expect(await borrow.tileShown(t)).toBe(true);
  });

  for (const t of tiles) {
    it(title(`${t} tile opens the ${t} landing screen`, Tag.med, Tag.spec('Nano§2')), async () => {
      await openBorrowTile(t);
      await new LoanLandingScreen(t).waitForShown();
    });
  }

  it(title('Nano tile shows loyalty streak for a returning customer', Tag.med, Tag.spec('Nano§12')), async () => {
    await seedNanoTerms(hooks);
    await hooks.seedLoan({ customerId, product: 'NANO', state: 'REPAID', amount: 20_000, extra: { streak: 3, repaidOnTime: true } });
    await openTab('borrow');
    await borrow.waitForShown();
    await expect(await borrow.tileStreakShown()).toBe(true);
    await expect(await borrow.tileStreak()).toMatch(/\b3\b/);
    await expect(await borrow.tileStreak()).toMatch(/streak/i);
  });

  it(title('Nano tile shows no streak indicator for a first-time borrower', Tag.low, Tag.spec('Nano§12')), async () => {
    await openTab('borrow');
    await borrow.waitForShown();
    await expect(await borrow.tileStreakShown()).toBe(false);
  });

  describe('Cross-loan constraint (config-dependent)', () => {
    const cases: Array<{ active: LoanProduct; target: LoanModule; targetProduct: LoanProduct }> = [
      { active: 'NANO', target: 'payday', targetProduct: 'PAYDAY' },
      { active: 'PERSONAL', target: 'payday', targetProduct: 'PAYDAY' },
      { active: 'PUBLIC_SECTOR', target: 'payday', targetProduct: 'PAYDAY' },
      { active: 'PAYDAY', target: 'personal', targetProduct: 'PERSONAL' },
    ];

    for (const c of cases) {
      it(title(`enabled: active ${productDisplayName[c.active]} loan blocks ${productDisplayName[c.targetProduct]} with "close your active loan" message`, Tag.crit, Tag.spec('Payday§9'), Tag.spec('Personal§9')), async () => {
        await setCrossLoanBlock(hooks, true);
        await hooks.seedLoan({ customerId, product: c.active, state: 'ACTIVE', amount: 50_000 });
        await openBorrowTile(c.target);
        const landing = new LoanLandingScreen(c.target);
        await landing.waitForShown();
        await expect(await landing.constraintShown()).toBe(true);
        const name = productDisplayName[c.active];
        await expect(await landing.constraint()).toMatch(new RegExp(`close your active ${name}.*loan before applying`, 'i'));
        if (await landing.applyShown()) await expect(await landing.applyEnabled()).toBe(false);
      });
    }

    it(title('disabled: an active Nano does not block Payday application entry', Tag.crit, Tag.spec('Payday§9')), async () => {
      await setCrossLoanBlock(hooks, false);
      await hooks.seedLoan({ customerId, product: 'NANO', state: 'ACTIVE', amount: 20_000 });
      await openBorrowTile('payday');
      const landing = new LoanLandingScreen('payday');
      await landing.waitForShown();
      await expect(await landing.constraintShown()).toBe(false);
      await expect(await landing.applyEnabled()).toBe(true);
    });

    it(title('same-product one-active rule applies even when cross-loan block is disabled', Tag.crit, Tag.spec('Nano§11')), async () => {
      await setCrossLoanBlock(hooks, false);
      await seedNanoTerms(hooks);
      await seedNanoEligibility(hooks, customerId, { eligible: true, min: 5_000, max: 50_000 });
      await hooks.seedLoan({ customerId, product: 'NANO', state: 'ACTIVE', amount: 20_000 });
      await openBorrowTile('nano');
      const landing = new LoanLandingScreen(moduleOf.NANO);
      await landing.waitForShown();
      await expect(await landing.constraint()).toMatch(/one active Nano/i);
    });
  });
});
