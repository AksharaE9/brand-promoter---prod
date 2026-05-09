import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
    plugins: [react()],
    server: {
        proxy: {
            '/api': {
                target: 'http://localhost:4000',
                changeOrigin: true,
            },
        },
    },
    build: {
        rollupOptions: {
            output: {
                manualChunks(id) {
                    if (id.includes('node_modules')) {
                        if (id.includes('react') || id.includes('react-dom') || id.includes('react-router-dom')) {
                            return 'react-vendor';
                        }
                        if (id.includes('framer-motion') || id.includes('lucide-react')) {
                            return 'ui-vendor';
                        }
                    }
                }
            }
        },
        chunkSizeWarningLimit: 1000,
        cssCodeSplit: true,
        reportCompressedSize: false
    }
});
