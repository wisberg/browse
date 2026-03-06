import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';

const SCREEN_PRESETS = [
  { label: 'Desktop 1440', width: 1440, height: 900 },
  { label: 'Laptop 1024', width: 1024, height: 768 },
  { label: 'Tablet 768', width: 768, height: 1024 },
  { label: 'Mobile 390', width: 390, height: 844 }
];

const NETWORK_PRESETS = ['No throttling', 'Fast 4G', 'Slow 4G', '3G'];
const BROWSER_TYPES = ['chromium', 'firefox', 'webkit'];

function App() {
  const [targetUrl, setTargetUrl] = useState('https://example.com');
  const [selectedScreens, setSelectedScreens] = useState(SCREEN_PRESETS.map((s) => s.label));
  const [networkProfile, setNetworkProfile] = useState('No throttling');
  const [browsers, setBrowsers] = useState(['chromium']);
  const [maxPages, setMaxPages] = useState(10);
  const [auditResult, setAuditResult] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const normalizedUrl = useMemo(() => {
    if (!targetUrl) return '';
    if (targetUrl.startsWith('http://') || targetUrl.startsWith('https://')) return targetUrl;
    return `https://${targetUrl}`;
  }, [targetUrl]);

  const activeScreens = SCREEN_PRESETS.filter((screen) => selectedScreens.includes(screen.label));

  const toggleSelection = (value, selected, onChange) => {
    if (selected.includes(value)) {
      onChange(selected.filter((v) => v !== value));
      return;
    }
    onChange([...selected, value]);
  };

  const runAudit = async () => {
    setError('');
    setAuditResult(null);

    if (!targetUrl.trim()) {
      setError('Target URL is required.');
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch('/api/audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetUrl,
          networkProfile,
          browsers: browsers.length ? browsers : ['chromium'],
          maxPages
        })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Audit failed');
      }
      setAuditResult(payload);
    } catch (runError) {
      setError(runError.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <h1 style={styles.title}>Website Testing Lab</h1>
        <p style={styles.subtitle}>Responsive previews, throttling profiles, cross-browser audits, and crawl diagnostics.</p>
      </header>

      <section style={styles.card}>
        <div style={styles.formGrid}>
          <label style={styles.label}>
            URL to test
            <input style={styles.input} value={targetUrl} onChange={(e) => setTargetUrl(e.target.value)} placeholder="https://example.com" />
          </label>

          <label style={styles.label}>
            Network throttling
            <select style={styles.input} value={networkProfile} onChange={(e) => setNetworkProfile(e.target.value)}>
              {NETWORK_PRESETS.map((preset) => (
                <option key={preset} value={preset}>{preset}</option>
              ))}
            </select>
          </label>

          <label style={styles.label}>
            Crawl depth (pages)
            <input style={styles.input} type="number" min="1" max="50" value={maxPages} onChange={(e) => setMaxPages(Number(e.target.value) || 1)} />
          </label>
        </div>

        <div style={styles.multiSelectGroup}>
          <strong>Browser engines</strong>
          <div style={styles.pillRow}>
            {BROWSER_TYPES.map((browser) => (
              <button
                key={browser}
                style={{ ...styles.pill, ...(browsers.includes(browser) ? styles.pillActive : {}) }}
                onClick={() => toggleSelection(browser, browsers, setBrowsers)}
              >
                {browser}
              </button>
            ))}
          </div>
        </div>

        <div style={styles.multiSelectGroup}>
          <strong>Viewport matrix</strong>
          <div style={styles.pillRow}>
            {SCREEN_PRESETS.map((screen) => (
              <button
                key={screen.label}
                style={{ ...styles.pill, ...(selectedScreens.includes(screen.label) ? styles.pillActive : {}) }}
                onClick={() => toggleSelection(screen.label, selectedScreens, setSelectedScreens)}
              >
                {screen.label}
              </button>
            ))}
          </div>
        </div>

        <button style={styles.primaryButton} onClick={runAudit} disabled={isLoading}>
          {isLoading ? 'Running crawl + audit…' : 'Run full website test'}
        </button>

        {error ? <p style={styles.errorText}>Error: {error}</p> : null}
      </section>

      <section style={styles.card}>
        <h2 style={styles.sectionTitle}>Responsive screen matrix</h2>
        <div style={styles.viewportGrid}>
          {activeScreens.map((screen) => {
            const scale = Math.min(1, 360 / screen.width);
            return (
              <div key={screen.label} style={styles.viewportCard}>
                <div style={styles.viewportHeader}>{screen.label} ({screen.width}×{screen.height})</div>
                <div style={{ ...styles.viewportFrameWrap, height: Math.round(screen.height * scale) + 20 }}>
                  <iframe
                    title={screen.label}
                    src={normalizedUrl}
                    style={{
                      ...styles.iframe,
                      width: screen.width,
                      height: screen.height,
                      transform: `scale(${scale})`
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {auditResult ? (
        <section style={styles.card}>
          <h2 style={styles.sectionTitle}>Audit results</h2>
          <p style={styles.meta}>Duration: {auditResult.durationMs} ms • Network profile: {auditResult.networkProfile}</p>

          <h3 style={styles.subheading}>Security risks</h3>
          <ul style={styles.list}>
            {auditResult.securityFindings.length === 0 ? <li>No obvious header/transport issues found.</li> : auditResult.securityFindings.map((item, idx) => (
              <li key={`${item.issue}-${idx}`}><strong>[{item.severity.toUpperCase()}]</strong> {item.issue} <em>({item.source})</em></li>
            ))}
          </ul>

          {auditResult.browserResults.map((result) => (
            <div key={result.browser} style={styles.resultBlock}>
              <h3 style={styles.subheading}>{result.browser} findings</h3>
              <p style={styles.meta}>Pages scanned: {result.scannedPages.length}</p>

              <details open>
                <summary style={styles.summary}>Errors (with source)</summary>
                <ul style={styles.list}>
                  {result.errors.length === 0 ? <li>No runtime/network errors captured.</li> : result.errors.map((item, idx) => (
                    <li key={`${item.source}-${idx}`}>
                      <strong>{item.type}</strong>: {item.message}
                      <div style={styles.source}>Source: {item.source}</div>
                    </li>
                  ))}
                </ul>
              </details>

              <details open>
                <summary style={styles.summary}>Broken links</summary>
                <ul style={styles.list}>
                  {result.brokenLinks.length === 0 ? <li>No broken links detected in scanned pages.</li> : result.brokenLinks.map((item, idx) => (
                    <li key={`${item.url}-${idx}`}>
                      <strong>Status {item.status}</strong>: {item.url}
                      <div style={styles.source}>Found from: {item.source}</div>
                    </li>
                  ))}
                </ul>
              </details>
            </div>
          ))}
        </section>
      ) : null}
    </div>
  );
}

const styles = {
  page: {
    fontFamily: 'Inter, system-ui, sans-serif',
    background: '#0f1115',
    color: '#f3f4f6',
    minHeight: '100vh',
    margin: 0,
    padding: '24px',
    display: 'grid',
    gap: '20px'
  },
  header: { display: 'grid', gap: '6px' },
  title: { margin: 0, fontSize: '2rem' },
  subtitle: { margin: 0, color: '#b8bec8' },
  card: {
    background: '#171a21',
    border: '1px solid #252a36',
    borderRadius: '14px',
    padding: '18px',
    display: 'grid',
    gap: '16px'
  },
  formGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' },
  label: { display: 'grid', gap: '6px', color: '#d1d5db', fontSize: '0.9rem' },
  input: {
    background: '#0e1016',
    color: '#f9fafb',
    border: '1px solid #30374a',
    borderRadius: '8px',
    padding: '9px 10px'
  },
  multiSelectGroup: { display: 'grid', gap: '8px' },
  pillRow: { display: 'flex', flexWrap: 'wrap', gap: '8px' },
  pill: {
    background: '#10141d',
    border: '1px solid #2c3344',
    color: '#dbe3ef',
    borderRadius: '999px',
    padding: '7px 12px',
    cursor: 'pointer'
  },
  pillActive: { borderColor: '#68a5ff', background: '#1c2f4f' },
  primaryButton: {
    background: '#68a5ff',
    color: '#0f1726',
    border: 'none',
    borderRadius: '10px',
    padding: '11px 16px',
    fontWeight: 700,
    cursor: 'pointer'
  },
  errorText: { color: '#ff8e8e', margin: 0 },
  sectionTitle: { margin: 0, fontSize: '1.25rem' },
  viewportGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: '12px' },
  viewportCard: { border: '1px solid #2b3242', borderRadius: '10px', overflow: 'hidden', background: '#0c0f15' },
  viewportHeader: { padding: '8px 10px', borderBottom: '1px solid #293041', color: '#cad2de', fontSize: '0.85rem' },
  viewportFrameWrap: { overflow: 'auto', display: 'grid', placeItems: 'start', padding: '10px' },
  iframe: { border: '1px solid #2f3749', borderRadius: '10px', transformOrigin: 'top left', background: '#fff' },
  meta: { margin: 0, color: '#9aa4b2' },
  subheading: { margin: '4px 0' },
  resultBlock: { border: '1px solid #293142', borderRadius: '10px', padding: '12px', display: 'grid', gap: '8px' },
  summary: { cursor: 'pointer', fontWeight: 600 },
  list: { margin: 0, paddingLeft: '20px', display: 'grid', gap: '8px' },
  source: { color: '#95a6c3', fontSize: '0.85rem' }
};

createRoot(document.getElementById('root')).render(<App />);
