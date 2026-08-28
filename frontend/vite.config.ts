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
        // BOTH PNGs referenced here were declared and never existed - `public/` has only
        // favicon.svg and icons.svg. The browser logged "Download error or resource isn't a
        // valid image" for every install, so "Add to home screen" produced a blank icon and
        // on some Android versions the install prompt is suppressed outright when a
        // manifest's icons cannot be fetched. That is not cosmetic for this product: the
        // installed PWA IS the offline/airplane-mode story.
        //
        // Pointed at the brand asset that actually exists rather than inventing artwork.
        // An SVG icon is valid in a web manifest and scales to every launcher size;
        // `sizes: "any"` is the correct declaration for one.
        icons: [
          { src: "/favicon.svg", sizes: "any", type: "image/svg+xml" },
          {
            src: "/favicon.svg",
            sizes: "any",
            type: "image/svg+xml",
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
