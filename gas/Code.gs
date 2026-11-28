// StudyLoop v2.1 Shared DB & Short URL Backend (Google Apps Script)
// 1. Googleスプレッドシートを作成 → 拡張機能 → Apps Script に貼り付け
// 2. デプロイ → 新しいデプロイ → ウェブアプリ（実行: 自分 / アクセス: 全員）

const PASSCODE = '';
const FOLDER_NAME = 'StudyLoop_Shares';
const SHEET_NAME = 'Shares';
const MAX_PAYLOAD_BYTES = 2 * 1024 * 1024; // 2MB

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow([
      'id', 'createdAt', 'updatedAt', 'visibility',
      'title', 'author', 'categories', 'deckCount',
      'cardCount', 'searchText', 'fileId', 'editKey'
    ]);
  }
  return sheet;
}

function getDriveFolder_() {
  const it = DriveApp.getFoldersByName(FOLDER_NAME);
  if (it.hasNext()) return it.next();
  return DriveApp.createFolder(FOLDER_NAME);
}

function jsonOut_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function makeId_(len) {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < len; i++) {
    out += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return out;
}

function doGet(e) {
  try {
    const p = (e && e.parameter) || {};
    const action = p.action || 'ping';

    if (action === 'ping') {
      return jsonOut_({ ok: true, requiresPasscode: Boolean(PASSCODE) });
    }

    const sheet = getSheet_();
    const values = sheet.getDataRange().getValues();

    if (action === 'get') {
      const id = String(p.id || '').trim();
      if (!id) return jsonOut_({ ok: false, error: 'IDが指定されていません' });
      for (let i = 1; i < values.length; i++) {
        if (String(values[i][0]) === id) {
          const fileId = String(values[i][10]);
          try {
            const content = DriveApp.getFileById(fileId).getBlob().getDataAsString('UTF-8');
            return jsonOut_({
              ok: true,
              id,
              title: String(values[i][4] || ''),
              author: String(values[i][5] || ''),
              visibility: String(values[i][3] || 'unlisted'),
              updatedAt: String(values[i][2] || ''),
              payload: JSON.parse(content)
            });
          } catch (_) {
            return jsonOut_({ ok: false, error: '共有ファイルが見つかりません（削除済みの可能性があります）' });
          }
        }
      }
      return jsonOut_({ ok: false, error: '共有データが見つかりません' });
    }

    if (action === 'search') {
      const q = String(p.q || '').trim().toLowerCase();
      const limit = Math.min(50, Math.max(1, Number(p.limit) || 30));
      const tokens = q ? q.split(/[\s　]+/).filter(Boolean) : [];
      const results = [];

      for (let i = values.length - 1; i >= 1; i--) {
        const row = values[i];
        if (String(row[3]) !== 'public') continue;
        const hay = [row[4], row[5], row[6], row[9]].join(' ').toLowerCase();
        const matched = tokens.every((tk) => hay.indexOf(tk) !== -1);
        if (!matched) continue;

        results.push({
          id: String(row[0]),
          updatedAt: String(row[2]),
          title: String(row[4]),
          author: String(row[5]),
          categories: String(row[6]),
          deckCount: Number(row[7]) || 0,
          cardCount: Number(row[8]) || 0
        });
        if (results.length >= limit) break;
      }
      return jsonOut_({ ok: true, items: results });
    }

    return jsonOut_({ ok: false, error: '不正なリクエストです' });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err.message || err) });
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    return jsonOut_({ ok: false, error: 'アクセスが集中しています。少し待ってから再試行してください' });
  }

  try {
    const raw = (e && e.postData && e.postData.contents) || '';
    if (!raw) return jsonOut_({ ok: false, error: 'データが空です' });
    if (raw.length > MAX_PAYLOAD_BYTES) {
      return jsonOut_({ ok: false, error: 'データサイズが大きすぎます（上限2MB）' });
    }

    const body = JSON.parse(raw);

    if (body.action === 'delete') {
      const reqId = String(body.id || '').trim();
      const reqKey = String(body.editKey || '').trim();
      if (!reqId || !reqKey) return jsonOut_({ ok: false, error: '削除キーが不足しています' });

      const sheet = getSheet_();
      const values = sheet.getDataRange().getValues();
      for (let i = 1; i < values.length; i++) {
        if (String(values[i][0]) === reqId && String(values[i][11]) === reqKey) {
          const fileId = String(values[i][10]);
          try { DriveApp.getFileById(fileId).setTrashed(true); } catch (_) {}
          sheet.deleteRow(i + 1);
          return jsonOut_({ ok: true, deleted: true });
        }
      }
      return jsonOut_({ ok: false, error: '対象データが見つからないか、権限がありません' });
    }

    if (body.action !== 'publish') {
      return jsonOut_({ ok: false, error: '不正なアクションです' });
    }

    if (PASSCODE && String(body.passcode || '') !== PASSCODE) {
      return jsonOut_({ ok: false, error: '合言葉が一致しません' });
    }

    const payload = body.payload;
    if (!payload || !Array.isArray(payload.decks) || payload.decks.length === 0) {
      return jsonOut_({ ok: false, error: '単語帳データがありません' });
    }

    const visibility = body.visibility === 'public' ? 'public' : 'unlisted';
    const title = String(body.title || payload.decks[0].title || '共有単語帳').trim().slice(0, 80);
    const author = String(body.author || '').trim().slice(0, 30);

    const catSet = {};
    const searchParts = [];
    let cardCount = 0;

    payload.decks.forEach((d) => {
      if (d.title) searchParts.push(d.title);
      (d.cards || []).forEach((c) => {
        cardCount += 1;
        if (c.category) catSet[c.category] = true;
        if (c.front) searchParts.push(c.front);
        if (c.back) searchParts.push(String(c.back).replace(/【|】/g, ''));
      });
    });

    const categories = Object.keys(catSet).slice(0, 20).join(', ');
    const searchText = searchParts.join(' ').slice(0, 30000);
    const nowIso = new Date().toISOString();
    const jsonString = JSON.stringify(payload);

    const sheet = getSheet_();
    const folder = getDriveFolder_();
    const reqId = String(body.id || '').trim();
    const reqKey = String(body.editKey || '').trim();

    if (reqId && reqKey) {
      const values = sheet.getDataRange().getValues();
      for (let i = 1; i < values.length; i++) {
        if (String(values[i][0]) === reqId && String(values[i][11]) === reqKey) {
          let fileId = String(values[i][10]);
          try {
            DriveApp.getFileById(fileId).setContent(jsonString);
          } catch (_) {
            const newFile = folder.createFile(reqId + '.json', jsonString, MimeType.PLAIN_TEXT);
            fileId = newFile.getId();
            sheet.getRange(i + 1, 11).setValue(fileId);
          }
          sheet.getRange(i + 1, 3, 1, 8).setValues([[
            nowIso, visibility, title, author, categories,
            payload.decks.length, cardCount, searchText
          ]]);
          return jsonOut_({ ok: true, id: reqId, editKey: reqKey, updated: true });
        }
      }
    }

    const id = makeId_(10);
    const editKey = makeId_(16);
    const file = folder.createFile(id + '.json', jsonString, MimeType.PLAIN_TEXT);

    sheet.appendRow([
      id, nowIso, nowIso, visibility,
      title, author, categories, payload.decks.length,
      cardCount, searchText, file.getId(), editKey
    ]);

    return jsonOut_({ ok: true, id, editKey, updated: false });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err.message || err) });
  } finally {
    lock.releaseLock();
  }
}
