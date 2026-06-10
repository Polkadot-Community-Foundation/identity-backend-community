# E2E Testing Environment

This directory contains configurations for end-to-end testing using Chopsticks (a chain simulation tool). The setup provides test accounts on Westend, and People Paseo networks.

## Account Mappings

### People Networks

#### Westend

- Alice: `5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY`
- Bob: `5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty` (dot authority)

#### Paseo

- Alice: `5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY`
- Bob: `5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty` (dot authority)

## Purpose

These configurations are used in conjunction with the e2e test suite in `apps/identity-backend-e2e/tests/`. The environment uses Chopsticks to simulate all networks for testing.

## Startup Containers

The environment includes startup containers that handle the initial setup:

### People Startup Container

Sets up the People networks (Westend and Paseo):

- Configures proxy permissions
- Sets up initial account states

These containers ensure consistent initial state for the test environment.
