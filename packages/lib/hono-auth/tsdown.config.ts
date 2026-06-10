import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    index: './src/mod.ts',
    'play-integrity': './src/play-integrity/mod.ts',
    'app-attest': './src/app-attest/mod.ts',
    'device-check': './src/device-check/mod.ts',
    auth: './src/auth/mod.ts',
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
