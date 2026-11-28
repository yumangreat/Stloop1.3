import { uid, normalizeCard, normalizeStructure } from './store.js';

export function parseImportText(rawText) {
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

export function parseCsvRows(text) {
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

export function generateDeckCsvText(deck) {
  const header = ['カテゴリ', '問題(Q)', '答え(A)', 'ヒント'].map(escapeCsvCell).join(',');
  const lines = deck.cards.map((c) =>
    [c.category, c.front, c.back, c.hint].map(escapeCsvCell).join(',')
  );
  return '\uFEFF' + [header, ...lines].join('\r\n');
}

export function generateSampleCsvText() {
  const rows = [
    ['カテゴリ', '問題(Q)', '答え(A)', 'ヒント'],
    ['英文法', 'apple の意味は？', '【りんご】', '赤い果物'],
    ['日本史', '1192年に鎌倉幕府を開いた人物は？', '【源頼朝】', '平氏を滅ぼした'],
    ['数学', '二次方程式 $ax^2+bx+c=0$ の解の公式', '【$$x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}$$】', '判別式Dを使う']
  ];
  return '\uFEFF' + rows.map((r) => r.map(escapeCsvCell).join(',')).join('\r\n');
}

export function generateFullBackupCsvText(appData) {
  const folderNameById = new Map((appData.folders || []).map((f) => [f.id, f.name]));
  const header = [
    'フォルダ名', '単語帳名', 'カテゴリ', '問題(Q)', '答え(A)', 'ヒント',
    '正解数', '誤答数', 'ピン留め', 'SRSレベル', '次回学習日時', '目標試験日'
  ].map(escapeCsvCell).join(',');

  const lines = [];
  appData.decks.forEach((deck) => {
    const folderName = deck.folderId ? (folderNameById.get(deck.folderId) || '') : '';
    if (deck.cards.length === 0) {
      lines.push([
        folderName, deck.title, '一般', '', '', '',
        0, 0, 0, 0, 0, appData.examDate || ''
      ].map(escapeCsvCell).join(','));
    } else {
      deck.cards.forEach((c) => {
        lines.push([
          folderName,
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

export function generateFullBackupJsonText(appData, imageMap = {}) {
  const payload = {
    format: 'studyloop_backup_v2',
    exportedAt: new Date().toISOString(),
    data: {
      examDate: appData.examDate || '',
      theme: appData.theme || 'light',
      unorderedEnabled: appData.unorderedEnabled !== false,
      unorderedDelimiters: appData.unorderedDelimiters || '',
      studyLog: appData.studyLog || {},
      folders: appData.folders || [],
      decks: appData.decks || []
    },
    images: imageMap
  };
  return JSON.stringify(payload, null, 2);
}

export function parseBackupJson(rawText) {
  try {
    const parsed = JSON.parse(rawText);
    const source = parsed && parsed.data && Array.isArray(parsed.data.decks) ? parsed.data : parsed;
    if (!source || !Array.isArray(source.decks)) return null;
    const { folders, decks } = normalizeStructure(source);
    return {
      type: 'json_backup',
      folders,
      decks,
      images: parsed.images && typeof parsed.images === 'object' ? parsed.images : {},
      examDate: source.examDate || '',
      unorderedEnabled: typeof source.unorderedEnabled === 'boolean' ? source.unorderedEnabled : undefined,
      unorderedDelimiters: typeof source.unorderedDelimiters === 'string' ? source.unorderedDelimiters : undefined,
      studyLog: source.studyLog && typeof source.studyLog === 'object' ? source.studyLog : {}
    };
  } catch (_) {
    return null;
  }
}

export function parseCsvAuto(csvText) {
  const rows = parseCsvRows(csvText);
  if (rows.length === 0) return { type: 'empty', cards: [], decks: [], folders: [] };

  const firstRow = rows[0].map((c) => c.trim());
  const firstJoined = firstRow.join(',').toLowerCase();

  if (firstRow[0] === 'フォルダ名' || firstRow.length >= 12) {
    const dataRows = firstRow[0] === 'フォルダ名' ? rows.slice(1) : rows;
    const folderMap = new Map();
    const deckMap = new Map();
    let restoredExamDate = '';

    for (const cols of dataRows) {
      const folderName = (cols[0] || '').trim();
      let folderId = '';
      if (folderName) {
        if (!folderMap.has(folderName)) {
          folderMap.set(folderName, { id: uid('folder'), name: folderName });
        }
        folderId = folderMap.get(folderName).id;
      }

      const deckTitle = (cols[1] || '復元された単語帳').trim();
      const deckKey = `${folderId}::${deckTitle}`;
      if (!deckMap.has(deckKey)) {
        deckMap.set(deckKey, { id: uid('deck'), folderId, title: deckTitle, cards: [] });
      }

      const front = (cols[3] || '').trim();
      const back = (cols[4] || '').trim();
      if (cols[11] && cols[11].trim()) restoredExamDate = cols[11].trim();
      if (front && back) {
        deckMap.get(deckKey).cards.push(normalizeCard({
          category: cols[2] || '一般',
          front,
          back,
          hint: cols[5] || '',
          correctCount: Number(cols[6] || 0),
          wrongCount: Number(cols[7] || 0),
          pinned: cols[8] === '1' || String(cols[8]).toLowerCase() === 'true',
          srsLevel: Number(cols[9] || 0),
          nextReview: Number(cols[10] || 0)
        }));
      }
    }

    return {
      type: 'backup',
      folders: Array.from(folderMap.values()),
      decks: Array.from(deckMap.values()),
      examDate: restoredExamDate
    };
  }

  if (firstRow[0] === '単語帳名' || firstRow.length >= 9) {
    const dataRows = firstRow[0] === '単語帳名' ? rows.slice(1) : rows;
    const deckMap = new Map();
    let restoredExamDate = '';

    for (const cols of dataRows) {
      const deckTitle = (cols[0] || '復元された単語帳').trim();
      if (!deckMap.has(deckTitle)) {
        deckMap.set(deckTitle, { id: uid('deck'), folderId: '', title: deckTitle, cards: [] });
      }
      const front = (cols[2] || '').trim();
      const back = (cols[3] || '').trim();
      if (cols[10] && cols[10].trim()) restoredExamDate = cols[10].trim();
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
      folders: [],
      decks: Array.from(deckMap.values()),
      examDate: restoredExamDate
    };
  }

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

export function downloadTextFile(content, filename, mimeType = 'text/csv;charset=utf-8') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function readFileTextSmart(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('File read error'));
    reader.onload = (ev) => {
      const text = String(ev.target.result || '');
      if (text.includes('\uFFFD') && !file.name.toLowerCase().endsWith('.json')) {
        const sjis = new FileReader();
        sjis.onerror = () => resolve(text);
        sjis.onload = (ev2) => resolve(String(ev2.target.result || ''));
        sjis.readAsText(file, 'Shift_JIS');
      } else {
        resolve(text);
      }
    };
    reader.readAsText(file, 'UTF-8');
  });
}
