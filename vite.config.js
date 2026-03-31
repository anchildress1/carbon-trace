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

/**
 * Stub out PixiJS renderers that this app never uses. autoDetectRenderer
 * dynamically imports CanvasRenderer and WebGPURenderer — this plugin
 * replaces those modules with empty exports so Rollup excludes their code.
 * Application.init({ preference: 'webgl' }) ensures these stubs are never
 * reached at runtime.
 */
function pixiWebGLOnly() {
  return {
    name: 'pixi-webgl-only',
    enforce: 'pre',
    load(id) {
      if (id.includes('/renderers/canvas/CanvasRenderer')) {
        return 'export const CanvasRenderer = null;';
      }
      if (id.includes('/renderers/gpu/WebGPURenderer')) {
        return 'export const WebGPURenderer = null;';
      }
      return null;
    },
  };
}

export default defineConfig({
  root: '.',
  publicDir: 'public',
  plugins: [relaxCspInDev(), pixiWebGLOnly()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: 'index.html',
    },
  },
  server: {
    open: true,
    headers: {
      'Cache-Control': 'no-store',
    },
  },
  preview: {
    open: false,
  },
});
