import {
  loadSyncConfig,
  saveSyncConfig,
  clearSyncConfig,
  verifyTokenAndFindGist,
  fetchCloudSnapshot,
  pushCloudSnapshot
} from '../gist-sync.js';
import { replaceAppDataInPlace } from '../store.js';
import { showAlert, showChoiceDialog, showConfirm, showToast } from './modal.js';

const $ = (id) => document.getElementById(id);

function formatSyncTime(ts) {
  if (!ts) return '未同期';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '未同期';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`;
}

export function createSyncView(ctx) {
  let syncInProgress = false;
  let autoSyncTimer = null;
  let syncState = 'idle'; // 'idle' | 'pending' | 'synced' | 'error'

  function setSyncButtonsBusy(busy) {
    const nowBtn = $('btn-sync-now');
    if (nowBtn) {
      nowBtn.disabled = busy;
      nowBtn.textContent = busy ? '同期中...' : '今すぐ同期';
    }
    ['btn-sync-pull', 'btn-sync-push', 'btn-sync-disconnect'].forEach((id) => {
      const el = $(id);
      if (el) el.disabled = busy;
    });
  }

  function updateHeaderDot() {
    const dot = $('sync-status-dot');
    if (!dot) return;
    const cfg = loadSyncConfig();
    if (!cfg.token) {
      dot.classList.add('hidden');
      return;
    }
    dot.classList.remove('hidden', 'pending', 'error');
    if (syncState === 'error') {
      dot.classList.add('error');
    } else if (syncState === 'pending' || !cfg.lastSyncedAt) {
      dot.classList.add('pending');
    }
  }

  function renderModalState() {
    const cfg = loadSyncConfig();
    const connected = Boolean(cfg.token);

    $('sync-setup-section')?.classList.toggle('hidden', connected);
    $('sync-connected-section')?.classList.toggle('hidden', !connected);

    if (connected) {
      $('sync-account-label').textContent = cfg.username ? `@${cfg.username}` : '接続済み';
      $('sync-last-time').textContent = `最終同期: ${formatSyncTime(cfg.lastSyncedAt)}`;
      const autoEl = $('opt-auto-sync');
      if (autoEl) autoEl.checked = cfg.autoSync !== false;
      setSyncButtonsBusy(syncInProgress);
    } else {
      const inp = $('sync-token-input');
      if (inp) inp.value = '';
    }
    updateHeaderDot();
  }

  function openSyncModal() {
    renderModalState();
    $('sync-modal')?.classList.remove('hidden');
  }

  function closeSyncModal() {
    $('sync-modal')?.classList.add('hidden');
  }

  function applyCloudToLocal(cloudSnapshot) {
    replaceAppDataInPlace(ctx.appData, cloudSnapshot.data, cloudSnapshot.updatedAt);
    Object.assign(ctx.settings, ctx.appData.preferences);
    ctx.saveRaw(true); // persist locally without bumping updatedAt or re-triggering auto-sync
    ctx.refreshAllViewsAfterSync();
  }

  async function runSmartSync({ silent = false, forceDirection = null } = {}) {
    const cfg = loadSyncConfig();
    if (!cfg.token || syncInProgress) return;
    syncInProgress = true;
    setSyncButtonsBusy(true);

    try {
      let gistId = cfg.gistId;
      if (!gistId) {
        const verified = await verifyTokenAndFindGist(cfg.token);
        gistId = verified.gistId;
        cfg.username = verified.username || cfg.username;
        cfg.gistId = gistId;
        saveSyncConfig(cfg);
      }

      if (forceDirection === 'push') {
        const pushed = await pushCloudSnapshot(cfg.token, gistId, ctx.appData);
        cfg.gistId = pushed.gistId;
        cfg.lastSyncedAt = pushed.updatedAt;
        saveSyncConfig(cfg);
        syncState = 'synced';
        renderModalState();
        if (!silent) showToast('クラウドへ保存しました');
        return;
      }

      const cloud = gistId ? await fetchCloudSnapshot(cfg.token, gistId) : null;

      if (forceDirection === 'pull') {
        if (!cloud) {
          if (!silent) showToast('クラウドにデータがありません');
          return;
        }
        applyCloudToLocal(cloud);
        cfg.lastSyncedAt = cloud.updatedAt;
        saveSyncConfig(cfg);
        syncState = 'synced';
        renderModalState();
        if (!silent) showToast('クラウドから最新データを取り込みました');
        return;
      }

      // Smart 3-way comparison with conflict protection
      const localUpdated = Number(ctx.appData.updatedAt || 0);
      const cloudUpdated = Number(cloud?.updatedAt || 0);
      const lastSynced = Number(cfg.lastSyncedAt || 0);

      if (!cloud) {
        const pushed = await pushCloudSnapshot(cfg.token, gistId, ctx.appData);
        cfg.gistId = pushed.gistId;
        cfg.lastSyncedAt = pushed.updatedAt;
        saveSyncConfig(cfg);
        syncState = 'synced';
        renderModalState();
        if (!silent) showToast('クラウド同期を開始しました');
        return;
      }

      const localChanged = localUpdated > lastSynced;
      const cloudChanged = cloudUpdated > lastSynced;

      if (!localChanged && !cloudChanged) {
        syncState = 'synced';
        renderModalState();
        if (!silent) showToast('すでに最新です');
        return;
      }

      if (cloudChanged && !localChanged) {
        applyCloudToLocal(cloud);
        cfg.lastSyncedAt = cloudUpdated;
        saveSyncConfig(cfg);
        syncState = 'synced';
        renderModalState();
        showToast('クラウドから最新データを同期しました');
        return;
      }

      if (localChanged && !cloudChanged) {
        const pushed = await pushCloudSnapshot(cfg.token, gistId, ctx.appData);
        cfg.gistId = pushed.gistId;
        cfg.lastSyncedAt = pushed.updatedAt;
        saveSyncConfig(cfg);
        syncState = 'synced';
        renderModalState();
        if (!silent) showToast('クラウドへ同期しました');
        return;
      }

      // Conflict: BOTH local and cloud changed since last sync
      const choice = await showChoiceDialog(
        '同期データの競合',
        `クラウド（${formatSyncTime(cloudUpdated)}）とこの端末（${formatSyncTime(localUpdated)}）の両方に変更があります。どちらを優先しますか？`,
        [
          { label: 'クラウドのデータを取り込む', value: 'pull', variant: 'primary' },
          { label: 'この端末のデータで上書き', value: 'push', variant: 'danger' }
        ]
      );

      if (choice === 'pull') {
        applyCloudToLocal(cloud);
        cfg.lastSyncedAt = cloudUpdated;
        saveSyncConfig(cfg);
        syncState = 'synced';
        renderModalState();
        showToast('クラウドのデータを取り込みました');
      } else if (choice === 'push') {
        const pushed = await pushCloudSnapshot(cfg.token, gistId, ctx.appData);
        cfg.gistId = pushed.gistId;
        cfg.lastSyncedAt = pushed.updatedAt;
        saveSyncConfig(cfg);
        syncState = 'synced';
        renderModalState();
        showToast('この端末のデータで上書きしました');
      } else {
        syncState = 'pending';
        updateHeaderDot();
      }
    } catch (err) {
      console.warn('Gist sync error:', err);
      syncState = 'error';
      updateHeaderDot();
      if (!silent) {
        await showAlert('同期エラー', err.message || '同期に失敗しました');
      }
    } finally {
      syncInProgress = false;
      setSyncButtonsBusy(false);
    }
  }

  function scheduleAutoSync() {
    const cfg = loadSyncConfig();
    if (!cfg.token || cfg.autoSync === false) return;
    syncState = 'pending';
    updateHeaderDot();
    clearTimeout(autoSyncTimer);
    autoSyncTimer = setTimeout(() => {
      if (navigator.onLine) runSmartSync({ silent: true });
    }, 3200);
  }

  function autoCheckOnStartup() {
    const cfg = loadSyncConfig();
    updateHeaderDot();
    if (!cfg.token || cfg.autoSync === false || !navigator.onLine) return;
    setTimeout(() => runSmartSync({ silent: true }), 700);
  }

  async function handleConnect() {
    const token = ($('sync-token-input')?.value || '').trim();
    if (!token) {
      showToast('GitHubトークンを入力してください');
      return;
    }

    const btn = $('btn-sync-connect');
    btn.disabled = true;
    btn.textContent = '接続中...';

    try {
      const info = await verifyTokenAndFindGist(token);
      saveSyncConfig({
        token,
        gistId: info.gistId,
        username: info.username,
        autoSync: true,
        lastSyncedAt: 0
      });
      syncState = 'pending';
      renderModalState();

      if (info.gistId) {
        const choice = await showChoiceDialog(
          `@${info.username} に接続しました`,
          'クラウド上に既存のStudyLoopデータが見つかりました。',
          [
            { label: 'クラウドのデータを取り込む（推奨）', value: 'pull', variant: 'primary' },
            { label: 'この端末のデータで上書きする', value: 'push', variant: 'danger' }
          ]
        );
        if (choice === 'pull') await runSmartSync({ silent: false, forceDirection: 'pull' });
        else if (choice === 'push') await runSmartSync({ silent: false, forceDirection: 'push' });
      } else {
        await runSmartSync({ silent: false, forceDirection: 'push' });
      }
    } catch (err) {
      await showAlert('接続エラー', err.message || 'トークンの確認に失敗しました');
    } finally {
      btn.disabled = false;
      btn.textContent = '接続して同期';
      renderModalState();
    }
  }

  function bindEvents() {
    $('btn-open-sync')?.addEventListener('click', openSyncModal);
    $('btn-sync-close')?.addEventListener('click', closeSyncModal);
    $('sync-modal')?.addEventListener('click', (e) => {
      if (e.target === $('sync-modal')) closeSyncModal();
    });

    $('btn-sync-connect')?.addEventListener('click', handleConnect);
    $('btn-sync-now')?.addEventListener('click', () => runSmartSync({ silent: false }));

    $('btn-sync-pull')?.addEventListener('click', async () => {
      if (syncInProgress) return;
      const ok = await showConfirm('クラウドから取り込む', 'この端末のデータがクラウドの最新データで置き換わります。', {
        confirmLabel: '取り込む',
        danger: true
      });
      if (ok) runSmartSync({ silent: false, forceDirection: 'pull' });
    });

    $('btn-sync-push')?.addEventListener('click', async () => {
      if (syncInProgress) return;
      const ok = await showConfirm('クラウドへ上書き保存', 'クラウド側のデータをこの端末の内容で上書きします。', {
        confirmLabel: '上書き保存',
        danger: true
      });
      if (ok) runSmartSync({ silent: false, forceDirection: 'push' });
    });

    $('opt-auto-sync')?.addEventListener('change', (e) => {
      const cfg = loadSyncConfig();
      cfg.autoSync = e.target.checked;
      saveSyncConfig(cfg);
      ctx.haptic(8);
    });

    $('btn-sync-disconnect')?.addEventListener('click', async () => {
      if (syncInProgress) return;
      const ok = await showConfirm('クラウド同期を解除しますか？', 'この端末のデータやGist自体は消えません。', {
        confirmLabel: '解除',
        danger: true
      });
      if (!ok) return;
      clearTimeout(autoSyncTimer);
      clearSyncConfig();
      syncState = 'idle';
      renderModalState();
      showToast('同期設定を解除しました');
    });

    updateHeaderDot();
  }

  return {
    openSyncModal,
    closeSyncModal,
    scheduleAutoSync,
    autoCheckOnStartup,
    bindEvents
  };
}
