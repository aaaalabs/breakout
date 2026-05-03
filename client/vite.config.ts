import { defineConfig } from 'vite';

// Vite 6 config for Breakout client.
// - Resolves @breakout/shared via npm workspaces (no extra alias needed).
// - Splits Phaser into its own chunk to keep app code small.
// - Dev server on 5173 to match Vercel-local convention.
export default defineConfig({
    base: './',
    build: {
        target: 'es2020',
        outDir: 'dist',
        sourcemap: false,
        rollupOptions: {
            output: {
                manualChunks: {
                    phaser: ['phaser'],
                    colyseus: ['colyseus.js'],
                },
            },
        },
        minify: 'terser',
        terserOptions: {
            compress: { passes: 2 },
            mangle: true,
            format: { comments: false },
        },
    },
    server: {
        port: 5173,
        host: true,
    },
});
