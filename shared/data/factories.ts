import { randomUUID } from 'crypto';

/** Synthetic test data only — QA Strategy §28.2: live customer profiles are never used. */

export const uid = (prefix = 'qa') => `${prefix}-${randomUUID().slice(0, 8)}`;

export const planName = (prefix = 'QA Plan') => `${prefix} ${randomUUID().slice(0, 4)}`.slice(0, 40);

/** NIBSS/NIMC test fixtures recognised by the dev identity-provider stub. */
export const identity = {
  validBvn: '22222222222',
  mismatchedBvn: '22222222299',
  validNin: '12345678901',
  mismatchedNin: '12345678999',
  tooShort: '1234567890',
  withLetters: '1234567890A',
};

export const testFiles = {
  /** Paths relative to repo root; generated on demand by shared/data/files.ts */
  validPdf: 'shared/data/files/sample-statement.pdf',
  validJpg: 'shared/data/files/sample-id.jpg',
  oversized: 'shared/data/files/oversized-11mb.pdf',
  unsupported: 'shared/data/files/sample.exe.txt',
};

export const reasons = {
  breakRequest: ['Emergency', 'Change of plans', 'Financial difficulty', 'Other'],
  loanPurpose: ['Home improvement', 'Education', 'Medical', 'Business', 'Debt consolidation', 'Personal use', 'Other'],
  nanoPurpose: ['Emergency', 'Bills', 'Airtime & Data', 'Other'],
  paydayPurpose: ['Emergency', 'Bills', 'Rent', 'Medical', 'Other'],
};
