import type { Plugin, Rollup } from "vite";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

/**
 * Security headers required for:
 *  - COOP/COEP: SharedArrayBuffer support
 *  - CSP: restrict resource loading to same-origin + known blob/data exceptions
 *  - Referrer / Permissions: tighten default browser leakage
 *  - X-Content-Type-Options: prevent MIME sniffing
 *  - X-Frame-Options: prevent clickjacking (belt-and-suspenders alongside frame-ancestors)
 */
/**
 * SHA-256 of every inline event handler Scenery puts in the parallel DOM,
 * base64 as CSP wants it.
 *
 * Scenery sets `onclick` on some PDOM primary siblings to suppress the browser's
 * default activation behaviour, and it uses two values: `return false` (the
 * step-forward button, for one) and the empty string. Without these hashes the
 * policy blocks the handler and Chrome logs a CSP error on *every* activation of
 * the control, which buries real errors and fails the `?fuzzBoard&ea` gate. The
 * handlers do nothing observable either way, so the sim always worked; the noise
 * was the problem.
 *
 * Note the directive actually enforced here is `script-src-attr`, which falls
 * back to `script-src` — so these live in `script-src` alongside 'unsafe-hashes'.
 * Without 'unsafe-hashes' the hashes are ignored outright for event handlers.
 *
 * Regenerate with:
 *   printf 'return false' | openssl dgst -sha256 -binary | openssl base64
 *   printf ''             | openssl dgst -sha256 -binary | openssl base64
 */
const SCENERY_PDOM_HANDLER_HASHES = [
  "'sha256-GZIcz60Uwd6wT3vaYke/atSr53TehbYAPepOa3d03Vw='", // "return false"
  "'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU='", // ""
].join(" ");

const securityHeaders: Record<string, string> = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Content-Security-Policy": [
    "default-src 'self'",
    // 'unsafe-eval' is required for SceneryStack query parameter parsing, which
    // builds its schema with Function/eval. Tracked upstream — see the CSP notes
    // in SECURITY.md for when it can be dropped and what to re-audit then.
    //
    // 'unsafe-hashes' + the hashes above admit exactly Scenery's two inline
    // event handlers and nothing else. They do NOT admit inline <script>
    // blocks; that still requires 'unsafe-inline', which is deliberately absent.
    `script-src 'self' 'unsafe-eval' 'unsafe-hashes' ${SCENERY_PDOM_HANDLER_HASHES}`,
    "worker-src blob: 'self'",
    // Inline styles are set via element.style / cssText throughout the UI layer.
    // Same upstream dependency as 'unsafe-eval' above.
    "style-src 'self' 'unsafe-inline'",
    // data: for icons
    "img-src 'self' data:",
    "media-src 'self' blob:",
    // blob: for fetch inside workers
    "connect-src 'self' blob:",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
  ].join("; "),
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

/** Single-file mode: inline every imported asset as base64 (effectively unlimited). */
const INLINE_LIMIT_BYTES = 100 * 1024 * 1024;

/** Workbox precache ceiling — SceneryStack bundles exceed the default 2 MB limit. */
const WORKBOX_MAX_FILE_BYTES = 12 * 1024 * 1024;

/** Escape a string for literal use inside a `RegExp`. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Decode a Rollup asset source (string or bytes) to text. */
function assetSourceToText(source: string | Uint8Array): string {
  return typeof source === "string" ? source : Buffer.from(source).toString("utf8");
}

/**
 * Return `html` with the tag that references `fileName` replaced by an inline
 * `<script>`/`<style>`, or `null` when this asset is not referenced.
 *
 * The replacement is a function (never a string) so `$` sequences in the JS/CSS
 * are not interpreted as `String.prototype.replace` special patterns.
 */
function inlineAsset(html: string, fileName: string, item: Rollup.OutputChunk | Rollup.OutputAsset): string | null {
  const ref = escapeRegExp(fileName);

  if (item.type === "chunk") {
    const scriptTag = new RegExp(`<script[^>]*\\bsrc="[^"]*${ref}"[^>]*></script>`);
    if (!scriptTag.test(html)) {
      return null;
    }
    // Escape `</script>` so an inlined occurrence cannot close the tag early.
    const code = item.code.replace(/<\/script>/g, "<\\/script>");
    return html.replace(scriptTag, () => `<script type="module">${code}</script>`);
  }

  if (fileName.endsWith(".css")) {
    const linkTag = new RegExp(`<link[^>]*\\bhref="[^"]*${ref}"[^>]*>`);
    if (!linkTag.test(html)) {
      return null;
    }
    const css = assetSourceToText(item.source);
    return html.replace(linkTag, () => `<style>${css}</style>`);
  }

  return null;
}

/**
 * Dependency-free single-file plugin. After the bundle is generated, splice every
 * JS chunk and CSS asset that `index.html` references directly into the HTML as
 * inline tags, drop those now-orphaned files, and strip external icon links so the
 * result has no outbound references — `dist/index.html` is the entire build.
 *
 * Safe because the production bundle is self-contained: no web workers, no .wasm,
 * no `import.meta.url`, no runtime fetches of local files.
 */
function inlineSingleFile(): Plugin {
  return {
    name: "inline-single-file",
    enforce: "post",
    generateBundle(_options: Rollup.NormalizedOutputOptions, bundle: Rollup.OutputBundle): void {
      for (const htmlName of Object.keys(bundle)) {
        const htmlAsset = bundle[htmlName];
        if (!htmlName.endsWith(".html") || htmlAsset?.type !== "asset" || typeof htmlAsset.source !== "string") {
          continue;
        }

        let html = htmlAsset.source;
        for (const fileName of Object.keys(bundle)) {
          const item = bundle[fileName];
          if (!item) {
            continue;
          }
          const inlined = inlineAsset(html, fileName, item);
          if (inlined !== null) {
            html = inlined;
            delete bundle[fileName];
          }
        }

        // Drop external favicon/touch-icon links — public/ is not emitted in single mode.
        htmlAsset.source = html.replace(/\s*<link[^>]*\brel="(?:icon|apple-touch-icon)"[^>]*>/g, "");
      }
    },
  };
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // `vite build --mode single` produces a single self-contained dist/index.html.
  const single = mode === "single";

  return {
    // So the build can be served from an arbitrary path
    base: "./",
    build: {
      // Requires Vite 8+ / esbuild ≥0.24. Run `npm ci` if build errors on ES2024.
      target: "es2024",
      // SceneryStack bundles exceed Vite's default 500 kB chunk warning.
      chunkSizeWarningLimit: 5000,
      ...(single && {
        // Inline every imported asset as a base64 data URI instead of emitting files.
        assetsInlineLimit: INLINE_LIMIT_BYTES,
        // Emit one CSS file (no per-chunk split) so there is a single tag to inline.
        cssCodeSplit: false,
        // Skip copying public/ (favicon, icons) — nothing external should remain.
        copyPublicDir: false,
        rollupOptions: {
          // Collapse dynamic imports into the single entry chunk.
          output: { inlineDynamicImports: true },
        },
      }),
    },
    server: {
      headers: securityHeaders,
    },
    preview: {
      headers: securityHeaders,
    },
    plugins: single
      ? [inlineSingleFile()]
      : [
          VitePWA({
            registerType: "autoUpdate",
            includeAssets: ["favicon.ico", "icons/apple-touch-icon.png"],
            manifest: {
              id: "fluid-dynamics",
              name: "Fluid Dynamics",
              // biome-ignore lint/style/useNamingConvention: Web App Manifest spec requires snake_case keys
              short_name: "FluidDynamics",
              description: "A SceneryStack simulation: Fluid Dynamics",
              categories: ["education", "science"],
              // biome-ignore lint/style/useNamingConvention: Web App Manifest spec requires snake_case keys
              theme_color: "#1a1a2e",
              // biome-ignore lint/style/useNamingConvention: Web App Manifest spec requires snake_case keys
              background_color: "#000000",
              display: "standalone",
              // biome-ignore lint/style/useNamingConvention: Web App Manifest spec requires snake_case keys
              display_override: ["window-controls-overlay", "standalone"],
              // No `orientation` — leave free so portrait-friendly sims are not forced landscape.
              icons: [
                {
                  src: "icons/icon-192.png",
                  sizes: "192x192",
                  type: "image/png",
                },
                {
                  src: "icons/icon-512.png",
                  sizes: "512x512",
                  type: "image/png",
                },
                {
                  src: "icons/icon.svg",
                  sizes: "any",
                  type: "image/svg+xml",
                  purpose: "maskable",
                },
              ],
              // Placeholder shots from `npm run icons`; replace with real sim screenshots before shipping.
              screenshots: [
                {
                  src: "screenshots/wide.png",
                  sizes: "1280x720",
                  type: "image/png",
                  // biome-ignore lint/style/useNamingConvention: Web App Manifest spec requires snake_case keys
                  form_factor: "wide",
                  label: "Fluid Dynamics",
                },
                {
                  src: "screenshots/narrow.png",
                  sizes: "720x1280",
                  type: "image/png",
                  // biome-ignore lint/style/useNamingConvention: Web App Manifest spec requires snake_case keys
                  form_factor: "narrow",
                  label: "Fluid Dynamics",
                },
              ],
            },
            workbox: {
              maximumFileSizeToCacheInBytes: WORKBOX_MAX_FILE_BYTES,
              globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
            },
          }),
        ],
  };
});
