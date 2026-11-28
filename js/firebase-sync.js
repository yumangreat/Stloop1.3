import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-app.js';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut,
  onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js';
import {
  getFirestore,
  doc,
  getDoc,
  setDoc
} from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js';

const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyBksYr43vAQBckzLLDQhR9XcURHfpJ7fkQ',
  authDomain: 'studyloop-86550.firebaseapp.com',
  projectId: 'studyloop-86550',
  storageBucket: 'studyloop-86550.firebasestorage.app',
  messagingSenderId: '141291674949',
  appId: '1:141291674949:web:86412b03a6f512e08fb22c',
  measurementId: 'G-W5T04Q58E6'
};

const SYNC_META_KEY = 'studyloop_firebase_sync_meta_v1';
const MAX_DOC_BYTES = 950 * 1024; // Safety margin under Firestore 1 MiB limit

const app = initializeApp(FIREBASE_CONFIG);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: 'select_account' });

export function loadSyncMeta(uid = '') {
  try {
    const raw = localStorage.getItem(SYNC_META_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      const lastByUid = p.lastSyncedByUid && typeof p.lastSyncedByUid === 'object'
        ? p.lastSyncedByUid
        : {};
      return {
        autoSync: p.autoSync !== false,
        lastSyncedAt: uid ? Number(lastByUid[uid] || 0) : 0,
        lastSyncedByUid: lastByUid
      };
    }
  } catch (_) {}
  return { autoSync: true, lastSyncedAt: 0, lastSyncedByUid: {} };
}

export function saveSyncMeta({ autoSync, uid, lastSyncedAt }) {
  try {
    const current = loadSyncMeta(uid);
    const nextAuto = typeof autoSync === 'boolean' ? autoSync : current.autoSync;
    const nextMap = { ...current.lastSyncedByUid };
    if (uid && typeof lastSyncedAt === 'number') {
      nextMap[uid] = lastSyncedAt;
    }
    localStorage.setItem(SYNC_META_KEY, JSON.stringify({
      autoSync: nextAuto,
      lastSyncedByUid: nextMap
    }));
  } catch (_) {}
}

export function getCurrentUser() {
  return auth.currentUser;
}

export function watchAuthState(callback) {
  return onAuthStateChanged(auth, callback);
}

export async function consumeRedirectSignIn() {
  try {
    return await getRedirectResult(auth);
  } catch (err) {
    throw new Error(formatFirebaseError(err));
  }
}

export async function signInWithGoogle() {
  try {
    const res = await signInWithPopup(auth, provider);
    return { user: res.user, redirected: false };
  } catch (err) {
    const code = err?.code || '';
    if (
      code === 'auth/popup-blocked' ||
      code === 'auth/operation-not-supported-in-this-environment'
    ) {
      await signInWithRedirect(auth, provider);
      return { user: null, redirected: true };
    }
    throw new Error(formatFirebaseError(err));
  }
}

export async function signOutGoogle() {
  await signOut(auth);
}

export function formatFirebaseError(err) {
  const code = String(err?.code || '');
  const msg = String(err?.message || err || '');

  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
    return 'ログインがキャンセルされました。';
  }
  if (code === 'auth/unauthorized-domain') {
    return `このドメイン（${window.location.hostname}）が Firebase の「承認済みドメイン」に登録されていません。Authentication → 設定 → 承認済みドメイン に追加してください。`;
  }
  if (code === 'auth/operation-not-allowed') {
    return 'Firebase で Google ログインが有効になっていません。Authentication → Sign-in method で Google を有効にしてください。';
  }
  if (code === 'auth/network-request-failed') {
    return 'ネットワークに接続できませんでした。通信環境を確認してください。';
  }
  if (code === 'permission-denied' || msg.includes('Missing or insufficient permissions')) {
    return 'Firestore へのアクセスが拒否されました。Firestore Database の「ルール」タブで保護ルールが公開されているか確認してください。';
  }
  if (code === 'unavailable' || code === 'failed-precondition') {
    return 'Firestore に接続できませんでした。データベースが作成済みか・通信環境を確認してください。';
  }
  return msg || 'クラウド同期エラーが発生しました。';
}

/**
 * Strips heavy local image refs from cloud payload
 * (local IndexedDB images are preserved by card.id on merge/pull).
 */
export function buildCloudPayload(appData) {
  const cleanDecks = (appData.decks || []).map((d) => ({
    id: d.id,
    folderId: d.folderId || '',
    title: d.title,
    cards: (d.cards || []).map((c) => ({
      id: c.id,
      category: c.category || '一般',
      front: c.front || '',
      back: c.back || '',
      hint: c.hint || '',
      correctCount: Number(c.correctCount || 0),
      wrongCount: Number(c.wrongCount || 0),
      pinned: Boolean(c.pinned),
      srsLevel: Number(c.srsLevel || 0),
      nextReview: Number(c.nextReview || 0),
      lockedIndices: Array.isArray(c.lockedIndices) ? c.lockedIndices : [],
      lockedIndicesReverse: Array.isArray(c.lockedIndicesReverse) ? c.lockedIndicesReverse : []
    }))
  }));

  return {
    format: 'studyloop_firebase_sync_v1',
    updatedAt: Number(appData.updatedAt || Date.now()),
    data: {
      activeDeckId: appData.activeDeckId || '',
      examDate: appData.examDate || '',
      theme: appData.theme || 'light',
      unorderedEnabled: appData.unorderedEnabled !== false,
      unorderedDelimiters: appData.unorderedDelimiters || '',
      preferences: appData.preferences || {},
      studyLog: appData.studyLog || {},
      folders: appData.folders || [],
      decks: cleanDecks
    }
  };
}

function getUserSyncDocRef(uid) {
  return doc(db, 'users', uid, 'sync', 'main');
}

export async function fetchCloudSnapshot(uid) {
  try {
    const snap = await getDoc(getUserSyncDocRef(uid));
    if (!snap.exists()) return null;
    const raw = snap.data();
    if (!raw) return null;

    // Stored as JSON string inside `payloadJson` to avoid nested-array / field-name limits
    let parsed;
    if (typeof raw.payloadJson === 'string') {
      parsed = JSON.parse(raw.payloadJson);
    } else if (raw.data && Array.isArray(raw.data.decks)) {
      parsed = raw;
    } else {
      return null;
    }

    if (!parsed || !parsed.data || !Array.isArray(parsed.data.decks)) {
      throw new Error('クラウドデータの形式が不正です');
    }
    return {
      updatedAt: Number(parsed.updatedAt || raw.updatedAt || 0),
      data: parsed.data
    };
  } catch (err) {
    throw new Error(formatFirebaseError(err));
  }
}

export async function pushCloudSnapshot(uid, appData) {
  const payload = buildCloudPayload(appData);
  const payloadJson = JSON.stringify(payload);
  const byteSize = new Blob([payloadJson]).size;
  if (byteSize > MAX_DOC_BYTES) {
    throw new Error('データサイズが大きすぎます（上限 約950KB）。不要な単語帳を整理してから同期してください。');
  }

  try {
    await setDoc(getUserSyncDocRef(uid), {
      format: payload.format,
      updatedAt: payload.updatedAt,
      payloadJson
    });
    return { updatedAt: payload.updatedAt };
  } catch (err) {
    throw new Error(formatFirebaseError(err));
  }
}
