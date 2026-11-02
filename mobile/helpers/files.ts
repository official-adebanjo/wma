import { driver } from '@wdio/globals';

/** One-page PDF reading "QA TEST DOCUMENT" — uploaded wherever the app asks for a document. */
const TEST_PDF = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 74>>stream
BT /F1 18 Tf 72 760 Td (QA TEST DOCUMENT - automated test upload) Tj ET
endstream endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R>>
%%EOF
`;

export const TEST_PDF_NAME = 'qa-test-document.pdf';

/** Put the test PDF in the device's Downloads so the system file picker lists it under "Recent". */
export async function pushTestPdf(): Promise<string> {
  const remote = `/sdcard/Download/${TEST_PDF_NAME}`;
  await driver.pushFile(remote, Buffer.from(TEST_PDF).toString('base64'));
  // Index it for the picker (needs Appium's --relaxed-security; harmless if refused).
  await driver.execute('mobile: shell', {
    command: 'am', args: ['broadcast', '-a', 'android.intent.action.MEDIA_SCANNER_SCAN_FILE', '-d', `file://${remote}`],
  }).catch(() => undefined);
  return TEST_PDF_NAME;
}
