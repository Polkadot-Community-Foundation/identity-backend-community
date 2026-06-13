FROM grafana/otel-lgtm:0.11.16

COPY grafana/dashboards.yaml /otel-lgtm/grafana/conf/provisioning/dashboards/identity-backend.yaml
COPY grafana/dashboards/ /otel-lgtm/grafana/conf/provisioning/dashboards/identity-backend/
COPY grafana/alerting/ /otel-lgtm/grafana/conf/provisioning/alerting/
