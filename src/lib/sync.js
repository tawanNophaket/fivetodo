import PouchDB from "pouchdb-browser";

const LOCAL_DB = "fivetodo_tasks_v1";
let db;
let liveSyncCancel = null;

function getDB() {
  if (!db) db = new PouchDB(LOCAL_DB);
  return db;
}

export async function syncInit() {
  getDB();
}

export async function loadAllTasks() {
  const d = getDB();
  const res = await d.allDocs({ include_docs: true });
  return res.rows
    .filter((r) => r.doc && r.doc.type === "task")
    .map((r) => r.doc.payload);
}

export async function upsertTasks(tasks) {
  const d = getDB();
  const now = new Date().toISOString();
  const docs = tasks.map((t) => ({
    _id: `task:${t.id}`,
    type: "task",
    updatedAt: now,
    payload: t,
  }));
  // Fetch existing revs to prevent conflicts on bulkDocs
  const existing = await d.allDocs({ keys: docs.map((x) => x._id) });
  const withRev = docs.map((doc) => {
    const row = existing.rows.find((r) => r.key === doc._id);
    return row && row.value && row.value.rev
      ? { ...doc, _rev: row.value.rev }
      : doc;
  });
  await d.bulkDocs(withRev);
}

export async function removeTasks(ids) {
  const d = getDB();
  const keys = ids.map((id) => `task:${id}`);
  const res = await d.allDocs({ keys });
  const dels = res.rows
    .filter((r) => r.value && r.value.rev)
    .map((r) => ({ _id: r.key, _rev: r.value.rev, _deleted: true }));
  if (dels.length) await d.bulkDocs(dels);
}

export function isConnected() {
  try {
    const cfg = JSON.parse(localStorage.getItem("sync_remote") || "null");
    return !!cfg?.url;
  } catch {
    return false;
  }
}

export function getRemoteConfig() {
  try {
    return JSON.parse(localStorage.getItem("sync_remote") || "null");
  } catch {
    return null;
  }
}

export function setRemoteConfig(cfg) {
  localStorage.setItem("sync_remote", JSON.stringify(cfg || null));
}

export function startLiveSync() {
  const cfg = getRemoteConfig();
  if (!cfg?.url) return;
  const d = getDB();
  const remote = new PouchDB(cfg.url, cfg.options || {});
  // cancel previous
  if (liveSyncCancel) liveSyncCancel();
  const push = d.replicate.to(remote, { live: true, retry: true });
  const pull = d.replicate.from(remote, { live: true, retry: true });
  const cancel = () => {
    push.cancel();
    pull.cancel();
    liveSyncCancel = null;
  };
  liveSyncCancel = cancel;
  return cancel;
}

export function stopLiveSync() {
  if (liveSyncCancel) liveSyncCancel();
}

// Convenience wrappers for app integration
export async function mirrorFromAppTasks(tasks) {
  await upsertTasks(tasks);
}

export async function fetchIntoAppTasks() {
  return await loadAllTasks();
}
