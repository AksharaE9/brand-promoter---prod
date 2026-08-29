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

let gitHash = process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || 'default';
if (gitHash === 'default') {
  try {
    gitHash = execSync('git rev-parse --short HEAD').toString().trim();
  } catch (e) {
    // Graceful fallback if git is not available
  }
}
const shortHash = gitHash.substring(0, 7);
const buildTime = new Date().toISOString();

export default defineConfig(({ command }) => {
  const isDev = command === 'serve';
  return {
    define: {
      'process.env.NODE_ENV': JSON.stringify(isDev ? 'development' : 'production'),
      __DEV__: isDev,
      'import.meta.env.VITE_BUILD_HASH': JSON.stringify(shortHash),
      'import.meta.env.VITE_BUILD_TIME': JSON.stringify(buildTime),
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
        // Precache versioned static assets (JS/CSS bundles have content-hash in
        // filename so Workbox detects changes and updates them on each deploy).
        globPatterns: ['**/*.{js,css,html,ico,woff2}'],

        // Remove precache entries from previous deploys on activation.
        // Without this, old caches accumulate and may serve stale assets.
        cleanupOutdatedCaches: true,

        // Exclude /api/* from SW interception entirely — API responses must
        // always go to the network. The StaleWhileRevalidate patterns below
        // only apply to specific non-scheduling, non-auth routes.
        navigateFallbackDenylist: [/^\/api\//],

        // Runtime caching strategies for static assets only (all /api/* requests bypass SW)
        runtimeCaching: [
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

        // skipWaiting: immediately activate the new SW without waiting for old
        // tabs to close. clientsClaim: take control of all open tabs straight away.
        // Together these ensure a fresh deploy is reflected on the next navigation
        // for returning users (not just new tabs / hard refreshes).
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
    warmup: {
      clientFiles: [
        './src/main.jsx',
        './src/App.jsx',
        './src/pages/Dashboard.jsx',
        './src/pages/InterviewSchedule.jsx',
      ],
    },
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
  build: {
    target: 'es2020',
    modulePreload: false,
    cssCodeSplit: true,
    sourcemap: false,           // disable in production
    reportCompressedSize: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (
              id.includes('react-router-dom') || 
              id.includes('react-router') || 
              id.includes('@remix-run') ||
              id.includes('react') || 
              id.includes('react-dom') || 
              id.includes('scheduler')
            ) {
              return 'react-vendor';
            }
            if (id.includes('@tanstack/react-query') || id.includes('@tanstack/query')) {
              return 'query-vendor';
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
            if (id.includes('html2canvas')) {
              return 'vendor-html2canvas';
            }
            if (id.includes('socket.io-client') || id.includes('engine.io-client')) {
              return 'vendor-socketio';
            }
            return 'vendor';
          }
        },
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
      },
    },
    chunkSizeWarningLimit: 250,
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
};
});
