import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { workflow } from "workflow/vite";

export default defineConfig({
  ssr: { external: ["@napi-rs/canvas"] },
  environments: { nitro: { resolve: { external: ["@napi-rs/canvas"] } } },
  plugins: [
    workflow(),
    tanstackStart({
      server: { entry: "server" },
    }),
    nitro({
      vercel: { functions: { maxDuration: 300 } },
      // Queue functions cannot use Nitro's copied absolute dependency symlinks.
      noExternals: ["tslib"],
      // The OCR worker resolves its own JS/WASM files at runtime.
      traceDeps: ["tesseract.js*", "tesseract.js-core*", "@napi-rs/canvas*"],
      rollupConfig: {
        plugins: [{
          name: "preserve-workflow-step-registration",
          transform(code, id) {
            // Workflow steps register at module load. Preserve this generated
            // module in Nitro's queue handler instead of a lazy app chunk.
            if (id.replaceAll("\\", "/").endsWith("/.nitro/workflow/steps.mjs")) {
              return { code, map: null, moduleSideEffects: "no-treeshake" };
            }
          },
        }],
      },
    }),
    viteReact(),
    tailwindcss(),
    tsConfigPaths(),
  ],
});
