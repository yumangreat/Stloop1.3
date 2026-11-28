const DB_NAME = 'StudyLoopImages_v1';
const STORE_NAME = 'images';
const IDB_PREFIX = 'idb:';

let dbPromise = null;
const memoryCache = new Map();

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
  }).catch((err) => {
    console.warn('IndexedDB fallback:', err);
    return null;
  });
  return dbPromise;
}

export function isIdbRef(ref) {
  return typeof ref === 'string' && ref.startsWith(IDB_PREFIX);
}

export async function saveImage(dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string') return '';
  if (isIdbRef(dataUrl)) return dataUrl;

  const db = await openDB();
  if (!db) return dataUrl; // Graceful fallback to inline DataURL

  const id = `img_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const ref = `${IDB_PREFIX}${id}`;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(dataUrl, id);
      tx.oncomplete = () => {
        memoryCache.set(ref, dataUrl);
        resolve(ref);
      };
      tx.onerror = () => resolve(dataUrl);
    } catch (_) {
      resolve(dataUrl);
    }
  });
}

export async function getImageUrl(ref) {
  if (!ref || typeof ref !== 'string') return '';
  if (!isIdbRef(ref)) return ref;
  if (memoryCache.has(ref)) return memoryCache.get(ref);

  const db = await openDB();
  if (!db) return '';

  const id = ref.slice(IDB_PREFIX.length);
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(id);
      req.onsuccess = () => {
        const val = typeof req.result === 'string' ? req.result : '';
        if (val) memoryCache.set(ref, val);
        resolve(val);
      };
      req.onerror = () => resolve('');
    } catch (_) {
      resolve('');
    }
  });
}

export async function deleteImage(ref) {
  if (!isIdbRef(ref)) return;
  memoryCache.delete(ref);
  const db = await openDB();
  if (!db) return;
  const id = ref.slice(IDB_PREFIX.length);
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch (_) {
      resolve();
    }
  });
}

export async function exportImageMap(decks) {
  const map = {};
  const refs = new Set();
  for (const deck of decks || []) {
    for (const card of deck.cards || []) {
      if (card.image && isIdbRef(card.image)) {
        refs.add(card.image);
      }
    }
  }
  for (const ref of refs) {
    const dataUrl = await getImageUrl(ref);
    if (dataUrl) map[ref] = dataUrl;
  }
  return map;
}

export async function migrateInlineImages(appData, onMigrated) {
  const db = await openDB();
  if (!db) return;
  let changed = false;
  for (const deck of appData.decks || []) {
    for (const card of deck.cards || []) {
      if (card.image && card.image.startsWith('data:image/')) {
        const ref = await saveImage(card.image);
        if (isIdbRef(ref)) {
          card.image = ref;
          changed = true;
        }
      }
    }
  }
  if (changed && typeof onMigrated === 'function') {
    onMigrated();
  }
}

export function compressImageFile(file, maxWidth = 900, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('File read failed'));
    reader.onload = (ev) => {
      const img = new Image();
      img.onerror = () => reject(new Error('Image decode failed'));
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.width);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });
}
