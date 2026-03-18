import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { copyFileSync, existsSync } from 'fs'

// T2-8: Copy service-worker.js and offline.html into /public during build
function copyServiceWorker() {
  return {
    name: 'copy-service-worker',
    writeBundle() {
      const files = [
        ['../service-worker.js', 'dist/service-worker.js'],
        ['../offline.html',      'dist/offline.html'],
        ['../sortWorker.js',     'dist/sortWorker.js'],
      ]
      for (const [src, dest] of files) {
        const srcPath = path.resolve(__dirname, src)
        if (existsSync(srcPath)) {
          copyFileSync(srcPath, path.resolve(__dirname, dest))
          console.log(`[copy-sw] ${src} → ${dest}`)
        }
      }
    },
  }
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, path.resolve(__dirname, '..'), '')

  return {
    plugins: [react(), copyServiceWorker()],

    // Expose only VITE_ prefixed vars to the browser bundle
    define: {
      'import.meta.env.VITE_SUPABASE_URL':      JSON.stringify(env.VITE_SUPABASE_URL),
      'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(env.VITE_SUPABASE_ANON_KEY),
      'import.meta.env.VITE_API_BASE':           JSON.stringify(env.VITE_API_BASE  || ''),
      'import.meta.env.VITE_WS_URL':             JSON.stringify(env.VITE_WS_URL    || ''),
    },

    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: env.FRONTEND_ORIGIN
            ? env.FRONTEND_ORIGIN.replace('5173', '8000')
            : 'http://localhost:8000',
          changeOrigin: true,
        },
        '/ws': {
          target: 'ws://localhost:8000',
          ws: true,
        },
      },
    },
  }
})
