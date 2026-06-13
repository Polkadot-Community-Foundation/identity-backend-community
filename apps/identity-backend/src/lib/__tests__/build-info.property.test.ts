import { BuildInfoDecodeError, BuildInfoStruct } from '#root/lib/build-info.js'
import { describe, expect, it } from '@effect/vitest'
import { ruleOfSchemas } from '@identity-backend/testing/schema'

ruleOfSchemas('BuildInfoDecodeError', BuildInfoDecodeError)

describe('BuildInfo schema', () => {
  it('Should_ExposeExactlyTheFiveNonSensitiveKeys_When_ExposingBuildInfo', () => {
    const keys = Object.keys(BuildInfoStruct.fields).sort()
    expect(keys).toEqual(['buildTime', 'commit', 'environment', 'service', 'version'])
  })
})
