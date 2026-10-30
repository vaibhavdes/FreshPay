import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  test: {
    include: ['tests/**/*.test.ts'],
    env: { PAYPAL_CLIENT_ID: 'test-client', PAYPAL_SECRET: 'test-secret', CHALLENGE_SECRET: 'test-challenge-secret-0123456789abcdef' },
    coverage: { provider: 'v8', include: ['lib/engine/**'], thresholds: { 100: true } },
  },
});
