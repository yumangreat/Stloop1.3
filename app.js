(function () {
  const S = window.StudyStorage;
  let appData = S.loadData();

  const settings = {
    mode: 'smart',      // 'smart' | 'all' | 'weak' | 'srs'
    format: 'flip',     // 'flip' | 'choice' | 'input'
    category: 'ALL',
    reverse: false,
    shuffle: false,
    redsheet: false
  };

  const session = {
    active: false,
    phase: 'main',      // 'main' | 'review'
    mainQueue: [],
    mainIndex: 0,
    mainStepsSinceReview: 0,
    wrongPool: [],
    reviewQueue: [],
    reviewIndex: 0,
    isFlipped: false,
    answeredCurrent: false
  };

  let pendingImageDataUrl = '';
  let suppressFlipUntil = 0;
  let editingCardId = null;

  const $ = (id) => document.getElementById(id);

  function haptic(ms = 14) {
    if (navigator.vibrate) {
      try {
        navigator.vibrate(ms);
      } catch (_) {}
    }
  }

  function getActiveDeck() {
    return appData.decks.find((d) => d.id === appData.activeDeckId) || appData.decks[0];
  }

  function applyThemeAndRedsheet() {
    document.body.classList.toggle('dark', appData.theme === 'dark');
    document.body.classList.toggle('redsheet-on', settings.redsheet);
    const optBtn = $('opt-redsheet');
    if (optBtn) {
      optBtn.textContent = `赤シート: ${settings.redsheet ? 'ON' : 'OFF'}`;
      optBtn.classList.toggle('active', settings.redsheet);
    }
    const studyBtn = $('btn-study-redsheet');
    if (studyBtn) {
      studyBtn.classList.toggle('active', settings.redsheet);
    }
  }

  /* ==================== URLからの共有・一括引越し受信 ==================== */
  async function checkIncomingShareHash() {
    const hash = window.location.hash || '';
    if (!hash.startsWith('#share=') && !hash.startsWith('#bundle=')) return;

    try {
      if (hash.startsWith('#share=')) {
        const token = hash.slice(7);
        const sharedDeck = await S.decodeSharePayload(token);
        if (sharedDeck && sharedDeck.cards.length > 0) {
          appData.decks.push(sharedDeck);
          appData.activeDeckId = sharedDeck.id;
          S.saveData(appData);
          alert(`共有された単語帳「${sharedDeck.title}」（${sharedDeck.cards.length}問）を追加しました！`);
        }
      } else if (hash.startsWith('#bundle=')) {
        const token = hash.slice(8);
        const bundle = await S.decodeFullBundlePayload(token);
        if (bundle && bundle.decks.length > 0) {
          const totalCards = bundle.decks.reduce((sum, d) => sum + d.cards.length, 0);
          const ok = confirm(`引越しデータ（${bundle.decks.length}個の単語帳 / 計${totalCards}問）が見つかりました。\n現在の端末に取り込みますか？`);
          if (ok) {
            appData.decks.push(...bundle.decks);
            appData.activeDeckId = bundle.decks[0].id;
            if (bundle.examDate && !appData.examDate) {
              appData.examDate = bundle.examDate;
            }
            S.saveData(appData);
            alert(`${bundle.decks.length}個の単語帳を一括で取り込みました！`);
          }
        }
      }
    } catch (e) {
      console.warn('Share/Bundle decode failed:', e);
      alert('共有URLの読み込みに失敗しました。URLが途中で切れていないか確認してください。');
    } finally {
      history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  }

  /* ==================== 第1段階：ホーム画面（単語帳一覧） ==================== */
  function showHomeView() {
    session.active = false;
    $('view-study').classList.add('hidden');
    $('view-deck').classList.add('hidden');
    $('view-home').classList.remove('hidden');
    renderHomeDeckList();
  }

  function renderHomeDeckList() {
    const list = $('home-deck-list');
    if (!list) return;
    list.innerHTML = '';

    appData.decks.forEach((deck) => {
      const total = deck.cards.length;
      const mastered = deck.cards.filter((c) => c.correctCount > 0 && c.correctCount >= c.wrongCount).length;
      const weak = deck.cards.filter((c) => c.wrongCount > c.correctCount || c.pinned).length;
      const pct = total > 0 ? Math.round((mastered / total) * 100) : 0;

      const cardEl = document.createElement('div');
      cardEl.className = 'deck-card';
      cardEl.innerHTML = `
        <div class="deck-card-top">
          <div class="deck-card-title">${escapeText(deck.title)}</div>
          <span class="deck-card-count">${total}問</span>
        </div>
        <div class="deck-card-bar">
          <div class="deck-card-bar-fill" style="width: ${pct}%;"></div>
        </div>
        <div class="deck-card-meta">
          <span>定着率 ${pct}%（${mastered}/${total}）</span>
          <span>苦手・★ ${weak}問</span>
        </div>
      `;
      cardEl.addEventListener('click', () => {
        haptic(10);
        openDeckView(deck.id);
      });
      list.appendChild(cardEl);
    });
  }

  function escapeText(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  /* ==================== 第2段階：デッキ詳細画面 ==================== */
  function openDeckView(deckId) {
    appData.activeDeckId = deckId;
    settings.category = 'ALL';
    S.saveData(appData);

    $('view-home').classList.add('hidden');
    $('view-study').classList.add('hidden');
    $('view-deck').classList.remove('hidden');
    $('share-output').classList.add('hidden');

    refreshDeckHeaderAndFilters();
    switchTab('setup');
  }

  function refreshDeckHeaderAndFilters() {
    const deck = getActiveDeck();
    if (!deck) return;
    $('current-deck-title').textContent = deck.title;

    // カテゴリ一覧を抽出
    const filterSel = $('category-filter');
    if (filterSel) {
      const cats = Array.from(new Set(deck.cards.map((c) => c.category || '一般')));
      filterSel.innerHTML = `<option value="ALL">すべての単元（${deck.cards.length}問）</option>`;
      cats.forEach((cat) => {
        const count = deck.cards.filter((c) => (c.category || '一般') === cat).length;
        const opt = document.createElement('option');
        opt.value = cat;
        opt.textContent = `${cat}（${count}問）`;
        if (settings.category === cat) opt.selected = true;
        filterSel.appendChild(opt);
      });
    }

    updateExamCountdown();
    updateStartTargetCount();
  }

  function getFilteredCards(deck) {
    const now = Date.now();
    let list = [...deck.cards];
    if (settings.category && settings.category !== 'ALL') {
      list = list.filter((c) => (c.category || '一般') === settings.category);
    }
    if (settings.mode === 'weak') {
      list = list.filter((c) => c.wrongCount > c.correctCount || c.pinned);
    } else if (settings.mode === 'srs') {
      list = list.filter((c) => !c.nextReview || c.nextReview <= now);
    }
    return list;
  }

  function updateStartTargetCount() {
    const deck = getActiveDeck();
    const countSpan = $('start-target-count');
    const startBtn = $('btn-start-study');
    if (!deck || !countSpan || !startBtn) return;

    const targets = getFilteredCards(deck);
    countSpan.textContent = String(targets.length);
    startBtn.disabled = targets.length === 0;
    startBtn.style.opacity = targets.length === 0 ? '0.5' : '1';
  }

  function updateExamCountdown() {
    const input = $('exam-date');
    const badge = $('exam-countdown');
    if (!input || !badge) return;
    input.value = appData.examDate || '';
    if (!appData.examDate) {
      badge.textContent = '未設定';
      return;
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(appData.examDate + 'T00:00:00');
    const diffDays = Math.ceil((target - today) / 86400000);
    const deck = getActiveDeck();
    const unmastered = deck ? deck.cards.filter((c) => c.correctCount === 0).length : 0;

    if (diffDays < 0) {
      badge.textContent = '試験終了';
    } else if (diffDays === 0) {
      badge.textContent = '本日が試験日';
    } else {
      const perDay = Math.ceil(unmastered / diffDays);
      badge.textContent = `あと${diffDays}日（1日${perDay}問目安）`;
    }
  }

  function switchTab(tabName) {
    document.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tab === tabName);
    });
    document.querySelectorAll('.tab-panel').forEach((panel) => {
      panel.classList.toggle('active', panel.id === `panel-${tabName}`);
    });
    if (tabName === 'setup') updateStartTargetCount();
    if (tabName === 'sheet') renderSheetTab();
    if (tabName === 'stats') renderStatsTab();
    if (tabName === 'manage') renderManageTab();
  }

  function renderSheetTab() {
    const container = $('sheet-list');
    const deck = getActiveDeck();
    if (!container || !deck) return;
    container.innerHTML = '';
    deck.cards.forEach((card) => {
      const row = document.createElement('div');
      row.className = 'sheet-item';
      const qDiv = document.createElement('div');
      qDiv.className = 'sheet-q';
      const aDiv = document.createElement('div');
      aDiv.className = 'sheet-a';
      S.renderContent(qDiv, card.front);
      S.renderContent(aDiv, card.back);
      row.appendChild(qDiv);
      row.appendChild(aDiv);
      container.appendChild(row);
    });
  }

  function renderStatsTab() {
    const container = $('stats-container');
    const catBox = $('category-stats-container');
    const deck = getActiveDeck();
    if (!container || !deck) return;

    const total = deck.cards.length;
    const mastered = deck.cards.filter((c) => c.correctCount > 0 && c.correctCount >= c.wrongCount).length;
    const weak = deck.cards.filter((c) => c.wrongCount > c.correctCount || c.pinned).length;
    const totalCorrect = deck.cards.reduce((sum, c) => sum + c.correctCount, 0);
    const totalWrong = deck.cards.reduce((sum, c) => sum + c.wrongCount, 0);
    const acc = totalCorrect + totalWrong > 0
      ? Math.round((totalCorrect / (totalCorrect + totalWrong)) * 100)
      : 0;

    container.innerHTML = `
      <div class="stat-box"><div class="stat-val">${total}</div><div class="stat-lbl">総問題数</div></div>
      <div class="stat-box"><div class="stat-val">${mastered}</div><div class="stat-lbl">定着済み</div></div>
      <div class="stat-box"><div class="stat-val">${weak}</div><div class="stat-lbl">苦手・★ピン</div></div>
      <div class="stat-box"><div class="stat-val">${acc}%</div><div class="stat-lbl">通算正答率</div></div>
    `;

    if (catBox) {
      const cats = Array.from(new Set(deck.cards.map((c) => c.category || '一般')));
      if (cats.length === 0) {
        catBox.classList.add('hidden');
      } else {
        catBox.classList.remove('hidden');
        catBox.innerHTML = '<h3 class="section-label">単元別の定着状況</h3>';
        cats.forEach((cat) => {
          const items = deck.cards.filter((c) => (c.category || '一般') === cat);
          const m = items.filter((c) => c.correctCount > 0 && c.correctCount >= c.wrongCount).length;
          const pct = items.length > 0 ? Math.round((m / items.length) * 100) : 0;
          const row = document.createElement('div');
          row.className = 'cat-stat-row';
          row.innerHTML = `
            <div class="cat-stat-head">
              <span>${escapeText(cat)}</span>
              <span>${m} / ${items.length}問 (${pct}%)</span>
            </div>
            <div class="deck-card-bar">
              <div class="deck-card-bar-fill" style="width: ${pct}%;"></div>
            </div>
          `;
          catBox.appendChild(row);
        });
      }
    }
  }

  function renderManageTab() {
    const list = $('manage-card-list');
    const deck = getActiveDeck();
    if (!list || !deck) return;
    const query = ($('manage-search')?.value || '').trim().toLowerCase();
    list.innerHTML = '';

    deck.cards.forEach((card, idx) => {
      if (query && !card.front.toLowerCase().includes(query) && !card.back.toLowerCase().includes(query) && !card.category.toLowerCase().includes(query)) {
        return;
      }
      const item = document.createElement('div');
      item.className = 'manage-item';

      const info = document.createElement('div');
      info.className = 'manage-item-text';
      info.innerHTML = `<strong>[${escapeText(card.category)}]</strong> ${escapeText(card.front)}<br><span class="muted-small">${escapeText(card.back)}</span>`;

      const btns = document.createElement('div');
      btns.className = 'manage-item-btns';

      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'btn-icon';
      editBtn.textContent = '✎';
      editBtn.addEventListener('click', () => openEditModal(card));

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'btn-icon';
      delBtn.textContent = '×';
      delBtn.addEventListener('click', () => {
        if (!confirm('このカードを削除しますか？')) return;
        deck.cards.splice(idx, 1);
        S.saveData(appData);
        refreshDeckHeaderAndFilters();
        renderManageTab();
      });

      btns.appendChild(editBtn);
      btns.appendChild(delBtn);
      item.appendChild(info);
      item.appendChild(btns);
      list.appendChild(item);
    });
  }

  /* ==================== カード編集モーダル ==================== */
  function openEditModal(card) {
    editingCardId = card.id;
    $('edit-card-cat').value = card.category || '';
    $('edit-card-front').value = card.front || '';
    $('edit-card-back').value = card.back || '';
    $('edit-card-hint').value = card.hint || '';
    $('edit-modal').classList.remove('hidden');
  }

  function closeEditModal() {
    editingCardId = null;
    $('edit-modal').classList.add('hidden');
  }

  /* ==================== 第3段階：学習セッション＆復習ロジック ==================== */
  function buildQueueForMode(deck) {
    const list = getFilteredCards(deck);
    if (settings.shuffle) {
      for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [list[i], list[j]] = [list[j], list[i]];
      }
    }
    return list.map((c) => c.id);
  }

  function startStudySession() {
    const deck = getActiveDeck();
    if (!deck || deck.cards.length === 0) return;

    const queue = buildQueueForMode(deck);
    if (queue.length === 0) return;

    haptic(18);
    S.clearUndo();
    session.active = true;
    session.phase = 'main';
    session.mainQueue = queue;
    session.mainIndex = 0;
    session.mainStepsSinceReview = 0;
    session.wrongPool = [];
    session.reviewQueue = [];
    session.reviewIndex = 0;
    session.isFlipped = false;
    session.answeredCurrent = false;

    $('view-home').classList.add('hidden');
    $('view-deck').classList.add('hidden');
    $('view-study').classList.remove('hidden');
    $('review-interstitial').classList.add('hidden');
    $('complete-interstitial').classList.add('hidden');

    renderCurrentStudyCard();
  }

  function exitStudySession() {
    session.active = false;
    $('view-study').classList.add('hidden');
    $('view-deck').classList.remove('hidden');
    refreshDeckHeaderAndFilters();
  }

  function getCurrentCard() {
    const deck = getActiveDeck();
    if (!deck) return null;
    const cardId = session.phase === 'review'
      ? session.reviewQueue[session.reviewIndex]
      : session.mainQueue[session.mainIndex];
    return deck.cards.find((c) => c.id === cardId) || null;
  }

  function renderCurrentStudyCard() {
    const card = getCurrentCard();
    if (!card) {
      showCompleteScreen();
      return;
    }

    session.isFlipped = false;
    session.answeredCurrent = false;

    // 進捗表示
    const isReview = session.phase === 'review';
    const cur = isReview ? session.reviewIndex + 1 : session.mainIndex + 1;
    const total = isReview ? session.reviewQueue.length : session.mainQueue.length;
    $('progress-fill').style.width = `${Math.min(100, Math.round((cur / total) * 100))}%`;
    $('progress-text').textContent = `${cur} / ${total}`;
    $('study-phase-badge').textContent = isReview
      ? '復習中'
      : (session.wrongPool.length > 0 ? `間違い蓄積: ${session.wrongPool.length}/5` : '');

    // ピン留め状態
    const pinBtn = $('btn-pin');
    pinBtn.textContent = card.pinned ? '★' : '☆';
    pinBtn.classList.toggle('pinned', card.pinned);

    // 表裏のバッジ＆テキスト切り替え（A→Qバグ修正済み）
    const frontBadge = $('front-badge');
    const backBadge = $('back-badge');
    if (settings.reverse) {
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

    const frontText = settings.reverse ? card.back : card.front;
    const backText = settings.reverse ? card.front : card.back;

    S.renderContent($('front-content'), frontText);
    S.renderContent($('back-content'), backText);

    // 画像（元の問題側＝通常時は表面、逆向き時は裏面）
    const fImg = $('front-image');
    const bImg = $('back-image');
    if (card.image && !settings.reverse) {
      fImg.src = card.image;
      fImg.classList.remove('hidden');
    } else {
      fImg.classList.add('hidden');
    }
    if (card.image && settings.reverse) {
      bImg.src = card.image;
      bImg.classList.remove('hidden');
    } else {
      bImg.classList.add('hidden');
    }

    // ヒント（表面側でいつでも確認可能）
    const hintBtn = $('btn-hint');
    const hintBox = $('hint-text');
    hintBox.classList.add('hidden');
    if (card.hint) {
      hintBtn.classList.remove('hidden');
      S.renderContent(hintBox, card.hint);
    } else {
      hintBtn.classList.add('hidden');
    }

    // 3Dフリップと座標をトランジションなしで即座にリセット
    const flipper = $('card-flipper');
    flipper.style.transition = 'none';
    flipper.classList.remove('is-flipped');
    void flipper.offsetWidth; // リフロー強制
    flipper.style.transition = '';

    resetCardTransform(true);

    // 下部UI切替
    $('flip-controls').classList.toggle('hidden', settings.format !== 'flip');
    $('choice-container').classList.toggle('hidden', settings.format !== 'choice');
    $('input-container').classList.toggle('hidden', settings.format !== 'input');

    if (settings.format === 'choice') renderMultipleChoice(card);
    if (settings.format === 'input') prepareInputMode();
  }

  function flipCard(forceState) {
    if (settings.format !== 'flip') return;
    session.isFlipped = typeof forceState === 'boolean' ? forceState : !session.isFlipped;
    $('card-flipper').classList.toggle('is-flipped', session.isFlipped);
    haptic(12);
  }

  function renderMultipleChoice(card) {
    const container = $('choice-container');
    const deck = getActiveDeck();
    container.innerHTML = '';

    const correctLabel = settings.reverse
      ? card.front
      : S.extractClozeTargets(card.back).join(' / ');

    const sameCat = deck.cards.filter((c) => c.id !== card.id && c.category === card.category);
    const otherCat = deck.cards.filter((c) => c.id !== card.id && c.category !== card.category);
    const pool = [...sameCat, ...otherCat].map((c) =>
      settings.reverse ? c.front : S.extractClozeTargets(c.back).join(' / ')
    );

    const uniqueDistractors = [];
    for (const item of pool) {
      if (item && item !== correctLabel && !uniqueDistractors.includes(item)) {
        uniqueDistractors.push(item);
      }
    }
    for (let i = uniqueDistractors.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [uniqueDistractors[i], uniqueDistractors[j]] = [uniqueDistractors[j], uniqueDistractors[i]];
    }
    const options = [correctLabel, ...uniqueDistractors.slice(0, 3)];
    for (let i = options.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [options[i], options[j]] = [options[j], options[i]];
    }

    options.forEach((optText) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'quiz-option';
      const plain = optText.replace(/【|】/g, '');
      btn.textContent = plain;
      if (typeof window.renderMathInElement === 'function') {
        try {
          window.renderMathInElement(btn, {
            delimiters: [
              { left: '$$', right: '$$', display: false },
              { left: '$', right: '$', display: false }
            ],
            throwOnError: false
          });
        } catch (_) {}
      }

      btn.addEventListener('click', () => {
        if (session.answeredCurrent) return;
        session.answeredCurrent = true;
        const isCorrect = optText === correctLabel;
        haptic(isCorrect ? 15 : 35);
        btn.classList.add(isCorrect ? 'is-correct' : 'is-wrong');
        if (!isCorrect) {
          Array.from(container.children).forEach((child, idx) => {
            if (options[idx] === correctLabel) child.classList.add('is-correct');
          });
        }
        $('card-flipper').classList.add('is-flipped');
        setTimeout(() => recordAnswer(isCorrect), isCorrect ? 550 : 1150);
      });
      container.appendChild(btn);
    });
  }

  function prepareInputMode() {
    const input = $('answer-input');
    const fb = $('input-feedback');
    const nextBtn = $('btn-input-next');
    input.value = '';
    input.disabled = false;
    fb.classList.add('hidden');
    nextBtn.classList.add('hidden');
    $('btn-submit-answer').classList.remove('hidden');
    setTimeout(() => input.focus(), 60);
  }

  function normalizeAnswerString(str) {
    return String(str || '')
      .replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
      .replace(/[\s　\$]/g, '')
      .toLowerCase();
  }

  function checkTextAnswer() {
    const card = getCurrentCard();
    if (!card || session.answeredCurrent) return;
    session.answeredCurrent = true;

    const userVal = normalizeAnswerString($('answer-input').value);
    const targets = settings.reverse ? [card.front] : S.extractClozeTargets(card.back);
    const isCorrect = targets.some((t) => normalizeAnswerString(t) === userVal && userVal.length > 0);

    haptic(isCorrect ? 15 : 35);
    $('answer-input').disabled = true;
    $('btn-submit-answer').classList.add('hidden');
    $('card-flipper').classList.add('is-flipped');

    const fb = $('input-feedback');
    fb.classList.remove('hidden', 'ok', 'ng');
    fb.classList.add(isCorrect ? 'ok' : 'ng');
    fb.textContent = isCorrect ? '◯ 正解' : `× 正解: ${targets.join(' / ')}`;

    const nextBtn = $('btn-input-next');
    nextBtn.classList.remove('hidden');
    nextBtn.onclick = () => recordAnswer(isCorrect);
  }

  function recordAnswer(isCorrect) {
    const card = getCurrentCard();
    if (!card) return;

    S.pushUndo({
      phase: session.phase,
      mainIndex: session.mainIndex,
      mainStepsSinceReview: session.mainStepsSinceReview,
      wrongPool: [...session.wrongPool],
      reviewQueue: [...session.reviewQueue],
      reviewIndex: session.reviewIndex,
      cardId: card.id,
      cardStats: {
        correctCount: card.correctCount,
        wrongCount: card.wrongCount,
        srsLevel: card.srsLevel,
        nextReview: card.nextReview
      }
    });

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
    S.saveData(appData);

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
          if (session.wrongPool.length > 0) {
            enterReviewMode();
          } else {
            showCompleteScreen();
          }
          return;
        }
      }
      renderCurrentStudyCard();
      return;
    }

    if (!isCorrect && !session.wrongPool.includes(card.id)) {
      session.wrongPool.push(card.id);
    }
    session.mainIndex += 1;
    session.mainStepsSinceReview += 1;

    if (settings.mode === 'smart') {
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
      renderCurrentStudyCard();
    }
  }

  function enterReviewMode() {
    session.phase = 'review';
    session.reviewQueue = [...session.wrongPool];
    session.reviewIndex = 0;
    session.mainStepsSinceReview = 0;

    $('review-count-label').textContent = `間違えた ${session.reviewQueue.length}問 を復習します`;
    $('review-interstitial').classList.remove('hidden');
  }

  function showCompleteScreen() {
    const deck = getActiveDeck();
    $('complete-summary').textContent = `${deck ? deck.title : ''} を完了しました`;
    $('complete-interstitial').classList.remove('hidden');
    haptic(25);
  }

  function performSilentUndo() {
    if (!session.active) return;
    const snap = S.popUndo();
    if (!snap) return;

    haptic(12);
    const deck = getActiveDeck();
    const card = deck?.cards.find((c) => c.id === snap.cardId);
    if (card && snap.cardStats) {
      Object.assign(card, snap.cardStats);
      S.saveData(appData);
    }

    session.phase = snap.phase;
    session.mainIndex = snap.mainIndex;
    session.mainStepsSinceReview = snap.mainStepsSinceReview;
    session.wrongPool = snap.wrongPool;
    session.reviewQueue = snap.reviewQueue;
    session.reviewIndex = snap.reviewIndex;

    $('review-interstitial').classList.add('hidden');
    $('complete-interstitial').classList.add('hidden');
    renderCurrentStudyCard();
  }

  /* ==================== カードスワイプ制御（バグ修正・誤操作防止） ==================== */
  function resetCardTransform(instant = false) {
    const cardEl = $('card-stage');
    const leftBadge = $('swipe-badge-left');
    const rightBadge = $('swipe-badge-right');
    if (!cardEl) return;

    if (instant) {
      cardEl.classList.remove('spring-back');
      cardEl.style.transition = 'none';
      cardEl.style.transform = 'translate3d(0, 0, 0) rotate(0deg)';
      void cardEl.offsetWidth;
      cardEl.style.transition = '';
    } else {
      cardEl.classList.add('spring-back');
      cardEl.style.transform = 'translate3d(0, 0, 0) rotate(0deg)';
    }
    if (leftBadge) leftBadge.style.opacity = '0';
    if (rightBadge) rightBadge.style.opacity = '0';
  }

  function initCardSwipeAndFlip() {
    const cardEl = $('card-stage');
    if (!cardEl) return;

    let startX = 0;
    let startY = 0;
    let currentX = 0;
    let tracking = false;
    let lockedHorizontal = false;
    let aborted = false;
    let thresholdPassed = false;

    const isInteractiveTarget = (target) => {
      return Boolean(target && target.closest('button, input, textarea, select, .cloze-blank'));
    };

    cardEl.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1 || isInteractiveTarget(e.target)) return;
      const t = e.touches[0];
      startX = t.clientX;
      startY = t.clientY;
      currentX = 0;
      tracking = true;
      lockedHorizontal = false;
      aborted = false;
      thresholdPassed = false;
      cardEl.classList.remove('spring-back');
    }, { passive: true });

    cardEl.addEventListener('touchmove', (e) => {
      if (!tracking || aborted || e.touches.length !== 1) return;
      const t = e.touches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;

      if (!lockedHorizontal) {
        if (Math.abs(dy) > 14 && Math.abs(dy) > Math.abs(dx)) {
          aborted = true;
          resetCardTransform(false);
          return;
        }
        if (Math.abs(dx) > 16 && Math.abs(dx) > Math.abs(dy) * 1.25) {
          lockedHorizontal = true;
        } else {
          return;
        }
      }

      if (lockedHorizontal) {
        e.preventDefault();
        currentX = dx;
        const threshold = Math.max(105, cardEl.clientWidth * 0.30);
        const ratio = Math.min(1, Math.abs(dx) / threshold);

        if (ratio >= 1 && !thresholdPassed) {
          thresholdPassed = true;
          haptic(15);
        } else if (ratio < 1) {
          thresholdPassed = false;
        }

        cardEl.style.transform = `translate3d(${dx}px, ${Math.abs(dx) * 0.04}px, 0) rotate(${dx * 0.035}deg)`;
        $('swipe-badge-right').style.opacity = dx > 0 ? String(ratio) : '0';
        $('swipe-badge-left').style.opacity = dx < 0 ? String(ratio) : '0';
      }
    }, { passive: false });

    const finishTouch = () => {
      if (!tracking) return;
      tracking = false;

      if (lockedHorizontal && !aborted) {
        suppressFlipUntil = Date.now() + 350;
        const threshold = Math.max(105, cardEl.clientWidth * 0.30);

        if (settings.format === 'flip' && Math.abs(currentX) >= threshold) {
          const isRight = currentX > 0;
          haptic(18);
          cardEl.classList.add('spring-back');
          cardEl.style.transform = `translate3d(${isRight ? 520 : -520}px, 30px, 0) rotate(${isRight ? 18 : -18}deg)`;
          setTimeout(() => recordAnswer(isRight), 160);
          return;
        }
      }
      resetCardTransform(false);
    };

    cardEl.addEventListener('touchend', finishTouch);
    cardEl.addEventListener('touchcancel', finishTouch);

    cardEl.addEventListener('click', (e) => {
      if (Date.now() < suppressFlipUntil) return;
      const cloze = e.target.closest('.cloze-blank');
      if (cloze && settings.redsheet) {
        cloze.classList.toggle('revealed');
        haptic(10);
        return;
      }
      if (isInteractiveTarget(e.target)) return;
      flipCard();
    });
  }

  /* ==================== URL出力ヘルパー ==================== */
  function showGeneratedUrl(boxEl, url, label, extraNote = '') {
    if (!boxEl) return;
    boxEl.classList.remove('hidden');
    boxEl.innerHTML = `
      <div style="font-weight:700; margin-bottom:4px; color:var(--primary);">
        ${label}（${url.length.toLocaleString()}文字）${extraNote}
      </div>
      <div style="user-select:all; -webkit-user-select:all;">${escapeText(url)}</div>
    `;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url).catch(() => {});
    }
  }

  /* ==================== イベント登録 ==================== */
  function bindEvents() {
    // テーマ切替
    $('btn-theme')?.addEventListener('click', () => {
      appData.theme = appData.theme === 'dark' ? 'light' : 'dark';
      S.saveData(appData);
      applyThemeAndRedsheet();
    });

    // ホーム画面：新規デッキ作成
    $('btn-new-deck')?.addEventListener('click', () => {
      const title = prompt('新しい単語帳の名前を入力:');
      if (!title || !title.trim()) return;
      const newDeck = { id: S.uid('deck'), title: title.trim(), cards: [] };
      appData.decks.push(newDeck);
      S.saveData(appData);
      openDeckView(newDeck.id);
      switchTab('manage');
    });

    // ホーム画面：JSON読込
    $('home-import-json')?.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const parsed = JSON.parse(ev.target.result);
          if (parsed && Array.isArray(parsed.decks) && parsed.decks.length > 0) {
            appData = parsed;
            S.saveData(appData);
            renderHomeDeckList();
            alert('バックアップを復元しました。');
          }
        } catch (_) {
          alert('JSONファイルの読み込みに失敗しました。');
        }
      };
      reader.readAsText(file);
    });

    // ホーム画面：全データ一括引越しURL作成
    $('btn-home-bundle-url')?.addEventListener('click', async () => {
      const { token, imagesStripped } = await S.encodeFullBundlePayload(appData);
      const url = `${window.location.origin}${window.location.pathname}#bundle=${token}`;
      const note = imagesStripped ? ' ※画像が多いためテキストと学習履歴のみ圧縮しました' : '';
      showGeneratedUrl($('home-share-box'), url, '全データ一括引越しURLをコピーしました', note);
    });

    // デッキ詳細画面：戻る・リネーム・削除
    $('btn-back-home')?.addEventListener('click', showHomeView);

    $('btn-rename-deck')?.addEventListener('click', () => {
      const deck = getActiveDeck();
      if (!deck) return;
      const next = prompt('単語帳の名前を変更:', deck.title);
      if (!next || !next.trim()) return;
      deck.title = next.trim();
      S.saveData(appData);
      refreshDeckHeaderAndFilters();
    });

    $('btn-delete-deck')?.addEventListener('click', () => {
      if (appData.decks.length <= 1) {
        alert('最後の単語帳は削除できません。');
        return;
      }
      const deck = getActiveDeck();
      if (!confirm(`「${deck.title}」を削除しますか？`)) return;
      appData.decks = appData.decks.filter((d) => d.id !== deck.id);
      appData.activeDeckId = appData.decks[0].id;
      S.saveData(appData);
      showHomeView();
    });

    // タブ切替
    document.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    // カテゴリ絞り込み
    $('category-filter')?.addEventListener('change', (e) => {
      settings.category = e.target.value;
      updateStartTargetCount();
    });

    // 進行ルール選択
    document.querySelectorAll('.mode-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        settings.mode = btn.dataset.mode;
        document.querySelectorAll('.mode-btn').forEach((b) => b.classList.toggle('active', b === btn));
        updateStartTargetCount();
      });
    });

    // 出題形式選択
    document.querySelectorAll('.format-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        settings.format = btn.dataset.format;
        document.querySelectorAll('.format-btn').forEach((b) => b.classList.toggle('active', b === btn));
      });
    });

    // オプション切替
    $('opt-reverse')?.addEventListener('click', (e) => {
      settings.reverse = !settings.reverse;
      e.currentTarget.textContent = settings.reverse ? '逆向き（A→Q）' : '通常（Q→A）';
      e.currentTarget.classList.toggle('active', settings.reverse);
    });

    $('opt-shuffle')?.addEventListener('click', (e) => {
      settings.shuffle = !settings.shuffle;
      e.currentTarget.textContent = settings.shuffle ? 'シャッフル' : '登録順';
      e.currentTarget.classList.toggle('active', settings.shuffle);
    });

    $('opt-redsheet')?.addEventListener('click', () => {
      settings.redsheet = !settings.redsheet;
      applyThemeAndRedsheet();
    });

    // 試験日
    $('exam-date')?.addEventListener('change', (e) => {
      appData.examDate = e.target.value;
      S.saveData(appData);
      updateExamCountdown();
    });

    // 学習開始・履歴リセット
    $('btn-start-study')?.addEventListener('click', startStudySession);

    $('btn-reset-progress')?.addEventListener('click', () => {
      const deck = getActiveDeck();
      if (!deck || !confirm('この単語帳の正誤履歴をリセットしますか？')) return;
      deck.cards.forEach((c) => {
        c.correctCount = 0;
        c.wrongCount = 0;
        c.srsLevel = 0;
        c.nextReview = 0;
      });
      S.saveData(appData);
      refreshDeckHeaderAndFilters();
      alert('学習履歴をリセットしました。');
    });

    // 学習画面内ボタン
    $('btn-exit-study')?.addEventListener('click', exitStudySession);
    $('btn-study-redsheet')?.addEventListener('click', () => {
      settings.redsheet = !settings.redsheet;
      applyThemeAndRedsheet();
    });
    $('btn-undo')?.addEventListener('click', performSilentUndo);

    $('btn-pin')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const card = getCurrentCard();
      if (!card) return;
      card.pinned = !card.pinned;
      S.saveData(appData);
      haptic(12);
      $('btn-pin').textContent = card.pinned ? '★' : '☆';
      $('btn-pin').classList.toggle('pinned', card.pinned);
    });

    $('btn-hint')?.addEventListener('click', (e) => {
      e.stopPropagation();
      $('hint-text').classList.toggle('hidden');
    });

    $('btn-wrong')?.addEventListener('click', () => {
      haptic(20);
      recordAnswer(false);
    });
    $('btn-correct')?.addEventListener('click', () => {
      haptic(14);
      recordAnswer(true);
    });

    $('btn-start-review')?.addEventListener('click', () => {
      $('review-interstitial').classList.add('hidden');
      renderCurrentStudyCard();
    });

    $('btn-restart-session')?.addEventListener('click', startStudySession);
    $('btn-complete-home')?.addEventListener('click', exitStudySession);

    // 赤文字入力判定
    $('btn-submit-answer')?.addEventListener('click', checkTextAnswer);
    $('answer-input')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') checkTextAnswer();
    });

    // 一覧シート
    $('sheet-redsheet-toggle')?.addEventListener('click', () => {
      settings.redsheet = !settings.redsheet;
      applyThemeAndRedsheet();
    });
    $('btn-print-sheet')?.addEventListener('click', () => window.print());

    // 管理タブ：AI指示文コピー・一括インポート
    $('btn-copy-prompt')?.addEventListener('click', async () => {
      const promptText = `この内容からテスト対策用の単語カードを作成してください。\n赤シート機能で隠せるよう、重要な語句や公式は【 】で囲んでください。\n数式や化学式はLaTeX形式（インラインは $...$ 、大きな式は $$...$$ ）で記述してください。\n出力は以下の形式で、1行につき1問のコードブロックのみを出力してください（前後の挨拶不要）。\n\nカテゴリ名 | 問題文（表面） | 【重要語句や数式】を含む答え（裏面） | ヒント`;
      try {
        await navigator.clipboard.writeText(promptText);
        $('btn-copy-prompt').textContent = 'コピー完了';
        setTimeout(() => { $('btn-copy-prompt').textContent = 'AI用指示文コピー'; }, 1500);
      } catch (_) {
        prompt('以下をコピーしてください:', promptText);
      }
    });

    $('btn-import')?.addEventListener('click', () => {
      const raw = $('import-text')?.value || '';
      const newCards = S.parseImportText(raw);
      if (newCards.length === 0) {
        alert('読み込める問題がありません。「カテゴリ | 問題 | 答え | ヒント」の形式で入力してください。');
        return;
      }
      const deck = getActiveDeck();
      deck.cards.push(...newCards);
      S.saveData(appData);
      $('import-text').value = '';
      refreshDeckHeaderAndFilters();
      renderManageTab();
      alert(`${newCards.length}問を追加しました。`);
    });

    // 管理タブ：画像圧縮付き1問追加
    $('new-card-image')?.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const img = new Image();
        img.onload = () => {
          const maxW = 720;
          const scale = Math.min(1, maxW / img.width);
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(img.width * scale);
          canvas.height = Math.round(img.height * scale);
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          pendingImageDataUrl = canvas.toDataURL('image/jpeg', 0.78);
          $('new-card-image-preview').textContent = file.name;
        };
        img.src = ev.target.result;
      };
      reader.readAsDataURL(file);
    });

    $('btn-add-single')?.addEventListener('click', () => {
      const front = ($('new-card-front')?.value || '').trim();
      const back = ($('new-card-back')?.value || '').trim();
      if (!front || !back) return;
      const deck = getActiveDeck();
      deck.cards.push(S.normalizeCard({
        category: $('new-card-cat')?.value || '一般',
        front,
        back,
        hint: $('new-card-hint')?.value || '',
        image: pendingImageDataUrl
      }));
      S.saveData(appData);
      $('new-card-front').value = '';
      $('new-card-back').value = '';
      $('new-card-hint').value = '';
      $('new-card-image-preview').textContent = '画像なし';
      pendingImageDataUrl = '';
      refreshDeckHeaderAndFilters();
      renderManageTab();
    });

    // CSV 書き出し・読み込み（UTF-8 / Shift-JIS自動判別対応）
    $('btn-export-csv')?.addEventListener('click', () => {
      const deck = getActiveDeck();
      if (!deck) return;
      const csvStr = S.generateCsvText(deck);
      const blob = new Blob([csvStr], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${deck.title}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    });

    $('import-csv-file')?.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const handleCsvContent = (text) => {
        const newCards = S.parseCsvText(text);
        if (newCards.length === 0) {
          alert('CSVから読み込める問題が見つかりませんでした。\n「カテゴリ,問題,答え,ヒント」の列構成になっているか確認してください。');
          return;
        }
        const deck = getActiveDeck();
        deck.cards.push(...newCards);
        S.saveData(appData);
        refreshDeckHeaderAndFilters();
        renderManageTab();
        alert(`CSVから ${newCards.length}問 を追加しました！`);
      };

      const reader = new FileReader();
      reader.onload = (ev) => {
        const text = String(ev.target.result || '');
        // Excel標準のShift-JISで文字化け（\uFFFD）が起きている場合は自動再読込
        if (text.includes('\uFFFD')) {
          const sjisReader = new FileReader();
          sjisReader.onload = (ev2) => handleCsvContent(ev2.target.result);
          sjisReader.readAsText(file, 'Shift_JIS');
        } else {
          handleCsvContent(text);
        }
      };
      reader.readAsText(file, 'UTF-8');
      e.target.value = '';
    });

    // JSON出力・読込
    $('btn-export-json')?.addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(appData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `studyloop_backup_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    });

    $('import-json-file')?.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const parsed = JSON.parse(ev.target.result);
          if (parsed && Array.isArray(parsed.decks) && parsed.decks.length > 0) {
            appData = parsed;
            S.saveData(appData);
            refreshDeckHeaderAndFilters();
            renderManageTab();
            alert('バックアップを復元しました。');
          }
        } catch (_) {
          alert('JSONファイルの読み込みに失敗しました。');
        }
      };
      reader.readAsText(file);
    });

    // 圧縮URL共有・一括引越し
    $('btn-share-url')?.addEventListener('click', async () => {
      const deck = getActiveDeck();
      if (!deck) return;
      const token = await S.encodeSharePayload(deck);
      const url = `${window.location.origin}${window.location.pathname}#share=${token}`;
      showGeneratedUrl($('share-output'), url, 'この単語帳の共有URLをコピーしました');
    });

    $('btn-bundle-url')?.addEventListener('click', async () => {
      const { token, imagesStripped } = await S.encodeFullBundlePayload(appData);
      const url = `${window.location.origin}${window.location.pathname}#bundle=${token}`;
      const note = imagesStripped ? ' ※画像が多いためテキストと学習履歴のみ圧縮しました' : '';
      showGeneratedUrl($('share-output'), url, '全データ一括引越しURLをコピーしました', note);
    });

    // 検索・モーダルイベント
    $('manage-search')?.addEventListener('input', renderManageTab);

    $('btn-edit-cancel')?.addEventListener('click', closeEditModal);
    $('btn-edit-save')?.addEventListener('click', () => {
      const deck = getActiveDeck();
      const card = deck?.cards.find((c) => c.id === editingCardId);
      if (!card) return;
      const nextFront = $('edit-card-front').value.trim();
      const nextBack = $('edit-card-back').value.trim();
      if (!nextFront || !nextBack) {
        alert('表面と裏面は空欄にできません。');
        return;
      }
      card.category = $('edit-card-cat').value.trim() || '一般';
      card.front = nextFront;
      card.back = nextBack;
      card.hint = $('edit-card-hint').value.trim();
      S.saveData(appData);
      closeEditModal();
      refreshDeckHeaderAndFilters();
      renderManageTab();
    });

    // キーボード操作（PC/外付けキーボード対応）
    document.addEventListener('keydown', (e) => {
      if (!session.active) return;
      if (document.activeElement && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
      if (e.key === 'z' || e.key === 'Z' || e.key === 'Backspace') {
        e.preventDefault();
        performSilentUndo();
      } else if (settings.format === 'flip') {
        if (e.key === ' ' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          flipCard();
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          recordAnswer(true);
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          recordAnswer(false);
        }
      }
    });
  }

  /* ==================== 初期化 ==================== */
  document.addEventListener('DOMContentLoaded', async () => {
    try {
      await checkIncomingShareHash();
      applyThemeAndRedsheet();
      bindEvents();
      initCardSwipeAndFlip();
      showHomeView();
    } catch (err) {
      console.error('Init error:', err);
    }
  });
})();
