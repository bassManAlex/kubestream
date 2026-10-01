import { EventSnapshotSchema, type EventSnapshot } from "../types";

export type { EventSnapshot };

const DB_NAME = "kubestream";
const DB_VERSION = 1;
const STORE_NAME = "snapshot";
const SNAPSHOT_KEY = "events";

let dbPromise: Promise<IDBDatabase> | null = null;

// Shared connection. Forgotten on open failure, versionchange or close, so
// the next call reopens it.
function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  const promise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => {
      const db = request.result;
      const forget = () => {
        if (dbPromise === promise) dbPromise = null;
      };
      db.onversionchange = () => {
        db.close();
        forget();
      };
      db.onclose = forget;
      resolve(db);
    };
    request.onerror = () => reject(request.error);
  });
  dbPromise = promise;
  promise.catch(() => {
    if (dbPromise === promise) dbPromise = null;
  });
  return promise;
}

// missing or stale snapshot -> null, start empty
export function parseSnapshot(value: unknown): EventSnapshot | null {
  const parsed = EventSnapshotSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

// never blocks startup: any IndexedDB problem just means no snapshot
export async function loadSnapshot(): Promise<EventSnapshot | null> {
  try {
    const db = await openDb();
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(SNAPSHOT_KEY);
      req.onsuccess = () => resolve(parseSnapshot(req.result));
      req.onerror = () => resolve(null);
      tx.onabort = () => resolve(null);
    });
  } catch {
    return null;
  }
}

// errors are ignored, the next save tries again
export async function saveSnapshot(snapshot: EventSnapshot): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(snapshot, SNAPSHOT_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      // a quota error can abort the transaction without an error event
      tx.onabort = () => resolve();
    });
  } catch {
    // no IndexedDB (private mode, quota...): skip
  }
}
