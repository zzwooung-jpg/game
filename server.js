// 의존성 없는 Node.js 서버: 정적 페이지 + 이슈 등록 API
// 실행: npm start  (기본 포트 3000, PORT 환경변수로 변경)
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const FILE = path.join(DATA_DIR, 'entries.json');
const MAX_ENTRIES = 5000;

fs.mkdirSync(DATA_DIR, {recursive: true});
let entries = [];
try { entries = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) {}

function persist() {
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(entries));
  fs.renameSync(tmp, FILE);
}

const hits = new Map(); // IP별 분당 등록 제한
function limited(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < 60000);
  list.push(now);
  hits.set(ip, list);
  return list.length > 10;
}

function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, {'Content-Type': type, 'X-Content-Type-Options': 'nosniff'});
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function validate(b) {
  const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const e = {
    n: str(b.n, 40), t: str(b.t, 20), d: str(b.d, 800), s: str(b.s, 300),
    lat: Number(b.lat), lon: Number(b.lon),
  };
  if (!e.n || !e.t || !e.d) return null;
  if (!Number.isFinite(e.lat) || !Number.isFinite(e.lon) || Math.abs(e.lat) > 90 || Math.abs(e.lon) > 180) return null;
  if (e.s && !/^https?:\/\//i.test(e.s)) return null;
  if (!e.s) delete e.s;
  e.ts = Date.now();
  return e;
}

http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/api/entries' && req.method === 'GET') return send(res, 200, entries);
  if (url === '/api/entries' && req.method === 'POST') {
    if (limited(req.socket.remoteAddress)) return send(res, 429, {error: '잠시 후 다시 시도해 주세요.'});
    if (entries.length >= MAX_ENTRIES) return send(res, 507, {error: '등록 한도에 도달했습니다.'});
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 10000) req.destroy(); });
    req.on('end', () => {
      let b;
      try { b = JSON.parse(raw); } catch (e) { return send(res, 400, {error: '잘못된 요청입니다.'}); }
      const e = validate(b || {});
      if (!e) return send(res, 400, {error: '입력값을 확인해 주세요.'});
      entries.push(e);
      persist();
      send(res, 201, e);
    });
    return;
  }
  if (url === '/' || url === '/index.html') {
    return fs.readFile(path.join(__dirname, 'index.html'), (err, data) =>
      err ? send(res, 500, 'error', 'text/plain') : send(res, 200, data, 'text/html; charset=utf-8'));
  }
  send(res, 404, {error: 'not found'});
}).listen(PORT, () => console.log(`http://localhost:${PORT}`));
