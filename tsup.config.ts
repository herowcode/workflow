import { defineConfig } from "tsup"

export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["cjs"],
  target: "node18",
  clean: true,
  treeshake: true,
  outExtension() {
    return { js: ".cjs" }
  },
  banner: {
    js: "#!/usr/bin/env node",
  },
})
