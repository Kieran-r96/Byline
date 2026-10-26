/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// BYLINE_API_PORT lets parallel worktrees run their own backend; 8000 by default
const BACKEND = `http://127.0.0.1:${process.env.BYLINE_API_PORT ?? '8000'}`

const proxy = {
  '/api': { target: BACKEND, changeOrigin: true },
  '/healthz': { target: BACKEND, changeOrigin: true },
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy,
  },
  preview: {
    port: 4173,
    proxy,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
    restoreMocks: true,
  },
})
