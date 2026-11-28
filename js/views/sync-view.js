import {
  loadSyncMeta,
  saveSyncMeta,
  getCurrentUser,
  watchAuthState,
  consumeRedirectSignIn,
  signInWithGoogle,
  signOutGoogle,
  fetchCloudSnapshot,
  pushCloudSnapshot
} from '../firebase-sync.js';
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
  let activeUser = null;
  let handledInitialUid = '';

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
    if (!activeUser) {
      dot.classList.add('hidden');
      return;
    }
    const meta = loadSyncMeta(activeUser.uid);
    dot.classList.remove('hidden', 'pending', 'error');
    if (syncState === 'error') {
      dot.classList.add('error');
    } else if (syncState === 'pending' || !meta.lastSyncedAt) {
      dot.classList.add('pending');
    }
  }

  function renderModalState() {
    const connected = Boolean(activeUser);
    $('sync-setup-section')?.classList.toggle('hidden', connected);
    $('sync-connected-section')?.classList.toggle('hidden', !connected);

    if (connected) {
      const meta = loadSyncMeta(activeUser.uid);
      const nameLabel = activeUser.displayName || activeUser.email || 'Googleアカウント';
      $('sync-account-label').textContent = nameLabel;
      const emailEl = $('sync-account-email');
      if (emailEl) {
        emailEl.textContent = activeUser.email && activeUser.email !== nameLabel ? activeUser.email : '';
        emailEl.classList.toggle('hidden', !emailEl.textContent);
      }
      $('sync-last-time').textContent = `最終同期: ${formatSyncTime(meta.lastSyncedAt)}`;
      const autoEl = $('opt-auto-sync');
      if (autoEl) autoEl.checked = meta.autoSync !== false;
      setSyncButtonsBusy(syncInProgress);
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

  async function runSmartSync({ silent = false, forceDirection = null, isFirstLogin = false } = {}) {
    const user = activeUser || getCurrentUser();
    if (!user || syncInProgress) return;
    syncInProgress = true;
    setSyncButtonsBusy(true);

    try {
      const uid = user.uid;
      const meta = loadSyncMeta(uid);

      if (forceDirection === 'push') {
        const pushed = await pushCloudSnapshot(uid, ctx.appData);
        saveSyncMeta({ uid, lastSyncedAt: pushed.updatedAt });
        syncState = 'synced';
        renderModalState();
        if (!silent) showToast('クラウドへ保存しました');
        return;
      }

      const cloud = await fetchCloudSnapshot(uid);

      if (forceDirection === 'pull') {
        if (!cloud) {
          if (!silent) showToast('クラウドにデータがありません');
          return;
        }
        applyCloudToLocal(cloud);
        saveSyncMeta({ uid, lastSyncedAt: cloud.updatedAt });
        syncState = 'synced';
        renderModalState();
        if (!silent) showToast('クラウドから最新データを取り込みました');
        return;
      }

      if (!cloud) {
        const pushed = await pushCloudSnapshot(uid, ctx.appData);
        saveSyncMeta({ uid, lastSyncedAt: pushed.updatedAt });
        syncState = 'synced';
        renderModalState();
        if (!silent) showToast('Googleアカウントへの同期を開始しました');
        return;
      }

      // First login on this device when cloud already has data: let user choose
      if (isFirstLogin && !meta.lastSyncedAt) {
        const choice = await showChoiceDialog(
          'クラウドデータが見つかりました',
          `クラウド（${formatSyncTime(cloud.updatedAt)}）に既存の単語帳データがあります。どちらを使いますか？`,
          [
            { label: 'クラウドのデータを取り込む（推奨）', value: 'pull', variant: 'primary' },
            { label: 'この端末のデータで上書きする', value: 'push', variant: 'danger' }
          ]
        );
        if (choice === 'pull') {
          applyCloudToLocal(cloud);
          saveSyncMeta({ uid, lastSyncedAt: cloud.updatedAt });
          syncState = 'synced';
          renderModalState();
          showToast('クラウドから最新データを取り込みました');
        } else if (choice === 'push') {
          const pushed = await pushCloudSnapshot(uid, ctx.appData);
          saveSyncMeta({ uid, lastSyncedAt: pushed.updatedAt });
          syncState = 'synced';
          renderModalState();
          showToast('この端末のデータで上書きしました');
        } else {
          syncState = 'pending';
          renderModalState();
        }
        return;
      }

      const localUpdated = Number(ctx.appData.updatedAt || 0);
      const cloudUpdated = Number(cloud.updatedAt || 0);
      const lastSynced = Number(meta.lastSyncedAt || 0);

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
        saveSyncMeta({ uid, lastSyncedAt: cloudUpdated });
        syncState = 'synced';
        renderModalState();
        showToast('クラウドから最新データを同期しました');
        return;
      }

      if (localChanged && !cloudChanged) {
        const pushed = await pushCloudSnapshot(uid, ctx.appData);
        saveSyncMeta({ uid, lastSyncedAt: pushed.updatedAt });
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
        saveSyncMeta({ uid, lastSyncedAt: cloudUpdated });
        syncState = 'synced';
        renderModalState();
        showToast('クラウドのデータを取り込みました');
      } else if (choice === 'push') {
        const pushed = await pushCloudSnapshot(uid, ctx.appData);
        saveSyncMeta({ uid, lastSyncedAt: pushed.updatedAt });
        syncState = 'synced';
        renderModalState();
        showToast('この端末のデータで上書きしました');
      } else {
        syncState = 'pending';
        updateHeaderDot();
      }
    } catch (err) {
      console.warn('Firebase sync error:', err);
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
    if (!activeUser) return;
    const meta = loadSyncMeta(activeUser.uid);
    if (meta.autoSync === false) return;
    syncState = 'pending';
    updateHeaderDot();
    clearTimeout(autoSyncTimer);
    autoSyncTimer = setTimeout(() => {
      if (navigator.onLine) runSmartSync({ silent: true });
    }, 3000);
  }

  function autoCheckOnStartup() {
    // Handle redirect sign-in result if popup fell back to redirect
    consumeRedirectSignIn().then((res) => {
      if (res && res.user) {
        activeUser = res.user;
        handledInitialUid = res.user.uid;
        renderModalState();
        runSmartSync({ silent: false, isFirstLogin: true });
      }
    }).catch((err) => {
      showAlert('ログインエラー', err.message || 'Googleログインに失敗しました');
    });

    watchAuthState((user) => {
      activeUser = user || null;
      if (!activeUser) {
        handledInitialUid = '';
        syncState = 'idle';
        renderModalState();
        return;
      }

      renderModalState();
      const meta = loadSyncMeta(activeUser.uid);
      if (handledInitialUid !== activeUser.uid) {
        handledInitialUid = activeUser.uid;
        if (meta.autoSync !== false && navigator.onLine) {
          runSmartSync({ silent: Boolean(meta.lastSyncedAt), isFirstLogin: !meta.lastSyncedAt });
        }
      }
    });
  }

  async function handleGoogleLogin() {
    const btn = $('btn-sync-google');
    if (btn) {
      btn.disabled = true;
      btn.dataset.origText = btn.textContent;
      btn.textContent = 'ログイン中...';
    }

    try {
      const { user, redirected } = await signInWithGoogle();
      if (redirected) return;
      if (user) {
        activeUser = user;
        handledInitialUid = user.uid;
        renderModalState();
        await runSmartSync({ silent: false, isFirstLogin: true });
      }
    } catch (err) {
      await showAlert('ログインエラー', err.message || 'Googleログインに失敗しました');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = `<svg class="google-g-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z"/><path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24z"/><path fill="#FBBC05" d="M5.27 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.98-3.09z"/><path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09c.95-2.85 3.6-4.96 6.73-4.96z"/></svg><span>Google でログイン</span>`;
      }
      renderModalState();
    }
  }

  function bindEvents() {
    $('btn-open-sync')?.addEventListener('click', openSyncModal);
    $('btn-sync-close')?.addEventListener('click', closeSyncModal);
    $('sync-modal')?.addEventListener('click', (e) => {
      if (e.target === $('sync-modal')) closeSyncModal();
    });

    $('btn-sync-google')?.addEventListener('click', handleGoogleLogin);
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
      saveSyncMeta({ autoSync: e.target.checked, uid: activeUser?.uid || '' });
      ctx.haptic(8);
    });

    $('btn-sync-disconnect')?.addEventListener('click', async () => {
      if (syncInProgress) return;
      const ok = await showConfirm('ログアウトしますか？', 'この端末のデータやクラウドのデータ自体は消えません。', {
        confirmLabel: 'ログアウト',
        danger: true
      });
      if (!ok) return;
      clearTimeout(autoSyncTimer);
      try {
        await signOutGoogle();
        activeUser = null;
        handledInitialUid = '';
        syncState = 'idle';
        renderModalState();
        showToast('ログアウトしました');
      } catch (err) {
        await showAlert('ログアウトエラー', err.message || 'ログアウトに失敗しました');
      }
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
