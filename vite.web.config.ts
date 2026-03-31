import { TanStackRouterVite } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { defineConfig } from 'vite'

// Standalone Vite config for web-only mode (no electron-vite)
export default defineConfig({
  root: path.resolve(__dirname, 'src/renderer'),
  publicDir: path.resolve(__dirname, 'assets'),
  plugins: [
    TanStackRouterVite({
      target: 'react',
      autoCodeSplitting: true,
      routesDirectory: './src/renderer/routes',
      generatedRouteTree: './src/renderer/routeTree.gen.ts',
    }),
    react(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src/renderer'),
      '@shared': path.resolve(__dirname, 'src/shared'),
      'src/shared': path.resolve(__dirname, 'src/shared'),
    },
  },
  define: {
    'process.type': '"renderer"',
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development'),
    'process.env.CHATBOX_BUILD_TARGET': JSON.stringify('unknown'),
    'process.env.CHATBOX_BUILD_PLATFORM': JSON.stringify('web'),
    'process.env.CHATBOX_BUILD_CHANNEL': JSON.stringify('unknown'),
    'process.env.USE_LOCAL_API': JSON.stringify(''),
    'process.env.USE_BETA_API': JSON.stringify(''),
  },
  css: {
    modules: {
      generateScopedName: '[name]__[local]___[hash:base64:5]',
    },
  },
  server: {
    port: 1212,
    strictPort: false,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: path.resolve(__dirname, 'dist/web'),
    target: 'es2020',
    sourcemap: true,
  },
  optimizeDeps: {
    include: ['mermaid'],
    esbuildOptions: {
      target: 'es2015',
    },
  },
})
