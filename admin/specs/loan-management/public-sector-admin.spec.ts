import { test, expect } from '../../fixtures/fixtures';
import { asRole, closeRoleContexts, LoanRole, roleBelowBand, roleForBand } from '../../fixtures/loan-personas';
import { LoanManagementPage } from '../../pages/LoanManagementPage';
import { ApprovalQueuePage } from '../../pages/ApprovalQueuePage';
import * as loans from '../../../shared/calc/loans';
import { addMonths, formatNaira } from '../../../shared/calc/money';
import { Tag, title } from '../../../shared/support/tags';

/**
 * Admin PRD › Loan Management › Public Sector-specific actions.
 * Corridor-routed: each corridor configures DTI, rate, salary basis, consent-letter requirement,
 * control-gate threshold (house visitation report / obligor cheques / utility bill) and approval bands
 * (Team Lead → CRM → GM for band 3+). Tenor ≤ whole months to retirement.
 *
 * Seeding assumptions: Public Sector config `corridors.<name>.{dtiPct,ratePct,consentLetterRequired,
 * controlGateThreshold,approvalBands,docFreshnessDays}`; seedLoan extra keys `corridor`, `salaryBasis`,
 * `retirementDate`, `controlGateDocs` ({name,status,uploadedDaysAgo}[]), `consentLetter`, `flag`, `monthlyRatePct`,
 * `interestModel`. Product config `interestModel`: 'A' monthly equal | 'B' monthly reducing — the same admin-configurable
 * engine as Personal (LOAN PRODUCT SPECIFICATIONS §4.2). Corridor `ratePct` is p.a.; the engine applies ratePct ÷ 12 monthly.
 */
test.describe('Loan Management › Public Sector actions', () => {
  const IPPIS = 'Federal IPPIS';
  const LAGOS = 'Lagos State';
  const CORRIDORS = {
    [IPPIS]: { dtiPct: 33, ratePct: 22, consentLetterRequired: true, controlGateThreshold: 3_000_000, approvalBands: [1_000_000, 3_000_000, 6_000_000] as [number, number, number], docFreshnessDays: 90 },
    [LAGOS]: { dtiPct: 40, ratePct: 24, consentLetterRequired: false, controlGateThreshold: 5_000_000, approvalBands: [1_500_000, 4_000_000, 8_000_000] as [number, number, number], docFreshnessDays: 90 },
  };
  /** Public Sector bands stop at GM ("GM (band 3+)"). */
  const psApprover = (amount: number, corridor: keyof typeof CORRIDORS): LoanRole => {
    const band = loans.approvalBand(amount, CORRIDORS[corridor].approvalBands);
    return band === 'EXECUTIVE' ? 'gm' : roleForBand(band);
  };
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const DEFAULT_MODEL: loans.InterestModel = 'B';
  const MODELS = ['A', 'B'] as const;
  const modelTitle = (m: loans.InterestModel) => (m === 'A' ? 'Model A (monthly equal)' : 'Model B (monthly reducing)');
  const monthlyRate = (corridor: keyof typeof CORRIDORS) => loans.monthlyFromAnnual(CORRIDORS[corridor].ratePct);

  test.beforeEach(async ({ hooks }) => {
    await hooks.setProductConfig({ product: 'PUBLIC_SECTOR', patch: { corridors: CORRIDORS, interestModel: DEFAULT_MODEL } });
  });
  test.afterEach(closeRoleContexts);

  test(title('Book Public Sector on behalf: unknown employer is not an eligible corridor', Tag.high, Tag.spec('AdminPRD:PublicSector'), Tag.spec('PublicSector§4')), async ({ asPersona, hooks }) => {
    const { customerId } = await hooks.seedCustomer({ tier: 3, walletBalance: 0 });
    const lm = new LoanManagementPage(await asPersona('loanAccountOfficer'));
    const m = await lm.bookOnBehalf(customerId, 'Public Sector');
    await m.fill(/corridor|employer/i, 'Unknown Employer Plc');
    await expect(m.root()).toContainText(/don.t currently serve|not (an )?eligible|no matching corridor/i);
  });

  for (const model of MODELS) test(title(`${modelTitle(model)}: Book Public Sector on behalf — amount above corridor DTI affordability rejected with oracle max`, Tag.crit, Tag.spec('AdminPRD:PublicSector'), Tag.spec('PublicSector§9'), Tag.spec('LoanSpec§4.2')), async ({ asPersona, hooks }) => {
    const salaryBasis = 400_000;
    const deductions = 20_000;
    const tenor = 24;
    const cfg = CORRIDORS[LAGOS];
    await hooks.setProductConfig({ product: 'PUBLIC_SECTOR', patch: { interestModel: model } });
    // Month-1 instalment (P/N + P×r) is the binding DTI constraint under both models.
    const max = loans.maxAffordablePrincipal(salaryBasis, cfg.dtiPct, deductions, monthlyRate(LAGOS), tenor);
    const { customerId } = await hooks.seedCustomer({ tier: 3, walletBalance: 0, monthlySalary: salaryBasis, employer: LAGOS });
    const lm = new LoanManagementPage(await asPersona('loanAccountOfficer'));
    const m = await lm.bookOnBehalf(customerId, 'Public Sector');
    await m.select(/corridor|employer/i, LAGOS);
    await m.fill(/salary basis/i, salaryBasis);
    await m.fill(/existing deductions/i, deductions);
    await m.fill(/retirement date/i, iso(addMonths(new Date(), 120)));
    await m.select(/tenor/i, `${tenor} months`);
    await m.fill(/amount/i, max.plus(1_000).toNumber());
    await m.expectValidationError(/affordability|exceeds/i);
    await expect(m.root()).toContainText(formatNaira(max)); // "Try up to ₦X"
    await m.fill(/amount/i, max.minus(1_000).floor().toNumber());
    await m.submit();
    await m.expectValidationError(/evidence/i);
    await m.evidence.fillDefault();
    await m.submit();
    await m.expectApplied();
    const notes = await hooks.latestNotifications(customerId);
    expect(notes.some((n) => /submitted|in review/i.test(`${n.title} ${n.body}`))).toBe(true);
  });

  test(title('Book Public Sector on behalf: tenor beyond retirement date is capped per oracle', Tag.crit, Tag.spec('AdminPRD:PublicSector'), Tag.spec('PublicSector§9')), async ({ asPersona, hooks }) => {
    const today = new Date();
    const retirement = addMonths(today, 20);
    const cap = loans.maxTenorByRetirement(today, retirement);
    const { customerId } = await hooks.seedCustomer({ tier: 3, walletBalance: 0, monthlySalary: 500_000, employer: LAGOS });
    const lm = new LoanManagementPage(await asPersona('loanAccountOfficer'));
    const m = await lm.bookOnBehalf(customerId, 'Public Sector');
    await m.select(/corridor|employer/i, LAGOS);
    await m.fill(/salary basis/i, 500_000);
    await m.fill(/retirement date/i, iso(retirement));
    await m.fill(/amount/i, 300_000);
    await m.select(/tenor/i, '24 months');
    await m.expectValidationError(new RegExp(`retirement.*${cap} months|${cap} months.*retirement|reduce tenor to ${cap}`, 'i'));
  });

  test(title('Book Public Sector on behalf: consent letter required by corridor and control-gate docs above threshold', Tag.crit, Tag.spec('AdminPRD:PublicSector'), Tag.spec('PublicSector§5')), async ({ asPersona, hooks }) => {
    const cfg = CORRIDORS[IPPIS];
    const amount = cfg.controlGateThreshold + 500_000;
    const { customerId } = await hooks.seedCustomer({ tier: 3, walletBalance: 0, monthlySalary: 2_500_000, employer: IPPIS });
    const lm = new LoanManagementPage(await asPersona('loanAccountOfficer'));
    const m = await lm.bookOnBehalf(customerId, 'Public Sector');
    await m.select(/corridor|employer/i, IPPIS);
    await m.fill(/ippis number/i, 'IPPIS123456');
    await m.fill(/salary basis/i, 2_500_000);
    await m.fill(/retirement date/i, iso(addMonths(new Date(), 120)));
    await m.select(/tenor/i, '24 months');
    await m.fill(/amount/i, amount);
    await expect(lm.requiredDocs()).toContainText(/consent letter/i);
    await expect(lm.requiredDocs()).toContainText(/house visitation/i);
    await expect(lm.requiredDocs()).toContainText(/utility bill/i);
    await m.evidence.fillDefault();
    await m.submit();
    await m.expectValidationError(/consent letter/i);
    await lm.uploadRequiredDoc(/consent letter/i);
    await m.submit();
    await m.expectValidationError(/control-gate|house visitation|utility bill|cheque/i);
    await lm.uploadRequiredDocs();
    await m.submit();
    await m.expectApplied();
    const audit = await hooks.auditEntries({ action: 'public_sector.book', limit: 1 });
    expect(audit[0].evidence).toBeTruthy();
  });

  for (const amount of [800_000, 2_500_000, 7_000_000]) {
    test(title(`Approve Public Sector ${formatNaira(amount)} at corridor band; under-authority blocked`, Tag.crit, Tag.spec('AdminPRD:PublicSector')), async ({ browser, asPersona, hooks }) => {
      const band = loans.approvalBand(amount, CORRIDORS[IPPIS].approvalBands);
      const { customerId } = await hooks.seedCustomer({ tier: 3, walletBalance: 0 });
      const { loanId } = await hooks.seedLoan({
        customerId, product: 'PUBLIC_SECTOR', state: 'UNDERWRITING', amount,
        extra: { corridor: IPPIS, consentLetter: 'VERIFIED', controlGateDocs: amount > CORRIDORS[IPPIS].controlGateThreshold ? [{ name: 'House visitation report', status: 'APPROVED', uploadedDaysAgo: 5 }, { name: 'Utility bill', status: 'APPROVED', uploadedDaysAgo: 5 }] : [] },
      });
      const below = band === 'EXECUTIVE' ? 'crm' : roleBelowBand(band);
      const under = below ? new LoanManagementPage(await asRole(browser, below)) : new LoanManagementPage(await asPersona('loanAccountOfficer'));
      await under.openLoan(loanId);
      await under.expectAuthorityBlocked(/^approve/i);

      const lm = new LoanManagementPage(await asRole(browser, psApprover(amount, IPPIS)));
      await lm.openLoan(loanId);
      const m = await lm.startAction(/^approve/i);
      await m.evidence.fillDefault();
      await m.submit();
      await m.expectApplied();
      await lm.expectState(/ready to disburse/i);
      const notes = await hooks.latestNotifications(customerId);
      expect(notes.some((n) => /public sector loan approved/i.test(`${n.title} ${n.body}`))).toBe(true);
    });
  }

  test(title('Review control-gate docs: a failed or stale doc blocks approval; re-upload request pushes customer', Tag.crit, Tag.spec('AdminPRD:PublicSector')), async ({ browser, hooks }) => {
    const cfg = CORRIDORS[IPPIS];
    const amount = cfg.controlGateThreshold + 200_000;
    const { customerId } = await hooks.seedCustomer({ tier: 3, walletBalance: 0 });
    const { loanId } = await hooks.seedLoan({
      customerId, product: 'PUBLIC_SECTOR', state: 'UNDERWRITING', amount,
      extra: {
        corridor: IPPIS, consentLetter: 'VERIFIED',
        controlGateDocs: [
          { name: 'House visitation report', status: 'PENDING', uploadedDaysAgo: 10 },
          { name: 'Utility bill', status: 'PENDING', uploadedDaysAgo: cfg.docFreshnessDays + 5 },
        ],
      },
    });
    const uw = new LoanManagementPage(await asRole(browser, 'underwriter'));
    await uw.openLoan(loanId);
    await uw.tab('Control-gate docs');
    await expect(uw.controlGateDoc(/utility bill/i)).toContainText(/stale|expired|outside freshness/i);
    await uw.reviewControlGateDoc(/house visitation/i, 'Approve');
    await uw.reviewControlGateDoc(/utility bill/i, 'Request re-upload', 'Utility bill older than 90 days');
    await expect(uw.controlGateDoc(/utility bill/i)).toContainText(/re-upload requested/i);
    const notes = await hooks.latestNotifications(customerId);
    expect(notes.some((n) => n.channel === 'PUSH' && /re-upload|utility bill/i.test(`${n.title} ${n.body}`))).toBe(true);

    const approver = new LoanManagementPage(await asRole(browser, psApprover(amount, IPPIS)));
    await approver.openLoan(loanId);
    await approver.detail.expectActionDisabled(/^approve/i);
  });

  test(title('Verify consent letter is silent to customer; reject sends re-upload push', Tag.high, Tag.spec('AdminPRD:PublicSector')), async ({ browser, hooks }) => {
    const { customerId } = await hooks.seedCustomer({ tier: 3, walletBalance: 0 });
    const { loanId } = await hooks.seedLoan({ customerId, product: 'PUBLIC_SECTOR', state: 'UNDERWRITING', amount: 800_000, extra: { corridor: IPPIS, consentLetter: 'UPLOADED' } });
    const before = (await hooks.latestNotifications(customerId, 20)).length;
    const uw = new LoanManagementPage(await asRole(browser, 'underwriter'));
    await uw.openLoan(loanId);
    await uw.tab('Consent letter');
    await uw.verifyConsentLetter();
    await expect(uw.consentLetter()).toContainText(/verified/i);
    expect((await hooks.latestNotifications(customerId, 20)).length).toBe(before);

    const { customerId: c2 } = await hooks.seedCustomer({ tier: 3, walletBalance: 0 });
    const { loanId: l2 } = await hooks.seedLoan({ customerId: c2, product: 'PUBLIC_SECTOR', state: 'UNDERWRITING', amount: 800_000, extra: { corridor: IPPIS, consentLetter: 'UPLOADED' } });
    await uw.openLoan(l2);
    await uw.tab('Consent letter');
    await uw.rejectConsentLetter('Not signed');
    await expect(uw.consentLetter()).toContainText(/rejected/i);
    const notes = await hooks.latestNotifications(c2);
    expect(notes.some((n) => n.channel === 'PUSH' && /consent letter/i.test(`${n.title} ${n.body}`))).toBe(true);
  });

  test(title('Reassign corridor (break-glass): Head of Credit proposes, self-approval blocked, Compliance signs off; re-underwritten', Tag.crit, Tag.spec('AdminPRD:PublicSector'), Tag.spec('AdminPRD:ApprovalQueue')), async ({ asPersona, hooks }) => {
    const { customerId } = await hooks.seedCustomer({ tier: 3, walletBalance: 0 });
    const { loanId, reference } = await hooks.seedLoan({ customerId, product: 'PUBLIC_SECTOR', state: 'UNDERWRITING', amount: 900_000, extra: { corridor: IPPIS } });
    const before = (await hooks.latestNotifications(customerId, 20)).length;
    const proposer = await asPersona('headOfCredit');
    const lm = new LoanManagementPage(proposer);
    await lm.openLoan(loanId);
    const m = await lm.startAction(/reassign corridor/i);
    await m.select(/new corridor/i, LAGOS);
    await m.fill(/reason/i, 'Customer is Lagos State staff, not federal');
    await m.submit();
    await m.expectValidationError(/evidence/i);
    await m.evidence.fillDefault();
    await m.submit();
    await m.expectRoutedToApproval();

    const own = new ApprovalQueuePage(proposer);
    await own.goto();
    await own.open(new RegExp(reference));
    await own.expectSelfApprovalBlocked();

    const q = new ApprovalQueuePage(await asPersona('compliance'));
    await q.goto();
    await q.open(new RegExp(reference));
    await q.expectComplianceStepRequired();
    await q.approve('Corridor correction verified');

    await lm.openLoan(loanId);
    await lm.expectState(/underwriting/i);
    await lm.tab('Decisioning');
    await expect(lm.decisioning('corridor')).toContainText(LAGOS);
    await expect(lm.decisioning('dti')).toContainText(`${CORRIDORS[LAGOS].dtiPct}`);
    await expect(lm.detail.field('customer-status')).toHaveText(/in review/i);
    expect((await hooks.auditEntries({ targetId: loanId, limit: 1 }))[0].prominent).toBe(true);
    expect((await hooks.latestNotifications(customerId, 20)).length).toBe(before);
  });

  test(title('Retirement-date approach → Accept risk requires a note and writes prominent audit', Tag.crit, Tag.spec('AdminPRD:PublicSector')), async ({ asPersona, hooks }) => {
    const { customerId } = await hooks.seedCustomer({ tier: 3, walletBalance: 0 });
    const { loanId } = await hooks.seedLoan({
      customerId, product: 'PUBLIC_SECTOR', state: 'LIVE_SERVICING', amount: 1_000_000,
      extra: { corridor: LAGOS, retirementDate: iso(addMonths(new Date(), 3)), tenorMonths: 12, flag: 'RETIREMENT_APPROACH' },
    });
    const lm = new LoanManagementPage(await asPersona('headOfPublicSector'));
    await lm.openLoan(loanId);
    await expect(lm.flagBanner()).toContainText(/retirement/i);
    const m = await lm.startAction(/retirement/i);
    await m.select(/action/i, 'Accept risk');
    await m.evidence.fillDefault();
    await m.submit();
    await m.expectValidationError(/note/i);
    await m.fill(/note/i, 'Gratuity assignment on file covers residual balance');
    await m.submit();
    await m.expectApplied();
    expect((await hooks.auditEntries({ targetId: loanId, limit: 1 }))[0].prominent).toBe(true);
  });

  test(title('Retirement-date approach → Restructure must stay within the retirement cap', Tag.crit, Tag.spec('AdminPRD:PublicSector')), async ({ asPersona, hooks }) => {
    const today = new Date();
    const retirement = addMonths(today, 9);
    const cap = loans.maxTenorByRetirement(today, retirement);
    const { customerId } = await hooks.seedCustomer({ tier: 3, walletBalance: 0 });
    const { loanId } = await hooks.seedLoan({
      customerId, product: 'PUBLIC_SECTOR', state: 'LIVE_SERVICING', amount: 600_000,
      extra: { corridor: LAGOS, retirementDate: iso(retirement), tenorMonths: 18, flag: 'RETIREMENT_APPROACH' },
    });
    const lm = new LoanManagementPage(await asPersona('headOfCredit'));
    await lm.openLoan(loanId);
    const m = await lm.startAction(/retirement/i);
    await m.select(/action/i, 'Restructure');
    await m.fill(/new tenor/i, cap + 1);
    await m.reasonCode('Retirement approach');
    await m.evidence.fillDefault();
    await m.submit();
    await m.expectValidationError(/retirement/i);
    await m.fill(/new tenor/i, cap);
    await m.submit();
    await m.expectApplied();
    await lm.tab('Schedule');
    await expect(lm.scheduleRows()).toHaveCount(cap);
  });

  for (const model of MODELS) test(title(`${modelTitle(model)}: Salary change → Restructure recalculates instalment per oracle; Continue records risk acceptance`, Tag.high, Tag.spec('AdminPRD:PublicSector'), Tag.spec('LoanSpec§4.2')), async ({ asPersona, hooks }) => {
    const outstanding = 700_000;
    const rate = monthlyRate(LAGOS);
    const newTenor = 24;
    await hooks.setProductConfig({ product: 'PUBLIC_SECTOR', patch: { interestModel: model } });
    const { customerId } = await hooks.seedCustomer({ tier: 3, walletBalance: 0 });
    const { loanId } = await hooks.seedLoan({ customerId, product: 'PUBLIC_SECTOR', state: 'LIVE_SERVICING', amount: outstanding, extra: { corridor: LAGOS, ratePct: CORRIDORS[LAGOS].ratePct, monthlyRatePct: rate.toNumber(), interestModel: model, tenorMonths: 12, flag: 'SALARY_REDUCTION' } });
    const lm = new LoanManagementPage(await asPersona('headOfPublicSector'));
    await lm.openLoan(loanId);
    const m = await lm.startAction(/salary change/i);
    await m.select(/action/i, 'Restructure');
    await m.select(/new tenor/i, `${newTenor} months`);
    await m.fill(/reason/i, 'Salary reduced after grade adjustment');
    await m.evidence.fillDefault();
    await m.submit();
    await m.expectApplied();
    // ASSUMPTION: "monthly repayment" shows the month-1 instalment (highest under Model B; constant under Model A).
    await expect(lm.detail.field('monthly-repayment')).toContainText(formatNaira(loans.firstInstalment(outstanding, rate, newTenor, model)));

    const { loanId: l2 } = await hooks.seedLoan({ customerId, product: 'PUBLIC_SECTOR', state: 'LIVE_SERVICING', amount: outstanding, extra: { corridor: LAGOS, flag: 'SALARY_REDUCTION' } });
    await lm.openLoan(l2);
    const m2 = await lm.startAction(/salary change/i);
    await m2.select(/action/i, 'Continue');
    await m2.fill(/reason/i, 'Reduction still within DTI');
    await m2.evidence.fillDefault();
    await m2.submit();
    await m2.expectApplied();
    await lm.tab('Audit trail');
    await expect(lm.detail.auditRows().filter({ hasText: /risk accept/i }).first()).toBeVisible();
  });

  test(title('Configured interest model drives the loan-detail schedule: Model A (monthly equal) vs Model B (monthly reducing)', Tag.crit, Tag.spec('AdminPRD:PublicSector'), Tag.spec('LoanSpec§4.2'), Tag.spec('LoanSpec§4.3')), async ({ asPersona, hooks }) => {
    const principal = 1_200_000;
    const rate = monthlyRate(IPPIS);
    const tenor = 12;
    const lm = new LoanManagementPage(await asPersona('loanAccountOfficer'));
    const lastRowText: Record<string, string> = {};
    for (const model of MODELS) {
      await hooks.setProductConfig({ product: 'PUBLIC_SECTOR', patch: { interestModel: model } });
      const { customerId } = await hooks.seedCustomer({ tier: 3, walletBalance: 0 });
      const { loanId } = await hooks.seedLoan({ customerId, product: 'PUBLIC_SECTOR', state: 'LIVE_SERVICING', amount: principal, extra: { corridor: IPPIS, ratePct: CORRIDORS[IPPIS].ratePct, monthlyRatePct: rate.toNumber(), interestModel: model, tenorMonths: tenor } });
      const expected = loans.loanSchedule(principal, rate, tenor, model);
      await lm.openLoan(loanId);
      await lm.tab('Schedule');
      await expect(lm.scheduleRows()).toHaveCount(tenor);
      for (const [i, row] of expected.entries()) {
        const ui = lm.scheduleRows().nth(i);
        await expect(ui, `${modelTitle(model)} row ${row.n} total due`).toContainText(formatNaira(row.totalDue));
        await expect(ui, `${modelTitle(model)} row ${row.n} interest`).toContainText(formatNaira(row.interest));
        await expect(ui, `${modelTitle(model)} row ${row.n} principal`).toContainText(formatNaira(row.principal));
        await expect(ui, `${modelTitle(model)} row ${row.n} balance`).toContainText(formatNaira(row.balanceAfter));
      }
      lastRowText[model] = (await lm.scheduleRows().last().innerText()).trim();
    }
    const a = loans.loanSchedule(principal, rate, tenor, 'A');
    const b = loans.loanSchedule(principal, rate, tenor, 'B');
    expect(a[tenor - 1].interest.gt(b[tenor - 1].interest)).toBe(true);
    expect(lastRowText.A).not.toBe(lastRowText.B);
  });

  test(title('Loan account officer cannot reassign corridor or handle retirement approach', Tag.high, Tag.smoke, Tag.spec('AdminPRD:PublicSector')), async ({ asPersona, hooks }) => {
    const { customerId } = await hooks.seedCustomer({ tier: 3, walletBalance: 0 });
    const { loanId } = await hooks.seedLoan({ customerId, product: 'PUBLIC_SECTOR', state: 'LIVE_SERVICING', amount: 600_000, extra: { corridor: LAGOS, flag: 'RETIREMENT_APPROACH' } });
    const lm = new LoanManagementPage(await asPersona('loanAccountOfficer'));
    await lm.openLoan(loanId);
    await lm.detail.expectActionAbsent(/reassign corridor|retirement|salary change/i);
  });
});
