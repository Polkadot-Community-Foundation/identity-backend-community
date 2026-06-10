export function isStandardLocalhost(ip: string): boolean {
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1'
}

export function isDockerNetworkAddress(ip: string): boolean {
  const extractIPv4 = (address: string): string => address.startsWith('::ffff:') ? address.slice(7) : address

  const isInDockerRange = (ipv4: string): boolean => {
    const parts = ipv4.split('.')
    if (parts.length === 4 && parts[0] === '172') {
      const secondOctet = parseInt(parts[1]!, 10)
      return secondOctet >= 16 && secondOctet <= 31
    }
    return false
  }

  return isInDockerRange(extractIPv4(ip))
}

export function isVPCAddress(ip: string): boolean {
  const extractIPv4 = (address: string): string => address.startsWith('::ffff:') ? address.slice(7) : address

  const isInVPCRange = (ipv4: string): boolean => {
    const parts = ipv4.split('.')
    return parts.length === 4 && parts[0] === '10'
  }

  return isInVPCRange(extractIPv4(ip))
}

export function isLocalhost(ip: string): boolean {
  return isStandardLocalhost(ip) || isDockerNetworkAddress(ip)
}
