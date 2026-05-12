import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  page.on('console', msg => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      console.log(`[BROWSER ${msg.type().toUpperCase()}]`, msg.text());
    }
  });

  page.on('pageerror', error => {
    console.log('[BROWSER UNCAUGHT ERROR]', error.message);
    console.log('[STACK]', error.stack);
  });

  console.log('Navigating to http://localhost:57335...');
  await page.goto('http://localhost:57335', { waitUntil: 'networkidle' });
  console.log('Navigation complete.');
  
  // Wait a bit for React to render
  await page.waitForTimeout(2000);
  
  const rootHtml = await page.evaluate(() => document.getElementById('root')?.innerHTML);
  console.log('Root element HTML length:', rootHtml?.length);
  
  await browser.close();
})();
