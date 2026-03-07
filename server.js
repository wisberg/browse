import crypto from 'node:crypto';
import express from 'express';
import cors from 'cors';
import { chromium, firefox, webkit } from 'playwright';

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

const PORT = process.env.PORT || 8787;
const MAX_HISTORY = 75;

const NETWORK_PRESETS = {
  'No throttling': null,
  'Fast 4G': { latency: 100, downloadBps: 1_500_000, uploadBps: 750_000 },
  'Slow 4G': { latency: 250, downloadBps: 700_000, uploadBps: 300_000 },
  '3G': { latency: 400, downloadBps: 150_000, uploadBps: 60_000 }
};

const browserMap = { chromium, firefox, webkit };
const runHistory = [];

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

function toIssue({ severity, category, title, source, browser = 'platform', details = '' }) {
  return { severity, category, title, source, browser, details };
}

function severityWeight(level) {
  return { critical: 28, high: 16, medium: 8, low: 3 }[level] ?? 6;
}

function calculateQualityScore(issues) {
  const totalPenalty = issues.reduce((sum, item) => sum + severityWeight(item.severity), 0);
  return Math.max(0, 100 - totalPenalty);
}

async function collectSecurityFindings(url) {
  const findings = [];
  if (!url.startsWith('https://')) {
    findings.push(toIssue({ severity: 'high', category: 'security', title: 'Site is not using HTTPS', source: url }));
  }

  try {
    const response = await fetch(url, { method: 'GET' });
    const headers = response.headers;

    const requiredHeaders = [
      'content-security-policy',
      'strict-transport-security',
      'x-frame-options',
      'x-content-type-options',
      'referrer-policy',
      'permissions-policy'
    ];

    for (const header of requiredHeaders) {
      if (!headers.get(header)) {
        findings.push(toIssue({
          severity: 'medium',
          category: 'security',
          title: `Missing security header: ${header}`,
          source: url
        }));
      }
    }

    const server = (headers.get('server') || '').toLowerCase();
    if (server.includes('apache/2.4.49')) {
      findings.push(toIssue({
        severity: 'critical',
        category: 'security',
        title: 'Potentially vulnerable Apache version exposed',
        source: 'server header'
      }));
    }

    if (!headers.get('x-robots-tag')) {
      findings.push(toIssue({
        severity: 'low',
        category: 'compliance',
        title: 'Missing X-Robots-Tag header (recommended for controlled environments)',
        source: url
      }));
    }
  } catch (error) {
    findings.push(toIssue({
      severity: 'high',
      category: 'security',
      title: 'Security probe failed',
      details: error.message,
      source: url
    }));
  }

  for (const path of ['/robots.txt', '/sitemap.xml']) {
    try {
      const probe = await fetch(new URL(path, url), { method: 'GET' });
      if (probe.status >= 400) {
        findings.push(toIssue({
          severity: 'low',
          category: 'seo',
          title: `${path} not accessible (status ${probe.status})`,
          source: new URL(path, url).toString()
        }));
      }
    } catch {
      findings.push(toIssue({
        severity: 'low',
        category: 'seo',
        title: `${path} could not be fetched`,
        source: new URL(path, url).toString()
      }));
    }
  }

  return findings;
}

async function applyNetworkThrottle(page, profile) {
  if (!profile || !NETWORK_PRESETS[profile]) return;
  const preset = NETWORK_PRESETS[profile];

  if (page.context().browser()?.browserType().name() !== 'chromium') {
    await page.route('**/*', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, Math.max(50, preset.latency)));
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
    return {
      browser: browserName,
      scannedPages: [],
      issues: [toIssue({ severity: 'medium', category: 'configuration', title: 'Unsupported browser', source: browserName, browser: browserName })]
    };
  }

  const browser = await browserType.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const queue = [url];
  const visited = new Set();
  const scannedPages = [];
  const issues = [];

  page.on('pageerror', (error) => {
    issues.push(toIssue({ severity: 'high', category: 'runtime', title: error.message, source: page.url(), browser: browserName }));
  });

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      issues.push(toIssue({ severity: 'medium', category: 'console', title: msg.text(), source: page.url(), browser: browserName }));
    }
  });

  page.on('requestfailed', (request) => {
    issues.push(toIssue({
      severity: 'high',
      category: 'network',
      title: request.failure()?.errorText || 'Request failed',
      source: request.url(),
      browser: browserName
    }));
  });

  const mixedContentWarnings = new Set();
  page.on('response', (response) => {
    if (url.startsWith('https://') && response.url().startsWith('http://') && !mixedContentWarnings.has(response.url())) {
      mixedContentWarnings.add(response.url());
      issues.push(toIssue({
        severity: 'high',
        category: 'security',
        title: 'Potential mixed-content resource loaded over HTTP',
        source: response.url(),
        browser: browserName
      }));
    }
  });

  try {
    while (queue.length > 0 && scannedPages.length < maxPages) {
      const next = queue.shift();
      if (!next || visited.has(next)) continue;
      visited.add(next);

      await applyNetworkThrottle(page, networkProfile);

      let response;
      try {
        response = await page.goto(next, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      } catch (error) {
        issues.push(toIssue({ severity: 'high', category: 'navigation', title: 'Navigation failed', details: error.message, source: next, browser: browserName }));
        continue;
      }

      const status = response?.status() || 0;
      scannedPages.push({ url: next, status });
      if (status >= 400 || status === 0) {
        issues.push(toIssue({ severity: 'high', category: 'broken-link', title: `Page returned status ${status}`, source: next, browser: browserName }));
      }

      const hrefs = await page.$$eval('a[href]', (anchors) => anchors.map((a) => a.href));
      for (const href of hrefs) {
        if (!sameOrigin(url, href)) continue;
        if (!visited.has(href) && !queue.includes(href) && queue.length < maxPages * 2) {
          queue.push(href);
        }
      }

      const uniqueLinks = [...new Set(hrefs)].slice(0, 80);
      for (const link of uniqueLinks) {
        try {
          const check = await page.request.get(link, { timeout: 15_000 });
          if (check.status() >= 400) {
            issues.push(toIssue({ severity: 'medium', category: 'broken-link', title: `Broken link status ${check.status()}`, source: link, browser: browserName, details: `Discovered on ${next}` }));
          }
        } catch (error) {
          issues.push(toIssue({ severity: 'medium', category: 'broken-link', title: 'Broken link request failed', source: link, browser: browserName, details: `${next}: ${error.message}` }));
        }
      }
    }
  } finally {
    await context.close();
    await browser.close();
  }

  return { browser: browserName, scannedPages, issues };
}

function buildSummary(result) {
  const allIssues = [
    ...result.securityFindings,
    ...result.browserResults.flatMap((item) => item.issues)
  ];

  const bySeverity = allIssues.reduce((acc, issue) => {
    acc[issue.severity] = (acc[issue.severity] || 0) + 1;
    return acc;
  }, { critical: 0, high: 0, medium: 0, low: 0 });

  const byCategory = allIssues.reduce((acc, issue) => {
    acc[issue.category] = (acc[issue.category] || 0) + 1;
    return acc;
  }, {});

  return {
    totalIssues: allIssues.length,
    qualityScore: calculateQualityScore(allIssues),
    bySeverity,
    byCategory
  };
}

app.get('/api/health', (_, res) => {
  res.json({ status: 'ok', service: 'website-testing-audit-api', historySize: runHistory.length });
});

app.get('/api/history', (_, res) => {
  res.json(runHistory.map((run) => ({
    auditId: run.auditId,
    targetUrl: run.targetUrl,
    createdAt: run.createdAt,
    durationMs: run.durationMs,
    networkProfile: run.networkProfile,
    summary: run.summary
  })));
});

app.get('/api/audit/:id', (req, res) => {
  const match = runHistory.find((run) => run.auditId === req.params.id);
  if (!match) {
    return res.status(404).json({ error: 'Audit run not found' });
  }
  return res.json(match);
});

app.post('/api/audit', async (req, res) => {
  const started = Date.now();
  const {
    targetUrl,
    browsers = ['chromium'],
    networkProfile = 'No throttling',
    maxPages = 12,
    suiteName = 'Default Enterprise Suite'
  } = req.body || {};

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
    const browserResults = await Promise.all(
      browsers.map((browserName) => runBrowserAudit({
        browserName,
        url,
        maxPages: Number(maxPages) || 12,
        networkProfile
      }))
    );

    const securityFindings = await collectSecurityFindings(url);

    const result = {
      auditId: crypto.randomUUID(),
      suiteName,
      createdAt: new Date().toISOString(),
      targetUrl: url,
      networkProfile,
      durationMs: Date.now() - started,
      browserResults,
      securityFindings
    };

    result.summary = buildSummary(result);

    runHistory.unshift(result);
    if (runHistory.length > MAX_HISTORY) {
      runHistory.length = MAX_HISTORY;
    }

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Audit API running on http://localhost:${PORT}`);
});
