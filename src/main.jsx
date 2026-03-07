import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';

const SCREEN_PRESETS = [
  { label: 'Desktop XL', width: 1728, height: 1117 },
  { label: 'Desktop', width: 1440, height: 900 },
  { label: 'Laptop', width: 1280, height: 800 },
  { label: 'Tablet', width: 834, height: 1194 },
  { label: 'Mobile L', width: 430, height: 932 },
  { label: 'Mobile S', width: 390, height: 844 }
];

const NETWORK_PRESETS = ['No throttling', 'Fast 4G', 'Slow 4G', '3G'];
const BROWSER_TYPES = ['chromium', 'firefox', 'webkit'];
const NAV_ITEMS = ['Dashboard', 'Responsive Lab', 'Automated Audits', 'Issue Center', 'Run History'];

function App() {
  const [activeNav, setActiveNav] = useState('Dashboard');
  const [targetUrl, setTargetUrl] = useState('https://example.com');
  const [suiteName, setSuiteName] = useState('Default Enterprise Suite');
  const [selectedScreens, setSelectedScreens] = useState(SCREEN_PRESETS.map((s) => s.label));
  const [networkProfile, setNetworkProfile] = useState('No throttling');
  const [browsers, setBrowsers] = useState(['chromium', 'firefox']);
  const [maxPages, setMaxPages] = useState(12);
  const [auditResult, setAuditResult] = useState(null);
  const [runHistory, setRunHistory] = useState([]);
  const [severityFilter, setSeverityFilter] = useState('all');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [expandedScreen, setExpandedScreen] = useState(null);

  const normalizedUrl = useMemo(() => {
    if (!targetUrl) return '';
    if (targetUrl.startsWith('http://') || targetUrl.startsWith('https://')) return targetUrl;
    return `https://${targetUrl}`;
  }, [targetUrl]);

  const activeScreens = SCREEN_PRESETS.filter((screen) => selectedScreens.includes(screen.label));

  const allIssues = useMemo(() => {
    if (!auditResult) return [];
    return [
      ...auditResult.securityFindings,
      ...auditResult.browserResults.flatMap((result) => result.issues)
    ];
  }, [auditResult]);

  const visibleIssues = useMemo(() => {
    if (severityFilter === 'all') return allIssues;
    return allIssues.filter((issue) => issue.severity === severityFilter);
  }, [allIssues, severityFilter]);

  const aggregateMetrics = useMemo(() => {
    if (!auditResult) {
      return { pages: 0, issues: 0, score: 0, securityFindings: 0 };
    }

    return {
      pages: auditResult.browserResults.reduce((total, browser) => total + browser.scannedPages.length, 0),
      issues: auditResult.summary.totalIssues,
      score: auditResult.summary.qualityScore,
      securityFindings: auditResult.securityFindings.length
    };
  }, [auditResult]);

  const toggleSelection = (value, selected, onChange) => {
    if (selected.includes(value)) {
      onChange(selected.filter((v) => v !== value));
      return;
    }
    onChange([...selected, value]);
  };

  const loadHistory = async () => {
    try {
      const response = await fetch('/api/history');
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Could not load run history');
      }
      setRunHistory(payload);
    } catch (historyError) {
      setError(historyError.message);
    }
  };

  useEffect(() => {
    loadHistory();
  }, []);

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
          suiteName,
          browsers: browsers.length ? browsers : ['chromium'],
          maxPages
        })
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Audit failed');
      }

      setAuditResult(payload);
      await loadHistory();
      setActiveNav('Issue Center');
    } catch (runError) {
      setError(runError.message);
    } finally {
      setIsLoading(false);
    }
  };

  const renderScreenCard = (screen, isLightbox = false) => {
    const baseWidth = isLightbox ? 920 : 320;
    const baseHeight = isLightbox ? 640 : 260;
    const scale = Math.min(baseWidth / screen.width, baseHeight / screen.height);

    return (
      <div key={`${screen.label}-${isLightbox ? 'lg' : 'sm'}`} style={isLightbox ? styles.viewportCardLarge : styles.viewportCard}>
        <div style={styles.viewportHeader}>
          <span>{screen.label}</span>
          <span style={styles.pillTag}>{screen.width}×{screen.height}</span>
        </div>
        <div style={{ ...styles.viewportFrameWrap, width: baseWidth, height: baseHeight }}>
          <div style={{ ...styles.scaledCanvas, width: screen.width * scale, height: screen.height * scale }}>
            <iframe
              title={screen.label}
              src={normalizedUrl}
              style={{ ...styles.iframe, width: screen.width, height: screen.height, transform: `scale(${scale})` }}
            />
          </div>
        </div>
        {!isLightbox ? <button style={styles.secondaryButton} onClick={() => setExpandedScreen(screen)}>Expand in lightbox</button> : null}
      </div>
    );
  };

  const overviewPanel = (
    <section style={styles.panel}>
      <h2 style={styles.sectionTitle}>Executive overview</h2>
      <div style={styles.kpiGrid}>
        <KpiCard title="Pages Scanned" value={aggregateMetrics.pages} color="#74d3ff" />
        <KpiCard title="Total Issues" value={aggregateMetrics.issues} color="#ff8f8f" />
        <KpiCard title="Quality Score" value={`${aggregateMetrics.score}/100`} color="#7de3b6" />
        <KpiCard title="Security Findings" value={aggregateMetrics.securityFindings} color="#b89bff" />
      </div>
      {auditResult ? (
        <div style={styles.auditLayout}>
          <div style={styles.infoCard}><h3 style={styles.cardTitle}>Suite</h3><p style={styles.meta}>{auditResult.suiteName}</p></div>
          <div style={styles.infoCard}><h3 style={styles.cardTitle}>Target</h3><p style={styles.meta}>{auditResult.targetUrl}</p></div>
          <div style={styles.infoCard}><h3 style={styles.cardTitle}>Duration</h3><p style={styles.meta}>{auditResult.durationMs} ms</p></div>
          <div style={styles.infoCard}><h3 style={styles.cardTitle}>Risk profile</h3><p style={styles.meta}>{JSON.stringify(auditResult.summary.bySeverity)}</p></div>
        </div>
      ) : <p style={styles.meta}>Run a suite to populate governance metrics and quality score.</p>}
    </section>
  );

  const controlsPanel = (
    <section style={styles.panel}>
      <h2 style={styles.sectionTitle}>Enterprise test controls</h2>
      <div style={styles.formGrid}>
        <label style={styles.label}>Suite name<input style={styles.input} value={suiteName} onChange={(e) => setSuiteName(e.target.value)} /></label>
        <label style={styles.label}>Target URL<input style={styles.input} value={targetUrl} onChange={(e) => setTargetUrl(e.target.value)} placeholder="https://example.com" /></label>
        <label style={styles.label}>Network profile
          <select style={styles.input} value={networkProfile} onChange={(e) => setNetworkProfile(e.target.value)}>
            {NETWORK_PRESETS.map((preset) => <option key={preset} value={preset}>{preset}</option>)}
          </select>
        </label>
        <label style={styles.label}>Crawl depth<input style={styles.input} type="number" min="1" max="50" value={maxPages} onChange={(e) => setMaxPages(Number(e.target.value) || 1)} /></label>
      </div>

      <div style={styles.selectGroup}>
        <h3 style={styles.groupTitle}>Browser engines</h3>
        <div style={styles.pillRow}>
          {BROWSER_TYPES.map((browser) => (
            <button key={browser} style={{ ...styles.pill, ...(browsers.includes(browser) ? styles.pillActive : {}) }} onClick={() => toggleSelection(browser, browsers, setBrowsers)}>{browser}</button>
          ))}
        </div>
      </div>

      <div style={styles.selectGroup}>
        <h3 style={styles.groupTitle}>Viewport matrix</h3>
        <div style={styles.pillRow}>
          {SCREEN_PRESETS.map((screen) => (
            <button key={screen.label} style={{ ...styles.pill, ...(selectedScreens.includes(screen.label) ? styles.pillActive : {}) }} onClick={() => toggleSelection(screen.label, selectedScreens, setSelectedScreens)}>{screen.label}</button>
          ))}
        </div>
      </div>

      <div style={styles.actionRow}>
        <button style={styles.primaryButton} onClick={runAudit} disabled={isLoading}>{isLoading ? 'Running enterprise test suite…' : 'Run all-in-one website test'}</button>
        {error ? <p style={styles.errorText}>Error: {error}</p> : null}
      </div>
    </section>
  );

  const responsiveLab = (
    <section style={styles.panel}>
      <h2 style={styles.sectionTitle}>Responsive Lab</h2>
      <p style={styles.meta}>Each device preview is constrained to avoid scrolling outside the simulated viewport frame.</p>
      <div style={styles.viewportGrid}>{activeScreens.map((screen) => renderScreenCard(screen))}</div>
    </section>
  );

  const auditPanel = (
    <section style={styles.panel}>
      <h2 style={styles.sectionTitle}>Automated audits</h2>
      {!auditResult ? <p style={styles.meta}>Run a suite to load cross-browser and compliance diagnostics.</p> : (
        <div style={styles.auditLayout}>
          {auditResult.browserResults.map((result) => (
            <article key={result.browser} style={styles.infoCard}>
              <h3 style={styles.cardTitle}>{result.browser.toUpperCase()}</h3>
              <p style={styles.meta}>Pages scanned: {result.scannedPages.length}</p>
              <p style={styles.meta}>Issues: {result.issues.length}</p>
            </article>
          ))}
          <article style={styles.infoCard}>
            <h3 style={styles.cardTitle}>Security and compliance</h3>
            <p style={styles.meta}>Findings: {auditResult.securityFindings.length}</p>
            <p style={styles.meta}>Categories: {Object.keys(auditResult.summary.byCategory).join(', ') || 'none'}</p>
          </article>
        </div>
      )}
    </section>
  );

  const issueCenter = (
    <section style={styles.panel}>
      <div style={styles.issueBar}>
        <h2 style={styles.sectionTitle}>Issue Center</h2>
        <select style={styles.input} value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value)}>
          <option value="all">All severities</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
      </div>
      {!auditResult ? <p style={styles.meta}>No issues yet. Execute a run to populate issue registry.</p> : (
        <ul style={styles.listCompact}>
          {visibleIssues.map((issue, idx) => (
            <li key={`${issue.category}-${idx}`} style={styles.issueRow}>
              <span style={styles.severity}>{issue.severity.toUpperCase()}</span>
              <div>
                <strong>{issue.title}</strong>
                <div style={styles.source}>Category: {issue.category} • Browser: {issue.browser}</div>
                <div style={styles.source}>Source: {issue.source}</div>
                {issue.details ? <div style={styles.source}>Details: {issue.details}</div> : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  const historyPanel = (
    <section style={styles.panel}>
      <h2 style={styles.sectionTitle}>Run history</h2>
      <button style={styles.secondaryButton} onClick={loadHistory}>Refresh history</button>
      <div style={styles.historyGrid}>
        {runHistory.map((run) => (
          <article key={run.auditId} style={styles.infoCard}>
            <h3 style={styles.cardTitle}>{run.targetUrl}</h3>
            <p style={styles.meta}>Suite score: {run.summary.qualityScore}/100</p>
            <p style={styles.meta}>Issues: {run.summary.totalIssues}</p>
            <p style={styles.meta}>Network: {run.networkProfile}</p>
            <p style={styles.meta}>Started: {new Date(run.createdAt).toLocaleString()}</p>
          </article>
        ))}
      </div>
    </section>
  );

  return (
    <div style={styles.appShell}>
      <aside style={styles.sidebar}>
        <h1 style={styles.logo}>AIO Website QA</h1>
        <nav style={styles.nav}>
          {NAV_ITEMS.map((item) => (
            <button key={item} style={{ ...styles.navItem, ...(activeNav === item ? styles.navItemActive : {}) }} onClick={() => setActiveNav(item)}>{item}</button>
          ))}
        </nav>
      </aside>

      <main style={styles.main}>
        <header style={styles.topBar}><h2 style={styles.heading}>Enterprise Website Quality Platform</h2><p style={styles.meta}>Responsive testing, automated audits, and issue governance in one workspace.</p></header>
        {overviewPanel}
        {controlsPanel}
        {(activeNav === 'Dashboard' || activeNav === 'Responsive Lab') ? responsiveLab : null}
        {(activeNav === 'Dashboard' || activeNav === 'Automated Audits') ? auditPanel : null}
        {(activeNav === 'Dashboard' || activeNav === 'Issue Center') ? issueCenter : null}
        {(activeNav === 'Dashboard' || activeNav === 'Run History') ? historyPanel : null}
      </main>

      {expandedScreen ? (
        <div style={styles.lightboxBackdrop} onClick={() => setExpandedScreen(null)}>
          <div style={styles.lightboxCard} onClick={(e) => e.stopPropagation()}>
            <div style={styles.lightboxHeader}><h3 style={styles.cardTitle}>{expandedScreen.label} Focused Test</h3><button style={styles.closeButton} onClick={() => setExpandedScreen(null)}>Close</button></div>
            {renderScreenCard(expandedScreen, true)}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function KpiCard({ title, value, color }) {
  return <div style={{ ...styles.kpiCard, borderColor: color }}><p style={styles.kpiTitle}>{title}</p><p style={styles.kpiValue}>{value}</p></div>;
}

const styles = {
  appShell: { margin: 0, minHeight: '100vh', display: 'grid', gridTemplateColumns: '260px 1fr', background: '#0b0e13', color: '#e5e7eb', fontFamily: 'Inter, system-ui, sans-serif' },
  sidebar: { borderRight: '1px solid #1c2330', padding: '24px 16px', display: 'grid', alignContent: 'start', gap: '18px', background: '#0f141d' },
  logo: { margin: 0, fontSize: '1.15rem' },
  nav: { display: 'grid', gap: '10px' },
  navItem: { border: '1px solid #263042', background: '#131a26', color: '#c5cedd', borderRadius: '10px', textAlign: 'left', padding: '10px 12px', cursor: 'pointer' },
  navItemActive: { borderColor: '#4b90ff', background: '#1a2f52', color: '#f1f5fb' },
  main: { padding: '24px', display: 'grid', gap: '16px' },
  topBar: { borderBottom: '1px solid #1f2734', paddingBottom: '10px' },
  heading: { margin: 0, fontSize: '1.5rem' },
  panel: { border: '1px solid #232b39', borderRadius: '14px', background: '#121720', padding: '16px', display: 'grid', gap: '14px' },
  sectionTitle: { margin: 0, fontSize: '1.2rem' },
  formGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '10px' },
  label: { display: 'grid', gap: '6px', fontSize: '0.9rem', color: '#c3ccda' },
  input: { background: '#0b0f16', border: '1px solid #2c3649', borderRadius: '8px', color: '#fff', padding: '9px 10px' },
  selectGroup: { display: 'grid', gap: '8px' },
  groupTitle: { margin: 0, fontSize: '1rem' },
  pillRow: { display: 'flex', flexWrap: 'wrap', gap: '8px' },
  pill: { border: '1px solid #33405a', borderRadius: '999px', background: '#121b2b', color: '#c4d2e6', padding: '7px 12px', cursor: 'pointer' },
  pillActive: { background: '#1f3d69', borderColor: '#63a5ff', color: '#f5f8fd' },
  actionRow: { display: 'grid', gap: '8px' },
  primaryButton: { border: 'none', background: '#68a5ff', color: '#10203a', borderRadius: '10px', padding: '11px 14px', fontWeight: 700, cursor: 'pointer' },
  secondaryButton: { width: 'fit-content', border: '1px solid #315079', background: '#122743', color: '#d8e7fb', borderRadius: '8px', padding: '8px 10px', cursor: 'pointer' },
  errorText: { margin: 0, color: '#ff9191' },
  kpiGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '10px' },
  kpiCard: { border: '1px solid', borderRadius: '10px', background: '#0c131c', padding: '12px' },
  kpiTitle: { margin: 0, color: '#9fb0c7', fontSize: '0.84rem' },
  kpiValue: { margin: '6px 0 0', fontSize: '1.6rem', fontWeight: 700 },
  infoCard: { border: '1px solid #263246', borderRadius: '10px', padding: '12px', background: '#0d141d' },
  cardTitle: { margin: 0 },
  meta: { margin: 0, color: '#9aa9bf' },
  viewportGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '12px' },
  viewportCard: { border: '1px solid #2d384d', borderRadius: '10px', background: '#0b111a', padding: '10px', display: 'grid', gap: '10px' },
  viewportCardLarge: { border: '1px solid #2d384d', borderRadius: '10px', background: '#0b111a', padding: '12px', display: 'grid', gap: '10px' },
  viewportHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.9rem' },
  pillTag: { border: '1px solid #344058', borderRadius: '999px', padding: '3px 7px', fontSize: '0.75rem', color: '#a7b7ce' },
  viewportFrameWrap: { border: '1px solid #2a3446', borderRadius: '10px', overflow: 'hidden', background: '#06090f', display: 'grid', placeItems: 'center' },
  scaledCanvas: { overflow: 'hidden', borderRadius: '8px', position: 'relative' },
  iframe: { border: 'none', transformOrigin: 'top left', pointerEvents: 'auto' },
  auditLayout: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px' },
  issueBar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' },
  issueRow: { display: 'grid', gridTemplateColumns: '84px 1fr', gap: '10px', border: '1px solid #2b3649', borderRadius: '8px', padding: '10px', background: '#0d141f' },
  severity: { fontWeight: 700, color: '#f2c16b' },
  listCompact: { margin: 0, paddingLeft: '18px', display: 'grid', gap: '7px' },
  source: { color: '#94a5bf', fontSize: '0.84rem' },
  historyGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '10px' },
  lightboxBackdrop: { position: 'fixed', inset: 0, background: 'rgba(3, 7, 16, 0.84)', display: 'grid', placeItems: 'center', zIndex: 50, padding: '20px' },
  lightboxCard: { width: 'min(1080px, 100%)', border: '1px solid #324360', borderRadius: '14px', background: '#101826', padding: '16px', display: 'grid', gap: '12px' },
  lightboxHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  closeButton: { border: '1px solid #3f4f66', background: '#152237', color: '#d9e5f7', borderRadius: '8px', padding: '8px 10px', cursor: 'pointer' }
};

createRoot(document.getElementById('root')).render(<App />);
