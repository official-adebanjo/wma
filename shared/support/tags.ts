/**
 * Tagging convention shared by Playwright and WebdriverIO (Mocha) titles.
 * Tags are embedded in the test title so `--grep` works in both runners and the
 * JUnit output carries them into TestRail (QA Strategy §13 stage 4).
 *
 *   Risk (QA Strategy §7):     @crit  @high  @med  @low
 *   Suite:                     @smoke  @regression
 *   Class (§8):                @classA  @classB  @classC
 *   Traceability:              @C<testrail-case-id>  @JIRA-<key>   (fill in as cases are imported)
 *   Spec reference:            @spec:<doc>§<section>   e.g. @spec:RWIN§9
 *   Open question:             @open:<id>   e.g. @open:W2 — assertion depends on an unanswered clarity question
 */
export const Tag = {
  crit: '@crit',
  high: '@high',
  med: '@med',
  low: '@low',
  smoke: '@smoke',
  regression: '@regression',
  classA: '@classA',
  classB: '@classB',
  spec: (ref: string) => `@spec:${ref.replace(/\s+/g, '')}`,
  open: (id: string) => `@open:${id}`,
} as const;

export function title(name: string, ...tags: string[]): string {
  return `${name} ${tags.join(' ')}`.trim();
}

/**
 * Open clarity questions (Investment_Products_Calculation_Clarity_Questions.docx) that
 * currently block a firm expected value. Specs tagged with these run against the
 * *suggested default*; flip the flag when Product/Finance confirm the answer.
 */
export const openQuestions: Record<string, { summary: string; defaultAssumed: string; confirmed: boolean }> = {
  X1: { summary: 'WHT rate/timing (10% spec vs 9% RTN form)', defaultAssumed: '10%, after penalty', confirmed: false },
  X4: { summary: 'Gross vs net as headline figure', defaultAssumed: 'Net primary, gross secondary', confirmed: false },
  W1: { summary: 'RWIN simple vs compound in cycle', defaultAssumed: 'Simple (Calculator Spec §3.2)', confirmed: true },
  W2: { summary: 'RWIN interest treatment on mid-cycle withdrawal', defaultAssumed: 'none — Treasury to decide', confirmed: false },
  W3: { summary: 'RWIN tranche per autosave vs pooled', defaultAssumed: 'One tranche per debit', confirmed: false },
  W4: { summary: 'RWIN cap scope', defaultAssumed: 'Per customer; warn at 90%', confirmed: false },
  E3: { summary: 'REAP "target met" basis', defaultAssumed: 'Contributions only, at maturity', confirmed: false },
  E4: { summary: 'REAP contributions above target', defaultAssumed: 'Allow with soft warning', confirmed: false },
  E5: { summary: 'REAP pace tolerance', defaultAssumed: 'One scheduled contribution', confirmed: false },
  E6: { summary: 'REAP forfeiture %', defaultAssumed: '100% of interest; principal never reduced', confirmed: false },
  T1: { summary: 'RTN matrix band edges', defaultAssumed: 'Whole-amount, lower-inclusive', confirmed: false },
  T4: { summary: 'RTN upfront-interest recovery on early exit', defaultAssumed: 'Recover unearned from principal', confirmed: false },
  T5: { summary: 'RTN penalty source', defaultAssumed: 'Linked ladder fixed at booking', confirmed: false },
  T7: { summary: 'RTN force-liquidate instant vs reviewed', defaultAssumed: 'Instant below threshold', confirmed: false },
  T9: { summary: 'RTN large-placement confirmation state', defaultAssumed: 'No state', confirmed: false },
  T11: { summary: 'RTN top-up', defaultAssumed: 'Off for launch', confirmed: false },
  // Raised while building the suite (not in the Clarity Questions document):
  'CALC-TIER': { summary: 'Calculator Spec requires Tier 2 for all investments; RTN spec allows individual RTN at Tier 1; Admin PRD allows REAP on behalf at Tier 1+', defaultAssumed: 'RTN individual Tier 1; REAP/RWIN Tier 2', confirmed: false },
  'TIER1-LIMITS': { summary: 'KYC V4: Tier 1 single transfer ₦300,000 exceeds its ₦20,000 daily limit — likely transposed', defaultAssumed: 'As published', confirmed: false },
  TM1: { summary: 'Admin PRD [M]/[C] approve markers never defined', defaultAssumed: 'Separate "approve [M]" / "approve [C]" grants per module', confirmed: false },
  'RTN-INV': { summary: 'Rate-matrix "invariants enforced" not listed', defaultAssumed: 'Non-negative; non-decreasing by tenor and by amount band', confirmed: false },
  'L-*': { summary: 'Loan money rules not in specs (streak reset on late repayment, Payday early-repay rebate, settlement accrual basis, upfront fees, out-of-cycle allocation)', defaultAssumed: 'See @open:L-… tagged tests', confirmed: false },
};
