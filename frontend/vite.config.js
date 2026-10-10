import process from "node:process";
import { execFileSync } from "node:child_process";
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

function buildRevision() {
  // Public source identity only; never expose arbitrary provider environment values.
  if (/^[a-f0-9]{40}$/i.test(process.env.VERCEL_GIT_COMMIT_SHA || "")) return process.env.VERCEL_GIT_COMMIT_SHA;
  try {
    const revision = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    if (!/^[a-f0-9]{40}$/i.test(revision)) return "unknown";
    const dirty = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return revision + (dirty ? "-dirty" : "");
  } catch { return "unknown"; }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [tailwindcss(), react(), { name: "medipulse-build-identity", apply: "build", transformIndexHtml: () => [{ tag: "meta", attrs: { name: "medipulse-build-revision", content: buildRevision() }, injectTo: "head" }] }],
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/backend': { target: process.env.DEV_API_PROXY_URL || loadEnv(mode, process.cwd(), 'DEV_').DEV_API_PROXY_URL || 'http://localhost:8080', changeOrigin: true, ws: true, rewrite: path => path.replace(/^\/backend/, '') }, '/api': { target: process.env.DEV_API_PROXY_URL || loadEnv(mode, process.cwd(), 'DEV_').DEV_API_PROXY_URL || 'http://localhost:8080', changeOrigin: true } },
  },
}));
