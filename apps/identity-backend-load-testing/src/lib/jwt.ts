import crypto from 'k6/crypto'
import encoding from 'k6/encoding'

export interface JwtToken {
  sub: string
  token: string
}

export function generateJwt(
  secret: string,
  sub: string,
  platform: string = 'unknown',
): string {
  const header = { alg: 'HS256', typ: 'JWT' }

  const now = Math.floor(Date.now() / 1000)
  const payload: Record<string, string | number> = {
    sub,
    iss: 'polkadot-app',
    iat: now,
    exp: now + 86400,
  }
  if (platform) {
    payload.platform = platform
  }

  const headerBase64 = encoding.b64encode(JSON.stringify(header), 'rawurl')
  const payloadBase64 = encoding.b64encode(JSON.stringify(payload), 'rawurl')
  const data = `${headerBase64}.${payloadBase64}`
  const signature = crypto.hmac('sha256', secret, data, 'base64rawurl')

  return `${data}.${signature}`
}

export function generateJwtPool(
  secret: string,
  count: number,
  platform: string = 'unknown',
): JwtToken[] {
  const tokens: JwtToken[] = []
  for (let i = 0; i < count; i++) {
    const sub = `0x${i.toString(16).padStart(64, '0')}`
    tokens.push({ sub, token: generateJwt(secret, sub, platform) })
  }
  return tokens
}
