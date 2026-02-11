
import { chromium } from 'playwright';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

async function runInspection() {
  // Start the server first
  console.log('Starting server...');
  
  const { spawn } = await import('child_process');
  const server = spawn('node', ['server.js'], {
    cwd: process.cwd(),
    detached: false
  });
  
  // Wait for server to start
  await new Promise(r => setTimeout(r, 2000));
  
  try {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    
    page.on('console', msg => {
      console.log('[PAGE]', msg.text());
    });
    
    console.log('Navigating to inspection page...');
    await page.goto('http://localhost:8080/inspect-model.html', { waitUntil: 'domcontentloaded' });
    
    // Wait for results
    console.log('Waiting for model inspection to complete (up to 60 seconds)...');
    await page.waitForFunction(() => {
      const el = document.getElementById('generated-code');
      return el && el.textContent.length > 50;
    }, { timeout: 60000 });
    
    // Extract results
    const code = await page.$eval('#generated-code', el => el.textContent);
    const stateInputs = await page.$eval('#state-inputs', el => el.textContent);
    
    console.log('\n=== INSPECTION COMPLETE ===\n');
    console.log(code);
    console.log('\n=== STATE INPUTS ===\n');
    console.log(stateInputs);
    
    await browser.close();
    server.kill();
    
  } catch (err) {
    console.error('Inspection failed:', err.message);
    server.kill();
    process.exit(1);
  }
}

runInspection().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
