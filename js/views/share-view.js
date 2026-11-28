import { escapeHtml } from '../math-renderer.js';
import { uid, normalizeCard } from '../store.js';
import {
  loadSharePrefs,
  saveSharePrefs,
  loadMyShares,
  upsertMyShare,
  removeMyShare,
  buildShareUrl,
  buildSharePayload,
  pingGas,
  publishShare,
  fetchShareById,
  searchPublicShares,
  deleteShare
} from '../share-service.js';
import { downloadTextFile } from '../backup.js';
import { showAlert, showConfirm, showToast } from './modal.js';

const $ = (id) => document.getElementById(id);

function formatDateShort(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `${d.getFullYear()}/${m}/${day}`;
}

export function createShareView(ctx) {
  const shareSelectedIds = new Set();
  let shareVisibility = 'unlisted'; // 'unlisted' | 'public'
  let shareModalTab = 'create';     // 'create' | 'manage'
  let updatingShareEntry = null;    // { id, editKey, ... } when updating an existing share
  let gasRequiresPasscode = false;

  // Incoming share preview state
  let incomingShare = null;         // { id, title, author, updatedAt, payload }
  const incomingSelectedIndexes = new Set();

  let searchDebounce = null;

  /* ==================== 共有モーダル ==================== */
  function openShareModal(initialDeckIds = null) {
    shareModalTab = 'create';
    updatingShareEntry = null;
    shareSelectedIds.clear();

    const allDecks = ctx.appData.decks || [];
    if (Array.isArray(initialDeckIds) && initialDeckIds.length > 0) {
      initialDeckIds.forEach((id) => shareSelectedIds.add(id));
    } else if (allDecks.length > 0) {
      allDecks.forEach((d) => shareSelectedIds.add(d.id));
    }

    const prefs = loadSharePrefs();
    const authorInput = $('share-author-input');
    if (authorInput) authorInput.value = prefs.author || '';
    const passInput = $('share-passcode-input');
    if (passInput) passInput.value = prefs.passcode || '';

    shareVisibility = 'unlisted';
    syncVisibilityButtons();
    $('share-result-box')?.classList.add('hidden');
    $('share-update-banner')?.classList.add('hidden');
    $('share-modal')?.classList.remove('hidden');

    switchShareTab('create');
    renderShareDeckList();
    autoFillShareTitle();

    // Check if GAS requires passcode in background
    pingGas().then((info) => {
      gasRequiresPasscode = Boolean(info.requiresPasscode);
      $('share-passcode-wrap')?.classList.toggle('hidden', !gasRequiresPasscode);
    }).catch(() => {
      $('share-passcode-wrap')?.classList.add('hidden');
    });
  }

  function closeShareModal() {
    updatingShareEntry = null;
    $('share-modal')?.classList.add('hidden');
  }

  function switchShareTab(tab) {
    shareModalTab = tab;
    $('btn-share-tab-create')?.classList.toggle('active', tab === 'create');
    $('btn-share-tab-manage')?.classList.toggle('active', tab === 'manage');
    $('share-panel-create')?.classList.toggle('hidden', tab !== 'create');
    $('share-panel-manage')?.classList.toggle('hidden', tab !== 'manage');
    if (tab === 'manage') renderMySharesList();
  }

  function syncVisibilityButtons() {
    document.querySelectorAll('.share-vis-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.visibility === shareVisibility);
    });
  }

  function autoFillShareTitle() {
    const input = $('share-title-input');
    if (!input) return;
    if (updatingShareEntry) {
      input.value = updatingShareEntry.title || '';
      return;
    }
    const decks = (ctx.appData.decks || []).filter((d) => shareSelectedIds.has(d.id));
    if (decks.length === 1) {
      input.value = decks[0].title;
    } else if (decks.length > 1) {
      input.value = `${decks[0].title} ほか${decks.length - 1}冊`;
    } else {
      input.value = '';
    }
  }

  function updateShareSelectionSummary() {
    const decks = (ctx.appData.decks || []).filter((d) => shareSelectedIds.has(d.id));
    const totalCards = decks.reduce((s, d) => s + (d.cards?.length || 0), 0);
    const el = $('share-selected-summary');
    if (el) el.textContent = `${decks.length}冊（${totalCards}問）選択中`;

    const pubBtn = $('btn-publish-share');
    if (pubBtn) {
      pubBtn.disabled = decks.length === 0;
      pubBtn.style.opacity = decks.length === 0 ? '0.45' : '1';
      pubBtn.textContent = updatingShareEntry ? '同じURLで上書き更新' : '短縮URLを発行';
    }
  }

  function createDeckCheckRow(deck) {
    const label = document.createElement('label');
    label.className = 'share-check-row';

    const left = document.createElement('span');
    left.className = 'share-check-left';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = shareSelectedIds.has(deck.id);
    cb.addEventListener('change', () => {
      if (cb.checked) shareSelectedIds.add(deck.id);
      else shareSelectedIds.delete(deck.id);
      renderShareDeckList();
      if (!updatingShareEntry) autoFillShareTitle();
    });

    const title = document.createElement('span');
    title.className = 'share-check-title';
    title.textContent = deck.title;

    left.appendChild(cb);
    left.appendChild(title);

    const count = document.createElement('span');
    count.className = 'share-check-count';
    count.textContent = `${deck.cards.length}問`;

    label.appendChild(left);
    label.appendChild(count);
    return label;
  }

  function renderShareDeckList() {
    const container = $('share-deck-list');
    if (!container) return;
    container.innerHTML = '';

    const folders = ctx.appData.folders || [];
    const folderIds = new Set(folders.map((f) => f.id));

    folders.forEach((folder) => {
      const children = ctx.appData.decks.filter((d) => d.folderId === folder.id);
      if (children.length === 0) return;

      const group = document.createElement('div');
      group.className = 'share-folder-group';

      const head = document.createElement('label');
      head.className = 'share-folder-head';

      const headLeft = document.createElement('span');
      headLeft.className = 'share-check-left';

      const folderCb = document.createElement('input');
      folderCb.type = 'checkbox';
      const checkedCount = children.filter((d) => shareSelectedIds.has(d.id)).length;
      folderCb.checked = checkedCount === children.length;
      folderCb.indeterminate = checkedCount > 0 && checkedCount < children.length;
      folderCb.addEventListener('change', () => {
        children.forEach((d) => {
          if (folderCb.checked) shareSelectedIds.add(d.id);
          else shareSelectedIds.delete(d.id);
        });
        renderShareDeckList();
        if (!updatingShareEntry) autoFillShareTitle();
      });

      const fname = document.createElement('span');
      fname.className = 'share-check-title';
      fname.textContent = folder.name;

      headLeft.appendChild(folderCb);
      headLeft.appendChild(fname);

      const fcount = document.createElement('span');
      fcount.className = 'share-check-count';
      fcount.textContent = `${children.length}冊`;

      head.appendChild(headLeft);
      head.appendChild(fcount);

      const childWrap = document.createElement('div');
      childWrap.className = 'share-folder-children';
      children.forEach((deck) => childWrap.appendChild(createDeckCheckRow(deck)));

      group.appendChild(head);
      group.appendChild(childWrap);
      container.appendChild(group);
    });

    const rootDecks = ctx.appData.decks.filter((d) => !d.folderId || !folderIds.has(d.folderId));
    rootDecks.forEach((deck) => container.appendChild(createDeckCheckRow(deck)));

    updateShareSelectionSummary();
  }

  function renderMySharesList() {
    const listEl = $('my-shares-list');
    if (!listEl) return;
    const items = loadMyShares();
    listEl.innerHTML = '';

    if (items.length === 0) {
      listEl.innerHTML = '<div class="cloud-status-msg">この端末から発行した共有URLはありません</div>';
      return;
    }

    items.forEach((item) => {
      const card = document.createElement('div');
      card.className = 'cloud-item-card';

      const visLabel = item.visibility === 'public' ? '検索に公開' : 'URL限定';
      card.innerHTML = `
        <div class="cloud-item-top">
          <div class="cloud-item-title">${escapeHtml(item.title || '共有単語帳')}</div>
          <span class="vis-pill ${item.visibility === 'public' ? 'public' : ''}">${visLabel}</span>
        </div>
        <div class="cloud-item-meta">
          <span>${item.deckCount || 1}冊 / ${item.cardCount || 0}問</span>
          <span>${formatDateShort(item.updatedAt)}</span>
        </div>
      `;

      const actions = document.createElement('div');
      actions.className = 'cloud-item-actions';

      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'mini-link-btn';
      copyBtn.textContent = 'URLコピー';
      copyBtn.addEventListener('click', () => copyUrlWithToast(buildShareUrl(item.id)));

      const updateBtn = document.createElement('button');
      updateBtn.type = 'button';
      updateBtn.className = 'mini-link-btn';
      updateBtn.textContent = '上書き更新';
      updateBtn.addEventListener('click', () => {
        updatingShareEntry = item;
        shareVisibility = item.visibility === 'public' ? 'public' : 'unlisted';
        syncVisibilityButtons();
        shareSelectedIds.clear();
        const existingDeckIds = new Set(ctx.appData.decks.map((d) => d.id));
        (item.deckIds || []).forEach((id) => {
          if (existingDeckIds.has(id)) shareSelectedIds.add(id);
        });
        if (shareSelectedIds.size === 0 && ctx.appData.decks.length > 0) {
          shareSelectedIds.add(ctx.appData.decks[0].id);
        }
        const banner = $('share-update-banner');
        if (banner) {
          banner.classList.remove('hidden');
          $('share-update-label').textContent = `上書き対象：${item.title}`;
        }
        $('share-result-box')?.classList.add('hidden');
        switchShareTab('create');
        renderShareDeckList();
        autoFillShareTitle();
      });

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'mini-link-btn danger-link';
      delBtn.textContent = '削除';
      delBtn.addEventListener('click', async () => {
        const ok = await showConfirm('共有を削除しますか？', `「${item.title}」の共有URLと検索表示が無効になります。`, {
          confirmLabel: '削除',
          danger: true
        });
        if (!ok) return;
        delBtn.disabled = true;
        try {
          await deleteShare(item.id, item.editKey);
          removeMyShare(item.id);
          renderMySharesList();
          showToast('共有を削除しました');
        } catch (err) {
          delBtn.disabled = false;
          // If already deleted remotely, let user remove local record
          const removeLocal = await showConfirm('削除エラー', `${err.message}\nこの端末の履歴から消去しますか？`, {
            confirmLabel: '履歴から消去',
            danger: true
          });
          if (removeLocal) {
            removeMyShare(item.id);
            renderMySharesList();
          }
        }
      });

      actions.appendChild(copyBtn);
      actions.appendChild(updateBtn);
      actions.appendChild(delBtn);
      card.appendChild(actions);
      listEl.appendChild(card);
    });
  }

  async function copyUrlWithToast(url) {
    try {
      await navigator.clipboard.writeText(url);
      showToast('共有URLをコピーしました');
    } catch (_) {
      const inp = $('share-result-url');
      if (inp) {
        inp.focus();
        inp.select();
      }
      showToast('URLを選択してコピーしてください');
    }
  }

  async function handlePublish() {
    const selectedIds = Array.from(shareSelectedIds);
    if (selectedIds.length === 0) return;

    const payload = buildSharePayload(ctx.appData, selectedIds);
    const totalCards = payload.decks.reduce((s, d) => s + d.cards.length, 0);
    if (totalCards === 0) {
      showToast('カードが1問以上ある単語帳を選んでください');
      return;
    }

    const title = ($('share-title-input')?.value || '').trim() || payload.decks[0].title;
    const author = ($('share-author-input')?.value || '').trim();
    const passcode = ($('share-passcode-input')?.value || '').trim();

    saveSharePrefs({ ...loadSharePrefs(), author, passcode });

    const btn = $('btn-publish-share');
    const origText = btn.textContent;
    btn.disabled = true;
    btn.textContent = '発行中...';

    try {
      const res = await publishShare({
        payload,
        title,
        author,
        visibility: shareVisibility,
        passcode,
        existingId: updatingShareEntry?.id || '',
        existingEditKey: updatingShareEntry?.editKey || ''
      });

      const shareUrl = buildShareUrl(res.id);
      upsertMyShare({
        id: res.id,
        editKey: res.editKey,
        title,
        visibility: shareVisibility,
        deckIds: selectedIds,
        deckCount: payload.decks.length,
        cardCount: totalCards,
        updatedAt: new Date().toISOString()
      });

      $('share-result-url').value = shareUrl;
      $('share-result-box')?.classList.remove('hidden');
      showToast(res.updated ? '同じURLで最新版に更新しました' : '短縮URLを発行しました');
      copyUrlWithToast(shareUrl);
    } catch (err) {
      await showAlert('共有エラー', err.message || '共有URLの発行に失敗しました');
    } finally {
      btn.disabled = false;
      btn.textContent = origText;
      updateShareSelectionSummary();
    }
  }

  function handleExportSelectedShareJson() {
    const selectedIds = Array.from(shareSelectedIds);
    if (selectedIds.length === 0) {
      showToast('書き出す単語帳を選択してください');
      return;
    }
    const payload = buildSharePayload(ctx.appData, selectedIds);
    const title = ($('share-title-input')?.value || payload.decks[0]?.title || 'share').replace(/[\\/:*?"<>|]/g, '_');
    downloadTextFile(JSON.stringify({ format: 'studyloop_backup_v2', data: payload }, null, 2), `${title}.json`, 'application/json;charset=utf-8');
    showToast('共有用JSONを保存しました');
  }

  /* ==================== 公開検索モーダル ==================== */
  function openSearchModal() {
    $('search-modal')?.classList.remove('hidden');
    const inp = $('public-search-input');
    if (inp) {
      setTimeout(() => inp.focus(), 40);
    }
    runPublicSearch(inp?.value || '');
  }

  function closeSearchModal() {
    $('search-modal')?.classList.add('hidden');
  }

  async function runPublicSearch(query = '') {
    const listEl = $('public-search-list');
    if (!listEl) return;
    listEl.innerHTML = '<div class="cloud-status-msg">読み込み中...</div>';

    try {
      const items = await searchPublicShares(query, 30);
      listEl.innerHTML = '';
      if (items.length === 0) {
        listEl.innerHTML = `<div class="cloud-status-msg">${query ? '一致する公開単語帳が見つかりませんでした' : 'まだ公開されている単語帳はありません'}</div>`;
        return;
      }

      items.forEach((item) => {
        const card = document.createElement('div');
        card.className = 'cloud-item-card';

        const metaParts = [`${item.deckCount}冊 / ${item.cardCount}問`];
        if (item.author) metaParts.push(`by ${item.author}`);
        if (item.updatedAt) metaParts.push(formatDateShort(item.updatedAt));

        card.innerHTML = `
          <div class="cloud-item-top">
            <div class="cloud-item-title">${escapeHtml(item.title)}</div>
          </div>
          <div class="cloud-item-meta">${metaParts.map((m) => `<span>${escapeHtml(m)}</span>`).join('')}</div>
          ${item.categories ? `<div class="cloud-item-cats">${escapeHtml(item.categories)}</div>` : ''}
        `;

        const actions = document.createElement('div');
        actions.className = 'cloud-item-actions';

        const openBtn = document.createElement('button');
        openBtn.type = 'button';
        openBtn.className = 'mini-link-btn';
        openBtn.textContent = '内容を見る / 取り込む';
        openBtn.addEventListener('click', () => {
          closeSearchModal();
          openIncomingShare(item.id, false);
        });

        actions.appendChild(openBtn);
        card.appendChild(actions);
        listEl.appendChild(card);
      });
    } catch (err) {
      listEl.innerHTML = `<div class="cloud-status-msg">${escapeHtml(err.message || '検索に失敗しました')}</div>`;
    }
  }

  /* ==================== 共有受取プレビューモーダル ==================== */
  async function openIncomingShare(shareId, cleanUrlParam = true) {
    if (!shareId) return;
    if (cleanUrlParam) {
      try {
        const u = new URL(window.location.href);
        u.searchParams.delete('share');
        window.history.replaceState({}, '', u.pathname + u.search + u.hash);
      } catch (_) {}
    }

    const modal = $('import-share-modal');
    const listEl = $('import-share-deck-list');
    const titleEl = $('import-share-title');
    const metaEl = $('import-share-meta');
    const confirmBtn = $('btn-confirm-import-share');

    incomingShare = null;
    incomingSelectedIndexes.clear();

    if (titleEl) titleEl.textContent = '共有データを読み込み中...';
    if (metaEl) metaEl.textContent = '';
    if (listEl) listEl.innerHTML = '<div class="cloud-status-msg">読み込み中...</div>';
    if (confirmBtn) confirmBtn.disabled = true;
    modal?.classList.remove('hidden');

    try {
      const res = await fetchShareById(shareId);
      const payload = res.payload;
      if (!payload || !Array.isArray(payload.decks) || payload.decks.length === 0) {
        throw new Error('取り込める単語帳がありません');
      }

      incomingShare = res;
      payload.decks.forEach((_, idx) => incomingSelectedIndexes.add(idx));

      if (titleEl) titleEl.textContent = res.title || payload.decks[0].title;
      const metaParts = [];
      if (res.author) metaParts.push(`作成者: ${res.author}`);
      if (res.updatedAt) metaParts.push(`更新: ${formatDateShort(res.updatedAt)}`);
      if (metaEl) metaEl.textContent = metaParts.join(' / ');

      renderIncomingDeckList();
    } catch (err) {
      closeImportShareModal();
      await showAlert('共有リンクを開けませんでした', err.message || 'URLが無効か削除されています');
    }
  }

  function closeImportShareModal() {
    incomingShare = null;
    $('import-share-modal')?.classList.add('hidden');
  }

  function renderIncomingDeckList() {
    const listEl = $('import-share-deck-list');
    const confirmBtn = $('btn-confirm-import-share');
    if (!listEl || !incomingShare) return;

    const decks = incomingShare.payload.decks || [];
    const folderNameById = new Map((incomingShare.payload.folders || []).map((f) => [f.id, f.name]));
    listEl.innerHTML = '';

    decks.forEach((deck, idx) => {
      const label = document.createElement('label');
      label.className = 'share-check-row';

      const left = document.createElement('span');
      left.className = 'share-check-left';

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = incomingSelectedIndexes.has(idx);
      cb.addEventListener('change', () => {
        if (cb.checked) incomingSelectedIndexes.add(idx);
        else incomingSelectedIndexes.delete(idx);
        updateIncomingButton();
      });

      const fName = deck.folderId ? folderNameById.get(deck.folderId) : '';
      const title = document.createElement('span');
      title.className = 'share-check-title';
      title.textContent = fName ? `[${fName}] ${deck.title}` : deck.title;

      left.appendChild(cb);
      left.appendChild(title);

      const count = document.createElement('span');
      count.className = 'share-check-count';
      count.textContent = `${(deck.cards || []).length}問`;

      label.appendChild(left);
      label.appendChild(count);
      listEl.appendChild(label);
    });

    updateIncomingButton();
    if (confirmBtn) confirmBtn.disabled = incomingSelectedIndexes.size === 0;
  }

  function updateIncomingButton() {
    const btn = $('btn-confirm-import-share');
    if (!btn || !incomingShare) return;
    const decks = incomingShare.payload.decks || [];
    let count = 0;
    let cards = 0;
    incomingSelectedIndexes.forEach((idx) => {
      const d = decks[idx];
      if (d) {
        count += 1;
        cards += (d.cards || []).length;
      }
    });
    btn.disabled = count === 0;
    btn.style.opacity = count === 0 ? '0.45' : '1';
    btn.textContent = count > 0 ? `${count}冊（${cards}問）を取り込む` : '単語帳を選択してください';
  }

  function confirmIncomingImport() {
    if (!incomingShare || incomingSelectedIndexes.size === 0) return;
    const payload = incomingShare.payload;
    const selectedDecks = (payload.decks || []).filter((_, idx) => incomingSelectedIndexes.has(idx));

    // Reuse or create referenced folders
    const folderIdMap = new Map();
    const usedFolderIds = new Set(selectedDecks.map((d) => d.folderId).filter(Boolean));
    (payload.folders || []).forEach((f) => {
      if (!usedFolderIds.has(f.id)) return;
      const existing = (ctx.appData.folders || []).find((ef) => ef.name === f.name);
      if (existing) {
        folderIdMap.set(f.id, existing.id);
      } else {
        const nf = { id: uid('folder'), name: f.name };
        ctx.appData.folders.push(nf);
        folderIdMap.set(f.id, nf.id);
      }
    });

    const createdDecks = [];
    selectedDecks.forEach((d) => {
      const newDeck = {
        id: uid('deck'),
        folderId: d.folderId ? (folderIdMap.get(d.folderId) || '') : '',
        title: String(d.title || '共有単語帳').trim(),
        cards: (d.cards || [])
          .filter((c) => c && c.front && c.back)
          .map((c) => normalizeCard({
            category: c.category || '一般',
            front: c.front,
            back: c.back,
            hint: c.hint || ''
          }))
      };
      ctx.appData.decks.push(newDeck);
      createdDecks.push(newDeck);
    });

    ctx.save();
    closeImportShareModal();

    if (createdDecks.length === 1) {
      ctx.openDeckView(createdDecks[0].id, 'setup');
      showToast(`「${createdDecks[0].title}」を取り込みました`);
    } else {
      ctx.showHomeView(null);
      showToast(`${createdDecks.length}冊の単語帳を取り込みました`);
    }
  }

  function bindEvents() {
    $('btn-open-share')?.addEventListener('click', () => openShareModal(null));
    $('btn-share-close')?.addEventListener('click', closeShareModal);
    $('share-modal')?.addEventListener('click', (e) => {
      if (e.target === $('share-modal')) closeShareModal();
    });

    $('btn-share-tab-create')?.addEventListener('click', () => switchShareTab('create'));
    $('btn-share-tab-manage')?.addEventListener('click', () => switchShareTab('manage'));

    $('btn-share-select-all')?.addEventListener('click', () => {
      ctx.appData.decks.forEach((d) => shareSelectedIds.add(d.id));
      renderShareDeckList();
      if (!updatingShareEntry) autoFillShareTitle();
    });

    $('btn-share-clear-all')?.addEventListener('click', () => {
      shareSelectedIds.clear();
      renderShareDeckList();
      if (!updatingShareEntry) autoFillShareTitle();
    });

    document.querySelectorAll('.share-vis-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        shareVisibility = btn.dataset.visibility;
        syncVisibilityButtons();
      });
    });

    $('btn-share-cancel-update')?.addEventListener('click', () => {
      updatingShareEntry = null;
      $('share-update-banner')?.classList.add('hidden');
      autoFillShareTitle();
      updateShareSelectionSummary();
    });

    $('btn-publish-share')?.addEventListener('click', handlePublish);
    $('btn-copy-share-url')?.addEventListener('click', () => {
      const url = $('share-result-url')?.value;
      if (url) copyUrlWithToast(url);
    });
    $('btn-share-export-json')?.addEventListener('click', handleExportSelectedShareJson);

    // Search modal
    $('btn-open-search')?.addEventListener('click', openSearchModal);
    $('btn-search-close')?.addEventListener('click', closeSearchModal);
    $('search-modal')?.addEventListener('click', (e) => {
      if (e.target === $('search-modal')) closeSearchModal();
    });

    $('btn-public-search-go')?.addEventListener('click', () => {
      runPublicSearch($('public-search-input')?.value || '');
    });

    $('public-search-input')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        runPublicSearch(e.target.value);
      }
    });

    $('public-search-input')?.addEventListener('input', (e) => {
      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(() => runPublicSearch(e.target.value), 420);
    });

    // Import preview modal
    $('btn-import-share-close')?.addEventListener('click', closeImportShareModal);
    $('btn-cancel-import-share')?.addEventListener('click', closeImportShareModal);
    $('import-share-modal')?.addEventListener('click', (e) => {
      if (e.target === $('import-share-modal')) closeImportShareModal();
    });
    $('btn-confirm-import-share')?.addEventListener('click', confirmIncomingImport);
  }

  return {
    openShareModal,
    closeShareModal,
    openSearchModal,
    closeSearchModal,
    openIncomingShare,
    closeImportShareModal,
    bindEvents
  };
}
