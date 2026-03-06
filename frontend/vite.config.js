import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Load .env from the PARENT directory (Radar_Pro/) instead of frontend/
  // This means you only maintain ONE .env file for both backend and frontend
  const env = loadEnv(mode, path.resolve(__dirname, '..'), '')

  return {
    plugins: [react()],

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
        // Proxy /api and /ws requests to the FastAPI backend
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
