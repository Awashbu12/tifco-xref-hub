const DB_NAME = "route-tracker-db";
const DB_VERSION = 1;

export const STORES = {
  customers: "customers",
  visits: "visits",
};

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;

      if (!db.objectStoreNames.contains(STORES.customers)) {
        const s = db.createObjectStore(STORES.customers, { keyPath: "id" });
        s.createIndex("name", "name", { unique: false });
        s.createIndex("nextDue", "nextDue", { unique: false });
        s.createIndex("active", "active", { unique: false });
      }

      if (!db.objectStoreNames.contains(STORES.visits)) {
        const s = db.createObjectStore(STORES.visits, { keyPath: "id" });
        s.createIndex("customerId", "customerId", { unique: false });
        s.createIndex("visitDate", "visitDate", { unique: false });
        s.createIndex("nextDue", "nextDue", { unique: false });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, storeName, mode = "readonly") {
  return db.transaction(storeName, mode).objectStore(storeName);
}

export async function dbPut(storeName, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = tx(db, storeName, "readwrite").put(value);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

export async function dbGetAll(storeName) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = tx(db, storeName).getAll();
    req.onsuccess = () => resolve(req.result ?? []);
    req.onerror = () => reject(req.error);
  });
}

export async function dbClear(storeName) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = tx(db, storeName, "readwrite").clear();
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

export async function exportAll() {
  const [customers, visits] = await Promise.all([
    dbGetAll(STORES.customers),
    dbGetAll(STORES.visits),
  ]);
  return { version: DB_VERSION, exportedAt: new Date().toISOString(), customers, visits };
}

export async function importAll(payload) {
  if (!payload || !Array.isArray(payload.customers) || !Array.isArray(payload.visits)) {
    throw new Error("Invalid import file.");
  }
  await Promise.all([dbClear(STORES.customers), dbClear(STORES.visits)]);
  for (const c of payload.customers) await dbPut(STORES.customers, c);
  for (const v of payload.visits) await dbPut(STORES.visits, v);
}
