import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    environment: "node"
  },
  resolve: {
    alias: [
      { find: "@opendrop/shared/db/repository", replacement: new URL("./packages/shared/src/db/repository.ts", import.meta.url).pathname },
      { find: "@opendrop/shared/db/schema", replacement: new URL("./packages/shared/src/db/schema.ts", import.meta.url).pathname },
      { find: "@opendrop/shared/db/tokens", replacement: new URL("./packages/shared/src/db/tokens.ts", import.meta.url).pathname },
      { find: "@opendrop/shared/db/types", replacement: new URL("./packages/shared/src/db/types.ts", import.meta.url).pathname },
      { find: "@opendrop/shared/storage/interface", replacement: new URL("./packages/shared/src/storage/interface.ts", import.meta.url).pathname },
      { find: "@opendrop/shared/core", replacement: new URL("./packages/shared/src/core/index.ts", import.meta.url).pathname },
      { find: "@opendrop/shared/auth", replacement: new URL("./packages/shared/src/auth/index.ts", import.meta.url).pathname },
      { find: "@opendrop/shared/db", replacement: new URL("./packages/shared/src/db/index.ts", import.meta.url).pathname },
      { find: "@opendrop/shared/storage", replacement: new URL("./packages/shared/src/storage/index.ts", import.meta.url).pathname },
      { find: "@opendrop/shared", replacement: new URL("./packages/shared/src/index.ts", import.meta.url).pathname },
      { find: "@", replacement: new URL("./apps/server/src", import.meta.url).pathname }
    ]
  }
});
