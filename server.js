import express from 'express';
import cors from 'cors';
import { chromium } from 'playwright';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

const PORT = process.env.PORT || 8787;
const MAX_URLS = 200;

function normalizeUrl(rawUrl) {
  const candidate = rawUrl.startsWith('http://') || rawUrl.startsWith('https://') ? rawUrl : `https://${rawUrl}`;
  return new URL(candidate).toString();
}

function sanitizeFilePart(value) {
  return (value || 'page')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'page';
}

function extractLocUrls(xmlText) {
  return [...xmlText.matchAll(/<loc>([\s\S]*?)<\/loc>/gi)]
    .map((match) => match[1].trim())
    .filter(Boolean);
}

async function fetchText(url) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
  }
  return response.text();
}

async function collectSitemapUrls(startSitemapUrl) {
  const visitedSitemaps = new Set();
  const queue = [startSitemapUrl];
  const pageUrls = [];

  while (queue.length && pageUrls.length < MAX_URLS) {
    const sitemapUrl = queue.shift();
    if (!sitemapUrl || visitedSitemaps.has(sitemapUrl)) continue;
    visitedSitemaps.add(sitemapUrl);

    let xml;
    try {
      xml = await fetchText(sitemapUrl);
    } catch {
      continue;
    }

    const locs = extractLocUrls(xml);
    for (const loc of locs) {
      if (pageUrls.length >= MAX_URLS) break;
      if (loc.endsWith('.xml')) {
        if (!visitedSitemaps.has(loc)) queue.push(loc);
      } else {
        pageUrls.push(loc);
      }
    }
  }

  return [...new Set(pageUrls)];
}

async function createPdf(page, url, viewport) {
  await page.setViewportSize(viewport);
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 });
  await page.emulateMedia({ media: 'screen' });

  const pageTitle = await page.title();
  const contentSize = await page.evaluate(() => {
    const body = document.body;
    const html = document.documentElement;
    const width = Math.max(body?.scrollWidth || 0, html?.scrollWidth || 0, html?.clientWidth || 0);
    const height = Math.max(body?.scrollHeight || 0, html?.scrollHeight || 0, html?.clientHeight || 0);
    return { width, height };
  });

  const pdfWidthPx = Math.max(viewport.width, contentSize.width, 320);
  const pdfHeightPx = Math.max(viewport.height, contentSize.height, 640);

  const pdf = await page.pdf({
    printBackground: true,
    width: `${pdfWidthPx}px`,
    height: `${pdfHeightPx}px`,
    margin: { top: '0px', right: '0px', bottom: '0px', left: '0px' }
  });

  return {
    title: sanitizeFilePart(pageTitle),
    pdf
  };
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.post('/api/export', async (req, res) => {
  const { url } = req.body || {};

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'A sitemap or website URL is required.' });
  }

  let normalizedUrl;
  try {
    normalizedUrl = normalizeUrl(url);
  } catch {
    return res.status(400).json({ error: 'Invalid URL.' });
  }

  const sitemapUrl = normalizedUrl.endsWith('.xml') ? normalizedUrl : new URL('/sitemap.xml', normalizedUrl).toString();

  let browser;
  let tempRoot;

  try {
    const discoveredUrls = await collectSitemapUrls(sitemapUrl);
    if (discoveredUrls.length === 0) {
      return res.status(404).json({ error: `No page URLs discovered from sitemap: ${sitemapUrl}` });
    }

    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'site-export-'));
    const desktopDir = path.join(tempRoot, 'Desktop');
    const mobileDir = path.join(tempRoot, 'Mobile');
    await fs.mkdir(desktopDir, { recursive: true });
    await fs.mkdir(mobileDir, { recursive: true });

    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    const usedNames = new Map();

    for (const pageUrl of discoveredUrls) {
      try {
        const desktop = await createPdf(page, pageUrl, { width: 1920, height: 1080 });
        const mobile = await createPdf(page, pageUrl, { width: 390, height: 844 });

        const currentCount = usedNames.get(desktop.title) || 0;
        usedNames.set(desktop.title, currentCount + 1);
        const suffix = currentCount === 0 ? '' : `_${currentCount + 1}`;
        const baseName = `${desktop.title}${suffix}`;

        await fs.writeFile(path.join(desktopDir, `${baseName}_desktop.pdf`), desktop.pdf);
        await fs.writeFile(path.join(mobileDir, `${baseName}_mobile.pdf`), mobile.pdf);
      } catch {
        continue;
      }
    }

    const archiveName = `${sanitizeFilePart(new URL(normalizedUrl).hostname)}_exports.zip`;
    const archivePath = path.join(tempRoot, archiveName);
    await execFileAsync('zip', ['-r', archivePath, 'Desktop', 'Mobile'], { cwd: tempRoot });

    const zipBuffer = await fs.readFile(archivePath);

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${archiveName}"`);
    return res.send(zipBuffer);
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Export generation failed.' });
  } finally {
    if (browser) await browser.close();
    if (tempRoot) await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
