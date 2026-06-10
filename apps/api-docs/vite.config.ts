import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react-swc'
import { defineConfig } from 'vite'
import { analyzer, unstableRolldownAdapter } from 'vite-bundle-analyzer'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [
    react(),
    tsconfigPaths({ ignoreConfigErrors: true }),
    tailwindcss(),
    ...(process.env.CI ? [] : [
      unstableRolldownAdapter(analyzer({
        analyzerMode: 'static',
        openAnalyzer: false,
        reportTitle: 'api-docs-bundle-analysis',
      })),
    ]),
  ],
  server: {
    proxy: process.env.CI ? undefined : {
      '/api': {
        target: process.env.API_DOCS_PROXY_TARGET ?? 'http://localhost:8080',
        changeOrigin: true,
      },
      '/rpc': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
})
