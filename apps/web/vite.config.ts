import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, loadEnv } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, repoRoot, "");
  const port = Number(env.PORT ?? process.env.PORT ?? 3456);

  return {
    root: __dirname,
    envDir: repoRoot,
    plugins: [react(), tailwindcss()],
    server: {
      port: 5174,
      fs: {
        allow: [repoRoot],
      },
      proxy: {
        "/api": {
          target: `http://localhost:${port}`,
          rewrite: (p) => p.replace(/^\/api/, ""),
          configure: (proxy) => {
            proxy.on("error", () => {
              /* server may be restarting */
            });
          },
        },
      },
    },
    build: {
      outDir: path.resolve(repoRoot, "dist/web"),
      emptyOutDir: true,
    },
  };
});
