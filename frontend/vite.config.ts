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
      includeAssets: ["favicon.svg", "icon-maskable.svg", "mediapipe/**/*"],
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
          "A ~3-minute daily neurological check-in that runs entirely on your phone.",
        theme_color: "#173a7a",
        background_color: "#f8fbff",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        // The manifest declared /icon-192.png and /icon-512.png since it was written and
        // NEITHER FILE HAS EVER EXISTED - `public/` held only favicon.svg and icons.svg.
        // Every load logged "Download error or resource isn't a valid image", so "Add to
        // home screen" produced a blank icon, and some Android versions suppress the
        // install prompt outright when a manifest's icons cannot be fetched. That is not
        // cosmetic here: the installed PWA IS the airplane-mode demo.
        //
        // SVG rather than the declared PNGs, for a reason worth recording: committing
        // raster icons trips `test_privacy.py`, which treats every tracked image as a
        // possible photograph of a real patient's records. That scanner is deliberately
        // blunt and it is right to be (INV-11), so the fix routes around the need for a
        // raster instead of weakening it. `icon-maskable.svg` is square with an opaque
        // ground and the mark inset to 56%, so it survives a launcher's circular crop;
        // favicon.svg is 48x46 and could not.
        icons: [
          { src: "/icon-maskable.svg", sizes: "any", type: "image/svg+xml" },
          {
            src: "/icon-maskable.svg",
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
