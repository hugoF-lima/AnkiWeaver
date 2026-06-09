import { defineConfig } from 'vite'
import path from 'path'
import { fileURLToPath } from 'url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

// ESM replacement for __dirname
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export default defineConfig(({ mode }) => {
  const isAndroid = mode === 'android';
  
  return {
    plugins: [
      react(),
      tailwindcss(),
    ],
    build: {
      outDir: isAndroid ? 'android/app/src/main/assets/www' : 'dist',
      emptyOutDir: true,
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      proxy: {
        '/api': {
          target: 'http://localhost:8000',
          changeOrigin: true,
          secure: false,
        },
        '/media': {
          target: 'http://localhost:8000',
          changeOrigin: true,
          secure: false,
        },
      },
      watch: {
        ignored: [
          '**/backend/flashvenv/**',
          '**/.git/**',
          '**/.vscode/**',
          '**/.idea/**',
          '**/documentation/**',
          '**/node_modules/**',
          '**/android/**'
        ]
      }
    },
  }
})
