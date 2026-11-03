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
      // Optional: pin a version / let Appium boot a named emulator (AVD) when none is running.
      ...(process.env.ANDROID_PLATFORM_VERSION ? { 'appium:platformVersion': process.env.ANDROID_PLATFORM_VERSION } : {}),
      ...(process.env.ANDROID_AVD ? { 'appium:avd': process.env.ANDROID_AVD, 'appium:avdLaunchTimeout': 180_000 } : {}),
      'appium:app': path.resolve(process.env.ANDROID_APP_PATH ?? './apps/rosabon-dev.apk'),
      'appium:appPackage': process.env.APP_PACKAGE ?? 'com.optisoft.rosabon',
      'appium:autoGrantPermissions': true,
      'appium:newCommandTimeout': 240,
      // A new build's first cold start can take over Appium's default 20 s.
      'appium:adbExecTimeout': 60_000,
      'appium:noReset': false,
    },
  ],
};
