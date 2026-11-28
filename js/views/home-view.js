import { ICONS } from '../icons.js';
import { escapeHtml } from '../math-renderer.js';
import { uid, getStudyStreak } from '../store.js';
import {
  downloadTextFile,
  generateFullBackupCsvText,
  generateFullBackupJsonText
} from '../backup.js';
import { exportImageMap } from '../image-db.js';
import { showPrompt, showConfirm, showChoiceDialog, showToast } from './modal.js';

const $ = (id) => document.getElementById(id);

export function createHomeView(ctx) {
  let movingDeckId = null;

  function getFolderById(folderId) {
    if (!folderId) return null;
    return (ctx.appData.folders || []).find((f) => f.id === folderId) || null;
  }

  function createDeckCardElement(deck) {
    const total = deck.cards.length;
    const mastered = deck.cards.filter((c) => c.correctCount > 0 && c.correctCount >= c.wrongCount).length;
    const weak = deck.cards.filter((c) => c.wrongCount > c.correctCount || c.pinned).length;
    const pct = total > 0 ? Math.round((mastered / total) * 100) : 0;

    const cardEl = document.createElement('div');
    cardEl.className = 'deck-card';
    cardEl.innerHTML = `
      <div class="deck-card-top">
        <div class="deck-card-title">${escapeHtml(deck.title)}</div>
        <div class="deck-card-right-tools">
          <span class="deck-card-count">${total}問</span>
          <button type="button" class="deck-tool-btn deck-move-btn" title="フォルダ移動" aria-label="フォルダ移動">${ICONS.folder}</button>
          <button type="button" class="deck-play-btn" title="すぐ学習" aria-label="すぐ学習">${ICONS.play}</button>
        </div>
      </div>
      <div class="progress-slim">
        <div class="progress-slim-fill" style="width: ${pct}%;"></div>
      </div>
      <div class="deck-card-footer">
        <span>定着 ${pct}%（${mastered}/${total}）</span>
        <span>苦手・★ ${weak}</span>
      </div>
    `;

    cardEl.querySelector('.deck-move-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      ctx.haptic(10);
      openFolderMoveModal(deck.id);
    });

    cardEl.querySelector('.deck-play-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      ctx.haptic(12);
      if (deck.cards.length === 0) {
        ctx.openDeckView(deck.id, 'manage');
        showToast('まずはカードを追加してください');
        return;
      }
      ctx.quickStartDeck(deck.id);
    });

    cardEl.addEventListener('click', () => {
      ctx.haptic(8);
      ctx.openDeckView(deck.id);
    });

    return cardEl;
  }

  function render() {
    const folderList = $('home-folder-list');
    const deckList = $('home-deck-list');
    const heroEl = $('home-hero');
    const folderNav = $('folder-nav-bar');
    const newFolderBtn = $('btn-new-folder');
    const createRow = $('home-create-row');
    const streakPill = $('home-streak-pill');
    if (!folderList || !deckList) return;

    const streak = getStudyStreak(ctx.appData);
    if (streakPill) {
      if (streak > 0) {
        streakPill.textContent = `${streak}日連続`;
        streakPill.classList.remove('hidden');
      } else {
        streakPill.classList.add('hidden');
      }
    }

    folderList.innerHTML = '';
    deckList.innerHTML = '';

    const activeFolder = getFolderById(ctx.state.currentFolderId);

    if (activeFolder) {
      heroEl?.classList.add('hidden');
      folderNav?.classList.remove('hidden');
      folderList.classList.add('hidden');
      newFolderBtn?.classList.add('hidden');
      createRow?.classList.add('single');
      $('current-folder-title').textContent = activeFolder.name;

      const decksInFolder = ctx.appData.decks.filter((d) => d.folderId === activeFolder.id);
      if (decksInFolder.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'empty-folder-box';
        empty.textContent = 'このフォルダにはまだ単語帳がありません';
        deckList.appendChild(empty);
      } else {
        decksInFolder.forEach((deck) => deckList.appendChild(createDeckCardElement(deck)));
      }
    } else {
      heroEl?.classList.remove('hidden');
      folderNav?.classList.add('hidden');
      newFolderBtn?.classList.remove('hidden');
      createRow?.classList.remove('single');

      const folders = ctx.appData.folders || [];
      if (folders.length > 0) {
        folderList.classList.remove('hidden');
        folders.forEach((folder) => {
          const childDecks = ctx.appData.decks.filter((d) => d.folderId === folder.id);
          const totalCards = childDecks.reduce((sum, d) => sum + d.cards.length, 0);

          const fEl = document.createElement('div');
          fEl.className = 'folder-card';
          fEl.innerHTML = `
            <div class="folder-card-left">
              <div class="folder-icon-box">${ICONS.folder}</div>
              <div class="folder-card-info">
                <div class="folder-card-title">${escapeHtml(folder.name)}</div>
                <div class="folder-card-meta">${totalCards}問</div>
              </div>
            </div>
            <div class="folder-card-right">
              <span class="folder-deck-badge">${childDecks.length}冊</span>
              ${ICONS.chevronRight}
            </div>
          `;
          fEl.addEventListener('click', () => {
            ctx.haptic(8);
            show(folder.id);
          });
          folderList.appendChild(fEl);
        });
      } else {
        folderList.classList.add('hidden');
      }

      const rootDecks = ctx.appData.decks.filter((d) => !d.folderId || !getFolderById(d.folderId));
      rootDecks.forEach((deck) => deckList.appendChild(createDeckCardElement(deck)));
    }
  }

  function show(folderId = ctx.state.currentFolderId) {
    ctx.state.currentFolderId = folderId && getFolderById(folderId) ? folderId : null;
    $('view-study')?.classList.add('hidden');
    $('view-deck')?.classList.add('hidden');
    $('view-home')?.classList.remove('hidden');
    render();
  }

  function openFolderMoveModal(deckId) {
    const deck = ctx.appData.decks.find((d) => d.id === deckId);
    if (!deck) return;
    movingDeckId = deck.id;
    $('move-modal-deck-name').textContent = `対象：${deck.title}`;
    renderFolderMoveChoices(deck);
    $('folder-move-modal').classList.remove('hidden');
  }

  function closeFolderMoveModal() {
    movingDeckId = null;
    $('folder-move-modal')?.classList.add('hidden');
  }

  function renderFolderMoveChoices(deck) {
    const list = $('folder-move-list');
    if (!list) return;
    list.innerHTML = '';

    const currentFid = deck.folderId && getFolderById(deck.folderId) ? deck.folderId : '';

    const addRow = (fid, label, isSelected) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'folder-choice-item' + (isSelected ? ' active' : '');
      btn.innerHTML = `<span>${escapeHtml(label)}</span><span>${isSelected ? ICONS.check : ''}</span>`;
      btn.addEventListener('click', () => {
        deck.folderId = fid;
        ctx.save();
        ctx.haptic(10);
        closeFolderMoveModal();
        if (!$('view-home').classList.contains('hidden')) render();
        showToast('フォルダを移動しました');
      });
      list.appendChild(btn);
    };

    addRow('', 'フォルダなし（トップ一覧）', currentFid === '');
    (ctx.appData.folders || []).forEach((f) => {
      addRow(f.id, f.name, currentFid === f.id);
    });
  }

  function bindEvents() {
    $('btn-new-deck')?.addEventListener('click', async () => {
      const title = await showPrompt('新しい単語帳の名前', '', { placeholder: '例：英単語・数学公式', confirmLabel: '作成' });
      if (!title || !title.trim()) return;
      const newDeck = {
        id: uid('deck'),
        folderId: ctx.state.currentFolderId || '',
        title: title.trim(),
        cards: []
      };
      ctx.appData.decks.push(newDeck);
      ctx.save();
      ctx.openDeckView(newDeck.id, 'manage');
    });

    $('btn-new-folder')?.addEventListener('click', async () => {
      const name = await showPrompt('新しいフォルダの名前', '', { placeholder: '例：定期テスト・英語', confirmLabel: '作成' });
      if (!name || !name.trim()) return;
      const newFolder = { id: uid('folder'), name: name.trim() };
      ctx.appData.folders.push(newFolder);
      ctx.save();
      ctx.haptic(10);
      show(newFolder.id);
    });

    $('btn-folder-back')?.addEventListener('click', () => {
      ctx.haptic(8);
      show(null);
    });

    $('btn-rename-folder')?.addEventListener('click', async () => {
      const folder = getFolderById(ctx.state.currentFolderId);
      if (!folder) return;
      const next = await showPrompt('フォルダ名を変更', folder.name, { confirmLabel: '保存' });
      if (!next || !next.trim()) return;
      folder.name = next.trim();
      ctx.save();
      render();
    });

    $('btn-delete-folder')?.addEventListener('click', async () => {
      const folder = getFolderById(ctx.state.currentFolderId);
      if (!folder) return;
      const ok = await showConfirm(
        `フォルダ「${folder.name}」を削除`,
        '中の単語帳は削除されず、トップ一覧に戻ります。',
        { confirmLabel: '削除', danger: true }
      );
      if (!ok) return;
      ctx.appData.decks.forEach((d) => {
        if (d.folderId === folder.id) d.folderId = '';
      });
      ctx.appData.folders = ctx.appData.folders.filter((f) => f.id !== folder.id);
      ctx.save();
      show(null);
      showToast('フォルダを削除しました');
    });

    $('btn-move-create-folder')?.addEventListener('click', async () => {
      const deck = ctx.appData.decks.find((d) => d.id === movingDeckId);
      if (!deck) return;
      const name = await showPrompt('新しいフォルダの名前', '', { confirmLabel: '作成して移動' });
      if (!name || !name.trim()) return;
      const newFolder = { id: uid('folder'), name: name.trim() };
      ctx.appData.folders.push(newFolder);
      deck.folderId = newFolder.id;
      ctx.save();
      ctx.haptic(10);
      closeFolderMoveModal();
      if (!$('view-home').classList.contains('hidden')) render();
      showToast(`「${newFolder.name}」へ移動しました`);
    });

    $('btn-move-cancel')?.addEventListener('click', closeFolderMoveModal);
    $('folder-move-modal')?.addEventListener('click', (e) => {
      if (e.target === $('folder-move-modal')) closeFolderMoveModal();
    });

    $('btn-home-export')?.addEventListener('click', async () => {
      const choice = await showChoiceDialog(
        'バックアップ形式を選択',
        'JSONは画像・ロック設定・学習ログまで完全保存します。',
        [
          { label: 'JSON 完全バックアップ（推奨）', value: 'json', variant: 'primary' },
          { label: 'CSV 全データ（Excel編集向け）', value: 'csv' }
        ]
      );
      const dateStr = new Date().toISOString().slice(0, 10);
      if (choice === 'json') {
        const imgMap = await exportImageMap(ctx.appData.decks);
        const json = generateFullBackupJsonText(ctx.appData, imgMap);
        downloadTextFile(json, `StudyLoop_backup_${dateStr}.json`, 'application/json;charset=utf-8');
        showToast('JSONバックアップを保存しました');
      } else if (choice === 'csv') {
        const csv = generateFullBackupCsvText(ctx.appData);
        downloadTextFile(csv, `StudyLoop_backup_${dateStr}.csv`);
        showToast('CSVバックアップを保存しました');
      }
    });

    $('home-import-file')?.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      await ctx.handleImportFile(file, 'home');
      e.target.value = '';
    });
  }

  return {
    show,
    render,
    openFolderMoveModal,
    closeFolderMoveModal,
    bindEvents
  };
}
