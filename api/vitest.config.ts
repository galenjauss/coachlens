import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { include: ['src/**/*.test.ts'], testTimeout: 20000, env: { COACHLENS_ALLOW_UNSCOPED: '1' } } })
