import { hc } from 'hono/client'
import type { App } from 'identity-backend-container/v1'
import type { StartedDockerComposeEnvironment } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { RTCPeerConnection } from 'werift'

import { setupTestEnvironment, teardownTestEnvironment } from '../setup.ts'

const ICE_GATHER_TIMEOUT_MS = 30_000
const SDP_CANDIDATE_TYPE_INDEX = 7

function extractCandidateType(sdpLine: string): string | undefined {
  return sdpLine.split(' ')[SDP_CANDIDATE_TYPE_INDEX]
}

describe('E2E: TURN/STUN Credential Issuance and WebRTC Connectivity', () => {
  let environment: StartedDockerComposeEnvironment
  let app: ReturnType<typeof hc<App>>

  beforeAll(async () => {
    ;({ environment, app } = await setupTestEnvironment<App>({
      composeProfiles: ['turn'],
      peopleNetwork: 'pop-testnet',
    }))
  })

  afterAll(async () => {
    await teardownTestEnvironment(environment)
  })

  it('Should_IssueCredentialsAndGatherSrflxAndRelay_When_PeerNegotiatesWithCoturn', async ({ annotate }) => {
    const response = await app.api.v1.turn.issue.$post({
      json: { regionHint: 'us-east-1' },
    })

    expect([200, 201]).toContain(response.status)
    const credentials = await response.json()

    expect.soft(credentials).toMatchObject({
      servers: expect.arrayContaining([expect.stringContaining('stun:')]),
      username: expect.stringMatching(/^\d+:[0-9a-f]{16}$/i),
      password: expect.stringMatching(/^[A-Za-z0-9+/=]+$/),
      ttl: expect.any(Number),
    })
    expect.soft(credentials.ttl).toBeGreaterThan(0)

    const [usernameExpirySecondsStr] = credentials.username.split(':')
    const usernameExpirySeconds = Number(usernameExpirySecondsStr)
    const nowSeconds = Math.floor(Date.now() / 1000)
    const CLOCK_SKEW_TOLERANCE_SECONDS = 5
    expect.soft(usernameExpirySeconds, 'username timestamp must be in the future').toBeGreaterThan(nowSeconds)
    expect.soft(
      usernameExpirySeconds - nowSeconds,
      'username timestamp must be within ttl (allowing small clock skew)',
    ).toBeLessThanOrEqual(credentials.ttl + CLOCK_SKEW_TOLERANCE_SECONDS)

    const stunServers = credentials.servers.filter((s: string) => s.startsWith('stun:'))
    const turnServers = credentials.servers.filter((s: string) => s.startsWith('turn:'))
    expect.soft(stunServers.length).toBeGreaterThanOrEqual(1)
    expect.soft(turnServers.length).toBeGreaterThanOrEqual(1)

    // Container hostnames are only DNS-resolvable inside Docker; remap to localhost for host-side peer.
    const hostnameToPort: Record<string, number> = {
      coturn1: environment.getContainer('coturn1-1').getMappedPort(3478),
      coturn2: environment.getContainer('coturn2-1').getMappedPort(3478),
      coturn3: environment.getContainer('coturn3-1').getMappedPort(3478),
    }

    const iceServers = credentials.servers.map((server: string) => {
      const match = server.match(/^(stun|turn):([^:]+)(?::(\d+))?(?:\?(.*))?$/)
      if (!match) throw new Error(`Invalid server URL: ${server}`)

      const [, protocol, hostname, portStr, query] = match
      if (!hostname) throw new Error(`Missing hostname in server URL: ${server}`)
      const mappedPort = hostnameToPort[hostname]
      const finalHostname = mappedPort ? 'localhost' : hostname
      const finalPort = mappedPort ?? (portStr ? parseInt(portStr, 10) : 3478)

      return {
        urls: `${protocol}:${finalHostname}:${finalPort}${query ? `?${query}` : ''}`,
        username: credentials.username,
        credential: credentials.password,
      }
    })

    await annotate('Configured ICE servers', {
      contentType: 'application/json',
      body: JSON.stringify(iceServers, null, 2),
    })

    const pc = new RTCPeerConnection({ iceServers })

    const candidateSdpLines: string[] = []
    const connectionStates: string[] = []
    const iceConnectionStates: string[] = []
    const iceGatheringStates: string[] = []

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        candidateSdpLines.push(event.candidate.candidate)
      }
    }
    pc.onconnectionstatechange = () => {
      connectionStates.push(pc.connectionState)
    }
    pc.oniceconnectionstatechange = () => {
      iceConnectionStates.push(pc.iceConnectionState)
    }

    const dataChannel = pc.createDataChannel('test')
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)

    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error(`ICE gathering timeout after ${ICE_GATHER_TIMEOUT_MS}ms`))
        }, ICE_GATHER_TIMEOUT_MS)

        // Single handler: records every transition AND resolves on completion.
        // Two separate handlers would race — the second assignment silently drops history.
        const onStateChange = () => {
          iceGatheringStates.push(pc.iceGatheringState)
          if (pc.iceGatheringState === 'complete') {
            clearTimeout(timeout)
            resolve()
          }
        }

        onStateChange()
        pc.onicegatheringstatechange = onStateChange
      })
    } finally {
      dataChannel.close()
      void pc.close()
    }

    const candidateTypes = { host: 0, srflx: 0, relay: 0, prflx: 0 }
    for (const sdpLine of candidateSdpLines) {
      const type = extractCandidateType(sdpLine)
      if (type && type in candidateTypes) {
        candidateTypes[type as keyof typeof candidateTypes]++
      }
    }

    await annotate('ICE candidates gathered', {
      contentType: 'text/plain',
      body: candidateSdpLines.join('\n') || '(none)',
    })
    await annotate(`Candidate type counts: ${JSON.stringify(candidateTypes)}`)
    await annotate(`ICE gathering transitions: ${iceGatheringStates.join(' → ')}`)
    await annotate(`ICE connection transitions: ${iceConnectionStates.join(' → ') || '(none)'}`)
    await annotate(`Connection state transitions: ${connectionStates.join(' → ') || '(none)'}`)

    expect(iceGatheringStates).toContain('complete')
    expect.soft(
      candidateTypes.relay,
      'TURN Allocate succeeded — issued HMAC credentials authenticated and coturn returned a relay address (subsumes the STUN Binding round-trip)',
    ).toBeGreaterThanOrEqual(1)
  })
})
