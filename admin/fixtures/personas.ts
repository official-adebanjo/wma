import * as path from 'path';

/**
 * Admin personas — the "Roles" column of the Admin PRD action inventory.
 * Each persona maps to ADMIN_<KEY>_EMAIL / ADMIN_<KEY>_PASSWORD in .env and gets its own
 * stored session (.auth/<key>.json) created once by auth.setup.ts.
 */
export const personas = {
  superAdmin: 'SUPER_ADMIN',
  compliance: 'COMPLIANCE',
  kycReviewer: 'KYC_REVIEWER',
  treasuryOfficer: 'TREASURY_OFFICER',
  headOfCrm: 'HEAD_OF_CRM',
  headOfOps: 'HEAD_OF_OPS',
  headOfCredit: 'HEAD_OF_CREDIT',
  loanAccountOfficer: 'LOAN_ACCOUNT_OFFICER',
  collectionsOfficer: 'COLLECTIONS_OFFICER',
  payrollOpsLead: 'PAYROLL_OPS_LEAD',
  headOfPublicSector: 'HEAD_OF_PUBLIC_SECTOR',
  marketing: 'MARKETING',
  headOfMarketing: 'HEAD_OF_MARKETING',
  productManager: 'PRODUCT_MANAGER',
  cpo: 'CPO',
  headOfTreasury: 'HEAD_OF_TREASURY',
  supportAgent: 'SUPPORT_AGENT',
  readOnly: 'READ_ONLY',
} as const;

export type Persona = keyof typeof personas;

export const storageStatePath = (p: Persona) => path.resolve(__dirname, `../../.auth/${personas[p]}.json`);

export function credsFor(p: Persona): { email: string; password: string } | undefined {
  const key = personas[p];
  const email = process.env[`ADMIN_${key}_EMAIL`];
  const password = process.env[`ADMIN_${key}_PASSWORD`];
  return email && password ? { email, password } : undefined;
}
