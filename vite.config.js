import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 800,
    rolldownOptions: {
      output: {
        advancedChunks: {
          groups: [
            { name: 'vendor-react', test: /node_modules\/(react|react-dom|scheduler)\// },
            { name: 'vendor-ethers', test: /node_modules\/(ethers|@adraffy|@noble)\// },
            { name: 'vendor-goldrush', test: /node_modules\/@covalenthq\// },
            {
              name: 'vendor-ui',
              test: /node_modules\/(framer-motion|lucide-react|react-hot-toast|goober)\//,
            },
          ],
        },
      },
    },
  },
})
