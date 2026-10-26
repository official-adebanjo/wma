import * as path from 'path';
import { sharedConfig } from './wdio.shared.conf';

/** Local Android emulator/device via Appium 2 (UiAutomator2). Start Appium yourself or let the service do it. */
export const config: WebdriverIO.Config = {
  ...sharedConfig,
  hostname: process.env.APPIUM_HOST ?? '127.0.0.1',
  port: Number(process.env.APPIUM_PORT ?? 4723),
  services: [['appium', { command: 'appium', args: { relaxedSecurity: true } }]],
  capabilities: [
    {
      platformName: 'Android',
      'appium:automationName': 'UiAutomator2',
      'appium:deviceName': process.env.ANDROID_DEVICE_NAME ?? 'Android Emulator',
      'appium:platformVersion': process.env.ANDROID_PLATFORM_VERSION ?? '14',
      'appium:app': path.resolve(process.env.ANDROID_APP_PATH ?? './apps/rosabon-dev.apk'),
      'appium:appPackage': process.env.APP_PACKAGE ?? 'com.rosabon.unified',
      'appium:autoGrantPermissions': true,
      'appium:newCommandTimeout': 240,
      'appium:noReset': false,
    },
  ],
};
