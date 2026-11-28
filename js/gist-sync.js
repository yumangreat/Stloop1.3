const SYNC_CONFIG_KEY = 'studyloop_sync_config_v1';
const GIST_FILENAME = 'studyloop_sync_data.json';
const GIST_DESCRIPTION = 'StudyLoop Cloud Sync Data (Private)';

export function loadSyncConfig() {
  try {
    const raw = localStorage.getItem(SYNC_CONFIG_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      return {
        token: typeof p.token === 'string' ? p.token.trim() : '',
        gistId: typeof p.gistId === 'string' ? p.gistId.trim() : '',
        autoSync: p.autoSync !== false,
        lastSyncedAt: Number(p.lastSyncedAt || 0),
        username: typeof p.username === 'string' ? p.username : ''
      };
    }
  } catch (_) {}
  return { token: '', gistId: '', autoSync: true, lastSyncedAt: 0, username: '' };
}

export function saveSyncConfig(cfg) {
  try {
    localStorage.setItem(SYNC_CONFIG_KEY, JSON.stringify({
      token: String(cfg.token || '').trim(),
      gistId: String(cfg.gistId || '').trim(),
      autoSync: cfg.autoSync !== false,
      lastSyncedAt: Number(cfg.lastSyncedAt || 0),
      username: String(cfg.username || '')
    }));
  } catch (_) {}
}

export function clearSyncConfig() {
  try {
    localStorage.removeItem(SYNC_CONFIG_KEY);
  } catch (_) {}
}

export function isSyncConfigured() {
  return Boolean(loadSyncConfig().token);
}

function authHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json'
  };
}

/**
 * Strips heavy inline base64 images & idb refs from cloud payload
 * (local IDB images are preserved by card.id on merge/pull).
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
    format: 'studyloop_gist_sync_v1',
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

export async function verifyTokenAndFindGist(token) {
  const userRes = await fetch('https://api.github.com/user', {
    headers: authHeaders(token)
  });
  if (!userRes.ok) {
    throw new Error('トークンが無効です。gist 権限付きトークンを確認してください。');
  }
  const user = await userRes.json();

  let foundGistId = '';
  const gistsRes = await fetch('https://api.github.com/gists?per_page=100', {
    headers: authHeaders(token)
  });
  if (gistsRes.ok) {
    const gists = await gistsRes.json();
    const matched = Array.isArray(gists)
      ? gists.find((g) => g.files && g.files[GIST_FILENAME])
      : null;
    if (matched) foundGistId = matched.id;
  }

  return {
    username: user.login || '',
    gistId: foundGistId
  };
}

export async function fetchCloudSnapshot(token, gistId) {
  const res = await fetch(`https://api.github.com/gists/${encodeURIComponent(gistId)}`, {
    headers: authHeaders(token),
    cache: 'no-store'
  });
  if (res.status === 404) {
    return null;
  }
  if (!res.ok) {
    throw new Error(`クラウド読込エラー (${res.status})`);
  }
  const gist = await res.json();
  const file = gist.files && gist.files[GIST_FILENAME];
  if (!file) return null;

  let content = file.content || '';
  if (file.truncated && file.raw_url) {
    const rawRes = await fetch(file.raw_url, { cache: 'no-store' });
    if (!rawRes.ok) throw new Error('クラウドデータの取得に失敗しました');
    content = await rawRes.text();
  }

  const parsed = JSON.parse(content);
  if (!parsed || !parsed.data || !Array.isArray(parsed.data.decks)) {
    throw new Error('クラウドデータの形式が不正です');
  }
  return {
    updatedAt: Number(parsed.updatedAt || Date.parse(gist.updated_at) || 0),
    data: parsed.data
  };
}

export async function pushCloudSnapshot(token, gistId, appData) {
  const payload = buildCloudPayload(appData);
  const body = {
    description: GIST_DESCRIPTION,
    public: false,
    files: {
      [GIST_FILENAME]: {
        content: JSON.stringify(payload)
      }
    }
  };

  let res;
  if (gistId) {
    res = await fetch(`https://api.github.com/gists/${encodeURIComponent(gistId)}`, {
      method: 'PATCH',
      headers: authHeaders(token),
      body: JSON.stringify(body)
    });
    if (res.status === 404) {
      // Gist was deleted remotely; recreate it
      res = await fetch('https://api.github.com/gists', {
        method: 'POST',
        headers: authHeaders(token),
        body: JSON.stringify(body)
      });
    }
  } else {
    res = await fetch('https://api.github.com/gists', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify(body)
    });
  }

  if (!res.ok) {
    throw new Error(`クラウド保存エラー (${res.status})`);
  }
  const gist = await res.json();
  return {
    gistId: gist.id,
    updatedAt: payload.updatedAt
  };
}
