
import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  page.on('console', msg => {
    console.log('PAGE:', msg.text());
  });
  
  page.on('error', err => {
    console.error('PAGE ERROR:', err);
  });
  
  try {
    console.log('Navigating to http://localhost:8080/inspect-model.html');
    await page.goto('http://localhost:8080/inspect-model.html', { waitUntil: 'networkidle' });
    
    // Wait for the generated code section to be populated
    console.log('Waiting for model inspection...');
    await page.waitForSelector('#generated-code', { timeout: 30000 });
    
    // Get the generated code
    const code = await page.$eval('#generated-code', el => el.textContent);
    console.log('\n=== GENERATED SHAPE MAP CODE ===\n');
    console.log(code);
    
    // Get the state inputs section
    const stateInputs = await page.$eval('#state-inputs', el => el.textContent);
    console.log('\n=== STATE INPUTS DETAILS ===\n');
    console.log(stateInputs);
    
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await browser.close();
  }
})();
