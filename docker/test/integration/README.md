# Integration Testing Environment

This directory contains Docker configurations for running integration tests. Unlike the e2e environment which simulates chains using Chopsticks, this setup runs against actual databases and services.

## Important

**⚠️ This environment must be running before executing E2E tests, as the E2E test suite depends on IntegreSQL for database management.**

## Purpose

The integration environment is used to test:

- Database interactions
- Service integrations
- API endpoints
- Background workers

## Setup

The environment is configured via docker-compose and includes:

- PostgreSQL database
- [IntegreSQL](https://github.com/allaboutapps/integresql) - Manages isolated PostgreSQL databases for each test
- Integration test runner

## Database Isolation

We use [IntegreSQL](https://github.com/allaboutapps/integresql) to ensure each test runs against a clean, isolated database. This provides:

- Fast test execution through database templating
- Complete isolation between tests
- Consistent database state for each test
- Parallel test execution support

## Usage

```bash
# Start the integration test environment (required for E2E tests)
docker-compose up -d

# Tear down environment
docker-compose down
```
