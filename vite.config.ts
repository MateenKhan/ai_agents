import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Standalone AI-Agents shell. Talks to the db-server (:6952) via VITE_API_BASE.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 6951,
    // Never hop to another port. Without this, if 6951 is busy vite silently
    // grabs 6952 — the db-server's port — and the db then dies with EADDRINUSE.
    strictPort: true,
    host: true,
    // The db-server owns the SQLite file (+ WAL/SHM) and embedding index. None of it is
    // in vite's module graph, but ignore it explicitly so DB writes never nudge the watcher.
    watch: { ignored: ['**/*.db', '**/*.db-wal', '**/*.db-shm', '**/db/data/**', '**/*.sqlite', '**/*.sqlite3'] },
  },
});
