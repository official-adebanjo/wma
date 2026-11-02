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

  // ---- Journeys (probed by hand on the 30 October build, 2026-11-02) ----
  // Shared: React Native red error screen (debug build), toast, confirm modal, screen header title
  // Native views: resource-ids carry the package prefix (com.optisoft.rosabon:id/…), unlike RN testIDs
  'common.redbox': 'android=new UiSelector().resourceIdMatches(".*:id/rn_redbox_stack")',
  'common.redbox.message': 'android=new UiSelector().resourceIdMatches(".*:id/catalyst_redbox_title")',
  'common.confirmModal': 'rid:confirm-modal',
  'common.header.title': '//*[@resource-id="screen-header"]//android.widget.TextView',
  'common.anyInput': '//android.widget.EditText',

  // Grow → product page. Blocked products open a confirm modal instead: "Upgrade Your Account … Upgrade Now".
  'grow.tierGate': 'text:Upgrade Your Account',
  'grow.tierGate.message': 'android=new UiSelector().textContains("isn\'t available on your current tier")',
  'rwin.product.screen': 'text:Rates based on Tenure',
  'rwin.product.newGoal': '~New Goal',
  // RWIN goal creation: 01 name → 02 amount, tenor, payment preference → 03 summary + T&Cs → "Goal created!"
  'rwin.create.step': 'android=new UiSelector().textMatches("0[1-3] / 03")',
  'rwin.create.name.input': 'rid:form-text-input',
  'rwin.create.continue': '~Continue',
  'rwin.create.target.input': '//android.widget.EditText',
  'rwin.create.summary': 'text:Goal Summary',
  'rwin.create.terms': 'rid:checkbox',
  'rwin.create.submit': '~Create Goal',
  'rwin.create.success': 'text:Goal created!',
  'rwin.create.success.note': 'android=new UiSelector().textStartsWith("Your first debit of")',
  'rwin.create.viewGoal': '~View Goal',
  'rwin.goal.topUp': '~Top Up Goal',
  'rwin.goal.delete': '~Delete Goal',
  'rwin.goal.deleteConfirm': '//*[@resource-id="confirm-modal"]//*[@content-desc="Delete Goal"] | (//*[@content-desc="Delete Goal"])[2]',
  'rwin.goal.deleted': 'text:Goal deleted',
  'rwin.topUp.screen': 'text:Top up plan',
  'rwin.topUp.submit': 'android=new UiSelector().descriptionStartsWith("Add ₦")',

  // Borrow → loan application. Personal: amount + tenor chips + purpose → Upload Documents → Review → submitted.
  'loan.apply.amountScreen': 'android=new UiSelector().textMatches("(?i)^(SELECT AMOUNT.*|Enter Amount|How much.*)$")',
  'loan.apply.continue': '~Continue',
  'loan.docs.screen': 'text:Upload Documents',
  'loan.docs.upload': '~Upload',
  'loan.docs.uploaded': 'android=new UiSelector().descriptionEndsWith("uploaded. Tap to replace.")',
  'loan.docs.submit': '~Submit for Review',
  'common.filePicker.pdf': '~Choose a PDF or document',
  'loan.review.screen': 'text:Review Application',
  'loan.review.seeBreakdown': '~See Breakdown',
  'loan.review.breakdownSheet': 'rid:repayment-breakdown-sheet',
  'loan.review.breakdownRow': 'android=new UiSelector().textMatches(".*\\\\(Month [0-9]+\\\\)$")',
  'loan.review.declaration': 'rid:checkbox',
  'loan.review.submit': '~Submit Application',
  // Borrow-tab states while a loan exists: under review → offer ready → disbursement in progress → active dashboard
  'loan.state.underReview': 'text:Your loan application on review',
  'loan.state.offer': 'text:OFFER READY',
  'loan.state.disbursing': 'text:Your disbursement is in progress',
  'loan.dashboard.outstanding': 'text:TOTAL OUTSTANDING',
  'loan.dashboard.nextDue': 'android=new UiSelector().textStartsWith("Next payment due in")',

  // Settings and Profile (Personal Info. / Next of Kin / Employment Info. tabs)
  'settings.screen': '//*[@resource-id="screen-header"] | //android.widget.TextView[@text="Settings"]',
  'settings.profile': '~Profile',
  'settings.logout': '~Log out',
  'profile.tab.personal': '~Personal Info.',
  'profile.tab.kin': '~Next of Kin',
  'profile.tab.employment': '~Employment Info.',
  'profile.personal.save': '~Save changes',
  'profile.address.add': '~Add your address',
  'profile.address.modal': 'text:Edit Address',
  'profile.address.street': 'android=new UiSelector().text("Enter street address")',
  'profile.address.state': '~Select state',
  'profile.address.city': '~Select City',
  'profile.address.done': '~Done',
  'profile.kin.relationship': '~Select relationship',
  'profile.kin.save': '~Save Next of Kin',
  'profile.employment.jobTitle': '(//android.widget.TextView[@text="Job Title"]/following::android.widget.EditText)[1]',
  'profile.employment.save': '~Save Changes',

  // Home quick actions → Send Money / Fund Wallet
  'send.screen': 'text:Send Money',
  'send.recent': 'text:Recent Recipients',
  'send.beneficiary': 'rid:list-item',
  'fund.screen': 'text:Fund Wallet',
  'fund.card': 'android=new UiSelector().descriptionStartsWith("Card Payment")',
  'fund.card.addNew': '~Add New Card',
  'fund.card.pay': 'android=new UiSelector().descriptionStartsWith("Pay ₦")',
  'fund.card.gateway': 'android=new UiSelector().className("android.webkit.WebView")',
};

/** WebdriverIO selector for a LIVE_IDS value (Android). */
export function liveSelector(value: string): string {
  if (value.startsWith('rid:')) return `android=new UiSelector().resourceId("${value.slice(4)}")`;
  if (value.startsWith('text:')) return `android=new UiSelector().text("${value.slice(5).replace(/"/g, '\\"')}")`;
  return value; // '~label' or 'android=...'
}
