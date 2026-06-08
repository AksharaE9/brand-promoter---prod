import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { visualizer } from 'rollup-plugin-visualizer';
import viteCompression from 'vite-plugin-compression';
import { VitePWA } from 'vite-plugin-pwa';
import { execSync } from 'child_process';

const stripAttributesPlugin = () => ({
  name: 'strip-attributes',
  transform(code, id) {
    if (/\.(jsx|tsx|js|ts)$/.test(id)) {
      const cleanCode = code
        .replace(/data-testid\s*=\s*({[^}]+}|"[^"]*"|'[^']*')/g, '')
        .replace(/data-cy\s*=\s*({[^}]+}|"[^"]*"|'[^']*')/g, '');
      return { code: cleanCode, map: null };
    }
    return null;
  }
});

let gitHash = 'default';
try {
  gitHash = execSync('git rev-parse --short HEAD').toString().trim();
} catch (e) {
  // Graceful fallback if git is not available
}

export default defineConfig({
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    __DEV__: false,
    'import.meta.env.VITE_BUILD_HASH': JSON.stringify(gitHash),
  },
  plugins: [
    react(),
    stripAttributesPlugin(),
    viteCompression({ algorithm: 'gzip', ext: '.gz' }),
    viteCompression({ algorithm: 'brotliCompress', ext: '.br' }),
    visualizer({ open: false, filename: 'stats.html', gzipSize: true }),
    VitePWA({
      registerType:    'autoUpdate',
      injectRegister:  'auto',
      workbox: {
        // Precache all static assets on install
        globPatterns: ['**/*.{js,css,html,ico,woff2}'],
        
        // Runtime caching strategies
        runtimeCaching: [
          {
            // API static data — serve stale while revalidating
            urlPattern: /\/api\/(jobs|team|org-settings|panel-members)/,
            handler:    'StaleWhileRevalidate',
            options: {
              cacheName:  'api-static',
              expiration: { maxAgeSeconds: 300, maxEntries: 50 },
            },
          },
          {
            // Fonts and icons — cache first, very long TTL
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com/,
            handler:    'CacheFirst',
            options: {
              cacheName:  'google-fonts',
              expiration: { maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
          {
            // Firebase Storage assets (avatars, resumes)
            urlPattern: /^https:\/\/storage\.googleapis\.com/,
            handler:    'CacheFirst',
            options: {
              cacheName:  'firebase-storage',
              expiration: { maxAgeSeconds: 60 * 60 * 24 * 7, maxEntries: 200 },
            },
          },
          {
            // Cloudinary images
            urlPattern: /^https:\/\/res\.cloudinary\.com/,
            handler:    'CacheFirst',
            options: {
              cacheName:  'cloudinary',
              expiration: { maxAgeSeconds: 60 * 60 * 24 * 30, maxEntries: 300 },
            },
          },
        ],
        
        // Skip waiting — activate new service worker immediately
        skipWaiting:  true,
        clientsClaim: true,
      },
      manifest: {
        name:             'TalentOS',
        short_name:       'TalentOS',
        theme_color:      '#1e3a5f',
        background_color: '#f8fafc',
        display:          'standalone',
        icons: [
          { src:'/icon-192.png', sizes:'192x192', type:'image/png' },
          { src:'/icon-512.png', sizes:'512x512', type:'image/png' },
        ],
      },
    })
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
    target: 'es2020',
    cssCodeSplit: true,
    sourcemap: false,           // disable in production
    reportCompressedSize: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('react-router-dom') || id.includes('react-router') || id.includes('@remix-run')) {
              return 'react-router';
            }
            if (id.includes('react') || id.includes('react-dom') || id.includes('scheduler')) {
              return 'react-core';
            }
            if (id.includes('@tanstack/react-query') || id.includes('@tanstack/query')) {
              return 'react-query';
            }
            if (id.includes('recharts')) {
              return 'vendor-charts';
            }
            if (id.includes('framer-motion')) {
              return 'vendor-motion';
            }
            if (id.includes('firebase')) {
              return 'vendor-firebase';
            }
            if (id.includes('lucide-react')) {
              return 'vendor-icons';
            }
            if (id.includes('@tanstack/react-virtual')) {
              return 'vendor-virtual';
            }
            return 'vendor';
          }
        },
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
      },
    },
    chunkSizeWarningLimit: 500,
  },
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-router-dom',
      '@tanstack/react-query',
      'lucide-react',
    ],
  },
});
