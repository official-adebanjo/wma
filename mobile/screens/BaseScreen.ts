import { $, $$, browser, driver, expect } from '@wdio/globals';
import type { ChainablePromiseElement } from 'webdriverio';
import Decimal from 'decimal.js';
import { parseNaira } from '../../shared/calc/money';
import { LIVE_IDS, liveSelector } from './live-ids';

/**
 * Selector strategy.
 *
 * Every element is addressed by a stable test ID (React Native `testID` / Flutter `Key` /
 * native accessibilityIdentifier). The IDs used in screen objects form the contract the
 * mobile developers implement — see docs/SELECTOR-CONTRACT.md. Convention:
 *     <module>.<screen>.<element>          e.g. rwin.booking.deposit.input
 *
 * `byId` resolves to accessibility id (`~id`) which works on both iOS and Android when the
 * app maps testID → accessibilityIdentifier / content-desc. If the Android build maps testID
 * to resource-id instead, set MOBILE_ID_STRATEGY=resource-id.
 */
export function byId(testId: string): ChainablePromiseElement {
  if (driver.isAndroid && LIVE_IDS[testId]) return $(liveSelector(LIVE_IDS[testId]));
  if (driver.isAndroid && process.env.MOBILE_ID_STRATEGY === 'resource-id') {
    return $(`android=new UiSelector().resourceIdMatches(".*${testId.replace(/\./g, '\\\\.')}$")`);
  }
  return $(`~${testId}`);
}

/** Every element matching a test ID (rows in a list). */
export function allById(testId: string) {
  if (driver.isAndroid && LIVE_IDS[testId]) return $$(liveSelector(LIVE_IDS[testId]));
  if (driver.isAndroid && process.env.MOBILE_ID_STRATEGY === 'resource-id') {
    return $$(`android=new UiSelector().resourceIdMatches(".*${testId.replace(/\./g, '\\\\.')}$")`);
  }
  return $$(`~${testId}`);
}

/** Visible-text lookup for copy assertions (copy is "EXAMPLE COPY (NOT FINAL)" — prefer partial matches). */
export function byText(text: string): ChainablePromiseElement {
  return driver.isAndroid
    ? $(`android=new UiSelector().textContains("${text.replace(/"/g, '\\"')}")`)
    : $(`-ios predicate string:label CONTAINS "${text.replace(/"/g, '\\"')}" OR value CONTAINS "${text.replace(/"/g, '\\"')}"`);
}

export abstract class BaseScreen {
  /** Root element whose presence proves the screen is shown. */
  protected abstract readonly root: string;

  async waitForShown(timeout = 20_000): Promise<this> {
    await byId(this.root).waitForDisplayed({ timeout });
    return this;
  }

  async isShown(): Promise<boolean> {
    return byId(this.root).isDisplayed().catch(() => false);
  }

  protected el(id: string) {
    return byId(id);
  }

  protected async tap(id: string): Promise<void> {
    const e = byId(id);
    await e.waitForDisplayed();
    // RN views carrying the testID are often not `clickable` themselves (the touchable is a
    // parent/child), and UiAutomator element clicks on them are dropped — tap the centre instead.
    if (driver.isAndroid && (await e.getAttribute('clickable')) !== 'true') {
      const { x, y, width, height } = await driver.getElementRect(await e.elementId);
      await driver.execute('mobile: clickGesture', { x: Math.round(x + width / 2), y: Math.round(y + height / 2) });
      return;
    }
    await e.click();
  }

  protected async type(id: string, value: string | number): Promise<void> {
    const e = byId(id);
    await e.waitForDisplayed();
    await e.clearValue();
    await e.setValue(String(value));
    await hideKeyboard();
  }

  protected async text(id: string): Promise<string> {
    const e = byId(id);
    await e.waitForDisplayed();
    return (await e.getText()).trim();
  }

  protected async amount(id: string): Promise<Decimal> {
    return parseNaira(await this.text(id));
  }

  protected async isEnabled(id: string): Promise<boolean> {
    const e = byId(id);
    await e.waitForDisplayed();
    return e.isEnabled();
  }

  protected async isChecked(id: string): Promise<boolean> {
    const e = byId(id);
    const attr = driver.isAndroid ? await e.getAttribute('checked') : await e.getAttribute('value');
    return attr === 'true' || attr === '1';
  }

  protected async exists(id: string, timeout = 3_000): Promise<boolean> {
    return byId(id).waitForDisplayed({ timeout }).then(() => true).catch(() => false);
  }

  async scrollTo(id: string, maxSwipes = 8): Promise<void> {
    for (let i = 0; i < maxSwipes; i++) {
      if (await byId(id).isDisplayed().catch(() => false)) return;
      await swipeUp();
    }
    throw new Error(`Element ${id} not found after ${maxSwipes} swipes`);
  }

  async goBack(): Promise<void> {
    await this.tap('common.header.back');
  }
}

export async function hideKeyboard(): Promise<void> {
  if (await driver.isKeyboardShown().catch(() => false)) {
    await driver.hideKeyboard().catch(() => undefined);
  }
}

export async function swipeUp(): Promise<void> {
  const { width, height } = await driver.getWindowSize();
  await driver
    .action('pointer', { parameters: { pointerType: 'touch' } })
    .move({ x: Math.round(width / 2), y: Math.round(height * 0.75) })
    .down()
    .pause(100)
    .move({ duration: 400, x: Math.round(width / 2), y: Math.round(height * 0.3) })
    .up()
    .perform();
}

/** Reusable assertion for "two-clause" inline errors used throughout the specs. */
export async function expectInlineError(fieldTestId: string, contains: string | RegExp): Promise<void> {
  const err = byId(`${fieldTestId}.error`);
  await err.waitForDisplayed();
  if (typeof contains === 'string') await expect(err).toHaveText(expect.stringContaining(contains));
  else await expect(err).toHaveText(contains);
}

export { browser, driver, expect };
