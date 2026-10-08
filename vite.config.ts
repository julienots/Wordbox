import { defineConfig } from 'vite';

// "debug" mode (APK debug) embeds the debug overlay; production builds strip it.
export default defineConfig(({ mode }) => ({
  base: './',
  define: {
    __DEBUG__: JSON.stringify(mode !== 'production'),
    __VERSION__: JSON.stringify(process.env.npm_package_version ?? '2.0.0'),
  },
  build: {
    target: 'es2020',
    outDir: 'dist',
    sourcemap: mode !== 'production',
    chunkSizeWarningLimit: 2000,
  },
  test: {
    environment: 'node',
    testTimeout: 600000,
  },
}));
