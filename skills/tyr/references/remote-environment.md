# Remote mode: GCP / GKE environment

Applies only in `remote` mode. `dev` and `rec` are the team's test
environments and are pre-approved: the user names which one for the run and
nothing more is asked. Production is never accepted.

The skill assumes the user is already logged in to GCP. It verifies instead of
trusting, with read-only commands. If a check fails it reports and stops. It
never runs `gcloud auth login`, `gcloud config set`, `kubectl config
use-context` or anything that changes the session.

## 1. Environment gate (preflight and again at execution)

1. The user names the target: environment (dev or rec) and, if the repo has
   several, the overlay, namespace and cluster.
2. Read-only checks:
   - `gcloud auth list` (an active account is present)
   - `gcloud config get-value project`
   - `kubectl config current-context`
   - `sops --version`
3. Classify the environment from the names found (project, context, cluster,
   namespace, overlay). Accept only dev and rec class. Refuse
   names that look like production (`prod`, `prd`, `live`, `production`),
   always. An environment that cannot be classified is accepted only if the
   user states explicitly that it is a test environment; record the statement
   in the plan. If the active context does not match what the user named,
   stop and report both; do not switch it.
4. Record in the plan: project, cluster, namespace, overlay, context, date.

Optional cluster reads (`kubectl get`, `kubectl auth can-i`, `kubectl logs`)
are read-only and used only to confirm what the manifests say (the deployment
exists, the image tag, the pod is ready). Tell the user before the first one.

## 2. Discover dependencies from the manifests

Locate the tree: `k8s/`, `deploy/`, `manifests/`, `helm/`, kustomize `base/`
and `overlays/<env>/`. Select the overlay or values file for the target. If the
overlay needs rendering (kustomize or helm), read the base and overlay files
and merge by reasoning; render with `kubectl kustomize` or `helm template` only
if the tool is present, and treat the output as read-only text.

| Source | What to take |
|---|---|
| Deployment | image and tag, env and `envFrom`, config and secret references, probes, replicas, service account, workload-identity annotation |
| ConfigMap (after overlay) | URLs, hosts, topics, buckets, feature flags |
| Secret (SOPS) | key names only |
| Service, Ingress, Gateway, HTTPRoute | how the service is reached: host names, paths, ports, auth in front |
| ServiceAccount, annotations | workload identity, so which GCP services the service uses |
| ExternalName services, Cloud SQL proxy or Memorystore references | managed infrastructure |

Separate each dependency into:

- **The service's own infrastructure**: Cloud SQL, Memorystore, Pub/Sub, GCS,
  other in-cluster services.
- **Real external APIs**: hosts outside the cluster and the project.

Flag any outbound target found in code but absent from the manifests.

## 3. SOPS

SOPS-encrypted files keep key names in clear and encrypt only the values.

- Planning: read the structure to learn which secrets exist and which the
  service needs. Never run `sops decrypt` for planning. The plan lists secret
  names and their purpose, never values.
- Execution: when a live check needs a credential (a client id and secret for a
  token endpoint, an API key for the service), decrypt with the globally
  installed `sops` to standard output and load the needed keys into the
  environment of the checking process only. Never write the output to a file,
  a log, the plan or the report. Report only that the secret was obtained.
- If decryption fails (no KMS access), the cases needing it are `BLOCKED`
  with the reason.

## 4. Reaching the service

In order of preference:

1. The ingress or gateway URL from the manifests, when it is reachable from
   the user's machine.
2. `kubectl port-forward` to the Service in the target namespace, on a free
   local port, started for the run and stopped at teardown.

Auth in front of the service (an OAuth gateway, an API key) is part of the
case: use the real mechanism with the credentials from SOPS. If neither route
works, that is a blocking doubt.

Direct access to the real database or broker is not planned. A user may choose
a read-only direct look for one dependency in the plan; it is then listed in
the plan's environment section and in the execution contract.

## 5. Side effects

Every remote case gets a side-effect class, shown in the plan:

- `read-only`: reads only.
- `reversible`: creates data the live check removes afterwards.
- `side-effecting`: sends an email or notification, publishes to a shared
  topic, calls a real partner in a way that cannot be undone, or leaves state
  that the API cannot remove.

No per-case approval is needed in dev and rec; the classes are visible when
the user validates. Real partner calls are listed with the partner host.

## 6. Data and cleanup

- Test data carries a run marker in business identifiers: the `run-id`
  itself, which already starts with `qa-` (for example a customer reference
  `qa-2410051430-a3f1-001`). Other people share
  these environments, and the marker lets them tell the data apart.
- Create data through the service's own API. Record every created identifier
  as it is created.
- Cleanup is part of every case: delete through the API, in reverse order of
  creation. At teardown, any identifier still recorded is retried once and then
  listed in the report with how to remove it.
- State the expected request volume. Warn when a case could hit a rate limit
  or quota on a real partner.

## 7. Live-check design (per case)

For every remote case the plan gives:

- entry point (ingress URL or port-forward target)
- credentials needed, by secret name, and how the check obtains them
- the request sequence that creates its data, with the run marker
- the commands (`curl` and a PowerShell form where they differ)
- the expected status, fields and side effects
- how the outcome is observed: the response, a follow-up read through the API,
  an event the API exposes
- the cleanup
- the side-effect class
- where to look if it fails: the service logs (`kubectl logs`, read-only), if
  the user has access
