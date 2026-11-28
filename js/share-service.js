export const DEFAULT_GAS_URL =
  'https://script.google.com/macros/s/AKfycbzkiJgjXoYY1hifkeG64eR6O-JyUIgi3Y6YAy_e_Y-6m1glaS95Ca-caE1X36sfrVF2/exec';

const SHARE_PREFS_KEY = 'studyloop_share_prefs_v1';
const MY_SHARES_KEY = 'studyloop_my_shares_v1';

export function loadSharePrefs() {
  try {
    const raw = localStorage.getItem(SHARE_PREFS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        author: typeof parsed.author === 'string' ? parsed.author : '',
        passcode: typeof parsed.passcode === 'string' ? parsed.passcode : '',
        gasUrl: typeof parsed.gasUrl === 'string' && parsed.gasUrl.trim() ? parsed.gasUrl.trim() : ''
      };
    }
  } catch (_) {}
  return { author: '', passcode: '', gasUrl: '' };
}

export function saveSharePrefs(prefs) {
  try {
    localStorage.setItem(SHARE_PREFS_KEY, JSON.stringify({
      author: String(prefs.author || '').trim().slice(0, 30),
      passcode: String(prefs.passcode || ''),
      gasUrl: String(prefs.gasUrl || '').trim()
    }));
  } catch (_) {}
}

export function getGasEndpoint() {
  const prefs = loadSharePrefs();
  return prefs.gasUrl || DEFAULT_GAS_URL;
}

export function loadMyShares() {
  try {
    const raw = localStorage.getItem(MY_SHARES_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return arr;
    }
  } catch (_) {}
  return [];
}

export function saveMyShares(list) {
  try {
    localStorage.setItem(MY_SHARES_KEY, JSON.stringify(list.slice(0, 50)));
  } catch (_) {}
}

export function upsertMyShare(entry) {
  const list = loadMyShares().filter((item) => item.id !== entry.id);
  list.unshift(entry);
  saveMyShares(list);
}

export function removeMyShare(id) {
  const list = loadMyShares().filter((item) => item.id !== id);
  saveMyShares(list);
}

export function buildShareUrl(id) {
  const base = `${window.location.origin}${window.location.pathname}`;
  return `${base}?share=${encodeURIComponent(id)}`;
}

/**
 * Strips personal study history, pins, locks, and local image refs (idb:/data:)
 * so shared packages are clean, lightweight, and never contain broken image links.
 */
export function buildSharePayload(appData, selectedDeckIds) {
  const idSet = new Set(selectedDeckIds);
  const selectedDecks = (appData.decks || []).filter((d) => idSet.has(d.id));
  const usedFolderIds = new Set(selectedDecks.map((d) => d.folderId).filter(Boolean));
  const folders = (appData.folders || [])
    .filter((f) => usedFolderIds.has(f.id))
    .map((f) => ({ id: f.id, name: f.name }));

  const decks = selectedDecks.map((d) => ({
    id: d.id,
    folderId: d.folderId && usedFolderIds.has(d.folderId) ? d.folderId : '',
    title: d.title,
    cards: (d.cards || []).map((c) => ({
      category: c.category || '一般',
      front: c.front || '',
      back: c.back || '',
      hint: c.hint || ''
    }))
  }));

  return {
    format: 'studyloop_share_v1',
    unorderedEnabled: appData.unorderedEnabled !== false,
    unorderedDelimiters: appData.unorderedDelimiters || '',
    folders,
    decks
  };
}

async function parseGasResponse(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (_) {
    throw new Error('サーバーからの応答を解析できませんでした');
  }
}

export async function pingGas() {
  const url = `${getGasEndpoint()}?action=ping`;
  const res = await fetch(url, { method: 'GET', redirect: 'follow' });
  const data = await parseGasResponse(res);
  if (!data || !data.ok) {
    throw new Error(data?.error || '共有サーバーへ接続できませんでした');
  }
  return data;
}

export async function publishShare({
  payload,
  title,
  author,
  visibility,
  passcode,
  existingId = '',
  existingEditKey = ''
}) {
  const body = {
    action: 'publish',
    title,
    author,
    visibility,
    passcode,
    payload
  };
  if (existingId && existingEditKey) {
    body.id = existingId;
    body.editKey = existingEditKey;
  }

  // Send as text/plain to bypass GAS CORS preflight restrictions
  const res = await fetch(getGasEndpoint(), {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(body),
    redirect: 'follow'
  });
  const data = await parseGasResponse(res);
  if (!data || !data.ok) {
    throw new Error(data?.error || '共有URLの発行に失敗しました');
  }
  return data;
}

export async function fetchShareById(id) {
  const url = `${getGasEndpoint()}?action=get&id=${encodeURIComponent(id)}`;
  const res = await fetch(url, { method: 'GET', redirect: 'follow' });
  const data = await parseGasResponse(res);
  if (!data || !data.ok) {
    throw new Error(data?.error || '共有データが見つかりませんでした');
  }
  return data;
}

export async function searchPublicShares(query = '', limit = 30) {
  const url = `${getGasEndpoint()}?action=search&q=${encodeURIComponent(query)}&limit=${limit}`;
  const res = await fetch(url, { method: 'GET', redirect: 'follow' });
  const data = await parseGasResponse(res);
  if (!data || !data.ok) {
    throw new Error(data?.error || '検索に失敗しました');
  }
  return data.items || [];
}

export async function deleteShare(id, editKey) {
  const res = await fetch(getGasEndpoint(), {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'delete', id, editKey }),
    redirect: 'follow'
  });
  const data = await parseGasResponse(res);
  if (!data || !data.ok) {
    throw new Error(data?.error || '削除に失敗しました');
  }
  return data;
}
