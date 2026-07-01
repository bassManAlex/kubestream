import type { ParsedEvent } from "../types";

const DB_NAME = "kubestream";
const DB_VERSION = 1;
const STORE_NAME = "snapshot";
const SNAPSHOT_KEY = "events";

export interface EventSnapshot {
  events: ParsedEvent[];
  cursor: string | null;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Best-effort: a corrupt or unavailable IndexedDB should never block startup.
export async function loadSnapshot(): Promise<EventSnapshot | null> {
  try {
    const db = await openDb();
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(SNAPSHOT_KEY);
      req.onsuccess = () => resolve((req.result as EventSnapshot) ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

// Fire-and-forget: callers debounce, so write failures are silently dropped.
export async function saveSnapshot(snapshot: EventSnapshot): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(snapshot, SNAPSHOT_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // IndexedDB unavailable (private browsing, quota, ...): skip persistence.
  }
}
