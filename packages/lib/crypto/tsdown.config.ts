import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: { index: './src/mod.ts', sr25519: './src/sr25519.ts' },
  format: 'esm',
  dts: { tsgo: true },
  exports: { devExports: '@identity-backend/source' },
  tsconfig: './tsconfig.build.json',
  clean: false,
  deps: { onlyBundle: false },
  define: { 'import.meta.vitest': 'undefined' },
})
