// k8s-style events. each emitted record matches the shape of
// `kubectl get event -o yaml` — corev1.Event: metadata, involvedObject
// (ObjectReference), reason, message, source, timestamps, count, type.
// messages are deliberately rich (multi-line, stack traces, scheduler
// detail) so payloads land around 1-2 kB.

export type EventType = 'Normal' | 'Warning'
export type Kind = 'Pod' | 'Deployment' | 'Node' | 'Service' | 'ConfigMap'

export type InvolvedObject = {
  apiVersion: string
  kind: Kind
  name: string
  namespace: string
  uid: string
  resourceVersion: string
  fieldPath?: string
}

export type LogEvent = {
  apiVersion: 'v1'
  kind: 'Event'
  metadata: {
    name: string
    namespace: string
    uid: string
    resourceVersion: string
    creationTimestamp: string
  }
  // delivery cursor — not part of corev1.Event, kept so clients can use ?since=
  id: string
  involvedObject: InvolvedObject
  type: EventType
  reason: string
  action: string
  message: string
  source: { component: string; host: string }
  reportingComponent: string
  reportingInstance: string
  firstTimestamp: string
  lastTimestamp: string
  eventTime: string
  count: number
  series?: { count: number; lastObservedTime: string }
}

// ---------- helpers ----------

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!
}

function hex(n: number): string {
  let out = ''
  for (let i = 0; i < n; i += 1) out += Math.floor(Math.random() * 16).toString(16)
  return out
}

function uuid(): string {
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${pick(['8', '9', 'a', 'b'])}${hex(3)}-${hex(12)}`
}

function podSuffix(): string {
  return `${Math.random().toString(36).slice(2, 12)}-${Math.random().toString(36).slice(2, 7)}`
}

function isoOffset(secondsAgo: number): string {
  return new Date(Date.now() - secondsAgo * 1000).toISOString()
}

// ---------- pools ----------

const NAMESPACES = ['default', 'kube-system', 'monitoring', 'ingress-nginx', 'apps', 'cert-manager', 'observability']
const NODES = ['ip-10-0-1-23.ec2.internal', 'ip-10-0-2-47.ec2.internal', 'ip-10-0-3-91.ec2.internal', 'ip-10-0-4-12.ec2.internal']
const IMAGES = [
  'nginx:1.25.3-alpine',
  'redis:7.2.4-bookworm',
  'postgres:16.1-bullseye',
  'ghcr.io/clastix/capsule:v0.7.0',
  'registry.k8s.io/coredns/coredns:v1.11.1',
  'quay.io/prometheus/prometheus:v2.51.0',
  'docker.io/library/node:20.11.1-alpine',
]
const POD_BASES = ['nginx', 'api', 'worker', 'redis', 'postgres', 'capsule', 'coredns', 'prometheus', 'cert-manager']
const KINDS: Kind[] = ['Pod', 'Deployment', 'Node', 'Service', 'ConfigMap']
const API_VERSIONS: Record<Kind, string> = {
  Pod: 'v1', Deployment: 'apps/v1', Node: 'v1', Service: 'v1', ConfigMap: 'v1',
}

// ---------- templates ----------

type Ctx = { object: InvolvedObject; image: string; node: string; container: string }

type Template = {
  type: EventType
  reason: string
  action: string
  component: string
  message: (ctx: Ctx) => string
}

const TEMPLATES: Template[] = [
  {
    type: 'Normal', reason: 'Scheduled', action: 'Binding', component: 'default-scheduler',
    message: ({ object, node }) =>
      `Successfully assigned ${object.namespace}/${object.name} to ${node}\n` +
      `  scheduling latency: ${randInt(8, 240)}ms\n` +
      `  preemption: not required, nominated node: <none>`,
  },
  {
    type: 'Normal', reason: 'Pulling', action: 'Pulling', component: 'kubelet',
    message: ({ image }) => `Pulling image "${image}"`,
  },
  {
    type: 'Normal', reason: 'Pulled', action: 'Pulled', component: 'kubelet',
    message: ({ image }) =>
      `Successfully pulled image "${image}" in ${(Math.random() * 12 + 0.3).toFixed(3)}s ` +
      `(${(Math.random() * 12 + 0.3).toFixed(3)}s including waiting). Image size: ${randInt(20, 380)}.${randInt(0, 99)}MB`,
  },
  {
    type: 'Normal', reason: 'Created', action: 'Created', component: 'kubelet',
    message: ({ container }) => `Created container ${container}`,
  },
  {
    type: 'Normal', reason: 'Started', action: 'Started', component: 'kubelet',
    message: ({ container }) => `Started container ${container}`,
  },
  {
    type: 'Warning', reason: 'BackOff', action: 'BackOff', component: 'kubelet',
    message: ({ object, container }) =>
      `Back-off restarting failed container ${container} in pod ${object.name}_${object.namespace}(${object.uid}).\n` +
      `  Container exited with code ${pick([1, 2, 137, 139, 143])}.\n` +
      `  Last termination state: ${pick(['OOMKilled', 'Error', 'ContainerCannotRun'])}.\n` +
      `  Restart count: ${randInt(1, 47)}.\n` +
      `  Last 200 chars of container log:\n` +
      `    panic: runtime error: invalid memory address or nil pointer dereference\n` +
      `    [signal SIGSEGV: segmentation violation code=0x1 addr=0x0 pc=0x${hex(8)}]\n` +
      `    goroutine 1 [running]:\n` +
      `    main.handleRequest(0x${hex(8)}, 0x${hex(8)})\n` +
      `        /app/cmd/server/main.go:${randInt(20, 480)} +0x${hex(3)}`,
  },
  {
    type: 'Warning', reason: 'Unhealthy', action: 'ProbeWarning', component: 'kubelet',
    message: ({ container }) =>
      `${pick(['Liveness', 'Readiness', 'Startup'])} probe failed: ` +
      `HTTP probe failed with statuscode: ${pick([500, 502, 503, 504])}\n` +
      `Probe details: GET "http://10.244.${randInt(0, 5)}.${randInt(2, 250)}:${pick([8080, 8443, 9090])}/healthz" ` +
      `(timeout 1s, period 10s, threshold 3/3)\n` +
      `Response body: {"status":"DOWN","container":"${container}","components":{"db":{"status":"DOWN",` +
      `"details":{"error":"org.postgresql.util.PSQLException: Connection to db:5432 refused"}}}}`,
  },
  {
    type: 'Warning', reason: 'FailedMount', action: 'FailedMount', component: 'kubelet',
    message: ({ object }) =>
      `MountVolume.SetUp failed for volume "${pick(['config', 'tls', 'secrets', 'data'])}" ` +
      `: ${pick(['configmap', 'secret'])} "${object.name}-${pick(['config', 'tls', 'env'])}" not found.\n` +
      `  Last seen mount path: /var/lib/kubelet/pods/${object.uid}/volumes/kubernetes.io~secret/${pick(['config', 'tls'])}\n` +
      `  Underlying error: open /etc/kubernetes/secrets/${object.namespace}/${object.name}: no such file or directory`,
  },
  {
    type: 'Warning', reason: 'Failed', action: 'PullImage', component: 'kubelet',
    message: ({ image }) => {
      const [registry = image] = image.split('/')
      const [repository = image] = image.split(':')
      return `Failed to pull image "${image}": rpc error: code = ${pick(['Unknown', 'NotFound', 'PermissionDenied'])} ` +
        `desc = failed to pull and unpack image "${image}":\n` +
        `  failed to copy: httpReaderSeeker: failed open:\n` +
        `  unexpected status code https://${registry}/v2/${repository}/manifests/sha256:${hex(16)}: ` +
        `${pick([401, 403, 404, 429, 500])} ${pick(['Unauthorized', 'Forbidden', 'Not Found', 'Too Many Requests'])}\n` +
        `  registry response headers: x-ratelimit-remaining=${randInt(0, 10)}, retry-after=${randInt(10, 600)}s`
    },
  },
  {
    type: 'Normal', reason: 'Killing', action: 'Killing', component: 'kubelet',
    message: ({ container, object }) =>
      `Stopping container ${container} (gracePeriodSeconds=${pick([10, 30, 60])}).\n` +
      `  Container received SIGTERM. Process group cleanup in progress.\n` +
      `  preStop hook: ${pick(['exec [/bin/sh, -c, sleep 5]', 'httpGet /shutdown', 'none'])}\n` +
      `  Pod ${object.namespace}/${object.name} entering Terminating state.`,
  },
  {
    type: 'Warning', reason: 'FailedScheduling', action: 'Scheduling', component: 'default-scheduler',
    message: () => {
      const total = randInt(3, 8)
      return `0/${total} nodes are available: ` +
        `${randInt(1, total - 1)} node(s) had untolerated taint {node-role.kubernetes.io/control-plane: }, ` +
        `${randInt(0, 2)} node(s) had volume node affinity conflict, ` +
        `${randInt(1, 3)} Insufficient cpu, ${randInt(0, 2)} Insufficient memory. ` +
        `preemption: 0/${total} nodes are available: ${total} Preemption is not helpful for scheduling.\n` +
        `  Pod resource request: cpu=${pick(['100m', '500m', '1', '2'])}, memory=${pick(['128Mi', '512Mi', '1Gi', '4Gi'])}`
    },
  },
  {
    type: 'Warning', reason: 'NodeNotReady', action: 'NodeStatusUpdate', component: 'node-controller',
    message: ({ node }) =>
      `Node ${node} status is now: NotReady.\n` +
      `  Reason: KubeletNotReady\n` +
      `  Message: runtime network not ready: NetworkReady=false reason:NetworkPluginNotReady ` +
      `message:Network plugin returns error: cni plugin not initialized\n` +
      `  Last heartbeat: ${isoOffset(randInt(30, 240))}\n` +
      `  Conditions: Ready=False, MemoryPressure=False, DiskPressure=False, PIDPressure=False`,
  },
  {
    type: 'Normal', reason: 'ScalingReplicaSet', action: 'ScalingReplicaSet', component: 'deployment-controller',
    message: ({ object }) =>
      `Scaled ${pick(['up', 'down'])} replica set ${object.name}-${hex(10)} to ${randInt(1, 12)} from ${randInt(0, 11)}.`,
  },
]

// ---------- entity pool ----------
// real clusters have a stable set of pods / deployments / nodes that
// each emit many events over their lifetime. we mirror that with a fixed
// pool so events are correlatable: events for the same entity share
// `involvedObject.uid` (and name/namespace/kind). occasional churn replaces
// a random entity to mimic pods being recreated.

type EntityRecord = {
  apiVersion: string
  kind: Kind
  name: string
  namespace: string
  uid: string
  fieldPath?: string
  resourceVersion: number
}

const POOL_SIZE = 30
const CHURN_PROBABILITY = 0.01
const pool: EntityRecord[] = []

function newRecord(): EntityRecord {
  const kind: Kind = Math.random() < 0.7 ? 'Pod' : pick(KINDS)
  const base = pick(POD_BASES)
  const name = kind === 'Pod' ? `${base}-${podSuffix()}` : base
  const namespace = pick(NAMESPACES)
  return {
    apiVersion: API_VERSIONS[kind],
    kind,
    name,
    namespace,
    uid: uuid(),
    ...(kind === 'Pod' ? { fieldPath: `spec.containers{${base}}` } : {}),
    resourceVersion: randInt(100_000, 9_999_999),
  }
}

// pick a stable entity (with rare churn). bumps its resourceVersion, since
// each event implies the object's state observably changed.
function getEntity(): InvolvedObject {
  let record: EntityRecord
  if (pool.length < POOL_SIZE) {
    record = newRecord()
    pool.push(record)
  } else if (Math.random() < CHURN_PROBABILITY) {
    const idx = Math.floor(Math.random() * pool.length)
    record = newRecord()
    pool[idx] = record
  } else {
    record = pool[Math.floor(Math.random() * pool.length)]!
  }
  record.resourceVersion += 1
  return {
    apiVersion: record.apiVersion,
    kind: record.kind,
    name: record.name,
    namespace: record.namespace,
    uid: record.uid,
    resourceVersion: String(record.resourceVersion),
    ...(record.fieldPath ? { fieldPath: record.fieldPath } : {}),
  }
}

let counter = 0
export function nextId(): string {
  counter += 1
  return `evt_${Date.now().toString(36)}_${counter.toString(36)}`
}

export function buildEvent(): LogEvent {
  const tpl = pick(TEMPLATES)
  const object = getEntity()
  const node = object.kind === 'Node' ? object.name : pick(NODES)
  const image = pick(IMAGES)
  const container = object.name.split('-')[0] ?? 'main'
  const now = new Date()
  const nowIso = now.toISOString()
  const id = nextId()
  const count = Math.random() < 0.25 ? randInt(2, 14) : 1
  const first = new Date(now.getTime() - randInt(0, 600) * 1000)
  return {
    apiVersion: 'v1',
    kind: 'Event',
    metadata: {
      name: `${object.name}.${hex(16)}`,
      namespace: object.namespace,
      uid: uuid(),
      resourceVersion: String(randInt(100_000, 9_999_999)),
      creationTimestamp: nowIso,
    },
    id,
    involvedObject: object,
    type: tpl.type,
    reason: tpl.reason,
    action: tpl.action,
    message: tpl.message({ object, image, node, container }),
    source: { component: tpl.component, host: node },
    reportingComponent: tpl.component,
    reportingInstance: node,
    firstTimestamp: first.toISOString(),
    lastTimestamp: nowIso,
    eventTime: nowIso,
    count,
    ...(count > 1 ? { series: { count, lastObservedTime: nowIso } } : {}),
  }
}

// ---------- malformation ----------

const MALFORM_STRATEGIES = [
  (s: string) => s.slice(0, -1), // drop trailing brace
  (s: string) => s.replace(/"([a-zA-Z_]+)":/, '$1:'), // remove quotes from first key
  (s: string) => s.replace(/:\s*(\d+)/, ': NaN'), // NaN where a number should be
  (s: string) => s.replace(/\}$/, ',}'), // stray trailing comma
  (s: string) => s.slice(0, Math.max(8, Math.floor(s.length * (0.3 + Math.random() * 0.5)))), // truncate mid-token
  (s: string) => {
    const i = Math.max(10, Math.floor(s.length / 2))
    return s.slice(0, i) + ',,' + s.slice(i)
  },
]

export function malform(json: string): string {
  return pick(MALFORM_STRATEGIES)(json)
}

export function serialize(event: LogEvent, malformedProbability: number): string {
  const clean = JSON.stringify(event)
  if (malformedProbability > 0 && Math.random() < malformedProbability) {
    return malform(clean)
  }
  return clean
}
