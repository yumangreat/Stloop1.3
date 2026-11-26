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
              back: '【$$F = k\\frac{\vert{}q_1 q_2\vert{}}{r^2}$$】',
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
      alert('保存容量の上限に達しました。画像サイズを減らすか不要なデッキを削除してください。');
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

  /* ==================== CSV 読み込み・書き出し ==================== */
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

  function parseCsvText(csvText) {
    const rows = parseCsvRows(csvText);
    if (rows.length === 0) return [];

    // 1行目がヘッダー行ならスキップ
    const firstJoined = rows[0].join(',').toLowerCase();
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
    return cards;
  }

  function escapeCsvCell(val) {
    const str = String(val ?? '');
    if (/[",\r\n]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }

  function generateCsvText(deck) {
    const header = ['カテゴリ', '表面（問題）', '裏面（答え）', 'ヒント'].map(escapeCsvCell).join(',');
    const lines = deck.cards.map((c) =>
      [c.category, c.front, c.back, c.hint].map(escapeCsvCell).join(',')
    );
    // Excelで文字化けしないようUTF-8 BOMを先頭に付与
    return '\uFEFF' + [header, ...lines].join('\r\n');
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

  /* ==================== 圧縮URL エンコード・デコード ==================== */
  function bytesToBase64Url(bytes) {
    let bin = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function base64UrlToBytes(b64url) {
    let b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4 !== 0) b64 += '=';
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  async function compressStringToUrlToken(jsonStr) {
    const rawBytes = new TextEncoder().encode(jsonStr);
    if (typeof CompressionStream !== 'undefined') {
      try {
        const cs = new CompressionStream('deflate-raw');
        const writer = cs.writable.getWriter();
        writer.write(rawBytes);
        writer.close();
        const compressedBuf = await new Response(cs.readable).arrayBuffer();
        return 'z_' + bytesToBase64Url(new Uint8Array(compressedBuf));
      } catch (e) {
        console.warn('CompressionStream fallback:', e);
      }
    }
    return bytesToBase64Url(rawBytes);
  }

  async function decompressUrlTokenToString(token) {
    if (token.startsWith('z_') && typeof DecompressionStream !== 'undefined') {
      const compBytes = base64UrlToBytes(token.slice(2));
      const ds = new DecompressionStream('deflate-raw');
      const writer = ds.writable.getWriter();
      writer.write(compBytes);
      writer.close();
      const rawBuf = await new Response(ds.readable).arrayBuffer();
      return new TextDecoder().decode(rawBuf);
    }
    const rawBytes = base64UrlToBytes(token);
    return new TextDecoder().decode(rawBytes);
  }

  // 単一デッキ共有URL生成
  async function encodeSharePayload(deck) {
    const minimal = {
      t: deck.title,
      c: deck.cards.map((card) => [card.category, card.front, card.back, card.hint])
    };
    return await compressStringToUrlToken(JSON.stringify(minimal));
  }

  async function decodeSharePayload(token) {
    const json = await decompressUrlTokenToString(token);
    const parsed = JSON.parse(json);
    if (!parsed || !Array.isArray(parsed.c)) return null;
    return {
      id: uid('deck'),
      title: String(parsed.t || '共有デッキ'),
      cards: parsed.c.map((arr) => normalizeCard({
        category: arr[0],
        front: arr[1],
        back: arr[2],
        hint: arr[3]
      }))
    };
  }

  // 全データ一括引越しURL生成（学習履歴・試験日・複数デッキ丸ごと圧縮）
  async function encodeFullBundlePayload(appData) {
    const buildPayload = (includeImages) => ({
      v: 2,
      e: appData.examDate || '',
      d: appData.decks.map((deck) => [
        deck.title,
        deck.cards.map((c) => [
          c.category,
          c.front,
          c.back,
          c.hint,
          c.correctCount,
          c.wrongCount,
          c.pinned ? 1 : 0,
          c.srsLevel,
          c.nextReview,
          includeImages ? (c.image || '') : ''
        ])
      ])
    });

    let imagesStripped = false;
    let token = await compressStringToUrlToken(JSON.stringify(buildPayload(true)));

    // URLが長すぎる場合（8000文字超）は画像を除いてテキスト＋成績のみ確実に圧縮
    if (token.length > 8000) {
      token = await compressStringToUrlToken(JSON.stringify(buildPayload(false)));
      imagesStripped = true;
    }

    return { token, imagesStripped };
  }

  async function decodeFullBundlePayload(token) {
    const json = await decompressUrlTokenToString(token);
    const parsed = JSON.parse(json);
    if (!parsed || !Array.isArray(parsed.d)) return null;

    const decks = parsed.d.map((deckArr) => ({
      id: uid('deck'),
      title: String(deckArr[0] || '引越しデッキ'),
      cards: Array.isArray(deckArr[1])
        ? deckArr[1].map((cArr) => normalizeCard({
            category: cArr[0],
            front: cArr[1],
            back: cArr[2],
            hint: cArr[3],
            correctCount: cArr[4] || 0,
            wrongCount: cArr[5] || 0,
            pinned: Boolean(cArr[6]),
            srsLevel: cArr[7] || 0,
            nextReview: cArr[8] || 0,
            image: cArr[9] || ''
          }))
        : []
    }));

    return {
      examDate: parsed.e || '',
      decks
    };
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
    parseCsvText,
    generateCsvText,
    pushUndo,
    popUndo,
    clearUndo,
    encodeSharePayload,
    decodeSharePayload,
    encodeFullBundlePayload,
    decodeFullBundlePayload
  };
})();
