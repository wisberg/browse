import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';

function App() {
  const [url, setUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState('Enter a site URL or sitemap URL to generate Desktop/Mobile PDFs in one ZIP.');

  async function startExport() {
    setMessage('Preparing export...');
    setIsLoading(true);

    try {
      const response = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || 'Export failed.');
      }

      const blob = await response.blob();
      const downloadUrl = URL.createObjectURL(blob);
      const contentDisposition = response.headers.get('Content-Disposition') || '';
      const fileNameMatch = contentDisposition.match(/filename="?([^\"]+)"?/i);
      const fileName = fileNameMatch?.[1] || 'website_exports.zip';

      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(downloadUrl);

      setMessage('Done. Your ZIP has Desktop/ and Mobile/ folders with per-page PDFs.');
    } catch (error) {
      setMessage(`Error: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main style={styles.page}>
      <section style={styles.card}>
        <h1 style={styles.title}>Sitemap PDF Exporter</h1>
        <p style={styles.subtitle}>Paste a website URL (or sitemap.xml URL), then export full-page PDFs for desktop and mobile.</p>

        <input
          style={styles.input}
          placeholder="https://example.com or https://example.com/sitemap.xml"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
        />

        <button style={styles.button} onClick={startExport} disabled={isLoading || !url.trim()}>
          {isLoading ? 'Running...' : 'Start Export'}
        </button>

        <p style={styles.message}>{message}</p>
      </section>
    </main>
  );
}

const styles = {
  page: {
    minHeight: '100vh',
    margin: 0,
    display: 'grid',
    placeItems: 'center',
    background: '#0f172a',
    color: '#e2e8f0',
    fontFamily: 'Inter, system-ui, sans-serif'
  },
  card: {
    width: 'min(680px, 90vw)',
    padding: '2rem',
    borderRadius: '16px',
    background: '#111827',
    border: '1px solid #334155',
    boxShadow: '0 20px 45px rgba(0,0,0,.35)',
    display: 'grid',
    gap: '1rem'
  },
  title: {
    margin: 0,
    fontSize: '1.7rem'
  },
  subtitle: {
    margin: 0,
    color: '#94a3b8',
    lineHeight: 1.5
  },
  input: {
    borderRadius: '10px',
    border: '1px solid #475569',
    background: '#0b1220',
    color: '#f8fafc',
    padding: '.8rem 1rem',
    fontSize: '1rem'
  },
  button: {
    border: 0,
    borderRadius: '10px',
    padding: '.85rem 1rem',
    fontWeight: 600,
    background: '#38bdf8',
    color: '#0f172a',
    cursor: 'pointer'
  },
  message: {
    margin: 0,
    color: '#cbd5e1'
  }
};

createRoot(document.getElementById('root')).render(<App />);
