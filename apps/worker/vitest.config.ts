import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { name: 'worker', include: ['src/**/*.test.ts'], testTimeout: 120_000, hookTimeout: 60_000 } });
