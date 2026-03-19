import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],

  // Optimize dependency pre-bundling
  optimizeDeps: {
    include: ['pdfjs-dist', 'react-markdown', 'react-syntax-highlighter']
  },

  // Development server configuration
  server: {
    port: 5173,
    open: true,
    // Configure headers to allow eval for Vite HMR
    headers: {
      'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self' https://generativelanguage.googleapis.com ws: wss: http://localhost:* http://127.0.0.1:*;"
    },
    // Proxy /chroma requests to ChromaDB to avoid CORS issues
    proxy: {
      '/chroma': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/chroma/, '')
      }
    }
  },

  // Production build optimizations
  build: {
    // Output directory
    outDir: 'dist',

    // Generate sourcemaps for debugging (disable in production if needed)
    sourcemap: false,

    // Minification
    minify: 'esbuild',

    // Target modern browsers for smaller bundles
    target: 'es2015',

    // Chunk size warning limit (500kb)
    chunkSizeWarningLimit: 500,

    // Rollup options for code splitting
    rollupOptions: {
      output: {
        // Manual chunk splitting for better caching
        manualChunks(id) {
          // React core libraries
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) {
            return 'react-vendor';
          }

          // PDF.js and related worker files
          if (id.includes('node_modules/pdfjs-dist')) {
            return 'pdf-vendor';
          }

          // AI and LangChain dependencies
          if (id.includes('node_modules/@google/generative-ai') ||
            id.includes('node_modules/@langchain') ||
            id.includes('node_modules/langchain')) {
            return 'ai-vendor';
          }

          // Markdown rendering libraries
          if (id.includes('node_modules/react-markdown') ||
            id.includes('node_modules/react-syntax-highlighter') ||
            id.includes('node_modules/remark-gfm')) {
            return 'markdown-vendor';
          }

          // DOCX processing
          if (id.includes('node_modules/mammoth')) {
            return 'docx-vendor';
          }

          // Lucide icons
          if (id.includes('node_modules/lucide-react')) {
            return 'icons-vendor';
          }
        },


        // Asset file naming
        assetFileNames: (assetInfo) => {
          const info = assetInfo.name.split('.')
          const ext = info[info.length - 1]
          if (/png|jpe?g|svg|gif|tiff|bmp|ico/i.test(ext)) {
            return `assets/images/[name]-[hash][extname]`
          } else if (/woff2?|ttf|otf|eot/i.test(ext)) {
            return `assets/fonts/[name]-[hash][extname]`
          }
          return `assets/[name]-[hash][extname]`
        },

        // Chunk file naming
        chunkFileNames: 'assets/js/[name]-[hash].js',
        entryFileNames: 'assets/js/[name]-[hash].js'
      }
    },

    // CSS code splitting
    cssCodeSplit: true,

    // Asset inlining threshold (4kb)
    assetsInlineLimit: 4096
  }
})
