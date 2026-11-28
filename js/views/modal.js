const $ = (id) => document.getElementById(id);

let activeDialogResolve = null;

export function showToast(message, options = {}) {
  const container = $('toast-container');
  if (!container) return;
  const { actionLabel = '', onAction = null, duration = 2600 } = options;

  const item = document.createElement('div');
  item.className = 'toast-item';
  const textSpan = document.createElement('span');
  textSpan.textContent = message;
  item.appendChild(textSpan);

  if (actionLabel && typeof onAction === 'function') {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'toast-action';
    btn.textContent = actionLabel;
    btn.addEventListener('click', () => {
      onAction();
      item.remove();
    });
    item.appendChild(btn);
  }

  container.appendChild(item);
  setTimeout(() => {
    item.remove();
  }, duration);
}

function closeAppDialog(result) {
  const modal = $('app-dialog-modal');
  if (modal) modal.classList.add('hidden');
  if (typeof activeDialogResolve === 'function') {
    const fn = activeDialogResolve;
    activeDialogResolve = null;
    fn(result);
  }
}

export function showAlert(title, message = '') {
  return new Promise((resolve) => {
    const modal = $('app-dialog-modal');
    if (!modal) { resolve(); return; }
    activeDialogResolve = resolve;

    $('dialog-title').textContent = title;
    const msgEl = $('dialog-message');
    msgEl.textContent = message;
    msgEl.classList.toggle('hidden', !message);
    $('dialog-input').classList.add('hidden');

    const actions = $('dialog-actions');
    actions.className = 'dialog-actions';
    actions.innerHTML = '';

    const okBtn = document.createElement('button');
    okBtn.type = 'button';
    okBtn.className = 'solid-action-btn primary';
    okBtn.textContent = 'OK';
    okBtn.addEventListener('click', () => closeAppDialog(true));
    actions.appendChild(okBtn);

    modal.classList.remove('hidden');
    okBtn.focus();
  });
}

export function showConfirm(title, message = '', options = {}) {
  const { confirmLabel = 'OK', cancelLabel = 'キャンセル', danger = false } = options;
  return new Promise((resolve) => {
    const modal = $('app-dialog-modal');
    if (!modal) { resolve(false); return; }
    activeDialogResolve = resolve;

    $('dialog-title').textContent = title;
    const msgEl = $('dialog-message');
    msgEl.textContent = message;
    msgEl.classList.toggle('hidden', !message);
    $('dialog-input').classList.add('hidden');

    const actions = $('dialog-actions');
    actions.className = 'dialog-actions row';
    actions.innerHTML = '';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'solid-action-btn';
    cancelBtn.textContent = cancelLabel;
    cancelBtn.addEventListener('click', () => closeAppDialog(false));

    const okBtn = document.createElement('button');
    okBtn.type = 'button';
    okBtn.className = `solid-action-btn ${danger ? 'danger' : 'primary'}`;
    okBtn.textContent = confirmLabel;
    okBtn.addEventListener('click', () => closeAppDialog(true));

    actions.appendChild(cancelBtn);
    actions.appendChild(okBtn);
    modal.classList.remove('hidden');
    okBtn.focus();
  });
}

export function showPrompt(title, defaultValue = '', options = {}) {
  const { placeholder = '', confirmLabel = '決定' } = options;
  return new Promise((resolve) => {
    const modal = $('app-dialog-modal');
    if (!modal) { resolve(null); return; }
    activeDialogResolve = resolve;

    $('dialog-title').textContent = title;
    $('dialog-message').classList.add('hidden');

    const input = $('dialog-input');
    input.classList.remove('hidden');
    input.value = defaultValue;
    input.placeholder = placeholder;

    const actions = $('dialog-actions');
    actions.className = 'dialog-actions row';
    actions.innerHTML = '';

    const submit = () => closeAppDialog(input.value);

    input.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submit();
      }
    };

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'solid-action-btn';
    cancelBtn.textContent = 'キャンセル';
    cancelBtn.addEventListener('click', () => closeAppDialog(null));

    const okBtn = document.createElement('button');
    okBtn.type = 'button';
    okBtn.className = 'solid-action-btn primary';
    okBtn.textContent = confirmLabel;
    okBtn.addEventListener('click', submit);

    actions.appendChild(cancelBtn);
    actions.appendChild(okBtn);
    modal.classList.remove('hidden');
    setTimeout(() => {
      input.focus();
      input.select();
    }, 30);
  });
}

export function showChoiceDialog(title, message, choices) {
  return new Promise((resolve) => {
    const modal = $('app-dialog-modal');
    if (!modal) { resolve(null); return; }
    activeDialogResolve = resolve;

    $('dialog-title').textContent = title;
    const msgEl = $('dialog-message');
    msgEl.textContent = message || '';
    msgEl.classList.toggle('hidden', !message);
    $('dialog-input').classList.add('hidden');

    const actions = $('dialog-actions');
    actions.className = 'dialog-actions';
    actions.innerHTML = '';

    choices.forEach((choice) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `solid-action-btn ${choice.variant || ''}`.trim();
      btn.textContent = choice.label;
      btn.addEventListener('click', () => closeAppDialog(choice.value));
      actions.appendChild(btn);
    });

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'text-subtle-btn';
    cancelBtn.textContent = 'キャンセル';
    cancelBtn.addEventListener('click', () => closeAppDialog(null));
    actions.appendChild(cancelBtn);

    modal.classList.remove('hidden');
  });
}

export function openLightbox(src) {
  const box = $('image-lightbox');
  const img = $('lightbox-img');
  if (!box || !img || !src) return;
  img.src = src;
  box.classList.remove('hidden');
}

export function closeLightbox() {
  const box = $('image-lightbox');
  if (box) box.classList.add('hidden');
}

export function openShortcutsModal() {
  $('shortcuts-modal')?.classList.remove('hidden');
}

export function closeShortcutsModal() {
  $('shortcuts-modal')?.classList.add('hidden');
}

export function isAnyModalOpen() {
  const ids = ['app-dialog-modal', 'edit-modal', 'folder-move-modal', 'image-lightbox', 'shortcuts-modal'];
  return ids.some((id) => {
    const el = $(id);
    return el && !el.classList.contains('hidden');
  });
}

export function initModalListeners(onExtraEscape) {
  $('app-dialog-modal')?.addEventListener('click', (e) => {
    if (e.target === $('app-dialog-modal')) closeAppDialog(null);
  });

  $('image-lightbox')?.addEventListener('click', closeLightbox);

  $('btn-shortcuts-close')?.addEventListener('click', closeShortcutsModal);
  $('shortcuts-modal')?.addEventListener('click', (e) => {
    if (e.target === $('shortcuts-modal')) closeShortcutsModal();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$('image-lightbox')?.classList.contains('hidden')) {
      closeLightbox();
      return;
    }
    if (!$('app-dialog-modal')?.classList.contains('hidden')) {
      closeAppDialog(null);
      return;
    }
    if (!$('shortcuts-modal')?.classList.contains('hidden')) {
      closeShortcutsModal();
      return;
    }
    if (typeof onExtraEscape === 'function') onExtraEscape();
  });
}
