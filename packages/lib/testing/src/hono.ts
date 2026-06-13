import { Effect } from 'effect'
import type { ClientResponse } from 'hono/client'
import type { ResponseFormat } from 'hono/types'
import type { StatusCode } from 'hono/utils/http-status'
import { expect } from 'vitest'

export function checkResponse<
  R extends ClientResponse<unknown, StatusCode, ResponseFormat>,
  S extends StatusCode,
>(
  resp: R,
  status: S,
  message?: string,
): asserts resp is Extract<R, { status: S }> {
  expect(resp.status, message).toBe(status)
}

export function checkResponseWithBody<
  R extends ClientResponse<unknown, StatusCode, ResponseFormat>,
  S extends StatusCode,
>(resp: R, status: S, message?: string): Promise<Extract<R, { status: S }>>
export function checkResponseWithBody(resp: Response, status: number, message?: string): Promise<Response>
export async function checkResponseWithBody(
  resp: ClientResponse<unknown, StatusCode, ResponseFormat> | Response,
  status: number,
  message?: string,
): Promise<ClientResponse<unknown, StatusCode, ResponseFormat> | Response> {
  if (resp.status !== status) {
    const body = await resp.clone().text().catch(() => '<unreadable response body>')
    const detail = message === undefined ? '' : `${message} — `

    expect(resp.status, `${detail}unexpected status; response body: ${body}`).toBe(status)
  }

  return resp
}

export const expectStatus =
  <S extends StatusCode>(status: S, message?: string) =>
  <R extends ClientResponse<unknown, StatusCode, ResponseFormat>>(
    resp: R,
  ): Effect.Effect<Extract<R, { status: S }>> =>
    Effect.sync(() => {
      expect(resp.status, message).toBe(status)
      return resp as Extract<R, { status: S }>
    })
