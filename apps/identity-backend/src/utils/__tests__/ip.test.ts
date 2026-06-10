import { describe, expect, it } from 'vitest'
import { isDockerNetworkAddress, isLocalhost, isStandardLocalhost, isVPCAddress } from '../ip.js'

describe('IP address utilities', () => {
  describe('isStandardLocalhost', () => {
    it('Should_IdentifyStandardLocalhost_When_StandardAddress', () => {
      expect(isStandardLocalhost('127.0.0.1')).toBe(true)
      expect(isStandardLocalhost('::1')).toBe(true)
      expect(isStandardLocalhost('::ffff:127.0.0.1')).toBe(true)
    })

    it('Should_RejectNonLocalhost_When_NonLocalAddress', () => {
      expect(isStandardLocalhost('192.168.0.1')).toBe(false)
      expect(isStandardLocalhost('10.0.0.1')).toBe(false)
      expect(isStandardLocalhost('172.18.0.1')).toBe(false)
    })
  })

  describe('isDockerNetworkAddress', () => {
    it('Should_IdentifyDockerNetwork_When_DockerRange', () => {
      expect(isDockerNetworkAddress('172.17.0.1')).toBe(true)
      expect(isDockerNetworkAddress('172.18.0.1')).toBe(true)
      expect(isDockerNetworkAddress('172.31.255.255')).toBe(true)
    })

    it('Should_HandleIpv6MappedDocker_When_MappedRange', () => {
      expect(isDockerNetworkAddress('::ffff:172.17.0.1')).toBe(true)
      expect(isDockerNetworkAddress('::ffff:172.18.0.1')).toBe(true)
      expect(isDockerNetworkAddress('::ffff:172.31.255.255')).toBe(true)
    })

    it('Should_RejectNonDockerNetwork_When_OutsideRange', () => {
      expect(isDockerNetworkAddress('172.15.0.1')).toBe(false)
      expect(isDockerNetworkAddress('172.32.0.1')).toBe(false)
      expect(isDockerNetworkAddress('192.168.0.1')).toBe(false)
      expect(isDockerNetworkAddress('10.0.0.1')).toBe(false)
    })
  })

  describe('isVPCAddress', () => {
    it('Should_IdentifyVpcAddresses_When_VpcRange', () => {
      expect(isVPCAddress('10.0.0.1')).toBe(true)
      expect(isVPCAddress('10.24.8.1')).toBe(true)
      expect(isVPCAddress('10.24.9.1')).toBe(true)
      expect(isVPCAddress('10.255.255.255')).toBe(true)
    })

    it('Should_HandleIpv6MappedVpc_When_MappedRange', () => {
      expect(isVPCAddress('::ffff:10.0.0.1')).toBe(true)
      expect(isVPCAddress('::ffff:10.24.8.1')).toBe(true)
      expect(isVPCAddress('::ffff:10.24.9.1')).toBe(true)
      expect(isVPCAddress('::ffff:10.255.255.255')).toBe(true)
    })

    it('Should_RejectNonVpc_When_OutsideRange', () => {
      expect(isVPCAddress('172.17.0.1')).toBe(false)
      expect(isVPCAddress('192.168.0.1')).toBe(false)
      expect(isVPCAddress('8.8.8.8')).toBe(false)
    })
  })

  describe('isLocalhost', () => {
    it('Should_IdentifyLocalhostAndDocker_When_LocalAddresses', () => {
      expect(isLocalhost('127.0.0.1')).toBe(true)
      expect(isLocalhost('::1')).toBe(true)
      expect(isLocalhost('::ffff:127.0.0.1')).toBe(true)
      expect(isLocalhost('172.17.0.1')).toBe(true)
      expect(isLocalhost('::ffff:172.18.0.1')).toBe(true)
    })

    it('Should_RejectNonLocalNonDocker_When_ExternalAddresses', () => {
      expect(isLocalhost('192.168.0.1')).toBe(false)
      expect(isLocalhost('10.0.0.1')).toBe(false)
      expect(isLocalhost('10.24.8.1')).toBe(false)
      expect(isLocalhost('::ffff:10.24.8.1')).toBe(false)
      expect(isLocalhost('8.8.8.8')).toBe(false)
    })

    it('Should_IdentifyLocalhostAndDocker_When_LocalAddresses', () => {
      expect(isLocalhost('10.0.0.1')).toBe(false)
      expect(isLocalhost('10.24.8.1')).toBe(false)
      expect(isLocalhost('::ffff:10.24.8.1')).toBe(false)
    })
  })
})
