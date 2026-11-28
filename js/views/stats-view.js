import { renderContent, escapeHtml } from '../math-renderer.js';
import { getStudyStreak, getTodayStudyCount } from '../store.js';

const PAGE_SIZE = 50;

const state = {
  filter: 'all',
  sort: 'wrong_desc',
  category: 'ALL',
  visibleCount: PAGE_SIZE
};

function getCardStatus(card) {
  const c = Number(card.correctCount || 0);
  const w = Number(card.wrongCount || 0);
  if (c === 0 && w === 0) return 'unstudied';
  if (c > 0 && c >= w) return 'mastered';
  return 'weak';
}

function getCardAccuracy(card) {
  const c = Number(card.correctCount || 0);
  const w = Number(card.wrongCount || 0);
  const total = c + w;
  if (total === 0) return null;
  return Math.round((c / total) * 100);
}

function formatNextReview(ts) {
  if (!ts) return '未学習';
  const diffDays = Math.ceil((ts - Date.now()) / 86400000);
  if (diffDays <= 0) return '今日復習';
  return `${diffDays}日後`;
}

export function renderStatsTab(appData, deck, onSave) {
  const container = document.getElementById('stats-container');
  const catBox = document.getElementById('category-stats-container');
  if (!container || !deck) return;

  const cards = deck.cards || [];
  const now = Date.now();
  const total = cards.length;
  const mastered = cards.filter((c) => c.correctCount > 0 && c.correctCount >= c.wrongCount).length;
  const weak = cards.filter((c) => c.wrongCount > c.correctCount || c.pinned).length;
  const dueSrs = cards.filter((c) => !c.nextReview || c.nextReview <= now).length;
  const totalCorrect = cards.reduce((sum, c) => sum + c.correctCount, 0);
  const totalWrong = cards.reduce((sum, c) => sum + c.wrongCount, 0);
  const acc = totalCorrect + totalWrong > 0
    ? Math.round((totalCorrect / (totalCorrect + totalWrong)) * 100)
    : 0;
  const streak = getStudyStreak(appData);
  const todayCount = getTodayStudyCount(appData);

  container.innerHTML = `
    <div class="stat-box"><div class="stat-val">${total}</div><div class="stat-lbl">総問題数</div></div>
    <div class="stat-box"><div class="stat-val" style="color:var(--cta);">${mastered}</div><div class="stat-lbl">定着済み</div></div>
    <div class="stat-box"><div class="stat-val" style="color:var(--wrong);">${weak}</div><div class="stat-lbl">苦手・★</div></div>
    <div class="stat-box"><div class="stat-val">${acc}%</div><div class="stat-lbl">通算正答率</div></div>
    <div class="stat-box"><div class="stat-val" style="color:var(--amber);">${dueSrs}</div><div class="stat-lbl">今日の復習対象</div></div>
    <div class="stat-box"><div class="stat-val">${streak}日</div><div class="stat-lbl">連続学習（今日 ${todayCount}問）</div></div>
  `;

  if (catBox) {
    const cats = Array.from(new Set(cards.map((c) => c.category || '一般')));
    if (cats.length === 0) {
      catBox.classList.add('hidden');
    } else {
      catBox.classList.remove('hidden');
      catBox.innerHTML = '<div class="group-heading">単元別</div>';
      cats.forEach((cat) => {
        const items = cards.filter((c) => (c.category || '一般') === cat);
        const m = items.filter((c) => c.correctCount > 0 && c.correctCount >= c.wrongCount).length;
        const pct = items.length > 0 ? Math.round((m / items.length) * 100) : 0;
        const row = document.createElement('div');
        row.className = 'cat-stat-row';
        row.innerHTML = `
          <div class="cat-stat-head">
            <span>${escapeHtml(cat)}</span>
            <span>${m} / ${items.length} (${pct}%)</span>
          </div>
          <div class="progress-slim">
            <div class="progress-slim-fill" style="width: ${pct}%;"></div>
          </div>
        `;
        catBox.appendChild(row);
      });
    }
  }

  renderStatsDetail(appData, deck, onSave);
}

function renderStatsDetail(appData, deck, onSave) {
  const root = document.getElementById('stats-detail-container');
  if (!root || !deck) return;

  const cards = deck.cards || [];
  const cats = Array.from(new Set(cards.map((c) => c.category || '一般')));
  if (state.category !== 'ALL' && !cats.includes(state.category)) {
    state.category = 'ALL';
  }

  const baseCards = state.category === 'ALL'
    ? cards
    : cards.filter((c) => (c.category || '一般') === state.category);

  const counts = {
    all: baseCards.length,
    mastered: baseCards.filter((c) => getCardStatus(c) === 'mastered').length,
    weak: baseCards.filter((c) => getCardStatus(c) === 'weak').length,
    unstudied: baseCards.filter((c) => getCardStatus(c) === 'unstudied').length,
    pinned: baseCards.filter((c) => Boolean(c.pinned)).length
  };

  let filtered = baseCards.map((card, idx) => ({ card, idx }));
  if (state.filter === 'mastered') filtered = filtered.filter(({ card }) => getCardStatus(card) === 'mastered');
  else if (state.filter === 'weak') filtered = filtered.filter(({ card }) => getCardStatus(card) === 'weak');
  else if (state.filter === 'unstudied') filtered = filtered.filter(({ card }) => getCardStatus(card) === 'unstudied');
  else if (state.filter === 'pinned') filtered = filtered.filter(({ card }) => Boolean(card.pinned));

  filtered.sort((a, b) => {
    const ca = Number(a.card.correctCount || 0);
    const wa = Number(a.card.wrongCount || 0);
    const cb = Number(b.card.correctCount || 0);
    const wb = Number(b.card.wrongCount || 0);

    if (state.sort === 'wrong_desc') {
      if (wb !== wa) return wb - wa;
      const diffA = wa - ca;
      const diffB = wb - cb;
      if (diffB !== diffA) return diffB - diffA;
      return a.idx - b.idx;
    }
    if (state.sort === 'acc_asc') {
      const accA = getCardAccuracy(a.card);
      const accB = getCardAccuracy(b.card);
      if (accA === null && accB === null) return a.idx - b.idx;
      if (accA === null) return 1;
      if (accB === null) return -1;
      if (accA !== accB) return accA - accB;
      return wb - wa;
    }
    if (state.sort === 'correct_desc') {
      if (cb !== ca) return cb - ca;
      return wa - wb;
    }
    return a.idx - b.idx;
  });

  root.innerHTML = '';

  const heading = document.createElement('div');
  heading.className = 'group-heading';
  heading.textContent = '問題別';
  root.appendChild(heading);

  const chipDefs = [
    { key: 'all', label: `すべて (${counts.all})` },
    { key: 'mastered', label: `定着 (${counts.mastered})` },
    { key: 'weak', label: `苦手 (${counts.weak})` },
    { key: 'unstudied', label: `未学習 (${counts.unstudied})` },
    { key: 'pinned', label: `★ (${counts.pinned})` }
  ];

  const chipBar = document.createElement('div');
  chipBar.className = 'stats-filter-chips';
  chipDefs.forEach((def) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'stats-chip' + (state.filter === def.key ? ' active' : '');
    btn.dataset.filter = def.key;
    btn.textContent = def.label;
    btn.addEventListener('click', () => {
      state.filter = def.key;
      state.visibleCount = PAGE_SIZE;
      renderStatsDetail(appData, deck, onSave);
    });
    chipBar.appendChild(btn);
  });
  root.appendChild(chipBar);

  const controlsBar = document.createElement('div');
  controlsBar.className = 'stats-controls-bar';

  const selectGroup = document.createElement('div');
  selectGroup.className = 'stats-select-group';

  const sortSel = document.createElement('select');
  sortSel.className = 'stats-mini-select';
  sortSel.setAttribute('aria-label', '並び替え');
  [
    { value: 'wrong_desc', label: 'ミスが多い順' },
    { value: 'acc_asc', label: '正答率が低い順' },
    { value: 'correct_desc', label: '正解数が多い順' },
    { value: 'default', label: '登録順' }
  ].forEach((optDef) => {
    const opt = document.createElement('option');
    opt.value = optDef.value;
    opt.textContent = optDef.label;
    if (state.sort === optDef.value) opt.selected = true;
    sortSel.appendChild(opt);
  });
  sortSel.addEventListener('change', (e) => {
    state.sort = e.target.value;
    state.visibleCount = PAGE_SIZE;
    renderStatsDetail(appData, deck, onSave);
  });
  selectGroup.appendChild(sortSel);

  if (cats.length > 1) {
    const catSel = document.createElement('select');
    catSel.className = 'stats-mini-select';
    catSel.setAttribute('aria-label', '単元絞り込み');
    const allOpt = document.createElement('option');
    allOpt.value = 'ALL';
    allOpt.textContent = '全単元';
    catSel.appendChild(allOpt);
    cats.forEach((cat) => {
      const opt = document.createElement('option');
      opt.value = cat;
      opt.textContent = cat;
      if (state.category === cat) opt.selected = true;
      catSel.appendChild(opt);
    });
    catSel.addEventListener('change', (e) => {
      state.category = e.target.value;
      state.visibleCount = PAGE_SIZE;
      renderStatsDetail(appData, deck, onSave);
    });
    selectGroup.appendChild(catSel);
  }

  const countLabel = document.createElement('span');
  countLabel.className = 'stats-result-count';
  countLabel.textContent = `${filtered.length}問`;

  controlsBar.appendChild(selectGroup);
  controlsBar.appendChild(countLabel);
  root.appendChild(controlsBar);

  const list = document.createElement('div');
  list.className = 'stats-card-list';

  if (filtered.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'stats-empty-msg';
    empty.textContent = '該当する問題がありません';
    list.appendChild(empty);
  } else {
    const slice = filtered.slice(0, state.visibleCount);
    slice.forEach(({ card }) => {
      const status = getCardStatus(card);
      const acc = getCardAccuracy(card);
      const cCount = Number(card.correctCount || 0);
      const wCount = Number(card.wrongCount || 0);

      const item = document.createElement('div');
      item.className = 'stats-card-item';

      const top = document.createElement('div');
      top.className = 'stats-card-top';

      const tags = document.createElement('div');
      tags.className = 'stats-card-tags';

      const statusBadge = document.createElement('span');
      statusBadge.className = `stats-status-badge ${status}`;
      statusBadge.textContent = status === 'mastered' ? '定着' : (status === 'weak' ? '苦手' : '未学習');

      const catPill = document.createElement('span');
      catPill.className = 'stats-cat-pill';
      catPill.textContent = card.category || '一般';

      tags.appendChild(statusBadge);
      tags.appendChild(catPill);

      const pinBtn = document.createElement('button');
      pinBtn.type = 'button';
      pinBtn.className = 'stats-pin-toggle' + (card.pinned ? ' pinned' : '');
      pinBtn.textContent = card.pinned ? '★' : '☆';
      pinBtn.title = 'ピン留め切替';
      pinBtn.addEventListener('click', () => {
        card.pinned = !card.pinned;
        if (typeof onSave === 'function') onSave();
        renderStatsTab(appData, deck, onSave);
      });

      top.appendChild(tags);
      top.appendChild(pinBtn);

      const qa = document.createElement('div');
      qa.className = 'stats-card-qa';

      const qDiv = document.createElement('div');
      qDiv.className = 'stats-card-q';
      const aDiv = document.createElement('div');
      aDiv.className = 'stats-card-a';
      renderContent(qDiv, card.front);
      renderContent(aDiv, card.back);
      qa.appendChild(qDiv);
      qa.appendChild(aDiv);

      const metrics = document.createElement('div');
      metrics.className = 'stats-card-metrics';

      const wrongPill = document.createElement('span');
      wrongPill.className = 'metric-pill wrong' + (wCount > 0 ? ' has-val' : '');
      wrongPill.textContent = `× ${wCount}`;

      const correctPill = document.createElement('span');
      correctPill.className = 'metric-pill correct' + (cCount > 0 ? ' has-val' : '');
      correctPill.textContent = `◯ ${cCount}`;

      const accPill = document.createElement('span');
      accPill.className = 'metric-pill';
      accPill.textContent = acc !== null ? `${acc}%` : '未挑戦';

      const srsPill = document.createElement('span');
      srsPill.className = 'metric-pill';
      srsPill.textContent = `次回: ${formatNextReview(card.nextReview)}`;

      metrics.appendChild(wrongPill);
      metrics.appendChild(correctPill);
      metrics.appendChild(accPill);
      metrics.appendChild(srsPill);

      item.appendChild(top);
      item.appendChild(qa);
      item.appendChild(metrics);
      list.appendChild(item);
    });
  }

  root.appendChild(list);

  if (filtered.length > state.visibleCount) {
    const moreBtn = document.createElement('button');
    moreBtn.type = 'button';
    moreBtn.className = 'outline-full-btn';
    moreBtn.textContent = `さらに表示（残り ${filtered.length - state.visibleCount}問）`;
    moreBtn.addEventListener('click', () => {
      state.visibleCount += PAGE_SIZE;
      renderStatsDetail(appData, deck, onSave);
    });
    root.appendChild(moreBtn);
  }
}
