import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.setViewportSize({ width: 1440, height: 900 });

// Navigate to the app first to establish origin
await page.goto('http://localhost:5173', { waitUntil: 'networkidle', timeout: 15000 });
await page.waitForTimeout(500);

// Inject wizard state
await page.evaluate(() => {
  const wizardState = {
    promptA: {
      id: null,
      version: 1,
      content: 'You are a helpful assistant. Answer questions clearly and concisely.',
      manifest: null
    },
    promptB: {
      id: null,
      version: 1,
      content: 'You are an expert assistant. Provide detailed, thorough answers to questions.',
      manifest: null
    },
    selectedModels: [
      { serverName: 'local', modelName: 'gpt-3.5-turbo' }
    ],
    templateId: null,
    testSuiteId: null,
    inlineTestCases: [],
    userMessage: 'What is the capital of France?',
    judgeModelId: null,
    enablePairwise: false,
    runsPerCell: 1,
    evalId: null,
    sessionId: null,
    currentStep: 2,
    maxVisitedStep: 2,
    isDirty: false
  };
  localStorage.setItem('lmeval:wizard:state', JSON.stringify(wizardState));
});

// Navigate to the Prepare step (step 2)
await page.goto('http://localhost:5173/eval/config', { waitUntil: 'networkidle', timeout: 15000 });
await page.waitForTimeout(2000);

// Take full page screenshot at high resolution
await page.screenshot({ path: '/tmp/screenshot_prepare_hires.png', fullPage: true });
console.log('High-res screenshot taken');

await browser.close();
