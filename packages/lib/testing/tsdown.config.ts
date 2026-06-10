import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: { index: './src/mod.ts', hono: './src/hono.ts', schema: './src/schema.ts' },
  format: 'esm',
  dts: { tsgo: true },
  exports: { devExports: '@identity-backend/source' },
  tsconfig: './tsconfig.build.json',
  clean: false,
  deps: { onlyBundle: false },
})
