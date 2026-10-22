import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { name: 'api', include: ['src/**/*.test.ts'], testTimeout: 60_000, hookTimeout: 60_000 } });
