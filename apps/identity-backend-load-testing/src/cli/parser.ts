import type { RegisterRequestBody } from '@identity-backend/people-lite-fixtures'

export interface RegisterEntry {
  body: RegisterRequestBody
  who: string
  sub: string
  mnemonic: string
}

export function parseRegisterPayloads(text: string): RegisterEntry[] {
  const out: RegisterEntry[] = []
  let lineNumber = 0
  for (const raw of text.split('\n')) {
    lineNumber++
    if (raw.length === 0) continue
    try {
      out.push(JSON.parse(raw) as RegisterEntry)
    } catch (cause) {
      throw new Error(`register-payloads: invalid JSONL at line ${lineNumber}`, { cause })
    }
  }
  return out
}

export function parseRegisterBodies(text: string): RegisterRequestBody[] {
  return parseRegisterPayloads(text).map((e) => e.body)
}
