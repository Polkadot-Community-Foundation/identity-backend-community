import {
  AttestationApplicationId,
  AttestationPackageInfo,
  AuthorizationList,
  KeyMintKeyDescription,
  RootOfTrust,
  SecurityLevel,
  VerifiedBootState,
} from '@peculiar/asn1-android'
import { AsnSerializer, OctetString } from '@peculiar/asn1-schema'
import {
  BasicConstraintsExtension,
  Extension,
  KeyUsageFlags,
  KeyUsagesExtension,
  X509CertificateGenerator,
} from '@peculiar/x509'
import { decodeHex } from '@std/encoding'

const ANDROID_KEY_ATTESTATION_OID = '1.3.6.1.4.1.11129.2.1.17'

export interface AttestationExtensionOptions {
  readonly challenge: Uint8Array
  readonly packageName: string
  readonly signingDigestHex: string
  readonly attestationSecurityLevel?: SecurityLevel
  readonly keyMintSecurityLevel?: SecurityLevel
  readonly includeRootOfTrust?: boolean
  readonly verifiedBootState?: VerifiedBootState
  readonly deviceLocked?: boolean
  readonly verifiedBootKey?: Uint8Array
}

export const buildAttestationExtensionValue = (opts: AttestationExtensionOptions): ArrayBuffer => {
  const appId = new AttestationApplicationId({
    packageInfos: [
      new AttestationPackageInfo({
        packageName: new OctetString(new TextEncoder().encode(opts.packageName)),
        version: 1,
      }),
    ],
    signatureDigests: [new OctetString(decodeHex(opts.signingDigestHex))],
  })

  const hardware = new AuthorizationList({
    attestationApplicationId: new OctetString(AsnSerializer.serialize(appId)),
    ...(opts.includeRootOfTrust === false ? {} : {
      rootOfTrust: new RootOfTrust({
        verifiedBootKey: new OctetString(opts.verifiedBootKey ?? new Uint8Array(32)),
        deviceLocked: opts.deviceLocked ?? true,
        verifiedBootState: opts.verifiedBootState ?? VerifiedBootState.verified,
      }),
    }),
  })

  const keyDesc = new KeyMintKeyDescription({
    attestationVersion: 100,
    attestationSecurityLevel: opts.attestationSecurityLevel ?? SecurityLevel.trustedEnvironment,
    keyMintVersion: 100,
    keyMintSecurityLevel: opts.keyMintSecurityLevel ?? SecurityLevel.trustedEnvironment,
    attestationChallenge: new OctetString(opts.challenge),
    uniqueId: new OctetString(new Uint8Array(0)),
    softwareEnforced: new AuthorizationList(),
    hardwareEnforced: hardware,
  })

  return AsnSerializer.serialize(keyDesc)
}

export interface AttestationChainOptions {
  readonly extensionValue?: ArrayBuffer
  readonly notBefore?: Date
  readonly notAfter?: Date
  readonly extraIntermediates?: number
  readonly extensionOnIntermediate?: boolean
}

export interface IssuedAttestationChain {
  readonly leafCert: Awaited<ReturnType<typeof X509CertificateGenerator.create>>
  readonly intermediates: ReadonlyArray<Awaited<ReturnType<typeof X509CertificateGenerator.create>>>
  readonly rootCert: Awaited<ReturnType<typeof X509CertificateGenerator.create>>
  readonly rootPem: string
}

export const issueAttestationChain = async (
  opts: AttestationChainOptions = {},
): Promise<IssuedAttestationChain> => {
  const notBefore = opts.notBefore ?? new Date(0)
  const notAfter = opts.notAfter ?? new Date(4_102_444_800_000)
  const newKey = () => crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-384' }, true, ['sign', 'verify'])

  const rootKey = await newKey()
  const rootCert = await X509CertificateGenerator.create({
    serialNumber: '01',
    subject: 'CN=Test Android Attestation Root',
    issuer: 'CN=Test Android Attestation Root',
    notBefore,
    notAfter,
    signingKey: rootKey.privateKey,
    publicKey: rootKey.publicKey,
    extensions: [
      new BasicConstraintsExtension(true, undefined, true),
      new KeyUsagesExtension(KeyUsageFlags.keyCertSign | KeyUsageFlags.cRLSign, true),
    ],
  })

  const intermediates: Array<Awaited<ReturnType<typeof X509CertificateGenerator.create>>> = []
  let signerKey = rootKey
  let signerSubject = rootCert.subject
  const intermediateCount = 1 + (opts.extraIntermediates ?? 0)
  for (let i = 0; i < intermediateCount; i++) {
    const key = await newKey()
    const cert = await X509CertificateGenerator.create({
      serialNumber: `1${i}`,
      subject: `CN=Test Android Intermediate ${i}`,
      issuer: signerSubject,
      notBefore,
      notAfter,
      signingKey: signerKey.privateKey,
      publicKey: key.publicKey,
      extensions: [
        new BasicConstraintsExtension(true, undefined, true),
        new KeyUsagesExtension(KeyUsageFlags.keyCertSign | KeyUsageFlags.cRLSign, true),
        ...(opts.extensionOnIntermediate && i === 0
          ? [new Extension(ANDROID_KEY_ATTESTATION_OID, false, new ArrayBuffer(4))]
          : []),
      ],
    })
    intermediates.push(cert)
    signerKey = key
    signerSubject = cert.subject
  }

  const leafKey = await newKey()
  const leafCert = await X509CertificateGenerator.create({
    serialNumber: '99',
    subject: 'CN=test.attested.device',
    issuer: signerSubject,
    notBefore,
    notAfter,
    signingKey: signerKey.privateKey,
    publicKey: leafKey.publicKey,
    extensions: [
      new KeyUsagesExtension(KeyUsageFlags.digitalSignature, true),
      ...(opts.extensionValue ? [new Extension(ANDROID_KEY_ATTESTATION_OID, false, opts.extensionValue)] : []),
    ],
  })

  return {
    leafCert,
    intermediates: intermediates.map((cert) => cert).reverse(),
    rootCert,
    rootPem: rootCert.toString(),
  }
}
