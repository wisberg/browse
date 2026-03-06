import express from 'express';
import cors from 'cors';
import { chromium, firefox, webkit } from 'playwright';

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

const PORT = process.env.PORT || 8787;

const NETWORK_PRESETS = {
  'No throttling': null,
  'Fast 4G': { latency: 100, downloadBps: 1_500_000, uploadBps: 750_000 },
  'Slow 4G': { latency: 250, downloadBps: 700_000, uploadBps: 300_000 },
  '3G': { latency: 400, downloadBps: 150_000, uploadBps: 60_000 }
};

const browserMap = { chromium, firefox, webkit };

function normalizeUrl(url) {
  const candidate = url.startsWith('http://') || url.startsWith('https://') ? url : `https://${url}`;
  return new URL(candidate).toString();
}

function sameOrigin(base, candidate) {
  try {
    return new URL(candidate).origin === new URL(base).origin;
  } catch {
    return false;
  }
}

async function collectSecurityFindings(url) {
  const findings = [];
  if (!url.startsWith('https://')) {
    findings.push({ severity: 'high', issue: 'Site is not using HTTPS', source: url });
  }

  try {
    const response = await fetch(url, { method: 'GET' });
    const headers = response.headers;
    const requiredHeaders = [
      'content-security-policy',
      'strict-transport-security',
      'x-frame-options',
      'x-content-type-options',
      'referrer-policy'
    ];

    for (const header of requiredHeaders) {
      if (!headers.get(header)) {
        findings.push({
          severity: 'medium',
          issue: `Missing security header: ${header}`,
          source: url
        });
      }
    }

    if ((headers.get('server') || '').toLowerCase().includes('apache/2.4.49')) {
      findings.push({ severity: 'critical', issue: 'Potentially vulnerable Apache version exposed', source: 'server header' });
    }
  } catch (error) {
    findings.push({ severity: 'high', issue: `Security probe failed: ${error.message}`, source: url });
  }

  return findings;
}

async function applyNetworkThrottle(page, profile) {
  if (!profile || !NETWORK_PRESETS[profile]) return;
  const preset = NETWORK_PRESETS[profile];

  if (page.context().browser()?.browserType().name() !== 'chromium') {
    await page.route('**/*', async (route) => {
      const waitMs = Math.max(50, preset.latency);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      await route.continue();
    });
    return;
  }

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: preset.latency,
    downloadThroughput: preset.downloadBps,
    uploadThroughput: preset.uploadBps,
    connectionType: 'cellular3g'
  });
}

async function runBrowserAudit({ browserName, url, maxPages, networkProfile }) {
  const browserType = browserMap[browserName];
  if (!browserType) {
    return { browser: browserName, scannedPages: [], errors: [{ type: 'config', message: 'Unsupported browser', source: browserName }] };
  }

  const browser = await browserType.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const queue = [url];
  const visited = new Set();
  const discovered = [];
  const errors = [];
  const brokenLinks = [];

  page.on('pageerror', (error) => {
    errors.push({ type: 'runtime', message: error.message, source: page.url() });
  });

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      errors.push({ type: 'console', message: msg.text(), source: page.url() });
    }
  });

  page.on('requestfailed', (request) => {
    errors.push({
      type: 'network',
      message: request.failure()?.errorText || 'Request failed',
      source: request.url()
    });
  });

  try {
    while (queue.length > 0 && discovered.length < maxPages) {
      const next = queue.shift();
      if (!next || visited.has(next)) continue;
      visited.add(next);

      await applyNetworkThrottle(page, networkProfile);

      let response;
      try {
        response = await page.goto(next, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      } catch (error) {
        errors.push({ type: 'navigation', message: error.message, source: next });
        continue;
      }

      const status = response?.status() || 0;
      discovered.push({ url: next, status });
      if (status >= 400 || status === 0) {
        brokenLinks.push({ url: next, status, source: 'navigation' });
      }

      const hrefs = await page.$$eval('a[href]', (anchors) => anchors.map((a) => a.href));
      for (const href of hrefs) {
        if (!sameOrigin(url, href)) continue;
        if (!visited.has(href) && !queue.includes(href) && discovered.length + queue.length < maxPages * 2) {
          queue.push(href);
        }
      }

      const uniqueLinks = [...new Set(hrefs)].slice(0, 60);
      for (const link of uniqueLinks) {
        try {
          const check = await page.request.get(link, { timeout: 15_000 });
          if (check.status() >= 400) {
            brokenLinks.push({ url: link, status: check.status(), source: next });
          }
        } catch (error) {
          brokenLinks.push({ url: link, status: 0, source: `${next} (${error.message})` });
        }
      }
    }
  } finally {
    await context.close();
    await browser.close();
  }

  return {
    browser: browserName,
    scannedPages: discovered,
    errors,
    brokenLinks
  };
}

app.post('/api/audit', async (req, res) => {
  const started = Date.now();
  const { targetUrl, browsers = ['chromium'], networkProfile = 'No throttling', maxPages = 10 } = req.body || {};

  if (!targetUrl) {
    return res.status(400).json({ error: 'targetUrl is required' });
  }

  let url;
  try {
    url = normalizeUrl(targetUrl);
  } catch {
    return res.status(400).json({ error: 'Invalid targetUrl' });
  }

  try {
    const browserResults = [];
    for (const browser of browsers) {
      browserResults.push(await runBrowserAudit({ browserName: browser, url, maxPages: Number(maxPages) || 10, networkProfile }));
    }

    const securityFindings = await collectSecurityFindings(url);

    res.json({
      targetUrl: url,
      networkProfile,
      durationMs: Date.now() - started,
      browserResults,
      securityFindings
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Audit API running on http://localhost:${PORT}`);
});
