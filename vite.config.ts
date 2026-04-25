import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 1420,
    strictPort: true,
    // Use polling to avoid Windows file-watcher UNKNOWN errors
    watch: {
      usePolling: true,
      interval: 300,
      ignored: ['**/src-tauri/**'],
    },
  },
  worker: {
    format: 'es',
  },
  build: {
    target: 'esnext',
    sourcemap: true,
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules')) {
            if (
              id.includes('/react/') ||
              id.includes('/react-dom/') ||
              id.includes('/react-router-dom/') ||
              id.includes('/react-router/')
            ) {
              return 'vendor-react';
            }
            if (id.includes('/@tauri-apps/')) return 'vendor-tauri';
            if (id.includes('/pdfjs-dist/')) return 'vendor-pdf';
            if (id.includes('/@xenova/transformers/')) return 'vendor-transformers';
            if (id.includes('/mammoth/')) return 'vendor-mammoth';
          }
          return undefined;
        },
      },
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
    exclude: ['node_modules', 'dist', 'src-tauri', 'e2e/**', '**/playwright/**'],
  },
});
