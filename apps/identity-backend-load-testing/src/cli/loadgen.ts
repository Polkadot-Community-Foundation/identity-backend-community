import { Args, Command, Options } from '@effect/cli'
import { Config, Effect, Option } from 'effect'
import { type JwtTokensArgs, makeJwtTokensHandler } from './jwt-tokens-command.js'
import { makeRegisterPayloadsHandler, type RegisterPayloadsArgs } from './register-payloads-command.js'

function unwrap<T>(option: Option.Option<T>, fallback: T): T {
  return Option.getOrElse(option, () => fallback)
}

function resolveBaseUrl(flagValue: string): string {
  if (flagValue !== 'http://localhost:8080') return flagValue
  const fromEnv = process.env.BASE_URL
  if (fromEnv !== undefined && fromEnv.length > 0) return fromEnv
  return 'http://localhost:8080'
}

const registerPayloadsOptions = {
  chunkSize: Options.integer('chunk-size').pipe(Options.withAlias('c'), Options.withDefault(500)),
  workers: Options.integer('workers').pipe(Options.optional),
  out: Options.text('out').pipe(Options.optional),
  attesterPublicKey: Options.text('attester-pubkey').pipe(Options.optional),
  verifierAddress: Options.text('verifier').pipe(Options.withAlias('v'), Options.optional),
}

const countArg = Args.integer({ name: 'count' }).pipe(
  Args.withFallbackConfig(Config.number('REGISTER_COUNT').pipe(Config.withDefault(1000))),
)

const registerPayloadsCommand = Command.make(
  'register-payloads',
  { ...registerPayloadsOptions, count: countArg },
  (args): Effect.Effect<void, never, never> => {
    const handlerArgs: RegisterPayloadsArgs = {
      count: args.count,
      chunkSize: args.chunkSize,
      workers: unwrap(args.workers, 0),
      out: unwrap(args.out, ''),
      attesterPublicKey: unwrap(args.attesterPublicKey, ''),
      verifierAddress: unwrap(args.verifierAddress, ''),
    }
    return makeRegisterPayloadsHandler(handlerArgs) as Effect.Effect<void, never, never>
  },
)

const jwtTokensOptions = {
  baseUrl: Options.text('base-url').pipe(Options.withDefault('http://localhost:8080')),
  inFile: Options.text('in').pipe(Options.optional),
  out: Options.text('out').pipe(Options.optional),
  limit: Options.integer('limit').pipe(Options.withDefault(0)),
}

const jwtTokensCommand = Command.make(
  'jwt-tokens',
  jwtTokensOptions,
  (args): Effect.Effect<void, never, never> => {
    const handlerArgs: JwtTokensArgs = {
      baseUrl: resolveBaseUrl(args.baseUrl),
      in: unwrap(args.inFile, ''),
      out: unwrap(args.out, ''),
      limit: args.limit,
    }
    return makeJwtTokensHandler(handlerArgs) as Effect.Effect<void, never, never>
  },
)

export const loadgen = Command.make('loadgen', {}, () => Effect.log("Use 'loadgen --help' to list subcommands")).pipe(
  Command.withSubcommands([registerPayloadsCommand, jwtTokensCommand]),
)
