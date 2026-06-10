export const PROBE_PATHS = ['/healthcheck', '/livez', '/readyz'] as const
export const isProbePath = (path: string): boolean => (PROBE_PATHS as readonly string[]).includes(path)
