/**
 * Contract test ID → selector in the live dev build, for screens the app has not yet tagged with
 * the contract IDs (docs/SELECTOR-CONTRACT.md). Probed on Android, build v1.1.55 (apps/rosabon-dev.apk).
 * React Native maps `testID` → Android resource-id, so IDs the app already has use `rid:`.
 *
 *   rid:<id>      exact resource-id (RN testID)
 *   ~<label>      accessibility id (content-desc)
 *   text:<text>   exact visible text
 *   android=...   raw UiAutomator selector
 *
 * Remove an entry once the app ships the contract ID for it.
 */
export const LIVE_IDS: Record<string, string> = {
  // Welcome
  'auth.welcome.screen': 'rid:onboarding-login',
  'auth.welcome.login': 'rid:onboarding-login',
  'auth.welcome.signup': '~Create account',

  // Sign-in: one "Email/Phone Number" field → Continue → password (email) or passcode/PIN (phone) → Login
  'auth.login.screen': 'text:Welcome back',
  'auth.login.identifier.input': 'rid:form-text-input',
  'auth.login.continue': '~Continue',
  'auth.login.password.screen': 'text:Enter your password',
  'auth.login.password.input': 'rid:form-text-input',
  'auth.login.submit': '~Login',
  'auth.login.forgotPassword': 'rid:login-forgot-password',
  // Phone route: "Enter your passcode" — 6-digit field that auto-submits on the 6th digit; button reads "Continue"
  'auth.login.pin.screen': 'rid:passcode-screen',
  'auth.login.pin.input': 'rid:otp-input',
  'auth.login.pin.submit': '~Continue',
  'auth.login.forgotPin': '~Forgot Passcode?',
  'auth.login.switchAccount': '~Switch Account',
  'auth.login.biometric': '~Login via Fingerprint',
  // Inline error under the field, e.g. "Incorrect passcode. 3 attempt(s) left."
  'auth.login.error': 'android=new UiSelector().textMatches("(?i).*(incorrect|invalid|locked|attempt).*")',

  // Bottom tabs: Home · Grow · Borrow · Settings (no separate Wallet tab — the wallet is the Home tab)
  'home.tabbar': 'rid:bottom-tab-bar',
  'home.tabbar.home': 'rid:bottom-tab-home',
  'home.tabbar.wallet': 'rid:bottom-tab-home',
  'home.tabbar.grow': 'rid:bottom-tab-investment',
  'home.tabbar.borrow': 'rid:bottom-tab-loan',
  'home.tabbar.profile': 'rid:bottom-tab-settings',
  'common.header.back': 'rid:phosphor-react-native-arrow-left-undefined',

  // Home tab (= wallet home): greeting, TOTAL BALANCE card, Home/Loans/Invest switcher, quick actions,
  // "Complete your profile" progress, Recent Activity
  'wallet.home.screen': 'text:TOTAL BALANCE',
  'wallet.home.greeting': '//android.widget.TextView[starts-with(@text,"Good ")]',
  'wallet.home.customerName': '(//android.widget.TextView[starts-with(@text,"Good ")]/../following-sibling::*/android.widget.TextView)[1]',
  'wallet.home.balance': '(//android.widget.TextView[@text="TOTAL BALANCE"]/following-sibling::*//android.widget.TextView[starts-with(@text,"₦")])[1]',
  'wallet.home.earned': '//android.widget.TextView[contains(@text,"earned from investments")]',
  'wallet.home.segment.home': '//*[@content-desc="Home" and (not(@resource-id) or @resource-id="")]',
  'wallet.home.segment.loans': '//*[@content-desc="Loans" and (not(@resource-id) or @resource-id="")]',
  'wallet.home.segment.invest': '//*[@content-desc="Invest" and (not(@resource-id) or @resource-id="")]',
  'wallet.home.transfer': '//*[@resource-id="quick-action" and @content-desc="Send"]',
  'wallet.home.fund': '//*[@resource-id="quick-action" and @content-desc="Fund"]',
  'wallet.home.bills': '//*[@resource-id="quick-action" and @content-desc="Bills"]',
  'wallet.home.invest': '//*[@resource-id="quick-action" and @content-desc="Invest"]',
  'wallet.home.kycProgress': 'android=new UiSelector().textMatches("^[0-9]+/[0-9]+$")',
  'wallet.home.kycProgress.card': 'text:Complete your profile',
  'wallet.home.kycProgress.summary': '//*[@resource-id="accordion"]/*[@content-desc]',
  'wallet.home.history': '~See All',
  'wallet.home.recent.item': 'rid:list-item',

  // Grow tab: "Your investments", TOTAL WORKING CAPITAL, product cards, Active Plans (n).
  // In Appium's tree the "investment-list-card" node is an empty sibling of its content, so anchor on the title.
  'grow.home.screen': 'text:GROW YOUR ASSETS',
  'grow.home.totalCapital': '//android.widget.TextView[@text="TOTAL WORKING CAPITAL"]/following-sibling::android.widget.TextView[1]',
  'grow.home.accrued': '//android.widget.TextView[contains(@text,"accrued interest this cycle")]',
  'grow.home.tile.rwin': '//android.widget.TextView[contains(@text,"(RWIN)")]',
  'grow.home.tile.reap': '//android.widget.TextView[contains(@text,"(REAP)")]',
  'grow.home.tile.rtn': '//android.widget.TextView[contains(@text,"(RTN)")]',
  'grow.home.tile.rwin.metric': '//android.widget.TextView[contains(@text,"(RWIN)")]/following-sibling::*[@resource-id="status-badge"][1]/android.widget.TextView',
  'grow.home.tile.reap.metric': '//android.widget.TextView[contains(@text,"(REAP)")]/following-sibling::*[@resource-id="status-badge"][1]/android.widget.TextView',
  'grow.home.tile.rtn.metric': '//android.widget.TextView[contains(@text,"(RTN)")]/following-sibling::*[@resource-id="status-badge"][1]/android.widget.TextView',
  'grow.home.tile.rwin.open': '//android.widget.TextView[contains(@text,"(RWIN)")]/following-sibling::*[@content-desc="View full details"][1]',
  'grow.home.tile.reap.open': '//android.widget.TextView[contains(@text,"(REAP)")]/following-sibling::*[@content-desc="View full details"][1]',
  'grow.home.tile.rtn.open': '//android.widget.TextView[contains(@text,"(RTN)")]/following-sibling::*[@content-desc="View full details"][1]',
  'grow.home.activePlans.header': 'android=new UiSelector().textStartsWith("Active Plans")',
  // Row content-desc: "<name> (<PRODUCT_CODE>), ₦<amount>, Next Payout: <n> days, <rate>% p.a."
  'grow.home.activePlan.row': 'rid:active-plan-row',

  // Borrow tab: "What do you need?", RECOMMENDED card, FAST CASH (Payday, Nano), LONG-TERM LOAN (Public Sector, Personal).
  // Product names are configured in Admin, so tiles match on the name (before the comma in content-desc).
  'borrow.home.screen': 'text:What do you need?',
  'borrow.home.menu': 'rid:options-menu',
  'borrow.home.recommended.title': '//android.widget.TextView[@text="RECOMMENDED FOR YOU"]/following-sibling::android.widget.TextView[1]',
  'borrow.home.recommended.subtitle': '//android.widget.TextView[@text="RECOMMENDED FOR YOU"]/following-sibling::android.widget.TextView[2]',
  'borrow.home.recommended.apply': '~Apply now',
  'borrow.home.group.fastCash': 'text:FAST CASH',
  'borrow.home.group.longTerm': 'text:LONG-TERM LOAN',
  'borrow.home.tile.nano': 'android=new UiSelector().resourceId("action-card").descriptionMatches("(?i)^[^,]*nano.*")',
  'borrow.home.tile.payday': 'android=new UiSelector().resourceId("action-card").descriptionMatches("(?i)^[^,]*payday.*")',
  'borrow.home.tile.personal': 'android=new UiSelector().resourceId("action-card").descriptionMatches("(?i)^[^,]*personal.*")',
  'borrow.home.tile.publicSector': 'android=new UiSelector().resourceId("action-card").descriptionMatches("(?i)^[^,]*public.?sector.*")',
  'borrow.home.tile.any': 'rid:action-card',
};

/** WebdriverIO selector for a LIVE_IDS value (Android). */
export function liveSelector(value: string): string {
  if (value.startsWith('rid:')) return `android=new UiSelector().resourceId("${value.slice(4)}")`;
  if (value.startsWith('text:')) return `android=new UiSelector().text("${value.slice(5).replace(/"/g, '\\"')}")`;
  return value; // '~label' or 'android=...'
}
