import { ICONS } from './icons.js';
import { loadData, saveData, uid } from './store.js';
import { migrateInlineImages, saveImage } from './image-db.js';
import { readFileTextSmart, parseBackupJson, parseCsvAuto } from './backup.js';
import { getValidSavedSession } from './study-engine.js';
import { createHomeView } from './views/home-view.js';
import { createDeckView } from './views/deck-view.js';
import { createStudyView } from './views/study-view.js';
import { createShareView } from './views/share-view.js';
import { createSyncView } from './views/sync-view.js';
import {
  showAlert,
  showChoiceDialog,
  showToast,
  initModalListeners
} from './views/modal.js';

const $ = (id) => document.getElementById(id);

function haptic(ms = 12) {
  if (navigator.vibrate) {
    try { navigator.vibrate(ms); } catch (_) {}
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const appData = loadData();
  const settings = { ...appData.preferences };
  const state = { currentFolderId: null };

  let homeView;
  let deckView;
  let studyView;
  let shareView;
  let syncView;

  function saveRaw(preserveTimestamp = false) {
    saveData(appData, () => {
      showAlert('保存容量の上限です', '不要な単語帳を削除するか、バックアップ後にデータを整理してください。');
    }, preserveTimestamp);
  }

  function save() {
    saveRaw(false);
    if (syncView) syncView.scheduleAutoSync();
  }

  function savePreferences() {
    appData.preferences = { ...settings };
    save();
  }

  function getActiveDeck() {
    return appData.decks.find((d) => d.id === appData.activeDeckId) || appData.decks[0];
  }

  function applyThemeAndRedsheet() {
    document.body.classList.toggle('dark', appData.theme === 'dark');
    document.body.classList.toggle('redsheet-on', Boolean(settings.redsheet));

    const themeBtn = $('btn-theme');
    if (themeBtn) {
      themeBtn.innerHTML = appData.theme === 'dark' ? ICONS.sun : ICONS.moon;
    }

    const optRed = $('opt-redsheet');
    if (optRed) optRed.checked = Boolean(settings.redsheet);

    const studyBtn = $('btn-study-redsheet');
    if (studyBtn) studyBtn.classList.toggle('active', Boolean(settings.redsheet));
  }

  function refreshAllViewsAfterSync() {
    applyThemeAndRedsheet();
    if (!$('view-home')?.classList.contains('hidden')) {
      homeView.render();
    } else if (!$('view-deck')?.classList.contains('hidden')) {
      deckView.syncControlsFromSettings();
      deckView.refreshHeaderAndFilters();
      if ($('panel-manage')?.classList.contains('active')) deckView.renderManageTab();
    }
  }

  async function importBackupPayload(result, contextMode) {
    const totalCards = result.decks.reduce((s, d) => s + d.cards.length, 0);
    const folderCount = (result.folders || []).length;
    const folderNote = folderCount > 0 ? `・${folderCount}フォルダ` : '';

    const mode = await showChoiceDialog(
      'バックアップを検出しました',
      `${result.decks.length}冊${folderNote}（計${totalCards}問）の復元方法を選択してください。`,
      [
        { label: '現在のデータに追加', value: 'append', variant: 'primary' },
        { label: '現在のデータをすべて置換', value: 'replace', variant: 'danger' }
      ]
    );
    if (!mode) return;

    const imgRefMap = new Map();
    if (result.images && typeof result.images === 'object') {
      for (const [oldRef, dataUrl] of Object.entries(result.images)) {
        if (typeof dataUrl === 'string' && dataUrl.startsWith('data:image/')) {
          const newRef = await saveImage(dataUrl);
          imgRefMap.set(oldRef, newRef);
        }
      }
    }

    if (mode === 'replace') {
      appData.folders = [];
      appData.decks = [];
      appData.savedSessions = {};
      appData.activeStudy = null;
      if (result.studyLog) appData.studyLog = { ...result.studyLog };
    } else if (result.studyLog) {
      appData.studyLog = appData.studyLog || {};
      for (const [k, v] of Object.entries(result.studyLog)) {
        appData.studyLog[k] = Math.max(Number(appData.studyLog[k] || 0), Number(v || 0));
      }
    }

    const importedFolderIdMap = new Map();
    (result.folders || []).forEach((impFolder) => {
      const existing = (appData.folders || []).find((f) => f.name === impFolder.name);
      if (existing) {
        importedFolderIdMap.set(impFolder.id, existing.id);
      } else {
        const newF = { id: uid('folder'), name: impFolder.name };
        appData.folders.push(newF);
        importedFolderIdMap.set(impFolder.id, newF.id);
      }
    });

    result.decks.forEach((d) => {
      const newDeck = {
        id: uid('deck'),
        folderId: d.folderId ? (importedFolderIdMap.get(d.folderId) || '') : '',
        title: d.title,
        cards: (d.cards || []).map((c) => ({
          ...c,
          id: uid('c'),
          image: c.image && imgRefMap.has(c.image) ? imgRefMap.get(c.image) : (c.image || '')
        }))
      };
      appData.decks.push(newDeck);
    });

    if (appData.decks.length > 0 && !appData.decks.some((d) => d.id === appData.activeDeckId)) {
      appData.activeDeckId = appData.decks[0].id;
    }
    if (result.examDate && (mode === 'replace' || !appData.examDate)) {
      appData.examDate = result.examDate;
    }
    if (typeof result.unorderedEnabled === 'boolean' && mode === 'replace') {
      appData.unorderedEnabled = result.unorderedEnabled;
    }
    if (typeof result.unorderedDelimiters === 'string' && mode === 'replace') {
      appData.unorderedDelimiters = result.unorderedDelimiters;
    }

    save();
    if (contextMode === 'home') homeView.render();
    else {
      deckView.refreshHeaderAndFilters();
      deckView.renderManageTab();
    }
    showToast(`${result.decks.length}冊（計${totalCards}問）を復元しました`);
  }

  async function handleImportFile(file, contextMode) {
    try {
      const text = await readFileTextSmart(file);

      if (file.name.toLowerCase().endsWith('.json') || text.trim().startsWith('{')) {
        const parsedJson = parseBackupJson(text);
        if (parsedJson && parsedJson.decks.length > 0) {
          await importBackupPayload(parsedJson, contextMode);
          return;
        }
      }

      const result = parseCsvAuto(text);
      if (result.type === 'backup' && result.decks.length > 0) {
        await importBackupPayload(result, contextMode);
      } else if (result.type === 'cards' && result.cards.length > 0) {
        if (contextMode === 'home') {
          const deckTitle = file.name.replace(/\.csv$/i, '').trim() || 'インポート単語帳';
          const newDeck = {
            id: uid('deck'),
            folderId: state.currentFolderId || '',
            title: deckTitle,
            cards: result.cards
          };
          appData.decks.push(newDeck);
          save();
          homeView.render();
          showToast(`「${deckTitle}」を作成（${result.cards.length}問）`);
        } else {
          const deck = getActiveDeck();
          if (!deck) return;
          deck.cards.push(...result.cards);
          save();
          deckView.refreshHeaderAndFilters();
          deckView.renderManageTab();
          showToast(`${result.cards.length}問を追加しました`);
        }
      } else {
        await showAlert('読み込めませんでした', '対応しているCSVまたはJSONファイルを確認してください。');
      }
    } catch (err) {
      console.error('Import error:', err);
      await showAlert('読み込みエラー', 'ファイルの読み込みに失敗しました。');
    }
  }

  const ctx = {
    appData,
    settings,
    state,
    haptic,
    save,
    saveRaw,
    savePreferences,
    getActiveDeck,
    applyThemeAndRedsheet,
    refreshAllViewsAfterSync,
    handleImportFile,
    showHomeView: (folderId) => homeView.show(folderId),
    openDeckView: (deckId, tab) => deckView.open(deckId, tab),
    openFolderMoveModal: (deckId) => homeView.openFolderMoveModal(deckId),
    openCardEditModal: (card, onSaved) => deckView.openEditModal(card, onSaved),
    openShareModal: (deckIds) => shareView.openShareModal(deckIds),
    startMemorizeSession: (forceFresh) => studyView.startMemorize(forceFresh),
    startTestSession: (customIds) => studyView.startTest(customIds),
    quickStartDeck: (deckId) => {
      appData.activeDeckId = deckId;
      settings.category = 'ALL';
      settings.studyType = 'memorize';
      savePreferences();
      studyView.startMemorize(false);
    },
    onExitStudy: () => {
      deckView.syncControlsFromSettings();
      deckView.refreshHeaderAndFilters();
    }
  };

  homeView = createHomeView(ctx);
  deckView = createDeckView(ctx);
  studyView = createStudyView(ctx);
  shareView = createShareView(ctx);
  syncView = createSyncView(ctx);

  $('btn-theme')?.addEventListener('click', () => {
    appData.theme = appData.theme === 'dark' ? 'light' : 'dark';
    save();
    applyThemeAndRedsheet();
  });

  homeView.bindEvents();
  deckView.bindEvents();
  studyView.bindEvents();
  shareView.bindEvents();
  syncView.bindEvents();

  initModalListeners(() => {
    deckView.closeEditModal();
    homeView.closeFolderMoveModal();
    shareView.closeShareModal();
    shareView.closeSearchModal();
    shareView.closeImportShareModal();
    syncView.closeSyncModal();
  });

  applyThemeAndRedsheet();
  migrateInlineImages(appData, () => saveRaw(true));

  const flushProgress = () => {
    if (studyView.isActive()) studyView.persistCurrentSession(true);
  };
  window.addEventListener('pagehide', flushProgress);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushProgress();
  });

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    navigator.serviceWorker.register('./sw.js').catch((err) => {
      console.warn('SW register skipped:', err);
    });
  }

  // Check incoming shared URL (?share=ID)
  const incomingShareId = new URLSearchParams(window.location.search).get('share');
  if (incomingShareId) {
    homeView.show(null);
    shareView.openIncomingShare(incomingShareId, true);
    syncView.autoCheckOnStartup();
    return;
  }

  // Auto-restore if user left mid-memorize session
  if (appData.activeStudy && appData.activeStudy.deckId && appData.activeStudy.format) {
    const targetDeck = appData.decks.find((d) => d.id === appData.activeStudy.deckId);
    const saved = targetDeck ? getValidSavedSession(appData, targetDeck.id, appData.activeStudy.format) : null;
    if (targetDeck && saved) {
      appData.activeDeckId = targetDeck.id;
      state.currentFolderId = targetDeck.folderId && appData.folders.some((f) => f.id === targetDeck.folderId)
        ? targetDeck.folderId
        : null;
      studyView.restoreFromSaved(saved, true);
      syncView.autoCheckOnStartup();
      return;
    }
    appData.activeStudy = null;
    saveRaw(true);
  }

  homeView.show(null);
  syncView.autoCheckOnStartup();
});
