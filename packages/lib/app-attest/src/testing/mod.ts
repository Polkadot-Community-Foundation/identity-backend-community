import { p256 } from '@noble/curves/nist.js'
import { sha256 } from '@noble/hashes/sha2.js'
import {
  BasicConstraintsExtension,
  Extension,
  KeyUsageFlags,
  KeyUsagesExtension,
  X509CertificateGenerator,
} from '@peculiar/x509'
import { concat } from '@std/bytes'
import { encodeCbor } from '@std/cbor'

const textEncoder = new TextEncoder()
const APPLE_APP_ATTEST_OID = '1.2.840.113635.100.8.2'
const DEV_AAGUID = textEncoder.encode('appattestdevelop')

const uint32be = (value: number): Uint8Array => {
  const out = new Uint8Array(4)
  new DataView(out.buffer).setUint32(0, value, false)
  return out
}

const uint16be = (value: number): Uint8Array => {
  const out = new Uint8Array(2)
  new DataView(out.buffer).setUint16(0, value, false)
  return out
}

const newEcKey = () => crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])

export interface AppleAttestationOptions {
  readonly appId: string
  readonly challenge: Uint8Array
  readonly notBefore?: Date
  readonly notAfter?: Date
}

export interface IssuedAppleAttestation {
  readonly keyId: Uint8Array
  readonly attestation: Uint8Array
  readonly rootPem: string
  readonly credKey: CryptoKeyPair
  readonly appId: string
}

export const issueAppleAttestation = async (
  opts: AppleAttestationOptions,
): Promise<IssuedAppleAttestation> => {
  const notBefore = opts.notBefore ?? new Date(0)
  const notAfter = opts.notAfter ?? new Date(4_102_444_800_000)

  const rootKey = await newEcKey()
  const rootCert = await X509CertificateGenerator.create({
    serialNumber: '01',
    subject: 'CN=Test Apple App Attest Root',
    issuer: 'CN=Test Apple App Attest Root',
    notBefore,
    notAfter,
    signingKey: rootKey.privateKey,
    publicKey: rootKey.publicKey,
    extensions: [
      new BasicConstraintsExtension(true, undefined, true),
      new KeyUsagesExtension(KeyUsageFlags.keyCertSign, true),
    ],
  })

  const intermediateKey = await newEcKey()
  const intermediateCert = await X509CertificateGenerator.create({
    serialNumber: '02',
    subject: 'CN=Test Apple App Attest CA',
    issuer: rootCert.subject,
    notBefore,
    notAfter,
    signingKey: rootKey.privateKey,
    publicKey: intermediateKey.publicKey,
    extensions: [
      new BasicConstraintsExtension(true, undefined, true),
      new KeyUsagesExtension(KeyUsageFlags.keyCertSign, true),
    ],
  })

  const credKey = await newEcKey()
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', credKey.publicKey))
  const keyId = sha256(spki.slice(-65))

  const rpIdHash = sha256(textEncoder.encode(opts.appId))
  const authData = concat([rpIdHash, new Uint8Array([0]), uint32be(0), DEV_AAGUID, uint16be(keyId.length), keyId])
  const nonce = sha256(concat([authData, sha256(opts.challenge)]))

  const credCert = await X509CertificateGenerator.create({
    serialNumber: '03',
    subject: 'CN=test.apple.credential',
    issuer: intermediateCert.subject,
    notBefore,
    notAfter,
    signingKey: intermediateKey.privateKey,
    publicKey: credKey.publicKey,
    extensions: [
      new KeyUsagesExtension(KeyUsageFlags.digitalSignature, true),
      new Extension(APPLE_APP_ATTEST_OID, false, nonce),
    ],
  })

  const attestation = encodeCbor({
    fmt: 'apple-appattest',
    attStmt: {
      x5c: [new Uint8Array(credCert.rawData), new Uint8Array(intermediateCert.rawData)],
      receipt: textEncoder.encode('test-receipt'),
    },
    authData,
  })

  return { keyId, attestation, rootPem: rootCert.toString(), credKey, appId: opts.appId }
}

export interface AppleAssertionOptions {
  readonly credKey: CryptoKeyPair
  readonly appId: string
  readonly challenge: Uint8Array
  readonly clientData: Uint8Array
  readonly clientId: Uint8Array
  readonly signCount: number
}

export const issueAppleAssertion = async (opts: AppleAssertionOptions): Promise<Uint8Array> => {
  const rpIdHash = sha256(textEncoder.encode(opts.appId))
  const authenticatorData = concat([rpIdHash, new Uint8Array([0]), uint32be(opts.signCount)])
  const clientDataHash = sha256(concat([opts.challenge, opts.clientId, sha256(opts.clientData)]))
  const nonce = sha256(concat([authenticatorData, clientDataHash]))

  const rawSignature = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, opts.credKey.privateKey, nonce),
  )
  const derSignature = p256.Signature.fromBytes(rawSignature, 'compact').toBytes('der')

  return encodeCbor({ signature: derSignature, authenticatorData })
}
