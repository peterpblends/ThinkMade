import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { name: 'brand', include: ['scripts/**/*.test.ts', 'src/**/*.test.ts'], testTimeout: 60_000 } });
