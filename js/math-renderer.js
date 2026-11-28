export const DEFAULT_UNORDERED_DELIMITERS = '・ 、 , ／ / と や および 及び ならびに 並びに または 又は';

export function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function formatCardHtml(rawText) {
  const escaped = escapeHtml(rawText || '');
  const withCloze = escaped.replace(/【([\s\S]*?)】/g, (_, inner) => {
    return `<span class="cloze-blank" tabindex="0"><span class="cloze-inner">${inner}</span></span>`;
  });
  return withCloze.replace(/\n/g, '<br>');
}

export function renderMathIfReady(element, displayMode = true) {
  if (!element || typeof window.renderMathInElement !== 'function') return;
  try {
    window.renderMathInElement(element, {
      delimiters: [
        { left: '$$', right: '$$', display: displayMode },
        { left: '$', right: '$', display: false }
      ],
      throwOnError: false
    });
  } catch (err) {
    console.warn('KaTeX render warning:', err);
  }
}

export function renderContent(element, rawText) {
  if (!element) return;
  element.innerHTML = formatCardHtml(rawText);
  renderMathIfReady(element, true);
}

function normalizeDelimiterToken(str) {
  return String(str || '')
    .replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .replace(/･/g, '・')
    .replace(/、/g, ',')
    .replace(/[\s　]+/g, '')
    .toLowerCase();
}

function parseDelimiterSet(delimitersStr) {
  const tokens = String(delimitersStr || '')
    .split(/[\s　]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  const normSet = new Set();
  tokens.forEach((t) => {
    const n = normalizeDelimiterToken(t);
    if (n) normSet.add(n);
  });
  return normSet;
}

export function extractClozeStructure(
  backText,
  unorderedEnabled = true,
  delimitersStr = DEFAULT_UNORDERED_DELIMITERS
) {
  const source = String(backText || '');
  const regex = /【([\s\S]*?)】/g;
  const rawMatches = [];
  let m;
  while ((m = regex.exec(source)) !== null) {
    const val = m[1].trim();
    if (val) {
      rawMatches.push({
        text: val,
        start: m.index,
        end: m.index + m[0].length
      });
    }
  }

  if (rawMatches.length === 0) {
    const fallback = source.trim();
    return {
      targets: [fallback],
      groups: [{ indices: [0], separator: '' }],
      groupIndexBySlot: [0]
    };
  }

  const targets = rawMatches.map((item) => item.text);
  const delimSet = unorderedEnabled ? parseDelimiterSet(delimitersStr) : new Set();

  const groups = [];
  const groupIndexBySlot = [];

  rawMatches.forEach((item, idx) => {
    if (idx === 0) {
      groups.push({ indices: [0], separator: '' });
      groupIndexBySlot.push(0);
      return;
    }

    const prev = rawMatches[idx - 1];
    const betweenRaw = source.slice(prev.end, item.start);
    const betweenTrimmed = betweenRaw.trim();
    const betweenNorm = normalizeDelimiterToken(betweenTrimmed);

    if (unorderedEnabled && betweenNorm.length > 0 && delimSet.has(betweenNorm)) {
      const currentGroupIdx = groups.length - 1;
      groups[currentGroupIdx].indices.push(idx);
      if (!groups[currentGroupIdx].separator) {
        groups[currentGroupIdx].separator = betweenTrimmed;
      }
      groupIndexBySlot.push(currentGroupIdx);
    } else {
      const newGroupIdx = groups.length;
      groups.push({ indices: [idx], separator: '' });
      groupIndexBySlot.push(newGroupIdx);
    }
  });

  return { targets, groups, groupIndexBySlot };
}

export function extractClozeTargets(backText) {
  return extractClozeStructure(backText, false).targets;
}
