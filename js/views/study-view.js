import { ICONS } from '../icons.js';
import {
  renderContent,
  renderMathIfReady,
  extractClozeTargets,
  escapeHtml
} from '../math-renderer.js';
import {
  pushUndo,
  popUndo,
  clearUndo,
  recordDailyActivity
} from '../store.js';
import {
  buildMemorizeQueue,
  buildTestQueue,
  getSessionStorageKey,
  getValidSavedSession,
  hasMeaningfulProgress,
  savedMatchesSettings,
  clearSavedSession,
  shuffleArray,
  getCardLockedArray,
  setCardLockedArray,
  getInputStructureForCard,
  gradeClozeValues,
  applySrsUpdate
} from '../study-engine.js';
import { getImageUrl } from '../image-db.js';
import { resetCardTransform, bindCardGestures } from '../swipe.js';
import { initSpeech, speakText, stopSpeech } from '../speech.js';
import {
  showToast,
  openLightbox,
  openShortcutsModal,
  isAnyModalOpen
} from './modal.js';

const $ = (id) => document.getElementById(id);

export function createStudyView(ctx) {
  const session = {
    active: false,
    kind: 'memorize',       // 'memorize' | 'test'
    phase: 'main',          // 'main' | 'review'
    mainQueue: [],
    mainIndex: 0,
    mainStepsSinceReview: 0,
    wrongPool: [],
    reviewQueue: [],
    reviewIndex: 0,
    sessionCorrect: 0,
    sessionWrong: 0,

    // Test state
    testGrading: 'instant', // 'instant' | 'batch'
    testQueue: [],
    testIndex: 0,
    testRecords: [],
    batchAnswers: [],
    batchChoiceMap: new Map(), // testIndex -> options[]
    testStartedAt: 0,
    testElapsedSec: 0,
    resultFilter: 'all',

    // Current card UI state
    isFlipped: false,
    answeredCurrent: false,
    awaitingSelfJudge: false,
    animatingJudge: false
  };

  const pendingTimers = new Set();
  let timerInterval = null;
  let renderSeq = 0;

  function schedule(fn, ms) {
    const id = setTimeout(() => {
      pendingTimers.delete(id);
      fn();
    }, ms);
    pendingTimers.add(id);
    return id;
  }

  function clearPendingTimers() {
    pendingTimers.forEach((id) => clearTimeout(id));
    pendingTimers.clear();
  }

  function stopTestTimer() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  }

  function formatSec(sec) {
    const m = String(Math.floor(sec / 60)).padStart(2, '0');
    const s = String(sec % 60).padStart(2, '0');
    return `${m}:${s}`;
  }

  function startTestTimerIfEnabled() {
    stopTestTimer();
    const pill = $('study-timer-pill');
    session.testStartedAt = Date.now();
    session.testElapsedSec = 0;

    if (session.kind !== 'test' || !ctx.settings.testTimer) {
      pill?.classList.add('hidden');
      return;
    }
    if (pill) {
      pill.textContent = '00:00';
      pill.classList.remove('hidden');
    }
    timerInterval = setInterval(() => {
      session.testElapsedSec = Math.floor((Date.now() - session.testStartedAt) / 1000);
      if (pill) pill.textContent = formatSec(session.testElapsedSec);
    }, 500);
  }

  function setStudyBehindVisible(visible) {
    $('study-main-area')?.classList.toggle('invisible-behind', !visible);
    $('study-bottom-area')?.classList.toggle('invisible-behind', !visible);
  }

  function getCurrentCard() {
    const deck = ctx.getActiveDeck();
    if (!deck) return null;
    let cardId = null;
    if (session.kind === 'test') {
      cardId = session.testQueue[session.testIndex];
    } else {
      cardId = session.phase === 'review'
        ? session.reviewQueue[session.reviewIndex]
        : session.mainQueue[session.mainIndex];
    }
    return deck.cards.find((c) => c.id === cardId) || null;
  }

  function isBatchTest() {
    return session.kind === 'test' && session.testGrading === 'batch';
  }

  function persistCurrentSession(keepActiveStudy = true) {
    if (!session.active || session.kind !== 'memorize') return;
    const deck = ctx.getActiveDeck();
    if (!deck) return;

    if (!ctx.appData.savedSessions || typeof ctx.appData.savedSessions !== 'object') {
      ctx.appData.savedSessions = {};
    }

    const key = getSessionStorageKey(deck.id, ctx.settings.format);
    ctx.appData.savedSessions[key] = {
      deckId: deck.id,
      format: ctx.settings.format,
      mode: ctx.settings.mode,
      category: ctx.settings.category,
      filterFavorites: Boolean(ctx.settings.filterFavorites),
      filterWrong: Boolean(ctx.settings.filterWrong),
      reverse: ctx.settings.reverse,
      shuffle: ctx.settings.shuffle,
      phase: session.phase,
      mainQueue: [...session.mainQueue],
      mainIndex: session.mainIndex,
      mainStepsSinceReview: session.mainStepsSinceReview,
      wrongPool: [...session.wrongPool],
      reviewQueue: [...session.reviewQueue],
      reviewIndex: session.reviewIndex,
      sessionCorrect: session.sessionCorrect,
      sessionWrong: session.sessionWrong,
      isFlipped: Boolean(session.isFlipped),
      updatedAt: Date.now()
    };

    if (keepActiveStudy) {
      ctx.appData.activeStudy = { deckId: deck.id, format: ctx.settings.format };
    }
    ctx.save();
  }

  function enterStudyViewport() {
    $('view-home')?.classList.add('hidden');
    $('view-deck')?.classList.add('hidden');
    $('view-study')?.classList.remove('hidden');
    $('review-interstitial')?.classList.add('hidden');
    $('complete-interstitial')?.classList.add('hidden');
    $('test-result-overlay')?.classList.add('hidden');
    setStudyBehindVisible(true);
  }

  function restoreFromSaved(saved, silent = false) {
    const deck = ctx.getActiveDeck();
    if (!deck || !saved) return false;

    clearPendingTimers();
    stopTestTimer();

    ctx.settings.studyType = 'memorize';
    ctx.settings.format = saved.format;
    ctx.settings.mode = saved.mode;
    ctx.settings.category = saved.category;
    ctx.settings.filterFavorites = Boolean(saved.filterFavorites);
    ctx.settings.filterWrong = Boolean(saved.filterWrong);
    ctx.settings.reverse = saved.reverse;
    ctx.settings.shuffle = saved.shuffle;
    ctx.savePreferences();

    if (!silent) ctx.haptic(14);
    clearUndo();
    session.active = true;
    session.kind = 'memorize';
    session.phase = saved.phase;
    session.mainQueue = [...saved.mainQueue];
    session.mainIndex = saved.mainIndex;
    session.mainStepsSinceReview = saved.mainStepsSinceReview;
    session.wrongPool = [...saved.wrongPool];
    session.reviewQueue = [...saved.reviewQueue];
    session.reviewIndex = saved.reviewIndex;
    session.sessionCorrect = Math.max(0, Number(saved.sessionCorrect || 0));
    session.sessionWrong = Math.max(0, Number(saved.sessionWrong || 0));
    session.isFlipped = false;
    session.answeredCurrent = false;
    session.awaitingSelfJudge = false;
    session.animatingJudge = false;

    $('study-timer-pill')?.classList.add('hidden');
    enterStudyViewport();

    if (session.phase === 'main' && session.mainIndex >= session.mainQueue.length && session.wrongPool.length > 0) {
      enterReviewMode();
      return true;
    }

    renderCurrentCard(saved.isFlipped);
    return true;
  }

  function startMemorize(forceFresh = false) {
    const deck = ctx.getActiveDeck();
    if (!deck || deck.cards.length === 0) return;

    clearPendingTimers();
    stopTestTimer();

    if (!forceFresh) {
      const saved = getValidSavedSession(ctx.appData, deck.id, ctx.settings.format);
      if (saved && hasMeaningfulProgress(saved) && savedMatchesSettings(saved, ctx.settings)) {
        restoreFromSaved(saved, false);
        return;
      }
    }

    clearSavedSession(ctx.appData, deck.id, ctx.settings.format);
    const queue = buildMemorizeQueue(deck, ctx.settings);
    if (queue.length === 0) {
      showToast('条件に一致する問題がありません');
      return;
    }

    ctx.haptic(14);
    clearUndo();
    session.active = true;
    session.kind = 'memorize';
    session.phase = 'main';
    session.mainQueue = queue;
    session.mainIndex = 0;
    session.mainStepsSinceReview = 0;
    session.wrongPool = [];
    session.reviewQueue = [];
    session.reviewIndex = 0;
    session.sessionCorrect = 0;
    session.sessionWrong = 0;
    session.isFlipped = false;
    session.answeredCurrent = false;
    session.awaitingSelfJudge = false;
    session.animatingJudge = false;

    $('study-timer-pill')?.classList.add('hidden');
    enterStudyViewport();
    renderCurrentCard(false);
  }

  function startTest(customCardIds = null) {
    const deck = ctx.getActiveDeck();
    if (!deck || deck.cards.length === 0) return;

    clearPendingTimers();
    stopTestTimer();

    const queue = buildTestQueue(deck, ctx.settings, customCardIds);
    if (queue.length === 0) {
      showToast('出題できる問題がありません');
      return;
    }

    ctx.haptic(14);
    clearUndo();
    session.active = true;
    session.kind = 'test';
    session.phase = 'main';
    session.testGrading = ctx.settings.testGrading || 'instant';
    session.testQueue = queue;
    session.testIndex = 0;
    session.testRecords = [];
    session.batchAnswers = new Array(queue.length).fill(null);
    session.batchChoiceMap = new Map();
    session.resultFilter = 'all';
    session.isFlipped = false;
    session.answeredCurrent = false;
    session.awaitingSelfJudge = false;
    session.animatingJudge = false;

    enterStudyViewport();
    startTestTimerIfEnabled();
    renderCurrentCard(false);
  }

  function exit() {
    clearPendingTimers();
    stopTestTimer();
    stopSpeech();

    if (session.active && session.kind === 'memorize') {
      persistCurrentSession(false);
    }
    ctx.appData.activeStudy = null;
    ctx.save();

    session.active = false;
    session.animatingJudge = false;
    document.body.classList.remove('input-cloze-hide');
    resetCardTransform($('card-stage'), $('swipe-badge-left'), $('swipe-badge-right'), true);
    setStudyBehindVisible(true);

    $('view-study')?.classList.add('hidden');
    $('test-result-overlay')?.classList.add('hidden');
    $('view-deck')?.classList.remove('hidden');
    ctx.onExitStudy();
  }

  function syncPinButtons(isPinned) {
    [$('btn-pin-front'), $('btn-pin-back')].forEach((btn) => {
      if (!btn) return;
      btn.textContent = isPinned ? '★' : '☆';
      btn.classList.toggle('pinned', isPinned);
    });
  }

  function renderCurrentCard(initialFlipped = false) {
    clearPendingTimers();
    stopSpeech();
    renderSeq += 1;
    const seq = renderSeq;

    const card = getCurrentCard();
    if (!card) {
      if (session.kind === 'test') finishTest();
      else showCompleteScreen();
      return;
    }

    const fmt = ctx.settings.format;
    const batch = isBatchTest();

    session.isFlipped = !batch && Boolean(initialFlipped) && (fmt === 'flip' || fmt === 'input');
    session.answeredCurrent = false;
    session.awaitingSelfJudge = false;
    session.animatingJudge = false;

    // Progress bar & phase badge
    let cur = 1;
    let total = 1;
    const phaseBadge = $('study-phase-badge');
    if (session.kind === 'test') {
      cur = session.testIndex + 1;
      total = session.testQueue.length;
      if (phaseBadge) {
        phaseBadge.textContent = batch ? 'まとめ判定' : 'テスト';
        phaseBadge.classList.add('test-pill');
      }
    } else {
      const isReview = session.phase === 'review';
      cur = isReview ? session.reviewIndex + 1 : session.mainIndex + 1;
      total = isReview ? session.reviewQueue.length : session.mainQueue.length;
      if (phaseBadge) {
        phaseBadge.textContent = isReview ? '復習中' : '';
        phaseBadge.classList.remove('test-pill');
      }
    }

    $('progress-fill').style.width = `${Math.min(100, Math.round((cur / total) * 100))}%`;
    $('progress-text').textContent = `${cur} / ${total}`;

    const scoreCounterEl = $('study-score-counter');
    if (scoreCounterEl) {
      if (batch) {
        scoreCounterEl.classList.add('hidden');
      } else {
        scoreCounterEl.classList.remove('hidden');
        const okCount = session.kind === 'test'
          ? session.testRecords.filter((r) => r.isCorrect).length
          : session.sessionCorrect;
        const ngCount = session.kind === 'test'
          ? session.testRecords.filter((r) => !r.isCorrect).length
          : session.sessionWrong;
        const okEl = $('study-ok-count');
        const ngEl = $('study-ng-count');
        if (okEl) okEl.textContent = String(okCount);
        if (ngEl) ngEl.textContent = String(ngCount);
      }
    }

    // Undo / Prev button tooltip
    const undoBtn = $('btn-undo');
    if (undoBtn) {
      undoBtn.title = batch ? '前の問題へ' : '1つ戻る';
      undoBtn.style.opacity = (batch && session.testIndex === 0) ? '0.4' : '1';
    }

    syncPinButtons(card.pinned);
    $('front-cat-tag').textContent = card.category || '一般';
    $('back-cat-tag').textContent = card.category || '一般';

    const frontBadge = $('front-badge');
    const backBadge = $('back-badge');
    if (ctx.settings.reverse) {
      frontBadge.textContent = 'A';
      frontBadge.classList.add('back');
      backBadge.textContent = 'Q';
      backBadge.classList.remove('back');
    } else {
      frontBadge.textContent = 'Q';
      frontBadge.classList.remove('back');
      backBadge.textContent = 'A';
      backBadge.classList.add('back');
    }

    const frontText = ctx.settings.reverse ? card.back : card.front;
    const backText = ctx.settings.reverse ? card.front : card.back;
    renderContent($('front-content'), frontText);
    renderContent($('back-content'), backText);

    // Async image hydration with sequence guard
    const fImg = $('front-image');
    const bImg = $('back-image');
    fImg.classList.add('hidden');
    bImg.classList.add('hidden');
    if (card.image) {
      getImageUrl(card.image).then((src) => {
        if (seq !== renderSeq || !src) return;
        const target = ctx.settings.reverse ? bImg : fImg;
        target.src = src;
        target.classList.remove('hidden');
      });
    }

    // Hint (hide in batch test to keep test authentic, show otherwise)
    const hintBtn = $('btn-hint');
    const hintBox = $('hint-text');
    hintBox.classList.add('hidden');
    if (card.hint && !batch) {
      hintBtn.classList.remove('hidden');
      renderContent(hintBox, card.hint);
    } else {
      hintBtn.classList.add('hidden');
    }

    const flipper = $('card-flipper');
    flipper.style.transition = 'none';
    flipper.classList.toggle('is-flipped', session.isFlipped);
    void flipper.offsetWidth;
    flipper.style.transition = '';

    resetCardTransform($('card-stage'), $('swipe-badge-left'), $('swipe-badge-right'), true);

    $('flip-controls').classList.toggle('hidden', fmt !== 'flip');
    $('choice-container').classList.toggle('hidden', fmt !== 'choice');
    $('input-container').classList.toggle('hidden', fmt !== 'input');
    $('batch-nav-bar').classList.add('hidden');

    if (fmt !== 'input') {
      document.body.classList.remove('input-cloze-hide');
    }
    if (fmt === 'choice') renderMultipleChoice(card);
    if (fmt === 'input') prepareInputMode(card);

    if (session.kind === 'memorize') {
      persistCurrentSession(true);
    }
  }

  function flipCard(forceState) {
    const fmt = ctx.settings.format;
    if (isBatchTest() && fmt !== 'flip') return;
    if (fmt !== 'flip' && fmt !== 'input') return;
    stopSpeech();
    session.isFlipped = typeof forceState === 'boolean' ? forceState : !session.isFlipped;
    $('card-flipper').classList.toggle('is-flipped', session.isFlipped);
    if (session.kind === 'memorize') persistCurrentSession(true);
    ctx.haptic(10);
  }

  function getChoiceOptionsForCurrent(card) {
    const deck = ctx.getActiveDeck();
    const correctLabel = ctx.settings.reverse
      ? card.front
      : extractClozeTargets(card.back).join(' / ');

    if (isBatchTest() && session.batchChoiceMap.has(session.testIndex)) {
      return { correctLabel, options: session.batchChoiceMap.get(session.testIndex) };
    }

    const sameCat = deck.cards.filter((c) => c.id !== card.id && c.category === card.category);
    const otherCat = deck.cards.filter((c) => c.id !== card.id && c.category !== card.category);
    const pool = [...sameCat, ...otherCat].map((c) =>
      ctx.settings.reverse ? c.front : extractClozeTargets(c.back).join(' / ')
    );

    const uniqueDistractors = [];
    for (const item of pool) {
      if (item && item !== correctLabel && !uniqueDistractors.includes(item)) {
        uniqueDistractors.push(item);
      }
    }
    const picked = shuffleArray(uniqueDistractors).slice(0, 3);
    const options = shuffleArray([correctLabel, ...picked]);

    if (isBatchTest()) {
      session.batchChoiceMap.set(session.testIndex, options);
    }
    return { correctLabel, options };
  }

  function renderMultipleChoice(card) {
    const container = $('choice-container');
    container.innerHTML = '';

    const { correctLabel, options } = getChoiceOptionsForCurrent(card);
    const batch = isBatchTest();
    const prevDraft = batch ? session.batchAnswers[session.testIndex] : null;

    options.forEach((optText) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'quiz-option';
      if (batch && prevDraft && prevDraft.choiceValue === optText) {
        btn.classList.add('is-selected');
      }
      btn.textContent = optText.replace(/【|】/g, '');
      renderMathIfReady(btn, false);

      btn.addEventListener('click', () => {
        if (session.answeredCurrent) return;
        session.answeredCurrent = true;
        const isCorrect = optText === correctLabel;

        if (batch) {
          ctx.haptic(10);
          Array.from(container.children).forEach((el) => el.classList.remove('is-selected'));
          btn.classList.add('is-selected');
          session.batchAnswers[session.testIndex] = {
            choiceValue: optText,
            correctLabel,
            isCorrect
          };
          schedule(() => advanceBatchTest(), 150);
          return;
        }

        ctx.haptic(isCorrect ? 14 : 30);
        btn.classList.add(isCorrect ? 'is-correct' : 'is-wrong');
        if (!isCorrect) {
          Array.from(container.children).forEach((child, idx) => {
            if (options[idx] === correctLabel) child.classList.add('is-correct');
          });
        }
        $('card-flipper').classList.add('is-flipped');

        const meta = {
          userAnswer: optText.replace(/【|】/g, ''),
          correctAnswer: correctLabel.replace(/【|】/g, '')
        };
        schedule(() => recordAnswer(isCorrect, meta), isCorrect ? 520 : 1100);
      });

      container.appendChild(btn);
    });
  }

  function prepareInputMode(card) {
    const list = $('input-fields-list');
    const fb = $('input-feedback');
    const overrideBtn = $('btn-input-override');
    const submitBtn = $('btn-submit-answer');
    const nextBtn = $('btn-input-next');
    const selfJudge = $('input-self-judge');
    const batchNav = $('batch-nav-bar');
    const batchNextBtn = $('btn-batch-next');
    if (!list) return;

    document.body.classList.add('input-cloze-hide');

    const batch = isBatchTest();
    const reverse = ctx.settings.reverse;
    const structure = getInputStructureForCard(card, ctx.appData, reverse);
    const { targets, groups, groupIndexBySlot } = structure;
    const count = Math.max(1, targets.length);
    const isMulti = count > 1;
    const lockedSet = new Set(getCardLockedArray(card, reverse).filter((n) => n >= 0 && n < count));
    const prevDraft = batch ? session.batchAnswers[session.testIndex] : null;

    list.innerHTML = '';
    fb.classList.add('hidden');
    overrideBtn?.classList.add('hidden');
    nextBtn.classList.add('hidden');
    selfJudge?.classList.add('hidden');

    if (batch) {
      submitBtn.classList.add('hidden');
      batchNav?.classList.remove('hidden');
      if (batchNextBtn) {
        const isLast = session.testIndex >= session.testQueue.length - 1;
        batchNextBtn.textContent = isLast ? '採点する' : '次へ';
        batchNextBtn.onclick = () => submitBatchInput(inputs, card);
      }
    } else {
      submitBtn.classList.remove('hidden');
      batchNav?.classList.add('hidden');
    }

    const inputs = [];
    const lockBtns = [];

    const updateSubmitAndHints = () => {
      if (!batch) {
        const activeCount = count - lockedSet.size;
        if (activeCount === 0) submitBtn.textContent = '答えを確認（全枠ロック中）';
        else if (lockedSet.size > 0) submitBtn.textContent = `判定する（対象 ${activeCount}/${count}）`;
        else submitBtn.textContent = isMulti ? `判定する（全${count}箇所）` : '判定する';
      }
      inputs.forEach((inp, idx) => {
        const hasNextActive = inputs.slice(idx + 1).some((el) => !el.disabled);
        inp.enterKeyHint = hasNextActive ? 'next' : 'done';
      });
    };

    const applyRowLockVisual = (idx) => {
      const isLocked = lockedSet.has(idx);
      const inp = inputs[idx];
      const lBtn = lockBtns[idx];
      const gIdx = groupIndexBySlot[idx] ?? 0;
      const isSlotUnordered = (groups[gIdx]?.indices.length || 0) > 1;
      if (inp) {
        inp.disabled = isLocked;
        inp.classList.toggle('is-locked', isLocked);
        inp.placeholder = isLocked
          ? 'ロック中（判定除外）'
          : (isSlotUnordered
              ? `答え ${idx + 1}（順不同可）`
              : (isMulti ? `答え ${idx + 1}` : '答えを入力...'));
      }
      if (lBtn) {
        lBtn.innerHTML = isLocked ? ICONS.lock : ICONS.unlock;
        lBtn.classList.toggle('is-locked', isLocked);
        lBtn.title = isLocked ? 'ロック解除' : '判定から除外（ロック）';
        lBtn.setAttribute('aria-pressed', String(isLocked));
      }
    };

    let multiGroupOrder = 0;
    const multiGroupVisualMap = new Map();
    groups.forEach((g, gi) => {
      if (g.indices.length > 1) {
        multiGroupVisualMap.set(gi, multiGroupOrder % 2);
        multiGroupOrder += 1;
      }
    });

    for (let i = 0; i < count; i++) {
      const item = document.createElement('div');
      item.className = 'input-field-item';

      const row = document.createElement('div');
      row.className = 'input-field-row';

      const gIdx = groupIndexBySlot[i] ?? 0;
      const isSlotUnordered = (groups[gIdx]?.indices.length || 0) > 1;

      if (isMulti) {
        const badge = document.createElement('span');
        badge.className = 'input-index-badge';
        if (isSlotUnordered) {
          badge.classList.add('is-unordered');
          if (multiGroupVisualMap.get(gIdx) === 1) badge.classList.add('group-alt');
          badge.textContent = `${i + 1}⇄`;
        } else {
          badge.textContent = String(i + 1);
        }
        row.appendChild(badge);
      }

      const inp = document.createElement('input');
      inp.type = 'text';
      inp.className = 'cloze-answer-input';
      inp.autocomplete = 'off';
      inp.autocapitalize = 'off';
      inp.spellcheck = false;
      if (prevDraft && Array.isArray(prevDraft.inputValues)) {
        inp.value = prevDraft.inputValues[i] || '';
      }

      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const nextActive = inputs.slice(i + 1).find((el) => !el.disabled);
          if (nextActive) nextActive.focus();
          else if (batch) submitBatchInput(inputs, card);
          else checkTextAnswer();
        }
      });

      const lockBtn = document.createElement('button');
      lockBtn.type = 'button';
      lockBtn.className = 'input-lock-btn';
      lockBtn.addEventListener('click', () => {
        if (session.answeredCurrent) return;
        ctx.haptic(8);
        if (lockedSet.has(i)) lockedSet.delete(i);
        else lockedSet.add(i);
        setCardLockedArray(card, reverse, Array.from(lockedSet).sort((a, b) => a - b));
        ctx.save();
        applyRowLockVisual(i);
        updateSubmitAndHints();
        if (!lockedSet.has(i)) inp.focus();
      });

      const mark = document.createElement('span');
      mark.className = 'input-item-mark hidden';

      row.appendChild(inp);
      row.appendChild(lockBtn);
      row.appendChild(mark);
      item.appendChild(row);
      list.appendChild(item);

      inputs.push(inp);
      lockBtns.push(lockBtn);
      applyRowLockVisual(i);
    }

    updateSubmitAndHints();

    const firstActive = inputs.find((el) => !el.disabled);
    if (firstActive) {
      schedule(() => firstActive.focus(), 60);
    }
  }

  function submitBatchInput(inputs, card) {
    if (session.answeredCurrent) return;
    session.answeredCurrent = true;
    const values = inputs.map((el) => el.value);
    const graded = gradeClozeValues(card, values, ctx.appData, ctx.settings.reverse);
    session.batchAnswers[session.testIndex] = {
      inputValues: values,
      isCorrect: graded.activeTotal === 0 ? true : graded.isAllCorrect,
      userAnswer: values.filter((_, i) => graded.slotResults[i]?.status !== 'locked').join(' / '),
      correctAnswer: graded.slotResults
        .filter((r) => r && r.status !== 'locked')
        .map((r) => r.displayAnswer)
        .join(' / ')
    };
    ctx.haptic(10);
    advanceBatchTest();
  }

  function checkTextAnswer() {
    const card = getCurrentCard();
    if (!card || session.answeredCurrent) return;
    session.answeredCurrent = true;

    document.body.classList.remove('input-cloze-hide');

    const items = Array.from($('input-fields-list')?.querySelectorAll('.input-field-item') || []);
    const userValues = items.map((item) => item.querySelector('.cloze-answer-input')?.value || '');
    const graded = gradeClozeValues(card, userValues, ctx.appData, ctx.settings.reverse);
    const isMulti = graded.targets.length > 1;

    graded.slotResults.forEach((res, idx) => {
      const item = items[idx];
      const inp = item?.querySelector('.cloze-answer-input');
      const lockBtn = item?.querySelector('.input-lock-btn');
      const mark = item?.querySelector('.input-item-mark');

      if (lockBtn) lockBtn.disabled = true;

      if (res.status === 'locked') {
        if (inp) {
          inp.disabled = true;
          inp.classList.add('is-locked-result');
        }
        if (mark) {
          mark.classList.remove('hidden', 'ok', 'ng', 'locked');
          mark.classList.add('locked');
          mark.innerHTML = ICONS.lock;
        }
        return;
      }

      const ok = res.status === 'ok';
      if (inp) {
        inp.disabled = true;
        inp.classList.add(ok ? 'is-ok' : 'is-ng');
      }
      if (mark) {
        mark.classList.remove('hidden', 'ok', 'ng', 'locked');
        mark.classList.add(ok ? 'ok' : 'ng');
        mark.textContent = ok ? '◯' : '×';
      }
      if (!ok && item) {
        const hintLine = document.createElement('div');
        hintLine.className = 'input-item-correct-hint' + (isMulti ? '' : ' no-badge');
        hintLine.textContent = `正解: ${res.displayAnswer}`;
        item.appendChild(hintLine);
      }
    });

    $('btn-submit-answer').classList.add('hidden');
    $('card-flipper').classList.add('is-flipped');

    const fb = $('input-feedback');
    const overrideBtn = $('btn-input-override');
    fb.classList.remove('ok', 'ng');
    overrideBtn?.classList.add('hidden');

    if (graded.activeTotal === 0) {
      ctx.haptic(10);
      session.awaitingSelfJudge = true;
      fb.classList.add('hidden');
      const selfJudge = $('input-self-judge');
      selfJudge?.classList.remove('hidden');
      $('btn-input-self-wrong').onclick = () => animateButtonJudge(false, true);
      $('btn-input-self-correct').onclick = () => animateButtonJudge(true, true);
      return;
    }

    const isAllCorrect = graded.isAllCorrect;
    ctx.haptic(isAllCorrect ? 14 : 30);

    fb.classList.remove('hidden');
    fb.classList.add(isAllCorrect ? 'ok' : 'ng');
    const lockNote = graded.lockedCount > 0 ? `（${graded.lockedCount}除外）` : '';
    fb.textContent = graded.activeTotal > 1
      ? (isAllCorrect ? `◯ 全${graded.activeTotal}箇所 正解${lockNote}` : `× ${graded.activeCorrect}/${graded.activeTotal} 正解${lockNote}`)
      : (isAllCorrect ? `◯ 正解${lockNote}` : `× 不正解${lockNote}`);

    const meta = {
      userAnswer: userValues.filter((_, i) => graded.slotResults[i]?.status !== 'locked').join(' / '),
      correctAnswer: graded.slotResults
        .filter((r) => r && r.status !== 'locked')
        .map((r) => r.displayAnswer)
        .join(' / ')
    };

    const nextBtn = $('btn-input-next');
    nextBtn.classList.remove('hidden');
    nextBtn.onclick = () => recordAnswer(isAllCorrect, meta);

    if (!isAllCorrect && overrideBtn) {
      overrideBtn.classList.remove('hidden');
      overrideBtn.onclick = () => {
        showToast('◯として記録しました');
        recordAnswer(true, meta);
      };
    }

    schedule(() => nextBtn.focus(), 60);
  }

  function advanceBatchTest() {
    if (session.testIndex + 1 >= session.testQueue.length) {
      finishBatchTest();
    } else {
      session.testIndex += 1;
      renderCurrentCard(false);
    }
  }

  function finishBatchTest() {
    const deck = ctx.getActiveDeck();
    if (!deck) return;

    session.testRecords = [];
    session.testQueue.forEach((cardId, idx) => {
      const card = deck.cards.find((c) => c.id === cardId);
      if (!card) return;
      const ans = session.batchAnswers[idx];
      const isCorrect = Boolean(ans && ans.isCorrect);
      applySrsUpdate(card, isCorrect);
      recordDailyActivity(ctx.appData, 1);

      const fallbackCorrect = (ctx.settings.reverse ? card.front : card.back).replace(/【|】/g, '');
      session.testRecords.push({
        cardId: card.id,
        isCorrect,
        userAnswer: ans?.userAnswer || ans?.choiceValue?.replace(/【|】/g, '') || '',
        correctAnswer: ans?.correctAnswer || ans?.correctLabel?.replace(/【|】/g, '') || fallbackCorrect
      });
    });

    ctx.save();
    finishTest();
  }

  function recordAnswer(isCorrect, meta = null) {
    const card = getCurrentCard();
    if (!card) return;

    if (isBatchTest()) {
      // Flip mode in batch test
      session.batchAnswers[session.testIndex] = {
        isCorrect,
        userAnswer: isCorrect ? '◯（自己採点）' : '×（自己採点）',
        correctAnswer: (ctx.settings.reverse ? card.front : card.back).replace(/【|】/g, '')
      };
      advanceBatchTest();
      return;
    }

    if (session.kind === 'test') {
      applySrsUpdate(card, isCorrect);
      recordDailyActivity(ctx.appData, 1);
      ctx.save();

      session.testRecords.push({
        cardId: card.id,
        isCorrect,
        userAnswer: meta?.userAnswer || '',
        correctAnswer: meta?.correctAnswer || (ctx.settings.reverse ? card.front : card.back).replace(/【|】/g, '')
      });

      session.testIndex += 1;
      if (session.testIndex >= session.testQueue.length) {
        finishTest();
      } else {
        renderCurrentCard(false);
      }
      return;
    }

    // Memorize mode
    pushUndo({
      phase: session.phase,
      mainIndex: session.mainIndex,
      mainStepsSinceReview: session.mainStepsSinceReview,
      wrongPool: [...session.wrongPool],
      reviewQueue: [...session.reviewQueue],
      reviewIndex: session.reviewIndex,
      sessionCorrect: session.sessionCorrect,
      sessionWrong: session.sessionWrong,
      cardId: card.id,
      cardStats: {
        correctCount: card.correctCount,
        wrongCount: card.wrongCount,
        srsLevel: card.srsLevel,
        nextReview: card.nextReview
      }
    });

    applySrsUpdate(card, isCorrect);
    if (isCorrect) session.sessionCorrect += 1;
    else session.sessionWrong += 1;
    recordDailyActivity(ctx.appData, 1);
    ctx.save();

    if (session.phase === 'review') {
      if (isCorrect) {
        session.wrongPool = session.wrongPool.filter((id) => id !== card.id);
      }
      session.reviewIndex += 1;

      if (session.reviewIndex >= session.reviewQueue.length) {
        session.phase = 'main';
        session.reviewQueue = [];
        session.reviewIndex = 0;

        if (session.mainIndex >= session.mainQueue.length) {
          if (session.wrongPool.length > 0) enterReviewMode();
          else showCompleteScreen();
          return;
        }
      }
      renderCurrentCard(false);
      return;
    }

    if (!isCorrect && !session.wrongPool.includes(card.id)) {
      session.wrongPool.push(card.id);
    }
    session.mainIndex += 1;
    session.mainStepsSinceReview += 1;

    if (ctx.settings.mode === 'smart') {
      const hitFiveWrong = session.wrongPool.length >= 5;
      const hitFiveCycle = session.mainStepsSinceReview >= 5 && session.wrongPool.length > 0;
      const hitEndWithWrong = session.mainIndex >= session.mainQueue.length && session.wrongPool.length > 0;

      if (hitFiveWrong || hitFiveCycle || hitEndWithWrong) {
        enterReviewMode();
        return;
      }
    }

    if (session.mainIndex >= session.mainQueue.length) {
      showCompleteScreen();
    } else {
      renderCurrentCard(false);
    }
  }

  function enterReviewMode() {
    clearPendingTimers();
    session.phase = 'review';
    session.reviewQueue = [...session.wrongPool];
    session.reviewIndex = 0;
    session.mainStepsSinceReview = 0;
    session.isFlipped = false;

    persistCurrentSession(true);
    resetCardTransform($('card-stage'), $('swipe-badge-left'), $('swipe-badge-right'), true);
    setStudyBehindVisible(false);

    $('review-count-label').textContent = `間違えた ${session.reviewQueue.length}問 を復習します`;
    $('review-interstitial').classList.remove('hidden');
  }

  function showCompleteScreen() {
    clearPendingTimers();
    resetCardTransform($('card-stage'), $('swipe-badge-left'), $('swipe-badge-right'), true);
    const deck = ctx.getActiveDeck();
    if (deck) clearSavedSession(ctx.appData, deck.id, ctx.settings.format);
    ctx.appData.activeStudy = null;
    ctx.save();

    const totalJudged = session.sessionCorrect + session.sessionWrong;
    const acc = totalJudged > 0 ? Math.round((session.sessionCorrect / totalJudged) * 100) : 0;
    $('complete-summary').textContent = `${deck ? deck.title : ''} を完了しました（正答率 ${acc}%）`;
    const cOk = $('complete-ok-count');
    const cNg = $('complete-ng-count');
    if (cOk) cOk.textContent = String(session.sessionCorrect);
    if (cNg) cNg.textContent = String(session.sessionWrong);
    $('complete-interstitial').classList.remove('hidden');
    ctx.haptic(20);
  }

  function finishTest() {
    clearPendingTimers();
    stopTestTimer();
    stopSpeech();
    document.body.classList.remove('input-cloze-hide');

    const total = session.testRecords.length;
    const correct = session.testRecords.filter((r) => r.isCorrect).length;
    const acc = total > 0 ? Math.round((correct / total) * 100) : 0;

    const wrongCount = total - correct;
    $('test-result-score').textContent = `${correct} / ${total}`;
    const breakdownEl = $('test-result-breakdown');
    if (breakdownEl) breakdownEl.textContent = `正解 ${correct}問 / 間違い ${wrongCount}問`;
    $('test-result-acc').textContent = `正答率 ${acc}%`;

    const timeEl = $('test-result-time');
    if (ctx.settings.testTimer && timeEl) {
      session.testElapsedSec = Math.floor((Date.now() - session.testStartedAt) / 1000);
      timeEl.textContent = `時間 ${formatSec(session.testElapsedSec)}`;
      timeEl.classList.remove('hidden');
    } else {
      timeEl?.classList.add('hidden');
    }

    const retestBtn = $('btn-retest-wrong');
    const pinBtn = $('btn-pin-wrong');
    if (retestBtn) {
      retestBtn.disabled = wrongCount === 0;
      retestBtn.style.opacity = wrongCount === 0 ? '0.45' : '1';
      retestBtn.textContent = wrongCount > 0 ? `×だけ再テスト (${wrongCount})` : '全問正解！';
    }
    if (pinBtn) {
      pinBtn.disabled = wrongCount === 0;
      pinBtn.style.opacity = wrongCount === 0 ? '0.45' : '1';
    }

    session.resultFilter = 'all';
    renderTestResultList();
    $('test-result-overlay').classList.remove('hidden');
    ctx.haptic(20);
  }

  function renderTestResultList() {
    const list = $('test-result-list');
    const deck = ctx.getActiveDeck();
    if (!list || !deck) return;

    $('btn-res-all')?.classList.toggle('active', session.resultFilter === 'all');
    $('btn-res-wrong')?.classList.toggle('active', session.resultFilter === 'wrong');

    const rows = session.resultFilter === 'wrong'
      ? session.testRecords.filter((r) => !r.isCorrect)
      : session.testRecords;

    list.innerHTML = '';
    if (rows.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'stats-empty-msg';
      empty.textContent = '該当する問題はありません';
      list.appendChild(empty);
      return;
    }

    rows.forEach((rec) => {
      const card = deck.cards.find((c) => c.id === rec.cardId);
      if (!card) return;

      const row = document.createElement('div');
      row.className = 'result-row';

      const head = document.createElement('div');
      head.className = 'result-row-head';
      head.innerHTML = `
        <span class="result-mark ${rec.isCorrect ? 'ok' : 'ng'}">${rec.isCorrect ? '◯ 正解' : '× 不正解'}</span>
        <span class="muted-small">${escapeHtml(card.category || '一般')}</span>
      `;

      const qDiv = document.createElement('div');
      qDiv.className = 'result-q';
      renderContent(qDiv, ctx.settings.reverse ? card.back : card.front);

      const aDiv = document.createElement('div');
      aDiv.className = 'result-a';
      renderContent(aDiv, ctx.settings.reverse ? card.front : card.back);

      row.appendChild(head);
      row.appendChild(qDiv);
      row.appendChild(aDiv);

      if (!rec.isCorrect && rec.userAnswer) {
        const uDiv = document.createElement('div');
        uDiv.className = 'result-user-ans';
        uDiv.textContent = `あなたの回答: ${rec.userAnswer}`;
        row.appendChild(uDiv);
      }

      list.appendChild(row);
    });
  }

  function performUndoOrPrev() {
    if (!session.active) return;
    clearPendingTimers();
    stopSpeech();

    if (isBatchTest()) {
      if (session.testIndex > 0) {
        ctx.haptic(10);
        session.testIndex -= 1;
        renderCurrentCard(false);
      }
      return;
    }

    if (session.kind === 'test') {
      showToast('テスト（1問ごと判定）中は戻れません');
      return;
    }

    const snap = popUndo();
    if (!snap) return;

    ctx.haptic(10);
    const deck = ctx.getActiveDeck();
    const card = deck?.cards.find((c) => c.id === snap.cardId);
    if (card && snap.cardStats) {
      Object.assign(card, snap.cardStats);
      ctx.save();
    }

    session.phase = snap.phase;
    session.mainIndex = snap.mainIndex;
    session.mainStepsSinceReview = snap.mainStepsSinceReview;
    session.wrongPool = snap.wrongPool;
    session.reviewQueue = snap.reviewQueue;
    session.reviewIndex = snap.reviewIndex;
    if (typeof snap.sessionCorrect === 'number') session.sessionCorrect = snap.sessionCorrect;
    if (typeof snap.sessionWrong === 'number') session.sessionWrong = snap.sessionWrong;

    $('review-interstitial').classList.add('hidden');
    $('complete-interstitial').classList.add('hidden');
    setStudyBehindVisible(true);
    renderCurrentCard(false);
  }

  function animateButtonJudge(isCorrect, allowSelfJudge = false) {
    if (!session.active || session.animatingJudge || (session.answeredCurrent && !allowSelfJudge)) return;
    session.awaitingSelfJudge = false;
    session.animatingJudge = true;
    ctx.haptic(isCorrect ? 12 : 18);

    const cardEl = $('card-stage');
    const leftBadge = $('swipe-badge-left');
    const rightBadge = $('swipe-badge-right');

    if (cardEl) {
      cardEl.classList.remove('spring-back', 'swiping-left', 'swiping-right');
      cardEl.classList.add(isCorrect ? 'swiping-right' : 'swiping-left', 'btn-fly-out');
      const dir = isCorrect ? 1 : -1;
      cardEl.style.transform = `translate3d(${dir * 420}px, 20px, 0) rotate(${dir * 14}deg)`;
      cardEl.style.opacity = '0.12';
    }
    if (isCorrect && rightBadge) {
      rightBadge.style.opacity = '0.9';
      rightBadge.classList.add('is-ready');
    } else if (!isCorrect && leftBadge) {
      leftBadge.style.opacity = '0.9';
      leftBadge.classList.add('is-ready');
    }

    schedule(() => {
      session.animatingJudge = false;
      recordAnswer(isCorrect);
    }, 200);
  }

  function bindEvents() {
    initSpeech((activeSide) => {
      $('btn-speak-front')?.classList.toggle('is-speaking', activeSide === 'front');
      $('btn-speak-back')?.classList.toggle('is-speaking', activeSide === 'back');
    });

    bindCardGestures({
      cardEl: $('card-stage'),
      leftBadge: $('swipe-badge-left'),
      rightBadge: $('swipe-badge-right'),
      canSwipeJudge: () => session.active && (ctx.settings.format === 'flip' || session.awaitingSelfJudge),
      onSwipeJudge: (isRight) => {
        schedule(() => recordAnswer(isRight), 150);
      },
      onSwipeDownUndo: () => performUndoOrPrev(),
      onTapFlip: () => flipCard(),
      onTapCloze: (clozeEl) => {
        if (ctx.settings.redsheet && !(ctx.settings.format === 'input' && !session.answeredCurrent)) {
          clozeEl.classList.toggle('revealed');
          ctx.haptic(8);
          return true;
        }
        return false;
      },
      onTapImage: (src) => openLightbox(src),
      haptic: ctx.haptic
    });

    $('btn-exit-study')?.addEventListener('click', exit);

    $('btn-study-redsheet')?.addEventListener('click', () => {
      ctx.settings.redsheet = !ctx.settings.redsheet;
      ctx.savePreferences();
      ctx.haptic(8);
      ctx.applyThemeAndRedsheet();
    });

    $('btn-undo')?.addEventListener('click', performUndoOrPrev);

    $('btn-speak-front')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const card = getCurrentCard();
      if (!card) return;
      ctx.haptic(8);
      speakText('front', ctx.settings.reverse ? card.back : card.front, () => {
        showToast('音声読み上げに対応していません');
      });
    });

    $('btn-speak-back')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const card = getCurrentCard();
      if (!card) return;
      ctx.haptic(8);
      speakText('back', ctx.settings.reverse ? card.front : card.back, () => {
        showToast('音声読み上げに対応していません');
      });
    });

    [$('btn-pin-front'), $('btn-pin-back')].forEach((btn) => {
      btn?.addEventListener('click', (e) => {
        e.stopPropagation();
        const card = getCurrentCard();
        if (!card) return;
        card.pinned = !card.pinned;
        ctx.save();
        ctx.haptic(10);
        syncPinButtons(card.pinned);
      });
    });

    [$('btn-edit-current-front'), $('btn-edit-current-back')].forEach((btn) => {
      btn?.addEventListener('click', (e) => {
        e.stopPropagation();
        const card = getCurrentCard();
        if (!card) return;
        ctx.openCardEditModal(card, () => renderCurrentCard(session.isFlipped));
      });
    });

    $('btn-hint')?.addEventListener('click', (e) => {
      e.stopPropagation();
      $('hint-text')?.classList.toggle('hidden');
    });

    $('btn-wrong')?.addEventListener('click', () => animateButtonJudge(false));
    $('btn-correct')?.addEventListener('click', () => animateButtonJudge(true));

    $('btn-start-review')?.addEventListener('click', () => {
      $('review-interstitial').classList.add('hidden');
      setStudyBehindVisible(true);
      renderCurrentCard(false);
    });

    $('btn-restart-session')?.addEventListener('click', () => startMemorize(true));
    $('btn-complete-home')?.addEventListener('click', exit);
    $('btn-submit-answer')?.addEventListener('click', checkTextAnswer);

    // Test result overlay events
    $('btn-res-all')?.addEventListener('click', () => {
      session.resultFilter = 'all';
      renderTestResultList();
    });
    $('btn-res-wrong')?.addEventListener('click', () => {
      session.resultFilter = 'wrong';
      renderTestResultList();
    });
    $('btn-retest-wrong')?.addEventListener('click', () => {
      const wrongIds = session.testRecords.filter((r) => !r.isCorrect).map((r) => r.cardId);
      if (wrongIds.length === 0) return;
      startTest(wrongIds);
    });
    $('btn-pin-wrong')?.addEventListener('click', () => {
      const deck = ctx.getActiveDeck();
      if (!deck) return;
      const wrongIds = new Set(session.testRecords.filter((r) => !r.isCorrect).map((r) => r.cardId));
      let count = 0;
      deck.cards.forEach((c) => {
        if (wrongIds.has(c.id) && !c.pinned) {
          c.pinned = true;
          count += 1;
        }
      });
      ctx.save();
      showToast(count > 0 ? `${count}問に★ピン留めしました` : 'すでにすべて★ピン留め済みです');
    });
    $('btn-result-home')?.addEventListener('click', exit);

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (isAnyModalOpen()) return;
      if (document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;

      if (e.key === '?' && session.active) {
        e.preventDefault();
        openShortcutsModal();
        return;
      }
      if (!session.active) return;

      if (e.key === 'z' || e.key === 'Z' || e.key === 'Backspace') {
        e.preventDefault();
        performUndoOrPrev();
        return;
      }

      if (e.key === 'h' || e.key === 'H') {
        if (!$('btn-hint')?.classList.contains('hidden')) {
          $('hint-text')?.classList.toggle('hidden');
        }
        return;
      }

      if (e.key === 's' || e.key === 'S') {
        const card = getCurrentCard();
        if (card) {
          card.pinned = !card.pinned;
          ctx.save();
          syncPinButtons(card.pinned);
        }
        return;
      }

      if (ctx.settings.format === 'choice' && ['1', '2', '3', '4'].includes(e.key)) {
        const idx = Number(e.key) - 1;
        const btn = $('choice-container')?.children[idx];
        if (btn) {
          e.preventDefault();
          btn.click();
        }
        return;
      }

      if (ctx.settings.format === 'flip') {
        if (e.key === ' ' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          flipCard();
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          animateButtonJudge(true);
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          animateButtonJudge(false);
        }
      }
    });
  }

  return {
    startMemorize,
    startTest,
    restoreFromSaved,
    exit,
    persistCurrentSession,
    isActive: () => session.active,
    bindEvents
  };
}
