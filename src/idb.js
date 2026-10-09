const NAME = 'gba-cache';
const VERSION = 1;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('roms')) db.createObjectStore('roms');
      if (!db.objectStoreNames.contains('sram')) db.createObjectStore('sram');
      if (!db.objectStoreNames.contains('states')) db.createObjectStore('states');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore(store, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const os = tx.objectStore(store);
    const req = fn(os);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function idbGet(store, key) {
  return withStore(store, 'readonly', (os) => os.get(key));
}

export function idbSet(store, key, value) {
  return withStore(store, 'readwrite', (os) => os.put(value, key));
}
