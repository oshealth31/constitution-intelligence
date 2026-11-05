// Page weight and loading time on slow phone networks (task T3). Chromium with the network
// slowed down (Chrome DevTools' own throttling), against the running test servers.
//
//   BASE_URL=http://127.0.0.1:3100 LOAD_PASSWORD=... LOAD_CONSTITUTION_ID=... node perf/slow-network.mjs
//
// For each network: open the sign-in page (until the Sign in button works), sign in (until the
// home page shows), open the large constitution (until its first clause shows), then open the
// home page again (now with the browser's cache). Reports time and data downloaded per step.
import { writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:3100';
const SLUG = process.env.LOAD_SLUG || 'sample-community-choir';
const CONSTITUTION = process.env.LOAD_CONSTITUTION_ID;
const PASSWORD = process.env.LOAD_PASSWORD;

// Bytes per second. "Slow 3G"-like and "Fast 3G"-like, as in Chrome DevTools; plus 4G.
const NETWORKS = [
  { name: 'Slow 3G (400 kbit/s, 400 ms)', down: 50_000, up: 50_000, latency: 400 },
  { name: 'Fast 3G (1.6 Mbit/s, 150 ms)', down: 200_000, up: 93_750, latency: 150 },
  { name: '4G (9 Mbit/s, 60 ms)', down: 1_125_000, up: 375_000, latency: 60 },
];

async function measure(network, index) {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    serviceWorkers: 'block', // a first visit, without the offline cache
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    downloadThroughput: network.down,
    uploadThroughput: network.up,
    latency: network.latency,
  });
  let bytes = 0;
  cdp.on('Network.loadingFinished', (event) => {
    bytes += event.encodedDataLength;
  });
  const results = [];
  async function step(name, work) {
    bytes = 0;
    const started = Date.now();
    await work();
    results.push({
      step: name,
      seconds: (Date.now() - started) / 1000,
      kilobytes: Math.round(bytes / 1024),
    });
  }
  const email = `loadtest-${190 + index}@sample.test`;
  await step('Open the sign-in page (ready to use)', async () => {
    await page.goto(`${BASE}/o/${SLUG}/sign-in`, { timeout: 180_000 });
    await page.getByRole('button', { name: 'Sign in' }).waitFor({ timeout: 180_000 });
    await page.waitForFunction(
      () => !document.querySelector('button[type="submit"]')?.hasAttribute('disabled'),
      null,
      { timeout: 180_000 },
    );
  });
  await step('Sign in (until the home page shows)', async () => {
    await page.getByLabel('Email address').fill(email);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.locator('#welcome-heading').waitFor({ timeout: 180_000 });
  });
  await step('Open the 500-clause constitution (first clause shows)', async () => {
    await page.goto(`${BASE}/o/${SLUG}/read/${CONSTITUTION}`, { timeout: 180_000 });
    await page.getByText('Clause 1 heading').first().waitFor({ timeout: 180_000 });
  });
  await step('Home page again (browser cache warm)', async () => {
    await page.goto(`${BASE}/o/${SLUG}`, { timeout: 180_000 });
    await page.locator('#welcome-heading').waitFor({ timeout: 180_000 });
  });
  await browser.close();
  return { network: network.name, results };
}

const all = [];
for (const [index, network] of NETWORKS.entries()) all.push(await measure(network, index));

const lines = ['## Slow networks (phone screen, first visit)', ''];
for (const { network, results } of all) {
  lines.push(`**${network}**`, '', '| Step | Time | Downloaded |', '| --- | --- | --- |');
  for (const result of results) {
    lines.push(`| ${result.step} | ${result.seconds.toFixed(1)} s | ${result.kilobytes} KB |`);
  }
  lines.push('');
}
const text = lines.join('\n') + '\n';
process.stdout.write(text);
writeFileSync('slow-network.md', text);
