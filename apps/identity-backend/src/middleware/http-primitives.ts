import type { Context } from 'hono'

const READ_ONLY_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export const readOnlyPassthrough = (c: Context): boolean => READ_ONLY_METHODS.has(c.req.method)

export const unauthenticatedPassthrough = (c: Context): boolean => c.req.header('Authorization') === undefined
