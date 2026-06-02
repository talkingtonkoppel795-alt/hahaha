import { defineConfig } from "vite";

export default defineConfig({
  // Use relative paths so Tauri's custom protocol can load assets
  base: "./",
  // Prevent vite from obscuring Rust errors
  clearScreen: false,
  server: {
    // Tauri expects a fixed port
    port: 1420,
    strictPort: true,
    // Make the dev server accessible from Tauri's WebView
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  // Env variables starting with TAURI_ will be exposed to tauri's source code
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    // Tauri uses Chromium on Windows
    target: process.env.TAURI_PLATFORM === "windows" ? "chrome105" : "safari14",
    // Don't minify for debug builds
    minify: !process.env.TAURI_DEBUG ? "esbuild" : false,
    // Produce sourcemaps for debug builds
    sourcemap: !!process.env.TAURI_DEBUG,
  },
});
