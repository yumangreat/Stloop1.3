(function () {
  const STORAGE_KEY = 'studyloop_v5_data';
  const LEGACY_KEYS = ['studyloop_pro_data', 'studyloop_v4_data', 'studyloop_v3_data', 'studyloop_data'];
  const undoStack = [];

  function uid(prefix = 'id') {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  }

  function createDefaultData() {
    const deckId = uid('deck');
    return {
      activeDeckId: deckId,
      examDate: '',
      theme: 'light',
      decks: [
        {
          id: deckId,
          title: 'サンプル（数式・赤シート確認）',
          cards: [
            {
              id: uid('c'),
              category: '数学',
              front: '二次方程式 $ax^2 + bx + c = 0$ ($a \\neq 0$) の解の公式',
              back: '【$$x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}$$】',
              hint: '判別式 $D = b^2 - 4ac$ をルートの中に入れます。',
              image: '',
              correctCount: 0,
              wrongCount: 0,
              pinned: false,
              srsLevel: 0,
              nextReview: 0
            },
            {
              id: uid('c'),
              category: '物理',
              front: '真空中のクーロンの法則の比例定数 $k$ を含む静電気力 $F$ の式',
              back: '【$$F = k\\frac{|q_1 q_2|}{r^2}$$】',
              hint: '距離 $r$ の2乗に反比例します。',
              image: '',
              correctCount: 0,
              wrongCount: 0,
              pinned: false,
              srsLevel: 0,
              nextReview: 0
            },
            {
              id: uid('c'),
              category: '化学',
              front: '理想気体の状態方程式',
              back: '【$$PV = nRT$$】',
              hint: '圧力 $P$、体積 $V$、物質量 $n$、気体定数 $R$、絶対温度 $T$',
              image: '',
              correctCount: 0,
              wrongCount: 0,
              pinned: false,
              srsLevel: 0,
              nextReview: 0
            }
          ]
        }
      ]
    };
  }

  function normalizeCard(raw) {
    return {
      id: raw.id || uid('c'),
      category: String(raw.category || '一般').trim(),
      front: String(raw.front || raw.q || '').trim(),
      back: String(raw.back || raw.a || '').trim(),
      hint: String(raw.hint || '').trim(),
      image: String(raw.image || ''),
      correctCount: Number(raw.correctCount || raw.correct || 0),
      wrongCount: Number(raw.wrongCount || raw.wrong || 0),
      pinned: Boolean(raw.pinned),
      srsLevel: Number(raw.srsLevel || 0),
      nextReview: Number(raw.nextReview || 0)
    };
  }

  function migrateLegacyData() {
    const candidateKeys = [...LEGACY_KEYS];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k !== STORAGE_KEY && k.toLowerCase().includes('studyloop') && !candidateKeys.includes(k)) {
        candidateKeys.push(k);
      }
    }
    for (const key of candidateKeys) {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.decks) && parsed.decks.length > 0) {
          const decks = parsed.decks.map((d) => ({
            id: d.id || uid('deck'),
            title: String(d.title || d.name || '引き継ぎデッキ'),
            cards: Array.isArray(d.cards) ? d.cards.map(normalizeCard).filter((c) => c.front && c.back) : []
          }));
          return {
            activeDeckId: parsed.activeDeckId && decks.some((d) => d.id === parsed.activeDeckId)
              ? parsed.activeDeckId
              : decks[0].id,
            examDate: parsed.examDate || '',
            theme: parsed.theme || 'light',
            decks
          };
        }
      } catch (e) {
        console.warn('Migration skip:', key, e);
      }
    }
    return null;
  }

  function loadData() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.decks) && parsed.decks.length > 0) {
          parsed.decks.forEach((d) => {
            d.cards = Array.isArray(d.cards) ? d.cards.map(normalizeCard) : [];
          });
          if (!parsed.decks.some((d) => d.id === parsed.activeDeckId)) {
            parsed.activeDeckId = parsed.decks[0].id;
          }
          return parsed;
        }
      }
    } catch (e) {
      console.error('Failed to read storage:', e);
    }
    const migrated = migrateLegacyData();
    if (migrated) {
      saveData(migrated);
      return migrated;
    }
    const fresh = createDefaultData();
    saveData(fresh);
    return fresh;
  }

  function saveData(data) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.error('Failed to save storage:', e);
      alert('保存容量の上限に達しました。画像サイズを減らすか不要な単語帳を削除してください。');
    }
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function formatCardHtml(rawText) {
    const escaped = escapeHtml(rawText || '');
    const withCloze = escaped.replace(/【([\s\S]*?)】/g, (_, inner) => {
      return `<span class="cloze-blank" tabindex="0"><span class="cloze-inner">${inner}</span></span>`;
    });
    return withCloze.replace(/\n/g, '<br>');
  }

  function renderContent(element, rawText) {
    if (!element) return;
    element.innerHTML = formatCardHtml(rawText);
    if (typeof window.renderMathInElement === 'function') {
      try {
        window.renderMathInElement(element, {
          delimiters: [
            { left: '$$', right: '$$', display: true },
            { left: '$', right: '$', display: false }
          ],
          throwOnError: false
        });
      } catch (e) {
        console.warn('KaTeX render warning:', e);
      }
    }
  }

  function extractClozeTargets(backText) {
    const matches = [];
    const regex = /【([\s\S]*?)】/g;
    let m;
    while ((m = regex.exec(backText || '')) !== null) {
      const val = m[1].trim();
      if (val) matches.push(val);
    }
    return matches.length > 0 ? matches : [String(backText || '').trim()];
  }

  function parseImportText(rawText) {
    const lines = String(rawText || '')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('```'));

    const cards = [];
    for (const line of lines) {
      const parts = line.split('|').map((p) => p.trim());
      if (parts.length < 2) continue;
      let category = '一般';
      let front = '';
      let back = '';
      let hint = '';

      if (parts.length === 2) {
        [front, back] = parts;
      } else {
        category = parts[0] || '一般';
        front = parts[1] || '';
        back = parts[2] || '';
        hint = parts.slice(3).join(' | ');
      }
      if (front && back) {
        cards.push(normalizeCard({ category, front, back, hint }));
      }
    }
    return cards;
  }

  /* ==================== CSV 解析・生成（単体デッキ＆全データ完全バックアップ対応） ==================== */
  function parseCsvRows(text) {
    const clean = String(text || '').replace(/^\uFEFF/, '');
    const rows = [];
    let row = [];
    let cell = '';
    let inQuotes = false;

    for (let i = 0; i < clean.length; i++) {
      const ch = clean[i];
      const next = clean[i + 1];

      if (inQuotes) {
        if (ch === '"' && next === '"') {
          cell += '"';
          i++;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          cell += ch;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
        } else if (ch === ',') {
          row.push(cell);
          cell = '';
        } else if (ch === '\r' && next === '\n') {
          row.push(cell);
          rows.push(row);
          row = [];
          cell = '';
          i++;
        } else if (ch === '\n' || ch === '\r') {
          row.push(cell);
          rows.push(row);
          row = [];
          cell = '';
        } else {
          cell += ch;
        }
      }
    }
    if (cell.length > 0 || row.length > 0) {
      row.push(cell);
      rows.push(row);
    }
    return rows.filter((r) => r.some((c) => c.trim() !== ''));
  }

  function escapeCsvCell(val) {
    const str = String(val ?? '');
    if (/[",\r\n]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }

  // 1. 単一デッキ用の標準4列CSV（カテゴリ, 問題, 答え, ヒント）
  function generateDeckCsvText(deck) {
    const header = ['カテゴリ', '問題(Q)', '答え(A)', 'ヒント'].map(escapeCsvCell).join(',');
    const lines = deck.cards.map((c) =>
      [c.category, c.front, c.back, c.hint].map(escapeCsvCell).join(',')
    );
    return '\uFEFF' + [header, ...lines].join('\r\n');
  }

  // 2. サンプルCSV生成
  function generateSampleCsvText() {
    const rows = [
      ['カテゴリ', '問題(Q)', '答え(A)', 'ヒント'],
      ['英文法', 'apple の意味は？', '【りんご】', '赤い果物'],
      ['日本史', '1192年に鎌倉幕府を開いた人物は？', '【源頼朝】', '平氏を滅ぼした'],
      ['数学', '二次方程式 $ax^2+bx+c=0$ の解の公式', '【$$x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}$$】', '判別式Dを使う']
    ];
    return '\uFEFF' + rows.map((r) => r.map(escapeCsvCell).join(',')).join('\r\n');
  }

  // 3. 全データ一括バックアップCSV（単語帳名＋学習成績まで完全保存）
  function generateFullBackupCsvText(appData) {
    const header = [
      '単語帳名', 'カテゴリ', '問題(Q)', '答え(A)', 'ヒント',
      '正解数', '誤答数', 'ピン留め', 'SRSレベル', '次回学習日時', '目標試験日'
    ].map(escapeCsvCell).join(',');

    const lines = [];
    appData.decks.forEach((deck) => {
      if (deck.cards.length === 0) {
        lines.push([
          deck.title, '一般', '', '', '',
          0, 0, 0, 0, 0, appData.examDate || ''
        ].map(escapeCsvCell).join(','));
      } else {
        deck.cards.forEach((c) => {
          lines.push([
            deck.title,
            c.category,
            c.front,
            c.back,
            c.hint,
            c.correctCount,
            c.wrongCount,
            c.pinned ? 1 : 0,
            c.srsLevel,
            c.nextReview,
            appData.examDate || ''
          ].map(escapeCsvCell).join(','));
        });
      }
    });

    return '\uFEFF' + [header, ...lines].join('\r\n');
  }

  // 4. CSV自動判別インポート（全バックアップCSV / 4列CSV / 2列CSV すべてに対応）
  function parseCsvAuto(csvText) {
    const rows = parseCsvRows(csvText);
    if (rows.length === 0) return { type: 'empty', cards: [], decks: [] };

    const firstRow = rows[0].map((c) => c.trim());
    const firstJoined = firstRow.join(',').toLowerCase();

    // 全データ一括バックアップCSVの判定（「単語帳名」または9列以上）
    if (firstRow[0] === '単語帳名' || firstRow.length >= 9) {
      const dataRows = firstRow[0] === '単語帳名' ? rows.slice(1) : rows;
      const deckMap = new Map();
      let restoredExamDate = '';

      for (const cols of dataRows) {
        const deckTitle = (cols[0] || '復元された単語帳').trim();
        if (!deckMap.has(deckTitle)) {
          deckMap.set(deckTitle, {
            id: uid('deck'),
            title: deckTitle,
            cards: []
          });
        }
        const front = (cols[2] || '').trim();
        const back = (cols[3] || '').trim();
        if (cols[10] && cols[10].trim()) {
          restoredExamDate = cols[10].trim();
        }
        if (front && back) {
          deckMap.get(deckTitle).cards.push(normalizeCard({
            category: cols[1] || '一般',
            front,
            back,
            hint: cols[4] || '',
            correctCount: Number(cols[5] || 0),
            wrongCount: Number(cols[6] || 0),
            pinned: cols[7] === '1' || String(cols[7]).toLowerCase() === 'true',
            srsLevel: Number(cols[8] || 0),
            nextReview: Number(cols[9] || 0)
          }));
        }
      }

      return {
        type: 'backup',
        decks: Array.from(deckMap.values()),
        examDate: restoredExamDate
      };
    }

    // 標準CSV（4列・3列・2列）
    const isHeader = ['カテゴリ', '問題', '表面', 'front', 'question', 'category'].some((kw) => firstJoined.includes(kw));
    const dataRows = isHeader ? rows.slice(1) : rows;
    const cards = [];

    for (const cols of dataRows) {
      if (cols.length < 2) continue;
      let category = '一般';
      let front = '';
      let back = '';
      let hint = '';

      if (cols.length === 2) {
        front = cols[0].trim();
        back = cols[1].trim();
      } else {
        category = cols[0].trim() || '一般';
        front = cols[1].trim();
        back = cols[2].trim();
        hint = (cols[3] || '').trim();
      }
      if (front && back) {
        cards.push(normalizeCard({ category, front, back, hint }));
      }
    }

    return { type: 'cards', cards };
  }

  /* ==================== Undo 管理 ==================== */
  function pushUndo(snapshot) {
    undoStack.push(snapshot);
    if (undoStack.length > 30) undoStack.shift();
  }

  function popUndo() {
    return undoStack.length > 0 ? undoStack.pop() : null;
  }

  function clearUndo() {
    undoStack.length = 0;
  }

  window.StudyStorage = {
    uid,
    loadData,
    saveData,
    normalizeCard,
    formatCardHtml,
    renderContent,
    extractClozeTargets,
    parseImportText,
    generateDeckCsvText,
    generateSampleCsvText,
    generateFullBackupCsvText,
    parseCsvAuto,
    pushUndo,
    popUndo,
    clearUndo
  };
})();
