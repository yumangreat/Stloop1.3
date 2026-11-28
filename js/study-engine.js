import { extractClozeStructure, DEFAULT_UNORDERED_DELIMITERS } from './math-renderer.js';

export function shuffleArray(list) {
  const arr = [...list];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function getFilteredCards(deck, { category = 'ALL', mode = 'smart', studyType = 'memorize' }) {
  if (!deck || !Array.isArray(deck.cards)) return [];
  const now = Date.now();
  let list = [...deck.cards];
  if (category && category !== 'ALL') {
    list = list.filter((c) => (c.category || '一般') === category);
  }
  if (studyType === 'memorize') {
    if (mode === 'weak') {
      list = list.filter((c) => c.wrongCount > c.correctCount || c.pinned);
    } else if (mode === 'srs') {
      list = list.filter((c) => !c.nextReview || c.nextReview <= now);
    }
  }
  return list;
}

export function buildMemorizeQueue(deck, settings) {
  const list = getFilteredCards(deck, { ...settings, studyType: 'memorize' });
  const ordered = settings.shuffle ? shuffleArray(list) : list;
  return ordered.map((c) => c.id);
}

export function buildTestQueue(deck, settings, customCardIds = null) {
  if (Array.isArray(customCardIds) && customCardIds.length > 0) {
    const valid = new Set((deck?.cards || []).map((c) => c.id));
    return shuffleArray(customCardIds.filter((id) => valid.has(id)));
  }
  const list = getFilteredCards(deck, { ...settings, studyType: 'test' });
  const randomized = shuffleArray(list);
  const limit = settings.testCount === 'ALL' ? randomized.length : Math.min(randomized.length, Number(settings.testCount) || 10);
  return randomized.slice(0, limit).map((c) => c.id);
}

export function getSessionStorageKey(deckId, format) {
  return `${deckId}::${format || 'flip'}`;
}

export function hasMeaningfulProgress(saved) {
  if (!saved) return false;
  return (
    saved.mainIndex > 0 ||
    saved.reviewIndex > 0 ||
    (Array.isArray(saved.wrongPool) && saved.wrongPool.length > 0) ||
    Boolean(saved.isFlipped)
  );
}

export function getValidSavedSession(appData, deckId, format) {
  if (!deckId || !format) return null;
  if (!appData.savedSessions || typeof appData.savedSessions !== 'object') {
    appData.savedSessions = {};
  }
  const key = getSessionStorageKey(deckId, format);
  const raw = appData.savedSessions[key];
  if (!raw || typeof raw !== 'object') return null;

  const deck = appData.decks.find((d) => d.id === deckId);
  if (!deck || !Array.isArray(deck.cards) || deck.cards.length === 0) {
    delete appData.savedSessions[key];
    return null;
  }

  const validIds = new Set(deck.cards.map((c) => c.id));
  const mainQueue = Array.isArray(raw.mainQueue) ? raw.mainQueue.filter((id) => validIds.has(id)) : [];
  const wrongPool = Array.isArray(raw.wrongPool) ? raw.wrongPool.filter((id) => validIds.has(id)) : [];
  let reviewQueue = Array.isArray(raw.reviewQueue) ? raw.reviewQueue.filter((id) => validIds.has(id)) : [];

  if (mainQueue.length === 0) {
    delete appData.savedSessions[key];
    return null;
  }

  let phase = raw.phase === 'review' ? 'review' : 'main';
  const mainIndex = Math.max(0, Math.min(Number(raw.mainIndex || 0), mainQueue.length));
  let reviewIndex = Math.max(0, Math.min(Number(raw.reviewIndex || 0), reviewQueue.length));
  const mainStepsSinceReview = Math.max(0, Number(raw.mainStepsSinceReview || 0));

  if (phase === 'review' && reviewIndex >= reviewQueue.length) {
    phase = 'main';
    reviewQueue = [];
    reviewIndex = 0;
  }

  if (phase === 'main' && mainIndex >= mainQueue.length && wrongPool.length === 0) {
    delete appData.savedSessions[key];
    return null;
  }

  return {
    deckId,
    format,
    mode: ['smart', 'all', 'weak', 'srs'].includes(raw.mode) ? raw.mode : 'smart',
    category: typeof raw.category === 'string' ? raw.category : 'ALL',
    reverse: Boolean(raw.reverse),
    shuffle: Boolean(raw.shuffle),
    phase,
    mainQueue,
    mainIndex,
    mainStepsSinceReview,
    wrongPool,
    reviewQueue,
    reviewIndex,
    isFlipped: Boolean(raw.isFlipped),
    updatedAt: Number(raw.updatedAt || Date.now())
  };
}

export function savedMatchesSettings(saved, settings) {
  if (!saved || !settings) return false;
  return (
    saved.mode === settings.mode &&
    saved.category === settings.category &&
    Boolean(saved.reverse) === Boolean(settings.reverse) &&
    Boolean(saved.shuffle) === Boolean(settings.shuffle)
  );
}

export function clearSavedSession(appData, deckId, format) {
  if (!appData.savedSessions || typeof appData.savedSessions !== 'object') return;
  delete appData.savedSessions[getSessionStorageKey(deckId, format)];
}

export function clearAllSavedSessionsForDeck(appData, deckId) {
  if (!appData.savedSessions || typeof appData.savedSessions !== 'object') return;
  const prefix = `${deckId}::`;
  Object.keys(appData.savedSessions).forEach((k) => {
    if (k.startsWith(prefix)) delete appData.savedSessions[k];
  });
  if (appData.activeStudy && appData.activeStudy.deckId === deckId) {
    appData.activeStudy = null;
  }
}

export function normalizeAnswerString(str) {
  return String(str || '')
    .replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .replace(/[\s　\$]/g, '')
    .toLowerCase();
}

export function getCardLockedArray(card, reverse) {
  if (!card) return [];
  const key = reverse ? 'lockedIndicesReverse' : 'lockedIndices';
  return Array.isArray(card[key]) ? card[key] : [];
}

export function setCardLockedArray(card, reverse, arr) {
  if (!card) return;
  const key = reverse ? 'lockedIndicesReverse' : 'lockedIndices';
  card[key] = arr;
}

export function getInputStructureForCard(card, appData, reverse) {
  if (!card) return { targets: [], groups: [], groupIndexBySlot: [] };
  const sourceText = reverse ? card.front : card.back;
  const enabled = appData.unorderedEnabled !== false;
  const delims = typeof appData.unorderedDelimiters === 'string'
    ? appData.unorderedDelimiters
    : DEFAULT_UNORDERED_DELIMITERS;
  return extractClozeStructure(sourceText, enabled, delims);
}

export function gradeClozeValues(card, userValues, appData, reverse) {
  const structure = getInputStructureForCard(card, appData, reverse);
  const { targets, groups } = structure;
  const lockedArr = getCardLockedArray(card, reverse).filter((n) => n >= 0 && n < targets.length);
  const lockedSet = new Set(lockedArr);

  let activeTotal = 0;
  let activeCorrect = 0;
  const slotResults = new Array(targets.length).fill(null);

  groups.forEach((group) => {
    const remainingPool = [];
    group.indices.forEach((slotIdx) => {
      const rawTarget = targets[slotIdx];
      const cleanAns = rawTarget.replace(/^\${1,2}|\${1,2}$/g, '');
      if (lockedSet.has(slotIdx)) {
        slotResults[slotIdx] = { status: 'locked', displayAnswer: cleanAns };
      } else {
        remainingPool.push({
          slotIdx,
          norm: normalizeAnswerString(rawTarget),
          cleanAns
        });
      }
    });

    const unmatchedSlots = [];
    group.indices.forEach((slotIdx) => {
      if (lockedSet.has(slotIdx)) return;
      activeTotal += 1;

      const rawUser = userValues[slotIdx] ?? '';
      const normUser = normalizeAnswerString(rawUser);

      if (normUser.length > 0) {
        const matchPos = remainingPool.findIndex((cand) => cand.norm === normUser);
        if (matchPos !== -1) {
          const matched = remainingPool.splice(matchPos, 1)[0];
          activeCorrect += 1;
          slotResults[slotIdx] = { status: 'ok', displayAnswer: matched.cleanAns };
          return;
        }
      }
      unmatchedSlots.push(slotIdx);
    });

    unmatchedSlots.forEach((slotIdx, uIdx) => {
      const fallbackCand = remainingPool[uIdx] || remainingPool[0];
      const cleanAns = fallbackCand
        ? fallbackCand.cleanAns
        : targets[slotIdx].replace(/^\${1,2}|\${1,2}$/g, '');
      slotResults[slotIdx] = { status: 'ng', displayAnswer: cleanAns };
    });
  });

  return {
    targets,
    slotResults,
    activeTotal,
    activeCorrect,
    lockedCount: lockedSet.size,
    isAllCorrect: activeTotal > 0 && activeCorrect === activeTotal
  };
}

export function applySrsUpdate(card, isCorrect) {
  if (!card) return;
  if (isCorrect) {
    card.correctCount += 1;
    card.srsLevel = Math.min(6, card.srsLevel + 1);
    const intervals = [1, 3, 7, 14, 30, 60];
    card.nextReview = Date.now() + intervals[card.srsLevel - 1] * 86400000;
  } else {
    card.wrongCount += 1;
    card.srsLevel = 0;
    card.nextReview = Date.now();
  }
}
