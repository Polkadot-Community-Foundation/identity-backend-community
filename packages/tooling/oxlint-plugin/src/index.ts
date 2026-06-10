/**
 * Oxlint Plugin Entry Point
 *
 * This plugin provides ESLint-compatible rules for use with oxlint's jsPlugins feature.
 * All rules are AST-only (no type-aware features) for maximum compatibility.
 */

import { banEffectSchemaImports } from './rules/ban-@-effect-schema-imports.js'
import { banClasses } from './rules/ban-classes.js'
import { banDataTaggedError } from './rules/ban-data-taggederror.js'
import { banErrorString } from './rules/ban-error-string.js'
import { dampTestNaming } from './rules/damp-test-naming.js'
import { noBarrels } from './rules/no-barrels.js'
import { noContextGenericTag } from './rules/no-context-generic-tag.js'
import { noDirectTagAccess } from './rules/no-direct-tag-access.js'
import { noEitherTagAssertions } from './rules/no-either-tag-assertions.js'
import { noInlineDestructuredType } from './rules/no-inline-destructured-type.js'
import { noLoggingInCatch } from './rules/no-logging-in-catch.js'
import { noManualTagProperty } from './rules/no-manual-tag-property.js'
import { noNativeMapInEffect } from './rules/no-native-map-in-effect.js'
import { noNativeSetInEffect } from './rules/no-native-set-in-effect.js'
import { noNativeSetIntervalInEffect } from './rules/no-native-setinterval-in-effect.js'
import { noNativeSetTimeoutInEffect } from './rules/no-native-settimeout-in-effect.js'
import { noNewPromiseInEffect } from './rules/no-new-promise-in-effect.js'
import { pbtNaming } from './rules/pbt-naming.js'

const PLUGIN_NAME = '@identity-backend/oxlint-plugin'

export default {
  meta: {
    name: PLUGIN_NAME,
  },
  rules: {
    'ban-classes': banClasses,
    'ban-data-taggederror': banDataTaggedError,
    'ban-effect-schema-imports': banEffectSchemaImports,
    'ban-error-string': banErrorString,
    'damp-test-naming': dampTestNaming,
    'pbt-naming': pbtNaming,
    'no-barrels': noBarrels,
    'no-context-generic-tag': noContextGenericTag,
    'no-inline-destructured-type': noInlineDestructuredType,
    'no-logging-in-catch': noLoggingInCatch,
    'no-new-promise-in-effect': noNewPromiseInEffect,
    'no-manual-tag-property': noManualTagProperty,
    'no-direct-tag-access': noDirectTagAccess,
    'no-either-tag-assertions': noEitherTagAssertions,
    'no-native-map-in-effect': noNativeMapInEffect,
    'no-native-set-in-effect': noNativeSetInEffect,
    'no-native-setinterval-in-effect': noNativeSetIntervalInEffect,
    'no-native-settimeout-in-effect': noNativeSetTimeoutInEffect,
  },
}
