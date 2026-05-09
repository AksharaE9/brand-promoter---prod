import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { visualizer } from 'rollup-plugin-visualizer';
import viteCompression from 'vite-plugin-compression';

export default defineConfig({
    plugins: [
        react(),
        viteCompression({
            algorithm: 'gzip',
            ext: '.gz',
        }),
        visualizer({
            open: false,
            filename: 'stats.html',
        }),
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
            },
        },
        rollupOptions: {
            output: {
                manualChunks(id) {
                    if (id.includes('node_modules')) {
                        if (id.includes('react')) return 'vendor-react';
                        if (id.includes('framer-motion')) return 'vendor-motion';
                        if (id.includes('lucide-react')) return 'vendor-icons';
                        if (id.includes('react-window') || id.includes('react-virtualized-auto-sizer')) return 'vendor-virtual';
                        return 'vendor-utils';
                    }
                }
            }
        },
        chunkSizeWarningLimit: 600,
        cssCodeSplit: true,
        reportCompressedSize: true,
        sourcemap: false
    }
});
