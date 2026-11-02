/// <reference types="vitest" />
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// В разработке запросы к /api уходят на бэкенд через прокси: один origin, cookie сессии работает без CORS.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react()],
    // e2e-сценарии гоняет Playwright, vitest берёт только юнит-тесты из src
    test: { include: ['src/**/*.test.ts'] },
    server: {
      port: 5173,
      proxy: { '/api': { target: env.VITE_PROXY_TARGET ?? 'http://localhost:8000', changeOrigin: true } },
    },
  }
})
