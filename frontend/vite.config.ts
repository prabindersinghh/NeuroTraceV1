import path from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

/**
 * The PWA configuration is load-bearing, not decoration.
 *
 * The exam has to complete with the phone in airplane mode: feature extraction already
 * runs on-device, so the only thing left to remove is the network dependency of the app
 * shell itself. That means precaching the shell *and* the MediaPipe WASM and model, which
 * are large and would otherwise be fetched on first use — exactly when the patient is
 * offline.
 *
 * The model is served from our own origin rather than a CDN for the same reason.
 */
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "mediapipe/**/*"],
      workbox: {
        // The face model is ~4 MB; the default 2 MB cap would silently skip it and the
        // offline claim would fail in the one place it matters.
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
        globPatterns: ["**/*.{js,css,html,svg,png,woff2,wasm,task,binarypb}"],
        navigateFallback: "index.html",
        runtimeCaching: [
          {
            // API responses are never cached: a stale dashboard showing yesterday's band
            // as though it were today's is worse than showing nothing.
            urlPattern: ({ url }) => url.pathname.startsWith("/api"),
            handler: "NetworkOnly",
          },
        ],
      },
      manifest: {
        name: "NeuroTrace",
        short_name: "NeuroTrace",
        description:
          "A 90-second daily neurological check-in that runs entirely on your phone.",
        theme_color: "#173a7a",
        background_color: "#f8fbff",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "./src") },
  },
  server: {
    port: 5173,
    host: true, // so a phone on the same network can reach the dev server
  },
  build: { outDir: "dist", sourcemap: false },
});
