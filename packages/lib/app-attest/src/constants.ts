import { concatBytesSync } from './utils.js'

const textEncoder = new TextEncoder()

export const APPLE_APP_ATTEST_OID = '1.2.840.113635.100.8.2'
export const DEV_AAGUID = textEncoder.encode('appattestdevelop')
export const PROD_AAGUID = concatBytesSync([textEncoder.encode('appattest'), new Uint8Array(7)])
