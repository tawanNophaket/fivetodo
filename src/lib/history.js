// Simple IndexedDB wrapper for autosave history snapshots
const DB_NAME = "fivetodo";
const DB_VERSION = 1;
const STORE = "history";

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, {
          keyPath: "id",
          autoIncrement: true,
        });
        store.createIndex("by_time", "ts");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveSnapshot(payload, { max = 50 } = {}) {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    store.add({ ts: Date.now(), payload });
    await new Promise((res, rej) => {
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
      tx.onabort = () => rej(tx.error);
    });

    // prune old snapshots beyond max
    const db2 = await openDB();
    const tx2 = db2.transaction(STORE, "readwrite");
    const idx = tx2.objectStore(STORE).index("by_time");
    const items = [];
    await new Promise((res, rej) => {
      const cursorReq = idx.openCursor(null, "prev");
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (cursor) {
          items.push({ key: cursor.primaryKey, value: cursor.value });
          cursor.continue();
        } else {
          res();
        }
      };
      cursorReq.onerror = () => rej(cursorReq.error);
    });
    if (items.length > max) {
      const toDelete = items.slice(max);
      await Promise.all(
        toDelete.map(
          (entry) =>
            new Promise((res, rej) => {
              const delTx = db2.transaction(STORE, "readwrite");
              delTx.objectStore(STORE).delete(entry.key);
              delTx.oncomplete = () => res();
              delTx.onerror = () => rej(delTx.error);
            })
        )
      );
    }
  } catch (e) {
    console.warn("saveSnapshot failed", e);
  }
}

export async function listSnapshots(limit = 20) {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE, "readonly");
    const idx = tx.objectStore(STORE).index("by_time");
    const out = [];
    await new Promise((res, rej) => {
      const cursorReq = idx.openCursor(null, "prev");
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (cursor && out.length < limit) {
          out.push(cursor.value);
          cursor.continue();
        } else {
          res();
        }
      };
      cursorReq.onerror = () => rej(cursorReq.error);
    });
    return out;
  } catch (e) {
    console.warn("listSnapshots failed", e);
    return [];
  }
}

export async function restoreLatest() {
  const [latest] = await listSnapshots(1);
  return latest?.payload ?? null;
}

export async function requestPersistentStorage() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      const persisted = await navigator.storage.persist();
      return persisted;
    }
  } catch (e) {
    console.warn("persist() failed", e);
  }
  return false;
}
