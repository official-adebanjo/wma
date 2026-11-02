import { expect } from '@wdio/globals';
import { Tag, title } from '../../../shared/support/tags';
import { hasPersona, loginAs, openTab, personaCreds } from '../../helpers/session';
import { driver } from '../../screens/BaseScreen';
import { resetApp } from '../../screens/common/AuthScreens';
import { ProfileScreen, SettingsScreen, messageAfter } from '../../screens/common/JourneyScreens';

/**
 * Profile journeys (Settings → Profile) on the live dev build, signed in as Tier 3.
 *  - Employment: one field is changed, saved, checked and changed back.
 *  - Next of kin: saves a clearly fake test contact (it could not be saved at all on 2026-11-02).
 *  - Address: only tried while none is on file; the check passes if it saves or the app says why not.
 */
describe('Journeys › Profile (Tier 3 persona)', () => {
  const settings = new SettingsScreen();
  const profile = new ProfileScreen();

  async function openProfile(tab: 'personal' | 'kin' | 'employment') {
    if (await profile.isShown()) await profile.goBack().catch(() => undefined);
    if (!(await settings.isShown())) await openTab('profile');
    await settings.waitForShown();
    await settings.openProfile();
    await profile.waitForShown();
    if (tab !== 'personal') await profile.openTab(tab);
    await driver.pause(1_500); // tab content loads after the switch
  }

  before(async function () {
    if (!hasPersona('T3')) this.skip();
    await resetApp();
    await loginAs(personaCreds('T3', 'email'));
  });

  it(title('employment details can be edited and saved', Tag.med), async () => {
    await openProfile('employment');
    const original = await profile.jobTitle();
    const changed = `${original} QA`;
    try {
      await profile.setJobTitle(changed);
      await profile.saveEmployment();
      await openProfile('employment');
      await expect(await profile.jobTitle()).toBe(changed);
    } finally {
      await openProfile('employment');
      if ((await profile.jobTitle()) !== original) {
        await profile.setJobTitle(original);
        await profile.saveEmployment();
      }
    }
    await openProfile('employment');
    await expect(await profile.jobTitle()).toBe(original);
  });

  it(title('next of kin can be saved', Tag.high, Tag.spec('KYCV4')), async () => {
    await openProfile('kin');
    await profile.fillKin({ name: 'QA Test Kin', relationship: 'Brother', phone: '+2348000000001', address: '1 QA Close, Ikeja' });
    const msg = await messageAfter(() => profile.saveKin());
    await openProfile('kin');
    const name = await (await driver.$$('//android.widget.EditText'))[0].getText();
    console.log(`Next of kin: message "${msg ?? 'none'}", name after reopening "${name}"`);
    await expect(msg ?? 'no message').not.toMatch(/cannot|required|invalid|error|failed/i);
    await expect(name).toBe('QA Test Kin');
  });

  it(title('adding a home address saves it or tells the customer why not', Tag.med), async function () {
    await openProfile('personal');
    if ((await profile.addressText()) !== 'Add your address') this.skip(); // an address is already shown — leave it alone
    await profile.enterAddress('12 QA Test Street', 'Lagos', 'Agege');
    const msg = await messageAfter(() => profile.savePersonal());
    await openProfile('personal');
    const after = await profile.addressText();
    const outcome = after !== 'Add your address' ? `saved: "${after}"` : msg ? `refused with a message: ${msg}` : 'not saved, and no message';
    console.log(`Home address: ${outcome}`);
    await expect(outcome).not.toBe('not saved, and no message');
  });
});
