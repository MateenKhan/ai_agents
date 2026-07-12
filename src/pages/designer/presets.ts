import { DevicePreset, VisualTweaks } from './types';

export const DEVICE_PRESETS: DevicePreset[] = [
  // Mobile Models
  { id: 'iphone-15-pro', name: 'iPhone 15 Pro', category: 'Mobile', width: 393, height: 852 },
  { id: 'iphone-14', name: 'iPhone 14', category: 'Mobile', width: 390, height: 844 },
  { id: 'pixel-8', name: 'Google Pixel 8', category: 'Mobile', width: 412, height: 915 },
  { id: 'galaxy-s24', name: 'Samsung Galaxy S24', category: 'Mobile', width: 360, height: 780 },
  // Tablet Models
  { id: 'ipad-pro-11', name: 'iPad Pro 11"', category: 'Tablet', width: 834, height: 1194 },
  { id: 'ipad-mini', name: 'iPad Mini', category: 'Tablet', width: 744, height: 1133 },
  { id: 'galaxy-tab-s9', name: 'Galaxy Tab S9', category: 'Tablet', width: 800, height: 1280 },
  // Desktop Models
  { id: 'macbook-pro-14', name: 'MacBook Pro 14"', category: 'Desktop', width: 1512, height: 982 },
  { id: 'desktop-1080p', name: 'Standard 1080p', category: 'Desktop', width: 1920, height: 1080 },
  { id: 'fluid', name: 'Full Fluid', category: 'Desktop', width: '100%', height: '100%' },
];

export const DEFAULT_TWEAKS: VisualTweaks = {
  fontFamily: 'Inter',
  fontSize: '15px',
  fontWeight: '400',
  lineHeight: '1.6',
  bgColor: '#0f172a',
  textColor: '#f8fafc',
  accentColor: '#6366f1',
  borderRadius: 16,
  borderWidth: 1,
  boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.4)',
};

export const DEFAULT_FILES = {
  '/App.tsx': `import React, { useState } from "react";
import "./styles.css";

export default function App() {
  const [count, setCount] = useState(0);
  const [activeTab, setActiveTab] = useState("overview");

  return (
    <div className="studio-container">
      <header className="studio-header">
        <div className="logo-badge">Visual Studio</div>
        <div className="header-status">Live Preview Active</div>
      </header>

      <main className="studio-main">
        <div className="card hero-card">
          <div className="card-top">
            <span className="tag">Responsive UI</span>
            <span className="status-dot" />
          </div>
          <h1>Next-Gen Agentic Design Studio</h1>
          <p className="subtitle">
            Live compile and tweak React components across authentic device viewports.
          </p>

          <div className="stats-row">
            <div className="stat-box">
              <span className="stat-value">{count}</span>
              <span className="stat-label">Interactions</span>
            </div>
            <div className="stat-box">
              <span className="stat-value">60fps</span>
              <span className="stat-label">Frame Rate</span>
            </div>
            <div className="stat-box">
              <span className="stat-value">100%</span>
              <span className="stat-label">Responsive</span>
            </div>
          </div>

          <div className="actions">
            <button className="btn btn-primary" onClick={() => setCount(c => c + 1)}>
              Interactive Counter ({count})
            </button>
            <button className="btn btn-secondary" onClick={() => setCount(0)}>
              Reset
            </button>
          </div>
        </div>

        <div className="card tabs-card">
          <div className="tabs-header">
            <button
              className={activeTab === "overview" ? "tab active" : "tab"}
              onClick={() => setActiveTab("overview")}
            >
              Overview
            </button>
            <button
              className={activeTab === "metrics" ? "tab active" : "tab"}
              onClick={() => setActiveTab("metrics")}
            >
              Metrics
            </button>
          </div>
          <div className="tab-body">
            {activeTab === "overview" ? (
              <p>Adjust visual tokens in the left-hand Inspector sidebar to live-modify colors, border radius, and typography.</p>
            ) : (
              <p>Sandpack runtime compiles code in real-time right inside your browser.</p>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}`,
  '/styles.css': `:root {
  --bg-color: #0f172a;
  --text-color: #f8fafc;
  --accent-color: #6366f1;
  --font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --font-size: 15px;
  --font-weight: 400;
  --line-height: 1.6;
  --border-radius: 16px;
  --border-width: 1px;
  --box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.4);
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  padding: 0;
  background-color: var(--bg-color);
  color: var(--text-color);
  font-family: var(--font-family);
  font-size: var(--font-size);
  font-weight: var(--font-weight);
  line-height: var(--line-height);
}

.studio-container {
  min-height: 100vh;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.studio-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.logo-badge {
  background: rgba(99, 102, 241, 0.15);
  color: var(--accent-color);
  padding: 6px 12px;
  border-radius: 9999px;
  font-weight: 700;
  font-size: 0.85rem;
  border: 1px solid rgba(99, 102, 241, 0.3);
}

.header-status {
  font-size: 0.85rem;
  opacity: 0.7;
}

.studio-main {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.card {
  background: rgba(255, 255, 255, 0.03);
  border: var(--border-width) solid rgba(255, 255, 255, 0.08);
  border-radius: var(--border-radius);
  padding: 24px;
  box-shadow: var(--box-shadow);
  transition: all 0.2s ease;
}

.card-top {
  display: flex;
  align-items: center;
  justify-contems: space-between;
  margin-bottom: 12px;
}

.tag {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  opacity: 0.6;
}

.status-dot {
  width: 8px;
  height: 8px;
  background: #10b981;
  border-radius: 505;
  box-shadow: 0 0 8px #10b981;
}

h1 {
  margin: 0 0 8px 0;
  font-size: 1.6rem;
  font-weight: 700;
  line-height: 1.25;
}

.subtitle {
  margin: 0 0 20px 0;
  opacity: 0.8;
}

.stats-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin-bottom: 24px;
}

.stat-box {
  background: rgba(255, 255, 255, 0.03);
  padding: 12px;
  border-radius: calc(var(--border-radius) * 0.6);
  border: 1px solid rgba(255, 255, 255, 0.05);
  text-align: center;
}

.stat-value {
  display: block;
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--accent-color);
}

.stat-label {
  font-size: 0.75rem;
  opacity: 0.6;
}

.actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.btn {
  padding: 10px 18px;
  border-radius: calc(var(--border-radius) * 0.6);
  font-weight: 600;
  font-size: 0.9rem;
  cursor: pointer;
  border: none;
  transition: transform 0.15s ease, opacity 0.15s ease;
}

.btn:active {
  transform: scale(0.98);
}

.btn-primary {
  background: var(--accent-color);
  color: #ffffff;
  box-shadow: 0 4px 12px rgba(99, 102, 241, 0.3);
}

.btn-secondary {
  background: rgba(255, 255, 255, 0.08);
  color: var(--text-color);
}

.tabs-card {
  padding: 0;
  overflow: hidden;
}

.tabs-header {
  display: flex;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(0, 0, 0, 0.2);
}

.tab {
  flex: 1;
  background: none;
  border: none;
  padding: 14px;
  color: var(--text-color);
  font-weight: 600;
  opacity: 0.6;
  cursor: pointer;
  transition: opacity 0.2s;
}

.tab.active {
  opacity: 1;
  border-bottom: 2px solid var(--accent-color);
}

.tab-body {
  padding: 20px 24px;
}`,
};
