/**
 * @type {import('lint-staged').Configuration}
 */

// Code the workspace toolchain must not lint or format:
// repos/ — vendored read-only git subtrees
// infra/, sst.config.ts — SST injected globals, excluded by oxlint.config.ts
const NOT_OUR_SOURCE = ['/repos/', '/infra/', 'sst.config.ts']

const lintable = (filenames) => filenames.filter((f) => !NOT_OUR_SOURCE.some((p) => f.includes(p)))

export default {
  '*.{js,jsx,ts,tsx,mjs,cjs,css}': (filenames) => {
    const files = lintable(filenames)
    if (files.length === 0) return []
    return [
      `dprint fmt --allow-no-files ${files.join(' ')}`,
      `oxlint --fix ${files.join(' ')} --type-aware --type-check --quiet`,
    ]
  },
  '*.{json,md,yml,yaml,html}': (filenames) => {
    const files = lintable(filenames)
    if (files.length === 0) return []
    return [`dprint fmt --allow-no-files ${files.join(' ')}`]
  },
}
