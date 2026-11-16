// AI-assisted; see README.
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  base: './',
  resolve: { alias: { '@contracts': fileURLToPath(new URL('../contracts', import.meta.url)) } },
  server: { fs: { allow: ['..'] } },
  build: { outDir: 'dist', target: 'es2020' },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
