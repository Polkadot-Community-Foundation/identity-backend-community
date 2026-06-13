import { APP_SERVICE, APP_VERSION, BUILD_TIME, DEPLOYMENT_ENVIRONMENT, GIT_COMMIT } from '#root/config.js'
import { ConfigError, Effect, Schema as S } from 'effect'

export const BUILD_INFO_PATH = '/api/v1/version' as const

export const BUILD_INFO_ENVIRONMENTS = [
  'production',
  'staging',
  'development',
  'test',
  'testnet',
  'testnet-next',
  'testnet-review',
] as const

export type BuildInfoEnvironment = (typeof BUILD_INFO_ENVIRONMENTS)[number]

const Rfc3339 = S.String.pipe(
  S.pattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/),
  S.brand('Rfc3339Timestamp'),
)

const GitCommitSha = S.String.pipe(
  S.pattern(/^[0-9a-f]{7,64}$/),
  S.brand('GitCommitSha'),
)

const ServiceName = S.NonEmptyString.pipe(
  S.maxLength(64),
  S.brand('ServiceName'),
)

const VersionString = S.NonEmptyString.pipe(
  S.maxLength(64),
  S.brand('VersionString'),
)

export const BuildInfoStruct = S.Struct({
  service: ServiceName,
  version: VersionString,
  commit: GitCommitSha,
  buildTime: Rfc3339,
  environment: S.Literal(...BUILD_INFO_ENVIRONMENTS),
})

export const BuildInfo = BuildInfoStruct.pipe(S.brand('BuildInfo'))

export type BuildInfo = S.Schema.Type<typeof BuildInfo>

export class BuildInfoDecodeError extends S.TaggedError<BuildInfoDecodeError>()(
  'BuildInfoDecodeError',
  {
    reason: S.String,
  },
) {}

export const buildInfoFromEnv: Effect.Effect<BuildInfo, BuildInfoDecodeError | ConfigError.ConfigError> = Effect
  .gen(function*() {
    const raw = {
      service: yield* APP_SERVICE,
      version: yield* APP_VERSION,
      commit: yield* GIT_COMMIT,
      buildTime: yield* BUILD_TIME,
      environment: yield* DEPLOYMENT_ENVIRONMENT,
    }

    return yield* S.decodeUnknown(BuildInfo)(raw).pipe(
      Effect.catchTag(
        'ParseError',
        (err) => Effect.fail(new BuildInfoDecodeError({ reason: err.message })),
      ),
    )
  })
