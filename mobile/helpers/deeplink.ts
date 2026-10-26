import { driver } from '@wdio/globals';

/**
 * Deep links shorten setup for screens deep in a flow (e.g. open a specific plan).
 * Scheme is an assumption — confirm with mobile devs and update APP_SCHEME.
 */
const scheme = process.env.APP_SCHEME ?? 'rosabon';

export async function openDeepLink(pathAndQuery: string): Promise<void> {
  const url = `${scheme}://${pathAndQuery.replace(/^\//, '')}`;
  if (driver.isAndroid) {
    await driver.execute('mobile: deepLink', { url, package: process.env.APP_PACKAGE ?? 'com.rosabon.unified' });
  } else {
    await driver.execute('mobile: deepLink', { url, bundleId: process.env.APP_BUNDLE_ID ?? 'com.rosabon.unified' });
  }
}

export const links = {
  rwinPlan: (id: string) => `grow/rwin/plan/${id}`,
  reapPlan: (id: string) => `grow/reap/plan/${id}`,
  rtnPlacement: (id: string) => `grow/rtn/placement/${id}`,
  loan: (product: 'nano' | 'payday' | 'personal' | 'public-sector', id: string) => `borrow/${product}/loan/${id}`,
  kyc: 'profile/kyc',
  walletFund: 'wallet/fund',
  notifications: 'notifications',
};
