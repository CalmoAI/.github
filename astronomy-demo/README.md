### Astronomy Shop Resilience Demo Kit

This kit demonstrates an end-to-end incident on the OpenTelemetry Astronomy Shop: baseline SLOs, induce failure with LitmusChaos, detect via Grafana + SigNoz, triage in Calmo, and remediate on Kubernetes with Kustomize.

#### Components
- k6 steady traffic to checkout
- Grafana alerting (p95 latency, error-rate) with webhook to Calmo
- LitmusChaos experiments: pod-network-latency (cart → datastore), pod-cpu-hog (cart)
- Kustomize remediation overlay to scale and resource-bump `cartservice`
- Optional misconfig scenario: wrong image to trigger CrashLoopBackOff

#### Prerequisites
- Kubernetes cluster (GKE recommended) with the OpenTelemetry Demo deployed (namespace `otel-demo` assumed)
- SigNoz or Prometheus-compatible metrics endpoint connected to Grafana
- Grafana v9+ with provisioning enabled
- LitmusChaos installed and a target ServiceAccount with permissions in `otel-demo`
- Calmo ingestion endpoint URL and optional API key
- kubectl, kustomize, and k6 installed locally

#### Environment
Export these before running:

```bash
export ASTRONOMY_NS=otel-demo
export FRONTEND_BASE_URL="http://frontend.${ASTRONOMY_NS}.svc.cluster.local:8080"
export CALMO_WEBHOOK_URL="https://ingest.getcalmo.com/webhook/<your-source>"
export CALMO_WEBHOOK_SECRET="<optional-shared-secret>"
# Grafana: set your Prometheus/SigNoz datasource UID (from Grafana > Connections > Data sources)
export GRAFANA_PROM_DS_UID="prometheus"
```

### 1) Baseline: generate steady checkout traffic

```bash
k6 run ./k6/checkout.js \
  -e BASE_URL="$FRONTEND_BASE_URL" \
  -e CHECKOUT_RATE_PER_SEC=3 \
  -e TEST_DURATION="10m"
```

Verify traces/metrics in Grafana/SigNoz are healthy; note baseline p95 and error-rate.

### 2) Arm alerts and route to Calmo
Provision Grafana contact point and alert rules via ConfigMaps/volumes or by copying files from `grafana/provisioning/alerting/*` into Grafana's provisioning directory. Ensure the datasource UID is set to `$GRAFANA_PROM_DS_UID` and Calmo webhook URL is set.

Files:
- `grafana/provisioning/alerting/contact-points.yaml`
- `grafana/provisioning/alerting/rules.yaml`

These configure:
- Alert A: checkout p95 latency > 2s for 5m
- Alert B: checkout error-rate > 3% for 5m

### 3) Inject failures with LitmusChaos

Set the app label and namespace in the engines if needed. Apply experiments and engines:

```bash
kubectl apply -n litmus -f ./litmus/experiments/pod-network-latency.yaml
kubectl apply -n litmus -f ./litmus/experiments/pod-cpu-hog.yaml

kubectl apply -n "$ASTRONOMY_NS" -f ./litmus/engines/cart-network-latency.yaml
kubectl apply -n "$ASTRONOMY_NS" -f ./litmus/engines/cart-cpu-hog.yaml
```

Observe: increased `cart` span latency, possible throttling/restarts; Grafana alerts should fire within 5–7 minutes; Calmo receives webhooks and correlates with K8s events and recent deploys.

### 4) Remediate with Kustomize overlay

Apply the remediation overlay to scale and resource-bump `cartservice`:

```bash
kubectl kustomize ./kustomize/overlays/cart-remediation | kubectl apply -n "$ASTRONOMY_NS" -f -
```

Validate SLOs recover, then roll back chaos:

```bash
kubectl delete -n "$ASTRONOMY_NS" -f ./litmus/engines/cart-network-latency.yaml || true
kubectl delete -n "$ASTRONOMY_NS" -f ./litmus/engines/cart-cpu-hog.yaml || true
```

### 5) Optional simple scenarios

- CrashLoopBackOff: apply `kubernetes/misconfig/cart-bad-image.yaml` to simulate non-existent image for `cartservice`, then revert.
- NodeSelector misplacement: add a strict `nodeSelector` to `cartservice` to schedule onto non-matching nodes and observe Pending pods.
- pod-cpu-hog: run only the CPU hog engine.

### 6) Grafana → Calmo webhook payload

Grafana contact point is configured to send JSON including `title`, `state`, `labels`, `evalMatches`, `startsAt`. Calmo can enrich with SLO metadata and correlate.

### Clean-up

```bash
# Remove remediation overlay changes (if you used a dedicated overlay, you can roll back by re-applying base manifests)
kubectl rollout restart deploy/cartservice -n "$ASTRONOMY_NS"

# Delete engines (experiments can remain installed in litmus namespace)
kubectl delete -n "$ASTRONOMY_NS" -f ./litmus/engines/cart-network-latency.yaml || true
kubectl delete -n "$ASTRONOMY_NS" -f ./litmus/engines/cart-cpu-hog.yaml || true
```

