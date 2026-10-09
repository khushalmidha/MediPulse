import process from "node:process";
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [tailwindcss(),react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/backend': { target: process.env.DEV_API_PROXY_URL || loadEnv(mode, process.cwd(), 'DEV_').DEV_API_PROXY_URL || 'http://localhost:8080', changeOrigin: true, ws: true, rewrite: path => path.replace(/^\/backend/, '') }, '/api': { target: process.env.DEV_API_PROXY_URL || loadEnv(mode, process.cwd(), 'DEV_').DEV_API_PROXY_URL || 'http://localhost:8080', changeOrigin: true } },
  },
}));
