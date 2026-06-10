import { defineConfig } from 'tsdown'

export default defineConfig({
  clean: false,
  entry: {
    index: './src/mod.ts',
  },
  exports: {
    devExports: '@identity-backend/source',
  },
  deps: {
    onlyBundle: false,
  },
  define: {
    'import.meta.vitest': 'undefined',
  },
  format: 'esm',
  dts: {
    tsgo: true,
  },
  tsconfig: './tsconfig.build.json',
})
