import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    // Shown in the footer so we can tell at a glance whether a phone has the latest deploy.
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
})
