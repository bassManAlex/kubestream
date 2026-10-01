// A small fixed set of fake objects, so the same involvedObject.uid keeps
// coming back. Events look like corev1.Event plus a top-level `id`, the
// cursor for GET /events?since=.

import { randomUUID } from "node:crypto";

export type EventType = "Normal" | "Warning";

export interface ObjectRef {
  apiVersion: string;
  kind: string;
  name: string;
  namespace: string;
  uid: string;
  resourceVersion: string;
  fieldPath?: string;
}

export interface KubeEvent {
  id: string;
  apiVersion: "v1";
  kind: "Event";
  metadata: {
    name: string;
    namespace: string;
    uid: string;
    resourceVersion: string;
    creationTimestamp: string;
  };
  involvedObject: ObjectRef;
  type: EventType;
  reason: string;
  action: string;
  message: string;
  source: { component: string; host: string };
  reportingComponent: string;
  reportingInstance: string;
  firstTimestamp: string;
  lastTimestamp: string;
  eventTime: string;
  count: number;
  series?: { count: number; lastObservedTime: string };
}

export const between = (min: number, max: number): number =>
  min + Math.floor(Math.random() * (max - min + 1));

export const oneOf = <T>(items: readonly T[]): T =>
  items[Math.floor(Math.random() * items.length)] as T;

const suffix = (length: number): string =>
  Array.from({ length }, () =>
    oneOf("bcdfghjklmnpqrstvwxz2456789".split("")),
  ).join("");

export const NAMESPACES = [
  "default",
  "kube-system",
  "payments",
  "search",
  "observability",
  "ingress",
  "batch",
];
const NODES = ["worker-a1", "worker-a2", "worker-b1", "worker-b2", "worker-c1"];
const IMAGES = [
  "nginx:1.27-alpine",
  "redis:7.4",
  "postgres:17",
  "grafana/loki:3.1.0",
  "envoyproxy/envoy:v1.31.0",
  "busybox:1.36",
];
const APPS = ["checkout", "catalog", "indexer", "gateway", "ledger", "mailer"];

interface Tracked {
  ref: ObjectRef;
  version: number;
  container: string;
}

type Kind =
  | "Pod"
  | "Deployment"
  | "ReplicaSet"
  | "Node"
  | "Job"
  | "PersistentVolumeClaim";

function makeObject(kind: Kind, preferredNamespace?: string): Tracked {
  const app = oneOf(APPS);
  const namespace =
    kind === "Node" ? "default" : (preferredNamespace ?? oneOf(NAMESPACES));
  const names: Record<Kind, () => string> = {
    Pod: () => `${app}-${suffix(9)}-${suffix(5)}`,
    Deployment: () => app,
    ReplicaSet: () => `${app}-${suffix(9)}`,
    Node: () => oneOf(NODES),
    Job: () => `${app}-backfill-${between(28_000_000, 29_000_000)}`,
    PersistentVolumeClaim: () => `data-${app}-${between(0, 2)}`,
  };
  const apiVersions: Record<Kind, string> = {
    Pod: "v1",
    Deployment: "apps/v1",
    ReplicaSet: "apps/v1",
    Node: "v1",
    Job: "batch/v1",
    PersistentVolumeClaim: "v1",
  };
  return {
    ref: {
      apiVersion: apiVersions[kind],
      kind,
      name: names[kind](),
      namespace,
      uid: randomUUID(),
      resourceVersion: "0",
      ...(kind === "Pod" ? { fieldPath: `spec.containers{${app}}` } : {}),
    },
    version: between(10_000, 900_000),
    container: app,
  };
}

const KIND_WEIGHTS: Kind[] = [
  "Pod",
  "Pod",
  "Pod",
  "Pod",
  "Pod",
  "Pod",
  "Deployment",
  "ReplicaSet",
  "Node",
  "Job",
  "PersistentVolumeClaim",
];
// Nodes always land in "default", so they can't stand for another namespace
const NAMESPACED_KINDS = KIND_WEIGHTS.filter((kind) => kind !== "Node");
const POPULATION = 24;
const REPLACE_CHANCE = 0.02;
const population: Tracked[] = [];

// Picks a tracked object, now and then replacing one (a pod rescheduled under
// a new uid). Every event bumps the object's resourceVersion.
function pickObject(): Tracked {
  let tracked: Tracked;
  if (population.length < POPULATION) {
    // the first fill cycles through the namespaces so each one is present
    // from the first events on
    const namespace = NAMESPACES[population.length % NAMESPACES.length];
    const kinds =
      population.length < NAMESPACES.length ? NAMESPACED_KINDS : KIND_WEIGHTS;
    tracked = makeObject(oneOf(kinds), namespace);
    population.push(tracked);
  } else {
    const index = between(0, population.length - 1);
    if (Math.random() < REPLACE_CHANCE) {
      population[index] = makeObject(oneOf(KIND_WEIGHTS));
    }
    tracked = population[index] as Tracked;
  }
  tracked.version += 1;
  tracked.ref = { ...tracked.ref, resourceVersion: String(tracked.version) };
  return tracked;
}

interface Template {
  kinds: Kind[];
  type: EventType;
  reason: string;
  action: string;
  component: string;
  message: (object: Tracked, node: string) => string;
}

const TEMPLATES: Template[] = [
  {
    kinds: ["Pod"],
    type: "Normal",
    reason: "Scheduled",
    action: "Binding",
    component: "default-scheduler",
    message: ({ ref }, node) =>
      `Assigned ${ref.namespace}/${ref.name} to ${node} after scoring ${between(3, 9)} feasible nodes`,
  },
  {
    kinds: ["Pod"],
    type: "Normal",
    reason: "Pulled",
    action: "Pulled",
    component: "kubelet",
    message: () =>
      `Image "${oneOf(IMAGES)}" ready in ${(Math.random() * 8 + 0.2).toFixed(2)}s (${between(12, 420)} MB)`,
  },
  {
    kinds: ["Pod"],
    type: "Normal",
    reason: "Started",
    action: "Started",
    component: "kubelet",
    message: ({ container }) => `Container ${container} is running`,
  },
  {
    kinds: ["Deployment"],
    type: "Normal",
    reason: "ScalingReplicaSet",
    action: "Scaling",
    component: "deployment-controller",
    message: ({ ref }) => {
      const from = between(1, 8);
      const to = Math.max(0, from + oneOf([-2, -1, 1, 2, 3]));
      return `Replica count for ${ref.name} changed from ${from} to ${to}`;
    },
  },
  {
    kinds: ["Job"],
    type: "Normal",
    reason: "Completed",
    action: "Completed",
    component: "job-controller",
    message: () =>
      `All ${between(1, 6)} pods finished; ${between(1_000, 90_000)} records processed`,
  },
  {
    kinds: ["Pod"],
    type: "Warning",
    reason: "BackOff",
    action: "Restarting",
    component: "kubelet",
    message: ({ container }) =>
      [
        `Container ${container} keeps exiting; next restart in ${oneOf([10, 20, 40, 80, 160, 300])}s`,
        `  exit code: ${oneOf([1, 2, 137, 139])}`,
        `  restarts so far: ${between(2, 60)}`,
        `  last log line: ${oneOf([
          'fatal: could not connect to "db:5432": connection refused',
          "panic: assignment to entry in nil map",
          "Error: ENOMEM: not enough memory, read",
          "java.lang.OutOfMemoryError: Java heap space",
        ])}`,
      ].join("\n"),
  },
  {
    kinds: ["Pod"],
    type: "Warning",
    reason: "Unhealthy",
    action: "Probing",
    component: "kubelet",
    message: ({ container }) =>
      [
        `${oneOf(["Readiness", "Liveness"])} check for ${container} failed ${between(3, 5)} times in a row`,
        `  GET http://10.42.${between(0, 9)}.${between(2, 254)}:${oneOf([8080, 9000])}/healthz -> ${oneOf([500, 503, "timeout after 1s"])}`,
      ].join("\n"),
  },
  {
    kinds: ["Pod"],
    type: "Warning",
    reason: "FailedScheduling",
    action: "Scheduling",
    component: "default-scheduler",
    message: () => {
      const total = NODES.length;
      return [
        `No node fits this pod (0/${total} available)`,
        `  ${between(1, total)} node(s) short on memory`,
        `  ${between(0, 2)} node(s) with a taint the pod does not tolerate`,
      ].join("\n");
    },
  },
  {
    kinds: ["Pod"],
    type: "Warning",
    reason: "FailedMount",
    action: "Mounting",
    component: "kubelet",
    message: ({ ref }) =>
      `Volume "${oneOf(["certs", "settings", "cache"])}" for ${ref.name} not attached: secret "${ref.name}-${oneOf(["tls", "env"])}" does not exist`,
  },
  {
    kinds: ["Node"],
    type: "Warning",
    reason: "NodePressure",
    action: "Evaluating",
    component: "node-controller",
    message: (_object, node) =>
      [
        `Node ${node} reports ${oneOf(["MemoryPressure", "DiskPressure", "PIDPressure"])}`,
        `  usage: ${between(85, 99)}% of allocatable`,
        `  pods at risk of eviction: ${between(1, 12)}`,
      ].join("\n"),
  },
  {
    kinds: ["ReplicaSet"],
    type: "Normal",
    reason: "SuccessfulCreate",
    action: "Creating",
    component: "replicaset-controller",
    message: ({ ref }) => `Created pod ${ref.name}-${suffix(5)}`,
  },
  {
    kinds: ["PersistentVolumeClaim"],
    type: "Warning",
    reason: "ProvisioningFailed",
    action: "Provisioning",
    component: "persistentvolume-controller",
    message: ({ ref }) =>
      `Could not provision ${between(1, 50)}Gi for ${ref.name}: storage class "${oneOf(["fast-ssd", "standard"])}" has no capacity left`,
  },
  {
    kinds: ["PersistentVolumeClaim"],
    type: "Normal",
    reason: "ProvisioningSucceeded",
    action: "Provisioning",
    component: "persistentvolume-controller",
    message: ({ ref }) =>
      `Bound ${ref.name} to a new ${between(1, 50)}Gi volume`,
  },
];

const secondsAgo = (seconds: number): string =>
  new Date(Date.now() - seconds * 1000).toISOString();

export function buildEvent(id: string): KubeEvent {
  const object = pickObject();
  const kind = object.ref.kind as Kind;
  const template = oneOf(TEMPLATES.filter((t) => t.kinds.includes(kind)));
  const node = object.ref.kind === "Node" ? object.ref.name : oneOf(NODES);
  const now = new Date().toISOString();
  const count = Math.random() < 0.2 ? between(2, 25) : 1;
  return {
    id,
    apiVersion: "v1",
    kind: "Event",
    metadata: {
      name: `${object.ref.name}.${suffix(12)}`,
      namespace: object.ref.namespace,
      uid: randomUUID(),
      resourceVersion: String(between(1_000_000, 9_000_000)),
      creationTimestamp: now,
    },
    involvedObject: object.ref,
    type: template.type,
    reason: template.reason,
    action: template.action,
    message: template.message(object, node),
    source: { component: template.component, host: node },
    reportingComponent: template.component,
    reportingInstance: node,
    firstTimestamp: count > 1 ? secondsAgo(between(30, 900)) : now,
    lastTimestamp: now,
    eventTime: now,
    count,
    ...(count > 1 ? { series: { count, lastObservedTime: now } } : {}),
  };
}
