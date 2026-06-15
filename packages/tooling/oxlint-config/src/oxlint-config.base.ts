import { defineConfig } from 'oxlint'

export default defineConfig({
  categories: {
    correctness: 'error',
  },

  options: {
    typeAware: true,
  },

  plugins: ['typescript', 'import', 'jsdoc', 'node', 'promise', 'vitest', 'unicorn'],

  jsPlugins: ['@identity-backend/oxlint-plugin'],

  rules: {
    'no-console': 'off',
    'no-debugger': 'off',
    'typescript/no-unnecessary-boolean-literal-compare': 'off',
    'typescript/no-explicit-any': 'error',
    'jest/no-standalone-expect': 'off',
    'jest/valid-expect': 'off',

    '@identity-backend/oxlint-plugin/ban-classes': ['error', { whitelist: ['WsCtor'] }],
    '@identity-backend/oxlint-plugin/ban-data-taggederror': 'error',
    '@identity-backend/oxlint-plugin/ban-effect-schema-imports': 'error',
    '@identity-backend/oxlint-plugin/ban-error-string': 'error',
    '@identity-backend/oxlint-plugin/no-manual-tag-property': 'error',
    '@identity-backend/oxlint-plugin/no-context-generic-tag': 'error',
    '@identity-backend/oxlint-plugin/no-date-now-in-effect': 'error',
    '@identity-backend/oxlint-plugin/no-direct-tag-access': 'error',
    '@identity-backend/oxlint-plugin/no-either-tag-assertions': 'error',
    '@identity-backend/oxlint-plugin/no-io-boundary-tests': 'error',
    '@identity-backend/oxlint-plugin/no-logging-in-catch': 'error',
    '@identity-backend/oxlint-plugin/no-new-promise-in-effect': 'error',
    '@identity-backend/oxlint-plugin/no-native-map-in-effect': 'error',
    '@identity-backend/oxlint-plugin/no-native-set-in-effect': 'error',
    '@identity-backend/oxlint-plugin/no-native-setinterval-in-effect': 'error',
    '@identity-backend/oxlint-plugin/no-native-settimeout-in-effect': 'error',
    '@identity-backend/oxlint-plugin/damp-test-naming': 'error',
    '@identity-backend/oxlint-plugin/pbt-naming': 'error',
    '@identity-backend/oxlint-plugin/policy-no-domain-imports': 'error',
    '@identity-backend/oxlint-plugin/no-new-worker-with-wasm-import': 'error',
    '@identity-backend/oxlint-plugin/no-barrels': 'off',
    '@identity-backend/oxlint-plugin/no-inline-destructured-type': 'off',
  },

  overrides: [
    {
      files: ['**/*.test.ts', '**/*.spec.ts'],
      rules: {
        '@identity-backend/oxlint-plugin/no-native-map-in-effect': 'off',
        '@identity-backend/oxlint-plugin/no-native-set-in-effect': 'off',
        '@identity-backend/oxlint-plugin/no-native-setinterval-in-effect': 'off',
        '@identity-backend/oxlint-plugin/no-native-settimeout-in-effect': 'off',
        '@identity-backend/oxlint-plugin/no-new-promise-in-effect': 'off',
        '@identity-backend/oxlint-plugin/no-direct-tag-access': 'off',
      },
    },
  ],

  ignorePatterns: [
    // Dependencies
    '**/node_modules/**',

    // Build outputs
    '**/dist/**',
    '**/lib/**',
    '**/esm/**',
    '**/cjs/**',
    '**/build/**',
    '**/out/**',
    '**/.tshy/**',
    '**/.tshy-build/**',

    // Monorepo tooling
    '**/.turbo/**',

    // Test & coverage
    '**/coverage/**',
    '**/.stryker-tmp/**',
    '**/__pycache__/**',

    // Generated types
    '**/*.d.ts',
    '**/*.tsbuildinfo',

    // AI assistants
    '**/.claude/**',
    '**/.opencode/**',
    '**/.sisyphus/**',

    // Project-specific
    '**/.repo/**',
    '**/.worktrees/**',
    '**/.issues/**',
    '**/.papi/**',
    '**/submodules/**',
    '**/repos/**',
  ],
})
