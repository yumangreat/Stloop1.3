import { DEFAULT_UNORDERED_DELIMITERS } from './math-renderer.js';

const STORAGE_KEY = 'studyloop_v5_data';
const LEGACY_KEYS = ['studyloop_pro_data', 'studyloop_v4_data', 'studyloop_v3_data', 'studyloop_data'];
const undoStack = [];

export function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function getTodayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function defaultPreferences() {
  return {
    studyType: 'memorize', // 'memorize' | 'test'
    mode: 'smart',         // 'smart' | 'all' | 'weak' | 'srs'
    format: 'flip',        // 'flip' | 'choice' | 'input'
    category: 'ALL',
    reverse: false,
    shuffle: false,
    redsheet: false,
    testCount: '10',       // '10' | '20' | '30' | 'ALL'
    testGrading: 'instant',// 'instant' | 'batch'
    testTimer: false
  };
}

export function normalizeCard(raw) {
  const parseLocks = (arr) =>
    Array.isArray(arr)
      ? Array.from(new Set(arr.map(Number).filter((n) => Number.isInteger(n) && n >= 0))).sort((a, b) => a - b)
      : [];

  return {
    id: raw.id || uid('c'),
    category: String(raw.category || '一般').trim() || '一般',
    front: String(raw.front || raw.q || '').trim(),
    back: String(raw.back || raw.a || '').trim(),
    hint: String(raw.hint || '').trim(),
    image: String(raw.image || ''),
    correctCount: Math.max(0, Number(raw.correctCount ?? raw.correct ?? 0) || 0),
    wrongCount: Math.max(0, Number(raw.wrongCount ?? raw.wrong ?? 0) || 0),
    pinned: Boolean(raw.pinned),
    srsLevel: Math.max(0, Number(raw.srsLevel || 0) || 0),
    nextReview: Math.max(0, Number(raw.nextReview || 0) || 0),
    lockedIndices: parseLocks(raw.lockedIndices),
    lockedIndicesReverse: parseLocks(raw.lockedIndicesReverse)
  };
}

export function createDefaultData() {
  const deckId = uid('deck');
  return {
    activeDeckId: deckId,
    examDate: '',
    theme: 'light',
    unorderedEnabled: true,
    unorderedDelimiters: DEFAULT_UNORDERED_DELIMITERS,
    preferences: defaultPreferences(),
    studyLog: {},
    savedSessions: {},
    activeStudy: null,
    folders: [],
    decks: [
      {
        id: deckId,
        folderId: '',
        title: 'サンプル（数式・赤シート確認）',
        cards: [
          normalizeCard({
            category: '数学',
            front: '二次方程式 $ax^2 + bx + c = 0$ ($a \\neq 0$) の解の公式',
            back: '【$$x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}$$】',
            hint: '判別式 $D = b^2 - 4ac$ をルートの中に入れます。'
          }),
          normalizeCard({
            category: '物理',
            front: '真空中のクーロンの法則の比例定数 $k$ を含む静電気力 $F$ の式',
            back: '【$$F = k\\frac{|q_1 q_2|}{r^2}$$】',
            hint: '距離 $r$ の2乗に反比例します。'
          }),
          normalizeCard({
            category: '化学',
            front: '理想気体の状態方程式',
            back: '【$$PV = nRT$$】',
            hint: '圧力 $P$、体積 $V$、物質量 $n$、気体定数 $R$、絶対温度 $T$'
          })
        ]
      }
    ]
  };
}

export function normalizeStructure(parsed) {
  const folders = Array.isArray(parsed.folders)
    ? parsed.folders
        .filter((f) => f && (f.id || f.name))
        .map((f) => ({
          id: f.id || uid('folder'),
          name: String(f.name || 'フォルダ').trim() || 'フォルダ'
        }))
    : [];
  const folderIds = new Set(folders.map((f) => f.id));

  const decks = Array.isArray(parsed.decks)
    ? parsed.decks.map((d) => ({
        id: d.id || uid('deck'),
        folderId: d.folderId && folderIds.has(d.folderId) ? d.folderId : '',
        title: String(d.title || d.name || '無題の単語帳').trim() || '無題の単語帳',
        cards: Array.isArray(d.cards) ? d.cards.map(normalizeCard) : []
      }))
    : [];

  return { folders, decks };
}

function hydrateData(parsed) {
  const { folders, decks } = normalizeStructure(parsed);
  if (decks.length === 0) return null;

  const prefs = { ...defaultPreferences(), ...(parsed.preferences || {}) };
  if (!['memorize', 'test'].includes(prefs.studyType)) prefs.studyType = 'memorize';
  if (!['smart', 'all', 'weak', 'srs'].includes(prefs.mode)) prefs.mode = 'smart';
  if (!['flip', 'choice', 'input'].includes(prefs.format)) prefs.format = 'flip';
  if (!['10', '20', '30', 'ALL'].includes(String(prefs.testCount))) prefs.testCount = '10';
  if (!['instant', 'batch'].includes(prefs.testGrading)) prefs.testGrading = 'instant';

  return {
    activeDeckId: parsed.activeDeckId && decks.some((d) => d.id === parsed.activeDeckId)
      ? parsed.activeDeckId
      : decks[0].id,
    examDate: typeof parsed.examDate === 'string' ? parsed.examDate : '',
    theme: parsed.theme === 'dark' ? 'dark' : 'light',
    unorderedEnabled: typeof parsed.unorderedEnabled === 'boolean' ? parsed.unorderedEnabled : true,
    unorderedDelimiters: typeof parsed.unorderedDelimiters === 'string'
      ? parsed.unorderedDelimiters
      : DEFAULT_UNORDERED_DELIMITERS,
    preferences: prefs,
    studyLog: parsed.studyLog && typeof parsed.studyLog === 'object' && !Array.isArray(parsed.studyLog)
      ? parsed.studyLog
      : {},
    savedSessions: parsed.savedSessions && typeof parsed.savedSessions === 'object' && !Array.isArray(parsed.savedSessions)
      ? parsed.savedSessions
      : {},
    activeStudy: parsed.activeStudy && typeof parsed.activeStudy === 'object' && parsed.activeStudy.deckId && parsed.activeStudy.format
      ? parsed.activeStudy
      : null,
    folders,
    decks
  };
}

function migrateLegacyData() {
  const candidateKeys = [...LEGACY_KEYS];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k !== STORAGE_KEY && k.toLowerCase().includes('studyloop') && !candidateKeys.includes(k)) {
        candidateKeys.push(k);
      }
    }
  } catch (_) {}

  for (const key of candidateKeys) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      const hydrated = hydrateData(parsed);
      if (hydrated) {
        hydrated.decks.forEach((d) => {
          d.cards = d.cards.filter((c) => c.front && c.back);
        });
        return hydrated;
      }
    } catch (e) {
      console.warn('Migration skip:', key, e);
    }
  }
  return null;
}

export function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const hydrated = hydrateData(JSON.parse(raw));
      if (hydrated) return hydrated;
    }
  } catch (e) {
    console.error('Failed to read storage:', e);
  }
  const migrated = migrateLegacyData();
  if (migrated) {
    saveData(migrated);
    return migrated;
  }
  const fresh = createDefaultData();
  saveData(fresh);
  return fresh;
}

export function saveData(data, onError) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    return true;
  } catch (e) {
    console.error('Failed to save storage:', e);
    if (typeof onError === 'function') {
      onError(e);
    }
    return false;
  }
}

export function recordDailyActivity(appData, count = 1) {
  if (!appData.studyLog || typeof appData.studyLog !== 'object') {
    appData.studyLog = {};
  }
  const key = getTodayKey();
  appData.studyLog[key] = (Number(appData.studyLog[key]) || 0) + count;
}

export function getStudyStreak(appData) {
  const log = appData.studyLog || {};
  let streak = 0;
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);

  // If today hasn't been studied yet, check starting from yesterday
  if (!log[getTodayKey(cursor)]) {
    cursor.setDate(cursor.getDate() - 1);
  }
  while (log[getTodayKey(cursor)] > 0) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

export function getTodayStudyCount(appData) {
  return Number((appData.studyLog || {})[getTodayKey()] || 0);
}

export function pushUndo(snapshot) {
  undoStack.push(snapshot);
  if (undoStack.length > 40) undoStack.shift();
}

export function popUndo() {
  return undoStack.length > 0 ? undoStack.pop() : null;
}

export function clearUndo() {
  undoStack.length = 0;
}

export function getUndoDepth() {
  return undoStack.length;
}
