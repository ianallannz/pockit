// ── Vault handle persistence ─────────────────────────────────
// A chosen FileSystemDirectoryHandle is structured-cloneable but not
// JSON-serializable, so it can't live in localStorage — IndexedDB is the
// standard place browsers let you park one across reloads.
const DB_NAME = 'pockit-vault';
const STORE_NAME = 'handles';
const HANDLE_KEY = 'vault-directory';

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const request = fn(tx.objectStore(STORE_NAME));
    tx.oncomplete = () => resolve(request?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function saveHandle(handle) {
  await withStore('readwrite', store => store.put(handle, HANDLE_KEY));
}

export async function loadHandle() {
  return (await withStore('readonly', store => store.get(HANDLE_KEY))) || null;
}

export async function clearHandle() {
  await withStore('readwrite', store => store.delete(HANDLE_KEY));
}
