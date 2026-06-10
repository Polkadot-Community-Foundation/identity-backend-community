import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    index: './src/mod.ts',
    types: './src/types.ts',
    services: './src/services/mod.ts',
    'device-check/ios': './src/services/device-check/ios/mod.ts',
  },
  format: 'esm',
  dts: { tsgo: true },
  exports: {
    devExports: '@identity-backend/source',
  },
  tsconfig: './tsconfig.build.json',
  clean: false,
  deps: {
    onlyBundle: false,
  },
  define: {
    'import.meta.vitest': 'undefined',
  },
})
