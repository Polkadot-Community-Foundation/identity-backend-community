import { Schema as S } from 'effect'

const BoundedInt = (min: number, max: number, brand: string) => S.Int.pipe(S.between(min, max), S.brand(brand))

const Population = BoundedInt(1, 1_000_000, 'Population')
const PodCount = BoundedInt(1, 64, 'PodCount')
const InstanceCount = BoundedInt(1, 64, 'InstanceCount')
const VcpuCount = BoundedInt(1, 64, 'VcpuCount')
const DbConnectionCount = BoundedInt(100, 5000, 'DbConnectionCount')
const Concurrency = BoundedInt(1, 5000, 'Concurrency')
const ReserveCount = BoundedInt(0, 30, 'ReserveCount')
const Rpm = BoundedInt(1, 5000, 'Rpm')
const LatencyMs = BoundedInt(1, 600_000, 'LatencyMs')
const Millis = BoundedInt(1, 60_000, 'Millis')
const HashesPerSec = BoundedInt(1000, 50_000_000, 'HashesPerSec')
const Utilization = S.Number.pipe(S.greaterThan(0), S.lessThanOrEqualTo(1), S.brand('Utilization'))
const SpikeMultiplier = S.Number.pipe(S.between(1, 10), S.brand('SpikeMultiplier'))

export const Binding = S.Literal('db_connections', 'cpu_external')
export type Binding = typeof Binding.Type

export class EndpointDemand extends S.Class<EndpointDemand>('EndpointDemand')({
  key: S.NonEmptyString,
  peakPerUserRpm: Rpm,
  avgLatencyMs: LatencyMs,
  binding: Binding,
  rationale: S.String,
}) {}

export const SizingInputs = S.Struct({
  population: Population,
  pods: PodCount,
  maxAppInstances: InstanceCount,
  appVcpusPerInstance: VcpuCount,
  dbMaxConnections: DbConnectionCount,
  leaderReserveConnections: ReserveCount,
  adminReserveConnections: ReserveCount,
  superuserReserveConnections: ReserveCount,
  externalConcurrencyPerPod: Concurrency,
  targetUtilization: Utilization,
  spikeMultiplier: SpikeMultiplier,
  powSolveBudgetMs: Millis,
  powHashesPerSec: HashesPerSec,
  classes: S.NonEmptyArray(EndpointDemand),
}).pipe(
  S.filter(
    (s) => s.leaderReserveConnections + s.adminReserveConnections + s.superuserReserveConnections < s.dbMaxConnections,
    { message: () => 'connection reserves (leader + admin + superuser) must be less than dbMaxConnections' },
  ),
)
export type SizingInputs = typeof SizingInputs.Type

export interface ClassResult {
  readonly key: string
  readonly capacityRpm: number
  readonly meanDemandRpm: number
  readonly binding: Binding
}

export interface DerivedLimits {
  readonly offNatPerIpRpm: number
  readonly sharedNatCeilingRpm: number
  readonly originPerJwtOverallRpm: Readonly<Record<string, number>>
  readonly originPerJwtPerInstanceRpm: Readonly<Record<string, number>>
  readonly powDifficultyBits: number
  readonly effectiveDbConnections: number
  readonly recommendedWebPoolPerInstance: number
  readonly cpuOptimalPoolPerInstance: number
  readonly perClass: readonly ClassResult[]
  readonly tightestCapacityRpm: number
  readonly bindingClassKey: string
  readonly aggregatePeakDemandRpm: number
  readonly warnings: readonly string[]
}

export const maxConnectionsFromMemoryGiB = (gib: number): number =>
  Math.min(5000, Math.floor((gib * 1024 * 1024 * 1024) / 9_531_392))

export const CIDR_OR_IP =
  /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}(?:\/(?:3[0-2]|[12]?\d))?|[0-9a-fA-F:]+(?:\/(?:12[0-8]|1[01]\d|[1-9]?\d))?)$/

export const Cidr = S.String.pipe(
  S.filter((s) => CIDR_OR_IP.test(s) ? true : `invalid IP/CIDR: '${s}'`),
  S.brand('Cidr'),
)
export type Cidr = typeof Cidr.Type

const decodeCidrs = S.decodeUnknownSync(S.Array(Cidr))

export const sharedNatClause = (cidrs: readonly string[]): string => `(ip.src in {${decodeCidrs(cidrs).join(' ')}})`

export const DEFAULT_ENDPOINT_DEMAND = [
  {
    key: 'public_reads',
    peakPerUserRpm: 30,
    avgLatencyMs: 1,
    binding: 'db_connections',
    rationale:
      'Username search/availability served from the display-key byte-range index (sub-ms); a user typing actively in search drives the peak.',
  },
  {
    key: 'authenticated_actions',
    peakPerUserRpm: 15,
    avgLatencyMs: 15,
    binding: 'db_connections',
    rationale: 'Subscriptions/notify/tickets/turn: indexed reads plus small writes.',
  },
  {
    key: 'registration',
    peakPerUserRpm: 2,
    avgLatencyMs: 30,
    binding: 'db_connections',
    rationale: 'Username registration is rare per principal; enqueues work, one bounded write.',
  },
  {
    key: 'handshake',
    peakPerUserRpm: 6,
    avgLatencyMs: 80,
    binding: 'cpu_external',
    rationale:
      'Challenge + platform attestation + token at cold start: CPU-bound signature checks plus an Apple/Google round trip, not the DB. The event-open bottleneck.',
  },
  {
    key: 'token_refresh',
    peakPerUserRpm: 2,
    avgLatencyMs: 12,
    binding: 'db_connections',
    rationale: 'Periodic refresh; one lookup.',
  },
]

export const DEFAULT_MODEL = {
  maxAppInstances: 10,
  appVcpusPerInstance: 1,
  dbMaxConnections: maxConnectionsFromMemoryGiB(1),
  leaderReserveConnections: 4,
  adminReserveConnections: 5,
  superuserReserveConnections: 3,
  externalConcurrencyPerPod: 50,
  targetUtilization: 0.75,
  spikeMultiplier: 3,
  powSolveBudgetMs: 150,
  powHashesPerSec: 435_000,
} as const

const dbConcurrency = (inputs: SizingInputs): number =>
  inputs.dbMaxConnections -
  inputs.leaderReserveConnections -
  inputs.adminReserveConnections -
  inputs.superuserReserveConnections

const concurrencyFor = (demand: EndpointDemand, inputs: SizingInputs, effectiveDb: number): number =>
  demand.binding === 'db_connections' ? effectiveDb : inputs.externalConcurrencyPerPod * inputs.pods

const capacityRpmFor = (demand: EndpointDemand, inputs: SizingInputs, effectiveDb: number): number =>
  Math.floor(
    (concurrencyFor(demand, inputs, effectiveDb) * inputs.targetUtilization / (demand.avgLatencyMs / 1000)) * 60,
  )

export const deriveRateLimits = (inputs: SizingInputs): DerivedLimits => {
  const effectiveDbConnections = dbConcurrency(inputs)

  const toResult = (demand: EndpointDemand): ClassResult => ({
    key: demand.key,
    capacityRpm: capacityRpmFor(demand, inputs, effectiveDbConnections),
    meanDemandRpm: inputs.population * demand.peakPerUserRpm,
    binding: demand.binding,
  })

  const perClass: ClassResult[] = inputs.classes.map(toResult)
  const tightest = perClass.reduce((min, c) => (c.capacityRpm < min.capacityRpm ? c : min), toResult(inputs.classes[0]))
  const totalPeakPerUserRpm = inputs.classes.reduce((sum, d) => sum + d.peakPerUserRpm, 0)
  const aggregatePeakDemandRpm = Math.ceil(inputs.population * totalPeakPerUserRpm * inputs.spikeMultiplier)
  const sharedNatCeilingRpm = Math.min(aggregatePeakDemandRpm, tightest.capacityRpm)
  const offNatPerIpRpm = Math.ceil(totalPeakPerUserRpm * inputs.spikeMultiplier)

  const cpuOptimalPoolPerInstance = Math.round(inputs.appVcpusPerInstance * 2) + 1
  const recommendedWebPoolPerInstance = Math.max(
    1,
    Math.min(cpuOptimalPoolPerInstance, Math.floor(effectiveDbConnections / inputs.maxAppInstances)),
  )

  const originPerJwtOverallRpm: Record<string, number> = {}
  const originPerJwtPerInstanceRpm: Record<string, number> = {}
  for (const d of inputs.classes) {
    const overall = Math.ceil(d.peakPerUserRpm * inputs.spikeMultiplier)
    originPerJwtOverallRpm[d.key] = overall
    originPerJwtPerInstanceRpm[d.key] = Math.max(1, Math.ceil(overall / inputs.pods))
  }

  const powIterations = Math.max(2, (inputs.powSolveBudgetMs / 1000) * inputs.powHashesPerSec)
  const powDifficultyBits = Math.max(1, Math.min(32, Math.round(Math.log2(powIterations))))

  const warnings: string[] = []
  if (aggregatePeakDemandRpm > tightest.capacityRpm) {
    warnings.push(
      `Shared-NAT peak demand ${aggregatePeakDemandRpm}/min exceeds the tightest class capacity ` +
        `${tightest.capacityRpm}/min ('${tightest.key}', binding=${tightest.binding}). The ceiling is clamped to ` +
        `capacity, so a fully synchronized burst will 429. Raise pod count, cut per-request cost on '${tightest.key}', ` +
        `or stagger client start.`,
    )
  }
  if (sharedNatCeilingRpm < offNatPerIpRpm) {
    warnings.push(
      `Shared-NAT ceiling ${sharedNatCeilingRpm}/min is below the off-NAT per-IP limit ${offNatPerIpRpm}/min: the ` +
        `tightest class capacity ('${tightest.key}') cannot serve even one principal's burst. Scale that binding ` +
        `resource before relying on the shared-NAT carve-out.`,
    )
  }
  if (effectiveDbConnections < cpuOptimalPoolPerInstance * inputs.maxAppInstances) {
    warnings.push(
      `Effective DB connections ${effectiveDbConnections} cannot give all ${inputs.maxAppInstances} instances their ` +
        `CPU-optimal pool of ${cpuOptimalPoolPerInstance} (would need ${
          cpuOptimalPoolPerInstance * inputs.maxAppInstances
        }). Per-instance pool is connection-budget-limited to ${recommendedWebPoolPerInstance}; scale the DB instance to lift it.`,
    )
  }

  return {
    offNatPerIpRpm,
    sharedNatCeilingRpm,
    originPerJwtOverallRpm,
    originPerJwtPerInstanceRpm,
    powDifficultyBits,
    effectiveDbConnections,
    recommendedWebPoolPerInstance,
    cpuOptimalPoolPerInstance,
    perClass,
    tightestCapacityRpm: tightest.capacityRpm,
    bindingClassKey: tightest.key,
    aggregatePeakDemandRpm,
    warnings,
  }
}

export const decodeInputs = S.decodeUnknownSync(SizingInputs)

export const deriveDefaultLimits = (population: number, pods: number): DerivedLimits =>
  deriveRateLimits(decodeInputs({ population, pods, ...DEFAULT_MODEL, classes: DEFAULT_ENDPOINT_DEMAND }))
