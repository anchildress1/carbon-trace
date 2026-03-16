import { defineConfig } from 'vite';

function relaxCspInDev() {
  return {
    name: 'relax-csp-dev',
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        if (ctx.server) {
          return html.replace("connect-src 'none'", "connect-src 'self' ws:");
        }
        return html;
      },
    },
  };
}

export default defineConfig({
  root: '.',
  publicDir: 'public',
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [relaxCspInDev()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: 'index.html',
    },
  },
  server: {
    open: true,
  },
});
