import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: { index: './src/index.ts' },
  format: 'esm',
  dts: { tsgo: true },
  exports: { devExports: '@identity-backend/source' },
  tsconfig: './tsconfig.build.json',
  clean: false,
  deps: { onlyBundle: false },
  define: { 'import.meta.vitest': 'undefined' },
})
