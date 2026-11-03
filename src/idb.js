const NAME = 'gba-cache';
const VERSION = 3;

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('roms')) db.createObjectStore('roms');
      if (!db.objectStoreNames.contains('sram')) db.createObjectStore('sram');
      if (!db.objectStoreNames.contains('states')) db.createObjectStore('states');
      if (!db.objectStoreNames.contains('cheats')) db.createObjectStore('cheats');
      // v3: screenshots for save states, kept on this device only
      if (!db.objectStoreNames.contains('thumbs')) db.createObjectStore('thumbs');
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { db.close(); dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => { dbPromise = null; reject(req.error); };
    req.onblocked = () => { /* another tab holds an older version; it closes on versionchange */ };
  });
  return dbPromise;
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

export function idbDelete(store, key) {
  return withStore(store, 'readwrite', (os) => os.delete(key));
}

export function idbKeys(store) {
  return withStore(store, 'readonly', (os) => os.getAllKeys());
}
