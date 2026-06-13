declare module 'k6' {
  export type bytes = ArrayBuffer
  export type JSONValue = string | number | boolean | null | JSONValue[] | { [key: string]: JSONValue }

  export function check<T>(val: T, sets: Record<string, (val: T) => boolean>, tags?: Record<string, string>): boolean
  export function sleep(t: number): void
  export function group<T>(name: string, fn: () => T): T
  export function fail(msg?: string): never
}

declare module 'k6/http' {
  export interface RefinedResponse<T = unknown> {
    status: number
    body: string
    headers: Record<string, string>
    json(): T
    timings: {
      duration: number
      blocked: number
      connecting: number
      tls_handshaking: number
      sending: number
      waiting: number
      receiving: number
    }
  }
  export interface RequestParams {
    headers?: Record<string, string>
    tags?: Record<string, string>
    timeout?: string | number
  }
  export function get(url: string, params?: RequestParams): RefinedResponse
  export function post(url: string, body?: string | null, params?: RequestParams): RefinedResponse
  export function del(url: string, body?: string | null, params?: RequestParams): RefinedResponse
}

declare module 'k6/crypto' {
  export function hmac(algorithm: string, secret: string, data: string, outputEncoding: string): string
  export function sha256(input: string | ArrayBufferLike, outputEncoding: 'hex' | 'base64' | 'base64rawurl'): string
  export function randomBytes(length: number): ArrayBuffer
  const crypto: {
    hmac: typeof hmac
    sha256: typeof sha256
    randomBytes: typeof randomBytes
  }
  export default crypto
}

declare module 'k6/execution' {
  const execution: {
    scenario: { name: string; iterationInTest: number; iterationInInstance: number }
    vu: { idInTest: number; idInInstance: number }
    test: { abort: (reason?: string) => void }
  }
  export default execution
}

declare module 'k6/encoding' {
  export function b64encode(input: string | ArrayBuffer, encoding?: string): string
}

declare module 'k6/metrics' {
  export interface Trend {
    add(value: number, tags?: Record<string, string>): void
  }
  export interface Rate {
    add(value: boolean, tags?: Record<string, string>): void
  }
  export interface Counter {
    add(value: number, tags?: Record<string, string>): void
  }
  export interface Gauge {
    add(value: number, tags?: Record<string, string>): void
  }
  export const Trend: { new(name: string, isTime?: boolean): Trend }
  export const Rate: { new(name: string): Rate }
  export const Counter: { new(name: string): Counter }
  export const Gauge: { new(name: string): Gauge }
}

declare module 'k6/data' {
  export interface SharedArray<T = unknown> {
    readonly length: number
    [index: number]: T
  }
  export const SharedArray: { new<T = unknown>(name: string, loadFn: () => T[]): SharedArray<T> }
}

declare module 'https://jslib.k6.io/k6-utils/1.2.0/index.js' {
  export function randomItem<T>(items: T[]): T
}

declare function open(path: string, mode?: string): string
declare var __ENV: Record<string, string | undefined>
declare var console: { log(...args: unknown[]): void; warn(...args: unknown[]): void; error(...args: unknown[]): void }
