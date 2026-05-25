import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { visualizer } from 'rollup-plugin-visualizer';
import viteCompression from 'vite-plugin-compression';

export default defineConfig({
  plugins: [
    react(),
    viteCompression({ algorithm: 'gzip', ext: '.gz' }),
    viteCompression({ algorithm: 'brotliCompress', ext: '.br' }),
    visualizer({ open: false, filename: 'stats.html' }),
  ],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
  build: {
    target: 'esnext',
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true,
        pure_funcs: ['console.log', 'console.warn'],
      },
    },
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Core React — load first
          if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/')) {
            return 'vendor-react';
          }
          // Router
          if (id.includes('node_modules/react-router')) {
            return 'vendor-router';
          }
          // Charts — only loaded on Analytics page
          if (id.includes('node_modules/recharts') || id.includes('node_modules/d3-')) {
            return 'vendor-charts';
          }
          // Framer Motion — animations
          if (id.includes('node_modules/framer-motion')) {
            return 'vendor-motion';
          }
          // Firebase — auth/db
          if (id.includes('node_modules/firebase') || id.includes('node_modules/@firebase')) {
            return 'vendor-firebase';
          }
          // React Query
          if (id.includes('node_modules/@tanstack')) {
            return 'vendor-query';
          }
          // HTML2Canvas — only for Analytics export
          if (id.includes('node_modules/html2canvas')) {
            return 'vendor-html2canvas';
          }
          // Socket.io
          if (id.includes('node_modules/socket.io-client') || id.includes('node_modules/engine.io')) {
            return 'vendor-socket';
          }
          // Lucide icons
          if (id.includes('node_modules/lucide-react')) {
            return 'vendor-icons';
          }
        },
      },
    },
    chunkSizeWarningLimit: 400,
    cssCodeSplit: true,
    reportCompressedSize: true,
    sourcemap: false,
  },
});
