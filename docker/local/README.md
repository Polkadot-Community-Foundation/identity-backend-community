# Local Development Environment

This directory contains the Docker Compose configuration for running the local development environment with observability tools.

## Services

### Grafana Tempo

- Distributed tracing backend
- Ports:
  - 14268: Jaeger ingest
  - 3200: Tempo HTTP API
  - 9095: Tempo gRPC
  - 4317: OpenTelemetry gRPC
  - 4318: OpenTelemetry HTTP
  - 9411: Zipkin

### Prometheus

- Metrics collection and storage
- Port 9090: Web UI and API
- Features enabled:
  - Remote write receiver
  - Exemplar storage

### Grafana

- Visualization platform for metrics and traces
- Port 3000: Web UI
- Preconfigured with:
  - Anonymous access (admin)
  - TraceQL editor
  - Data sources for Prometheus and Tempo

## Getting Started

1. Start the services:
   ```bash
   docker compose up
   ```

2. Access the UIs:
   - Grafana: http://localhost:3000
   - Prometheus: http://localhost:9090
   - Tempo: http://localhost:3200

## Configuration

The services are configured using shared configuration files from the `../shared` directory:

- `tempo.yaml`: Tempo configuration
- `prometheus.yaml`: Prometheus configuration
- `grafana-datasources.yaml`: Grafana data source configuration

## Troubleshooting

If you encounter port conflicts, ensure no other services are running on the required ports:

- 3000 (Grafana)
- 9090 (Prometheus)
- 3200, 14268, 9095, 4317, 4318, 9411 (Tempo)
