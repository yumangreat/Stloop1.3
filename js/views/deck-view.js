import { ICONS } from '../icons.js';
import { renderContent, escapeHtml, DEFAULT_UNORDERED_DELIMITERS } from '../math-renderer.js';
import { normalizeCard, normalizeTestCount } from '../store.js';
import {
  getFilteredCards,
  getValidSavedSession,
  hasMeaningfulProgress,
  savedMatchesSettings,
  clearAllSavedSessionsForDeck
} from '../study-engine.js';
import {
  parseImportText,
  generateDeckCsvText,
  generateSampleCsvText,
  generateFullBackupCsvText,
  generateFullBackupJsonText,
  downloadTextFile
} from '../backup.js';
import {
  compressImageFile,
  saveImage,
  getImageUrl,
  deleteImage,
  exportImageMap
} from '../image-db.js';
import { renderStatsTab } from './stats-view.js';
import { showPrompt, showConfirm, showAlert, showToast } from './modal.js';

const $ = (id) => document.getElementById(id);
const CHUNK_SIZE = 50;

export function createDeckView(ctx) {
  let pendingNewImageDataUrl = '';
  let editingCardId = null;
  let editingImageRef = '';
  let editingImageChanged = false;
  let editingOnSavedCallback = null;

  let sheetVisibleCount = CHUNK_SIZE;
  let manageVisibleCount = CHUNK_SIZE;
  let searchDebounceTimer = null;

  function open(deckId, initialTab = 'setup') {
    ctx.appData.activeDeckId = deckId;
    ctx.settings.category = 'ALL';
    ctx.save();

    $('view-home')?.classList.add('hidden');
    $('view-study')?.classList.add('hidden');
    $('view-deck')?.classList.remove('hidden');

    syncControlsFromSettings();
    refreshHeaderAndFilters();
    switchTab(initialTab);
  }

  function syncControlsFromSettings() {
    const s = ctx.settings;
    const isTest = s.studyType === 'test';
    const activeChipMode = isTest ? 'test' : s.mode;

    $('setup-test-block')?.classList.toggle('hidden', !isTest);
    $('row-opt-shuffle')?.classList.toggle('hidden', isTest);
    $('row-opt-test-timer')?.classList.toggle('hidden', !isTest);

    document.querySelectorAll('.mode-chip').forEach((b) => {
      b.classList.toggle('active', b.dataset.mode === activeChipMode);
    });
    document.querySelectorAll('.fmt-seg-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.format === s.format);
    });
    const presets = ['10', '20', '50', 'ALL'];
    const normCount = normalizeTestCount(s.testCount);
    const isPreset = presets.includes(normCount);
    document.querySelectorAll('.test-count-btn').forEach((b) => {
      b.classList.toggle('active', isPreset && String(b.dataset.count) === normCount);
    });
    const customInput = $('input-test-custom-count');
    if (customInput) {
      if (!isPreset) {
        if (document.activeElement !== customInput) customInput.value = normCount;
        customInput.classList.add('active');
      } else {
        if (document.activeElement !== customInput) customInput.value = '';
        customInput.classList.remove('active');
      }
    }
    document.querySelectorAll('.test-grading-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.grading === s.testGrading);
    });

    const favEl = $('opt-filter-fav');
    if (favEl) favEl.checked = Boolean(s.filterFavorites);
    const wrongEl = $('opt-filter-wrong');
    if (wrongEl) wrongEl.checked = Boolean(s.filterWrong);
    const revEl = $('opt-reverse');
    if (revEl) revEl.checked = Boolean(s.reverse);
    const shufEl = $('opt-shuffle');
    if (shufEl) shufEl.checked = Boolean(s.shuffle);
    const redEl = $('opt-redsheet');
    if (redEl) redEl.checked = Boolean(s.redsheet);
    const timerEl = $('opt-test-timer');
    if (timerEl) timerEl.checked = Boolean(s.testTimer);

    syncUnorderedOptionUI();
  }

  function syncUnorderedOptionUI() {
    const enabled = ctx.appData.unorderedEnabled !== false;
    const optEl = $('opt-unordered');
    const editorEl = $('unordered-delim-editor');
    const inpEl = $('input-unordered-delimiters');
    if (optEl) optEl.checked = enabled;
    if (editorEl) editorEl.classList.toggle('hidden', !enabled);
    if (inpEl) inpEl.value = ctx.appData.unorderedDelimiters ?? DEFAULT_UNORDERED_DELIMITERS;
  }

  function refreshHeaderAndFilters() {
    const deck = ctx.getActiveDeck();
    if (!deck) return;
    $('current-deck-title').textContent = deck.title;

    const filterSel = $('category-filter');
    if (filterSel) {
      const cats = Array.from(new Set(deck.cards.map((c) => c.category || '一般')));
      if (ctx.settings.category !== 'ALL' && !cats.includes(ctx.settings.category)) {
        ctx.settings.category = 'ALL';
      }
      filterSel.innerHTML = `<option value="ALL">すべての単元（${deck.cards.length}問）</option>`;
      cats.forEach((cat) => {
        const count = deck.cards.filter((c) => (c.category || '一般') === cat).length;
        const opt = document.createElement('option');
        opt.value = cat;
        opt.textContent = `${cat}（${count}問）`;
        if (ctx.settings.category === cat) opt.selected = true;
        filterSel.appendChild(opt);
      });
    }

    updateExamCountdown();
    updateStartButton();
  }

  function updateStartButton() {
    const deck = ctx.getActiveDeck();
    const mainLabel = $('start-btn-main');
    const badgeEl = $('start-btn-badge');
    const startBtn = $('btn-start-study');
    const restartFreshBtn = $('btn-restart-fresh');
    if (!deck || !startBtn) return;

    const isTest = ctx.settings.studyType === 'test';
    startBtn.classList.remove('is-resume', 'is-test');

    if (isTest) {
      restartFreshBtn?.classList.add('hidden');
      const pool = getFilteredCards(deck, ctx.settings);
      const count = ctx.settings.testCount === 'ALL'
        ? pool.length
        : Math.min(pool.length, Number(ctx.settings.testCount) || 10);

      startBtn.classList.add('is-test');
      if (mainLabel) mainLabel.textContent = 'テストを開始';
      if (badgeEl) badgeEl.innerHTML = `<span id="start-target-count">${count}</span> 問`;
      startBtn.disabled = count === 0;
      startBtn.style.opacity = count === 0 ? '0.45' : '1';
      return;
    }

    // Memorize mode: only show "続きから再開" when saved session matches current settings!
    const saved = getValidSavedSession(ctx.appData, deck.id, ctx.settings.format);
    if (saved && hasMeaningfulProgress(saved) && savedMatchesSettings(saved, ctx.settings)) {
      const isRev = saved.phase === 'review' && saved.reviewQueue.length > 0;
      const cur = isRev
        ? Math.min(saved.reviewIndex + 1, saved.reviewQueue.length)
        : Math.min(saved.mainIndex + 1, saved.mainQueue.length);
      const total = isRev ? saved.reviewQueue.length : saved.mainQueue.length;

      if (mainLabel) mainLabel.textContent = '続きから再開';
      if (badgeEl) {
        badgeEl.innerHTML = isRev
          ? `復習 <span id="start-target-count">${cur}/${total}</span>`
          : `<span id="start-target-count">${cur}/${total}</span>`;
      }
      startBtn.classList.add('is-resume');
      startBtn.disabled = false;
      startBtn.style.opacity = '1';
      restartFreshBtn?.classList.remove('hidden');
      return;
    }

    if (mainLabel) mainLabel.textContent = '学習をスタート';
    const targets = getFilteredCards(deck, ctx.settings);
    if (badgeEl) badgeEl.innerHTML = `<span id="start-target-count">${targets.length}</span> 問`;
    restartFreshBtn?.classList.add('hidden');
    startBtn.disabled = targets.length === 0;
    startBtn.style.opacity = targets.length === 0 ? '0.45' : '1';
  }

  function updateExamCountdown() {
    const input = $('exam-date');
    const badge = $('exam-countdown');
    if (!input || !badge) return;
    input.value = ctx.appData.examDate || '';
    if (!ctx.appData.examDate) {
      badge.textContent = '未設定';
      return;
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(ctx.appData.examDate + 'T00:00:00');
    const diffDays = Math.ceil((target - today) / 86400000);
    const deck = ctx.getActiveDeck();
    const unmastered = deck ? deck.cards.filter((c) => c.correctCount === 0).length : 0;

    if (diffDays < 0) badge.textContent = '試験終了';
    else if (diffDays === 0) badge.textContent = '本日';
    else {
      const perDay = Math.ceil(unmastered / diffDays);
      badge.textContent = `あと${diffDays}日（1日${perDay}問）`;
    }
  }

  function switchTab(tabName) {
    document.querySelectorAll('.seg-tab').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tab === tabName);
    });
    document.querySelectorAll('.tab-panel').forEach((panel) => {
      panel.classList.toggle('active', panel.id === `panel-${tabName}`);
    });
    if (tabName === 'setup') updateStartButton();
    if (tabName === 'sheet') {
      sheetVisibleCount = CHUNK_SIZE;
      renderSheetTab();
    }
    if (tabName === 'stats') {
      renderStatsTab(ctx.appData, ctx.getActiveDeck(), () => ctx.save());
    }
    if (tabName === 'manage') {
      manageVisibleCount = CHUNK_SIZE;
      renderManageTab();
    }
  }

  function renderSheetTab() {
    const container = $('sheet-list');
    const moreBtn = $('sheet-load-more');
    const deck = ctx.getActiveDeck();
    if (!container || !deck) return;

    container.innerHTML = '';
    const slice = deck.cards.slice(0, sheetVisibleCount);
    const frag = document.createDocumentFragment();
    slice.forEach((card) => {
      const row = document.createElement('div');
      row.className = 'sheet-item';
      const qDiv = document.createElement('div');
      qDiv.className = 'sheet-q';
      const aDiv = document.createElement('div');
      aDiv.className = 'sheet-a';
      renderContent(qDiv, card.front);
      renderContent(aDiv, card.back);
      row.appendChild(qDiv);
      row.appendChild(aDiv);
      frag.appendChild(row);
    });
    container.appendChild(frag);

    if (moreBtn) {
      const remaining = deck.cards.length - sheetVisibleCount;
      moreBtn.classList.toggle('hidden', remaining <= 0);
      if (remaining > 0) moreBtn.textContent = `さらに表示（残り ${remaining}問）`;
    }
  }

  function renderManageTab() {
    const list = $('manage-card-list');
    const moreBtn = $('manage-load-more');
    const countEl = $('manage-card-count');
    const deck = ctx.getActiveDeck();
    if (!list || !deck) return;

    const query = ($('manage-search')?.value || '').trim().toLowerCase();
    const matched = deck.cards.filter((card) => {
      if (!query) return true;
      return (
        card.front.toLowerCase().includes(query) ||
        card.back.toLowerCase().includes(query) ||
        card.category.toLowerCase().includes(query)
      );
    });

    if (countEl) countEl.textContent = `(${matched.length}問)`;
    list.innerHTML = '';

    const slice = matched.slice(0, manageVisibleCount);
    const frag = document.createDocumentFragment();

    slice.forEach((card) => {
      const item = document.createElement('div');
      item.className = 'manage-item';

      const info = document.createElement('div');
      info.className = 'manage-item-text';
      info.innerHTML = `<strong>[${escapeHtml(card.category)}]</strong> ${escapeHtml(card.front)}<br><span class="muted-small">${escapeHtml(card.back)}</span>`;

      const btns = document.createElement('div');
      btns.className = 'manage-item-btns';

      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'icon-btn small';
      editBtn.innerHTML = ICONS.edit;
      editBtn.title = '編集';
      editBtn.addEventListener('click', () => openEditModal(card));

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'icon-btn small danger';
      delBtn.innerHTML = ICONS.trash;
      delBtn.title = '削除';
      delBtn.addEventListener('click', async () => {
        const ok = await showConfirm('カードを削除しますか？', card.front, { confirmLabel: '削除', danger: true });
        if (!ok) return;
        const idx = deck.cards.findIndex((c) => c.id === card.id);
        if (idx === -1) return;
        const [removed] = deck.cards.splice(idx, 1);
        ctx.save();
        refreshHeaderAndFilters();
        renderManageTab();
        showToast('カードを削除しました', {
          actionLabel: '元に戻す',
          duration: 4200,
          onAction: () => {
            deck.cards.splice(Math.min(idx, deck.cards.length), 0, removed);
            ctx.save();
            refreshHeaderAndFilters();
            renderManageTab();
          }
        });
      });

      btns.appendChild(editBtn);
      btns.appendChild(delBtn);
      item.appendChild(info);
      item.appendChild(btns);
      frag.appendChild(item);
    });

    list.appendChild(frag);

    if (moreBtn) {
      const remaining = matched.length - manageVisibleCount;
      moreBtn.classList.toggle('hidden', remaining <= 0);
      if (remaining > 0) moreBtn.textContent = `さらに表示（残り ${remaining}問）`;
    }
  }

  /* ==================== カード編集モーダル（画像編集対応） ==================== */
  async function openEditModal(card, onSaved = null) {
    editingCardId = card.id;
    editingImageRef = card.image || '';
    editingImageChanged = false;
    editingOnSavedCallback = onSaved;

    $('edit-card-cat').value = card.category || '';
    $('edit-card-front').value = card.front || '';
    $('edit-card-back').value = card.back || '';
    $('edit-card-hint').value = card.hint || '';

    const thumb = $('edit-card-image-preview');
    const remBtn = $('btn-edit-remove-image');
    if (card.image) {
      const url = await getImageUrl(card.image);
      if (url) {
        thumb.src = url;
        thumb.classList.remove('hidden');
        remBtn.classList.remove('hidden');
      } else {
        thumb.classList.add('hidden');
        remBtn.classList.add('hidden');
      }
    } else {
      thumb.src = '';
      thumb.classList.add('hidden');
      remBtn.classList.add('hidden');
    }

    $('edit-modal').classList.remove('hidden');
  }

  function closeEditModal() {
    editingCardId = null;
    editingImageRef = '';
    editingImageChanged = false;
    editingOnSavedCallback = null;
    $('edit-modal')?.classList.add('hidden');
  }

  function bindEvents() {
    $('btn-back-home')?.addEventListener('click', () => {
      const deck = ctx.getActiveDeck();
      const targetFolderId = deck?.folderId && ctx.appData.folders.some((f) => f.id === deck.folderId)
        ? deck.folderId
        : null;
      ctx.showHomeView(targetFolderId);
    });

    $('btn-move-deck-folder')?.addEventListener('click', () => {
      const deck = ctx.getActiveDeck();
      if (deck) ctx.openFolderMoveModal(deck.id);
    });

    $('btn-rename-deck')?.addEventListener('click', async () => {
      const deck = ctx.getActiveDeck();
      if (!deck) return;
      const next = await showPrompt('単語帳の名前を変更', deck.title, { confirmLabel: '保存' });
      if (!next || !next.trim()) return;
      deck.title = next.trim();
      ctx.save();
      refreshHeaderAndFilters();
    });

    $('btn-delete-deck')?.addEventListener('click', async () => {
      if (ctx.appData.decks.length <= 1) {
        await showAlert('削除できません', '最後の単語帳は削除できません。');
        return;
      }
      const deck = ctx.getActiveDeck();
      const ok = await showConfirm(`「${deck.title}」を削除しますか？`, '登録されているカードと履歴が削除されます。', {
        confirmLabel: '削除',
        danger: true
      });
      if (!ok) return;
      const prevFolderId = deck.folderId && ctx.appData.folders.some((f) => f.id === deck.folderId) ? deck.folderId : null;
      // Clean up IDB images in deleted deck
      for (const c of deck.cards) {
        if (c.image) deleteImage(c.image);
      }
      clearAllSavedSessionsForDeck(ctx.appData, deck.id);
      ctx.appData.decks = ctx.appData.decks.filter((d) => d.id !== deck.id);
      ctx.appData.activeDeckId = ctx.appData.decks[0].id;
      ctx.save();
      ctx.showHomeView(prevFolderId);
      showToast('単語帳を削除しました');
    });

    document.querySelectorAll('.seg-tab').forEach((btn) => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    $('category-filter')?.addEventListener('change', (e) => {
      ctx.settings.category = e.target.value;
      updateStartButton();
    });

    document.querySelectorAll('.mode-chip').forEach((btn) => {
      btn.addEventListener('click', () => {
        ctx.haptic(8);
        const target = btn.dataset.mode;
        if (target === 'test') {
          ctx.settings.studyType = 'test';
        } else {
          ctx.settings.studyType = 'memorize';
          ctx.settings.mode = target;
        }
        ctx.savePreferences();
        syncControlsFromSettings();
        updateStartButton();
      });
    });

    $('btn-share-deck')?.addEventListener('click', () => {
      const deck = ctx.getActiveDeck();
      if (deck) ctx.openShareModal([deck.id]);
    });

    document.querySelectorAll('.test-count-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        ctx.haptic(8);
        ctx.settings.testCount = btn.dataset.count;
        const customInput = $('input-test-custom-count');
        if (customInput) customInput.value = '';
        ctx.savePreferences();
        syncControlsFromSettings();
        updateStartButton();
      });
    });

    $('input-test-custom-count')?.addEventListener('input', (e) => {
      const raw = e.target.value.replace(/[^0-9]/g, '');
      if (e.target.value !== raw) e.target.value = raw;
      if (!raw) {
        ctx.settings.testCount = 'ALL';
      } else {
        const n = Math.max(1, Math.min(9999, parseInt(raw, 10)));
        ctx.settings.testCount = String(n);
      }
      ctx.savePreferences();
      syncControlsFromSettings();
      updateStartButton();
    });

    document.querySelectorAll('.test-grading-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        ctx.haptic(8);
        ctx.settings.testGrading = btn.dataset.grading;
        ctx.savePreferences();
        syncControlsFromSettings();
      });
    });

    document.querySelectorAll('.fmt-seg-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        ctx.haptic(8);
        ctx.settings.format = btn.dataset.format;
        ctx.savePreferences();
        syncControlsFromSettings();
        updateStartButton();
      });
    });

    $('opt-filter-fav')?.addEventListener('change', (e) => {
      ctx.settings.filterFavorites = e.target.checked;
      ctx.savePreferences();
      ctx.haptic(8);
      updateStartButton();
    });

    $('opt-filter-wrong')?.addEventListener('change', (e) => {
      ctx.settings.filterWrong = e.target.checked;
      ctx.savePreferences();
      ctx.haptic(8);
      updateStartButton();
    });

    $('opt-reverse')?.addEventListener('change', (e) => {
      ctx.settings.reverse = e.target.checked;
      ctx.savePreferences();
      ctx.haptic(8);
      updateStartButton();
    });

    $('opt-shuffle')?.addEventListener('change', (e) => {
      ctx.settings.shuffle = e.target.checked;
      ctx.savePreferences();
      ctx.haptic(8);
      updateStartButton();
    });

    $('opt-redsheet')?.addEventListener('change', (e) => {
      ctx.settings.redsheet = e.target.checked;
      ctx.savePreferences();
      ctx.haptic(8);
      ctx.applyThemeAndRedsheet();
    });

    $('opt-test-timer')?.addEventListener('change', (e) => {
      ctx.settings.testTimer = e.target.checked;
      ctx.savePreferences();
      ctx.haptic(8);
    });

    $('opt-unordered')?.addEventListener('change', (e) => {
      ctx.appData.unorderedEnabled = e.target.checked;
      ctx.save();
      syncUnorderedOptionUI();
      ctx.haptic(8);
    });

    $('input-unordered-delimiters')?.addEventListener('input', (e) => {
      ctx.appData.unorderedDelimiters = e.target.value;
      ctx.save();
    });

    $('btn-reset-delimiters')?.addEventListener('click', () => {
      ctx.appData.unorderedDelimiters = DEFAULT_UNORDERED_DELIMITERS;
      ctx.save();
      syncUnorderedOptionUI();
      ctx.haptic(8);
    });

    $('exam-date')?.addEventListener('change', (e) => {
      ctx.appData.examDate = e.target.value;
      ctx.save();
      updateExamCountdown();
    });

    $('btn-start-study')?.addEventListener('click', () => {
      if (ctx.settings.studyType === 'test') {
        ctx.startTestSession();
      } else {
        ctx.startMemorizeSession(false);
      }
    });

    $('btn-restart-fresh')?.addEventListener('click', () => {
      ctx.startMemorizeSession(true);
    });

    $('btn-reset-progress')?.addEventListener('click', async () => {
      const deck = ctx.getActiveDeck();
      if (!deck) return;
      const ok = await showConfirm('学習履歴をリセットしますか？', '正誤履歴・SRS・途中進捗が初期化されます。', {
        confirmLabel: 'リセット',
        danger: true
      });
      if (!ok) return;
      deck.cards.forEach((c) => {
        c.correctCount = 0;
        c.wrongCount = 0;
        c.srsLevel = 0;
        c.nextReview = 0;
      });
      clearAllSavedSessionsForDeck(ctx.appData, deck.id);
      ctx.save();
      refreshHeaderAndFilters();
      showToast('学習履歴をリセットしました');
    });

    // Sheet tab
    $('sheet-redsheet-toggle')?.addEventListener('click', () => {
      ctx.settings.redsheet = !ctx.settings.redsheet;
      ctx.savePreferences();
      ctx.applyThemeAndRedsheet();
    });
    $('btn-print-sheet')?.addEventListener('click', () => {
      const deck = ctx.getActiveDeck();
      if (deck && sheetVisibleCount < deck.cards.length) {
        sheetVisibleCount = deck.cards.length;
        renderSheetTab();
      }
      window.print();
    });
    $('sheet-load-more')?.addEventListener('click', () => {
      sheetVisibleCount += CHUNK_SIZE;
      renderSheetTab();
    });

    // Manage tab: CSV / JSON
    $('btn-download-sample-csv')?.addEventListener('click', () => {
      downloadTextFile(generateSampleCsvText(), 'StudyLoop_sample.csv');
    });

    $('btn-export-csv')?.addEventListener('click', () => {
      const deck = ctx.getActiveDeck();
      if (!deck) return;
      downloadTextFile(generateDeckCsvText(deck), `${deck.title}.csv`);
      showToast('CSVを書き出しました');
    });

    $('btn-export-all-csv')?.addEventListener('click', () => {
      const dateStr = new Date().toISOString().slice(0, 10);
      downloadTextFile(generateFullBackupCsvText(ctx.appData), `StudyLoop_all_${dateStr}.csv`);
      showToast('全データCSVを書き出しました');
    });

    $('btn-export-json')?.addEventListener('click', async () => {
      const dateStr = new Date().toISOString().slice(0, 10);
      const imgMap = await exportImageMap(ctx.appData.decks);
      downloadTextFile(
        generateFullBackupJsonText(ctx.appData, imgMap),
        `StudyLoop_backup_${dateStr}.json`,
        'application/json;charset=utf-8'
      );
      showToast('JSONバックアップを保存しました');
    });

    $('import-csv-file')?.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      await ctx.handleImportFile(file, 'deck');
      e.target.value = '';
    });

    // AI prompt copy & bulk text import
    $('btn-copy-prompt')?.addEventListener('click', async () => {
      const unorderedEnabled = ctx.appData.unorderedEnabled !== false;
      const rawDelims = typeof ctx.appData.unorderedDelimiters === 'string' && ctx.appData.unorderedDelimiters.trim()
        ? ctx.appData.unorderedDelimiters.trim()
        : DEFAULT_UNORDERED_DELIMITERS;
      const delimTokens = rawDelims.split(/[\s　]+/).filter(Boolean);
      const sampleDelim = delimTokens[0] || '・';

      const unorderedRule = unorderedEnabled && delimTokens.length > 0
        ? `\n順不同（入れ替え可）にしたい並列語句は、【語句A】${sampleDelim}【語句B】のように区切り（${delimTokens.join(' ')}）だけでつないでください。`
        : '';

      const promptText = `この内容からテスト対策用の単語カードを作成してください。\n赤シートで隠す重要語句や公式は【 】で囲んでください。${unorderedRule}\n数式や化学式はLaTeX形式（インラインは $...$ 、ディスプレイは $$...$$ ）で記述してください。\n出力は以下の形式で、1行1問のコードブロックのみ出力してください（前後の説明不要）。\n\nカテゴリ名 | 問題文（表面） | 【重要語句や数式】を含む答え（裏面） | ヒント`;

      try {
        await navigator.clipboard.writeText(promptText);
        showToast('AI用プロンプトをコピーしました');
      } catch (_) {
        await showPrompt('以下をコピーしてください', promptText, { confirmLabel: '閉じる' });
      }
    });

    $('btn-import')?.addEventListener('click', async () => {
      const raw = $('import-text')?.value || '';
      const newCards = parseImportText(raw);
      if (newCards.length === 0) {
        await showAlert('読み込みエラー', '「カテゴリ | 問題 | 答え | ヒント」の形式で入力してください。');
        return;
      }
      const deck = ctx.getActiveDeck();
      deck.cards.push(...newCards);
      ctx.save();
      $('import-text').value = '';
      refreshHeaderAndFilters();
      renderManageTab();
      showToast(`${newCards.length}問を追加しました`);
    });

    // Single card add with image
    $('new-card-image')?.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        pendingNewImageDataUrl = await compressImageFile(file);
        $('new-card-image-preview').textContent = file.name;
        $('btn-clear-new-image')?.classList.remove('hidden');
      } catch (_) {
        showToast('画像の読み込みに失敗しました');
      }
      e.target.value = '';
    });

    $('btn-clear-new-image')?.addEventListener('click', () => {
      pendingNewImageDataUrl = '';
      $('new-card-image-preview').textContent = '画像なし';
      $('btn-clear-new-image')?.classList.add('hidden');
    });

    $('btn-add-single')?.addEventListener('click', async () => {
      const front = ($('new-card-front')?.value || '').trim();
      const back = ($('new-card-back')?.value || '').trim();
      if (!front || !back) {
        showToast('表面と裏面を入力してください');
        return;
      }
      const deck = ctx.getActiveDeck();
      const imageRef = pendingNewImageDataUrl ? await saveImage(pendingNewImageDataUrl) : '';
      deck.cards.push(normalizeCard({
        category: $('new-card-cat')?.value || '一般',
        front,
        back,
        hint: $('new-card-hint')?.value || '',
        image: imageRef
      }));
      ctx.save();
      $('new-card-front').value = '';
      $('new-card-back').value = '';
      $('new-card-hint').value = '';
      $('new-card-image-preview').textContent = '画像なし';
      $('btn-clear-new-image')?.classList.add('hidden');
      pendingNewImageDataUrl = '';
      refreshHeaderAndFilters();
      renderManageTab();
      showToast('カードを追加しました');
    });

    $('manage-search')?.addEventListener('input', () => {
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(() => {
        manageVisibleCount = CHUNK_SIZE;
        renderManageTab();
      }, 150);
    });

    $('manage-load-more')?.addEventListener('click', () => {
      manageVisibleCount += CHUNK_SIZE;
      renderManageTab();
    });

    // Edit modal events
    $('edit-card-image')?.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const dataUrl = await compressImageFile(file);
        editingImageRef = dataUrl;
        editingImageChanged = true;
        const thumb = $('edit-card-image-preview');
        thumb.src = dataUrl;
        thumb.classList.remove('hidden');
        $('btn-edit-remove-image')?.classList.remove('hidden');
      } catch (_) {
        showToast('画像の読み込みに失敗しました');
      }
      e.target.value = '';
    });

    $('btn-edit-remove-image')?.addEventListener('click', () => {
      editingImageRef = '';
      editingImageChanged = true;
      $('edit-card-image-preview').src = '';
      $('edit-card-image-preview').classList.add('hidden');
      $('btn-edit-remove-image').classList.add('hidden');
    });

    $('btn-edit-cancel')?.addEventListener('click', closeEditModal);
    $('edit-modal')?.addEventListener('click', (e) => {
      if (e.target === $('edit-modal')) closeEditModal();
    });

    $('btn-edit-save')?.addEventListener('click', async () => {
      const deck = ctx.getActiveDeck();
      const card = deck?.cards.find((c) => c.id === editingCardId);
      if (!card) return;
      const nextFront = $('edit-card-front').value.trim();
      const nextBack = $('edit-card-back').value.trim();
      if (!nextFront || !nextBack) {
        showToast('表面と裏面は必須です');
        return;
      }
      card.category = $('edit-card-cat').value.trim() || '一般';
      card.front = nextFront;
      card.back = nextBack;
      card.hint = $('edit-card-hint').value.trim();

      if (editingImageChanged) {
        const oldRef = card.image;
        card.image = editingImageRef ? await saveImage(editingImageRef) : '';
        if (oldRef && oldRef !== card.image) deleteImage(oldRef);
      }

      const cb = editingOnSavedCallback;
      ctx.save();
      closeEditModal();
      refreshHeaderAndFilters();
      if (!$('panel-manage').classList.contains('hidden')) renderManageTab();
      if (typeof cb === 'function') cb(card);
      showToast('カードを保存しました');
    });
  }

  return {
    open,
    switchTab,
    syncControlsFromSettings,
    refreshHeaderAndFilters,
    updateStartButton,
    renderManageTab,
    openEditModal,
    closeEditModal,
    bindEvents
  };
}
