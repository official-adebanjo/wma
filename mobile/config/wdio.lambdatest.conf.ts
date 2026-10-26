import { sharedConfig } from './wdio.shared.conf';
import { required } from '../../shared/config/env';

/**
 * TestMu AI / LambdaTest real-device cloud (QA Strategy §13 stage 3, §34).
 * Capped at LT_PARALLEL_SESSIONS (default 1) per the budget cap in §35.3.
 * Device matrix should mirror the customer audience footprint (§28.2) — adjust below.
 */
const build = `rosabon-${process.env.TEST_ENV ?? 'dev'}-${process.env.GITHUB_RUN_NUMBER ?? new Date().toISOString().slice(0, 16)}`;

const ltOptions = (platformName: 'android' | 'ios', deviceName: string, platformVersion: string, app: string) => ({
  platformName,
  'appium:automationName': platformName === 'android' ? 'UiAutomator2' : 'XCUITest',
  'lt:options': {
    w3c: true,
    build,
    project: 'Rosabon Unified App',
    name: `${deviceName} ${platformVersion}`,
    deviceName,
    platformVersion,
    platformName,
    app,
    isRealMobile: true,
    devicelog: true,
    network: true,
    visual: true,
    video: true,
    autoGrantPermissions: true,
    autoAcceptAlerts: true,
  },
});

export const config: WebdriverIO.Config = {
  ...sharedConfig,
  user: process.env.LT_USERNAME ?? '',
  key: process.env.LT_ACCESS_KEY ?? '',
  hostname: 'mobile-hub.lambdatest.com',
  port: 443,
  protocol: 'https',
  path: '/wd/hub',
  maxInstances: Number(process.env.LT_PARALLEL_SESSIONS ?? 1),
  capabilities: [
    ltOptions('android', 'Galaxy A54 5G', '14', process.env.LT_APP_ID_ANDROID ?? ''),
    ltOptions('android', 'Pixel 7', '13', process.env.LT_APP_ID_ANDROID ?? ''),
    ltOptions('android', 'Galaxy A14', '13', process.env.LT_APP_ID_ANDROID ?? ''),
    ltOptions('ios', 'iPhone 14', '16', process.env.LT_APP_ID_IOS ?? ''),
    ltOptions('ios', 'iPhone 15', '17', process.env.LT_APP_ID_IOS ?? ''),
  ].filter((c) => c['lt:options'].app),
  onPrepare: () => {
    required('LT_USERNAME');
    required('LT_ACCESS_KEY');
  },
};
