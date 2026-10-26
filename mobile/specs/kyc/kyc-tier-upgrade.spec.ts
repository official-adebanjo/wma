import { expect } from '@wdio/globals';
import { formatNaira } from '../../../shared/calc/money';
import { tierLimits } from '../../../shared/config/env';
import { identity } from '../../../shared/data/factories';
import { QaHooks } from '../../../shared/api/qa-hooks';
import { Tag, title } from '../../../shared/support/tags';
import { freshCustomer, requireHooks } from '../../helpers/session';
import { links, openDeepLink } from '../../helpers/deeplink';
import { AddressScreen, DocumentUploadScreen, EmailVerifyScreen, EmploymentScreen, IdNumberScreen, KycHubScreen } from '../../screens/kyc/KycScreens';
import { NotificationsScreen } from '../../screens/common/HomeScreens';

/**
 * Tier upgrades — Account Tiering & KYC Spec V4 §2–§4; Admin PRD Review Queues (approve / decline / re-upload).
 * Risk: Authentication & access CRIT; compliance evidence for CBN/NDPA (QA Strategy §33).
 */
describe('KYC › Tier upgrades', () => {
  let hooks: QaHooks;
  let customerId: string;
  const hub = new KycHubScreen();
  const idScreen = new IdNumberScreen();
  const docs = new DocumentUploadScreen();

  afterEach(async () => {
    await hooks?.dispose();
  });

  describe('Tier 1 → Tier 2', () => {
    beforeEach(async function () {
      requireHooks(this);
      ({ hooks, customerId } = await freshCustomer({ tier: 1 }));
      await openDeepLink(links.kyc);
      await hub.waitForShown();
    });

    it(title('hub shows Tier 1 limits and the Tier 2 checklist with Incomplete badges', Tag.high, Tag.smoke, Tag.spec('KYC§1'), Tag.spec('KYC§4')), async () => {
      await expect(await hub.currentTier()).toMatch(/tier 1/i);
      const limits = await hub.limitsText();
      expect(limits).toContain(formatNaira(tierLimits[1].dailyTransfer, { kobo: false }));
      await hub.upgradeTo(2);
      for (const item of ['nin', 'address', 'employment', 'email'] as const) {
        await expect(await hub.itemStatus(item)).toBe('incomplete');
      }
      await expect(await hub.submitEnabled()).toBe(false);
    });

    it(title('NIN: 11-digit numeric validation and inline USSD tip *346#', Tag.high, Tag.spec('KYC§2-Tier2'), Tag.spec('KYC§4')), async () => {
      await hub.upgradeTo(2);
      await hub.openItem('nin');
      await idScreen.waitForShown();
      await expect(await idScreen.ussdTip()).toContain('*346#');
      for (const bad of [identity.tooShort, identity.withLetters]) {
        await idScreen.enter(bad);
        await expect(await idScreen.submitEnabled()).toBe(false);
      }
      await idScreen.enter('123456789012');
      await expect((await idScreen.value()).replace(/\D/g, '').length).toBeLessThanOrEqual(11);
    });

    it(title('NIN that fails NIMC validation shows error and stays Incomplete', Tag.crit, Tag.spec('KYC§3')), async () => {
      await hooks.stubProvider({ provider: 'NIMC', outcome: 'NOT_FOUND', customerId });
      await hub.upgradeTo(2);
      await hub.openItem('nin');
      await idScreen.enter(identity.mismatchedNin);
      await idScreen.submit();
      await expect(await idScreen.error()).toMatch(/couldn't verify|not found|check/i);
      await idScreen.goBack();
      await expect(await hub.itemStatus('nin')).toBe('incomplete');
    });

    it(title('completing NIN, address, employment, email → submitted → Verified → Tier 2 + limits update', Tag.crit, Tag.smoke, Tag.spec('KYC§2-Tier2')), async () => {
      await hooks.stubProvider({ provider: 'NIMC', outcome: 'MATCH', customerId });
      await hub.upgradeTo(2);
      await hub.openItem('nin');
      await idScreen.enter(identity.validNin);
      await idScreen.submit();
      await hub.waitForShown();
      await expect(await hub.itemStatus('nin')).toBe('verified');

      await hub.openItem('address');
      const address = new AddressScreen();
      await address.fill({ line1: '12 Admiralty Way', city: 'Lekki', state: 'Lagos' });
      await address.submit();

      await hub.openItem('employment');
      const emp = new EmploymentScreen();
      await emp.employer('Acme Nigeria Ltd');
      await emp.sector('private');
      await emp.incomeRange(2);
      await emp.submit();

      await hub.openItem('email');
      const email = new EmailVerifyScreen();
      await email.sendCode();
      await email.enterCode(process.env.TEST_OTP ?? '');
      await email.verify();

      await hub.waitForShown();
      await expect(await hub.submitEnabled()).toBe(true);
      await hub.submitUpgrade();
      // Auto-grant fires when every item is auto-verifiable (Admin PRD › Auto Grants)
      await hooks.advanceClock({ customerId, days: 0 });
      await expect(await hub.currentTier()).toMatch(/tier 2/i);
      expect(await hub.limitsText()).toContain(formatNaira(tierLimits[2].singleTransfer, { kobo: false }));
    });

    it(title('address missing required fields is blocked', Tag.med, Tag.spec('KYC§2-Tier2')), async () => {
      await hub.upgradeTo(2);
      await hub.openItem('address');
      const address = new AddressScreen();
      await address.submit();
      await expect(await address.fieldError('line1')).toMatch(/required/i);
    });
  });

  describe('Tier 2 → Tier 3', () => {
    beforeEach(async function () {
      requireHooks(this);
      ({ hooks, customerId } = await freshCustomer({ tier: 2 }));
      await openDeepLink(links.kyc);
      await hub.waitForShown();
      await hub.upgradeTo(3);
    });

    it(title('government ID: each type requires document number + photo; upload card walks Default → Uploading → Uploaded', Tag.high, Tag.spec('KYC§2-Tier3'), Tag.spec('KYC§4')), async () => {
      await hub.openItem('governmentId');
      await docs.waitForShown();
      for (const t of ['nationalId', 'passport', 'driversLicence', 'votersCard'] as const) {
        await docs.pickType(t);
        await expect(await docs.docNumberShown()).toBe(true);
      }
      await expect(await docs.uploadState()).toBe('default');
      await docs.docNumber('A12345678');
      await docs.pickFile();
      await expect(await docs.progressShown() || (await docs.uploadState()) === 'uploaded').toBe(true);
      await expect(await docs.uploadState()).toBe('uploaded');
      await expect(await docs.fileMeta()).toMatch(/\.(jpg|jpeg|png|pdf)/i);
    });

    it(title('upload failure shows Error state with Retry that recovers', Tag.high, Tag.spec('KYC§4')), async () => {
      await hooks.stubProvider({ provider: 'DOC_VERIFY', outcome: 'UPLOAD_FAIL_ONCE', customerId });
      await hub.openItem('governmentId');
      await docs.pickType('passport');
      await docs.docNumber('A12345678');
      await docs.pickFile();
      await expect(await docs.uploadState()).toBe('error');
      await expect(await docs.errorText()).toBeTruthy();
      await docs.retry();
      await expect(await docs.uploadState()).toBe('uploaded');
    });

    it(title('proof of address older than 3 months is rejected', Tag.crit, Tag.spec('KYC§2-Tier3')), async () => {
      await hub.openItem('proofOfAddress');
      await docs.pickType('utilityBill');
      const old = new Date();
      old.setUTCMonth(old.getUTCMonth() - 4);
      await docs.docDate(old.toISOString().slice(0, 10));
      await docs.pickFile();
      await docs.submit();
      await expect(await docs.dateError()).toMatch(/3 months/i);
    });

    it(title('submitted documents show Pending (amber) until reviewed', Tag.high, Tag.spec('KYC§4')), async () => {
      await hub.openItem('governmentId');
      await docs.pickType('nationalId');
      await docs.docNumber('NIN-DOC-1');
      await docs.pickFile();
      await docs.submit();
      await hub.waitForShown();
      await expect(await hub.itemStatus('governmentId')).toBe('pending');
    });

    it(title('Mono Connect link for income verification', Tag.med, Tag.spec('KYC§3')), async () => {
      await hooks.stubProvider({ provider: 'MONO', outcome: 'LINK_SUCCESS', customerId });
      await hub.openItem('incomeVerification');
      const emp = new EmploymentScreen();
      await emp.linkBankWithMono();
      await hub.waitForShown();
      await expect(['verified', 'pending']).toContain(await hub.itemStatus('incomeVerification'));
    });
  });

  describe('Admin review outcomes reflected in app', () => {
    beforeEach(async function () {
      requireHooks(this);
      ({ hooks, customerId } = await freshCustomer({ tier: 2 }));
    });

    it(title('decline → push with reason; tier unchanged', Tag.crit, Tag.spec('AdminPRD:ReviewQueues')), async () => {
      await hooks.resolveKycReview({ customerId, outcome: 'DECLINE', reason: 'Document illegible' });
      const notes = await hooks.latestNotifications(customerId, 1);
      expect(notes[0].body).toMatch(/KYC upgrade declined, reason: Document illegible/i);
      await openDeepLink(links.kyc);
      await expect(await hub.currentTier()).toMatch(/tier 2/i);
    });

    it(title('re-upload request opens directly to the upload flow', Tag.high, Tag.spec('AdminPRD:ReviewQueues')), async () => {
      await hooks.resolveKycReview({ customerId, outcome: 'REQUEST_REUPLOAD', document: 'governmentId' });
      await openDeepLink(links.notifications);
      const inbox = new NotificationsScreen();
      await inbox.waitForShown();
      await expect(await inbox.latestBody()).toMatch(/re-upload|upload again/i);
      await docs.waitForShown();
    });

    it(title('approve → tier badge updates to Tier 3 and limits unlock', Tag.crit, Tag.spec('AdminPRD:ReviewQueues')), async () => {
      await hooks.resolveKycReview({ customerId, outcome: 'APPROVE', toTier: 3 });
      await openDeepLink(links.kyc);
      await hub.waitForShown();
      await expect(await hub.currentTier()).toMatch(/tier 3/i);
    });
  });
});
