let activeSide = null;
let stateListener = null;

export function initSpeech(onStateChange) {
  stateListener = onStateChange;
  if ('speechSynthesis' in window) {
    try {
      window.speechSynthesis.getVoices();
      window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
    } catch (_) {}
  }
}

function notify() {
  if (typeof stateListener === 'function') stateListener(activeSide);
}

export function stopSpeech() {
  activeSide = null;
  notify();
  if ('speechSynthesis' in window) {
    try {
      window.speechSynthesis.cancel();
    } catch (_) {}
  }
}

function buildSpeechText(rawText) {
  let t = String(rawText || '');
  t = t.replace(/【|】/g, '');
  t = t.replace(/\$\$([\s\S]*?)\$\$/g, '$1');
  t = t.replace(/\$([^$]+?)\$/g, '$1');
  t = t.replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, '$1 / $2');
  t = t.replace(/\\sqrt\{([^{}]+)\}/g, 'ルート $1');
  t = t
    .replace(/\\pm/g, '±')
    .replace(/\\times/g, '×')
    .replace(/\\div/g, '÷')
    .replace(/\\neq/g, '≠')
    .replace(/\\leq/g, '≤')
    .replace(/\\geq/g, '≥')
    .replace(/\\pi/g, 'π')
    .replace(/\\[a-zA-Z]+/g, ' ')
    .replace(/[{}]/g, ' ');
  return t.replace(/\s+/g, ' ').trim();
}

function detectSpeechLang(text) {
  if (/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/.test(text)) return 'ja-JP';
  if (/[A-Za-z]/.test(text)) return 'en-US';
  return 'ja-JP';
}

export function speakText(side, rawText, onUnsupported) {
  if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance !== 'function') {
    if (typeof onUnsupported === 'function') onUnsupported();
    return;
  }

  const wasSame = activeSide === side && window.speechSynthesis.speaking;
  stopSpeech();
  if (wasSame) return;

  const cleanText = buildSpeechText(rawText);
  if (!cleanText) return;

  const lang = detectSpeechLang(cleanText);
  const utter = new SpeechSynthesisUtterance(cleanText);
  utter.lang = lang;
  utter.rate = 1.0;

  try {
    const voices = window.speechSynthesis.getVoices();
    const matched = voices.find((v) => v.lang && v.lang.toLowerCase() === lang.toLowerCase())
      || voices.find((v) => v.lang && v.lang.toLowerCase().startsWith(lang.slice(0, 2).toLowerCase()));
    if (matched) utter.voice = matched;
  } catch (_) {}

  activeSide = side;
  notify();

  const clearIfSame = () => {
    if (activeSide === side) {
      activeSide = null;
      notify();
    }
  };
  utter.onend = clearIfSame;
  utter.onerror = clearIfSame;

  window.speechSynthesis.speak(utter);
}
