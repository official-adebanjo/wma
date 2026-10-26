import * as path from 'path';
import { sharedConfig } from './wdio.shared.conf';

/** Local iOS simulator via Appium 2 (XCUITest). macOS only. */
export const config: WebdriverIO.Config = {
  ...sharedConfig,
  hostname: process.env.APPIUM_HOST ?? '127.0.0.1',
  port: Number(process.env.APPIUM_PORT ?? 4723),
  services: [['appium', { command: 'appium' }]],
  capabilities: [
    {
      platformName: 'iOS',
      'appium:automationName': 'XCUITest',
      'appium:deviceName': process.env.IOS_DEVICE_NAME ?? 'iPhone 15',
      'appium:platformVersion': process.env.IOS_PLATFORM_VERSION ?? '17.5',
      'appium:app': path.resolve(process.env.IOS_APP_PATH ?? './apps/rosabon-dev.app'),
      'appium:bundleId': process.env.APP_BUNDLE_ID ?? 'com.rosabon.unified',
      'appium:autoAcceptAlerts': true,
      'appium:newCommandTimeout': 240,
    },
  ],
};
