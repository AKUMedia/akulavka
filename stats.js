/* AKU Лавка — своя статистика сайта и мини-приложения.
   Сайт шлёт события на https://api.akulavka.com/t → Caddy → сюда (127.0.0.1:8797).
   Данные: stats.json рядом с ботом. Экран в боте: /admin → 🌐 Сайт (или /site). */
const http = require('http');
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'stats.json');
const PORT = +process.env.STATS_PORT || 8797;   // 8787 на сервере уже занят другим проектом
const KEEP_DAYS = 120;
const TZ = 'Europe/Minsk';
const EVENTS = ['view', 'add', 'buy', 'checkout', 'out'];

let st = { seen: {}, days: {} };
try { st = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (_) {}
st.seen = st.seen || {}; st.days = st.days || {};
let dirty = false;
const live = new Map();                       // vid → { t, a, p } — кто на сайте прямо сейчас

const dayKey = (ts = Date.now()) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(ts)); // 2026-11-03
const inc = (o, k, n = 1) => { if (k) o[k] = (o[k] || 0) + n; };
const clip = (s, n = 60) => String(s == null ? '' : s).replace(/[\u0000-\u001f<>]/g, '').slice(0, n);

function day(k) {
  return st.days[k] || (st.days[k] = { vis: {}, app: {}, newv: 0, ses: 0, pv: 0, src: {}, pages: {}, prod: {},
    add: {}, buy: {}, co: 0, coSum: 0, coVis: {}, addVis: {}, prodVis: {}, dev: {}, out: {} });
}

function record(e) {
  const vid = clip(e.v, 24), ev = clip(e.e, 12);
  if (!/^[a-z0-9]{6,24}$/i.test(vid) || !EVENTS.includes(ev)) return;
  const now = Date.now(), d = day(dayKey(now)), app = e.a === 'app';
  if (!d.vis[vid]) {
    d.vis[vid] = 1;
    inc(d.dev, e.m ? 'mobile' : 'desktop');
    if (!st.seen[vid]) { st.seen[vid] = dayKey(now); d.newv++; }
  }
  if (app) d.app[vid] = 1;
  if (e.ns) { d.ses++; inc(d.src, app ? 'Mini App' : (clip(e.u, 40) || 'прямой заход')); }
  const g = clip(e.g, 20);
  if (ev === 'view') {
    d.pv++; inc(d.pages, clip(e.p, 30) || '/');
    if (g) { inc(d.prod, g); d.prodVis[vid] = 1; }
  }
  if (ev === 'add' && g) { inc(d.add, g); d.addVis[vid] = 1; }
  if (ev === 'buy' && g) { inc(d.buy, g); d.addVis[vid] = 1; }
  if (ev === 'checkout') { d.co++; d.coSum += Math.max(0, Math.min(1e6, +e.n || 0)); d.coVis[vid] = 1; }
  if (ev === 'out') inc(d.out, clip(e.p, 20));
  live.set(vid, { t: now, a: app, p: clip(e.p, 30) });
  dirty = true;
}

function save() {
  if (!dirty) return; dirty = false;
  const keys = Object.keys(st.days).sort();
  keys.slice(0, Math.max(0, keys.length - KEEP_DAYS)).forEach(k => delete st.days[k]);
  try { fs.writeFileSync(FILE + '.tmp', JSON.stringify(st)); fs.renameSync(FILE + '.tmp', FILE); }
  catch (e) { console.error('stats save:', e.message); }
}
setInterval(save, 30e3).unref();
process.on('exit', save);
for (const s of ['SIGINT', 'SIGTERM']) process.once(s, () => { save(); });

/* ---------- приём событий ---------- */
const hits = new Map();                       // ip → [счётчик, начало окна]
function limited(ip) {
  const now = Date.now(), h = hits.get(ip);
  if (!h || now - h[1] > 10 * 60e3) { hits.set(ip, [1, now]); return false; }
  return ++h[0] > 400;
}
setInterval(() => { const t = Date.now() - 10 * 60e3; for (const [k, v] of hits) if (v[1] < t) hits.delete(k); }, 60e3).unref();

function start() {
  const srv = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    if (req.method === 'GET' && req.url === '/health') { res.writeHead(200); return res.end('ok'); }
    if (req.method !== 'POST' || !req.url.startsWith('/t')) { res.writeHead(404); return res.end(); }
    const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    let body = '';
    req.on('data', c => { body += c; if (body.length > 4096) req.destroy(); });
    req.on('end', () => {
      res.writeHead(204); res.end();
      if (limited(ip)) return;
      try { const e = JSON.parse(body); (Array.isArray(e) ? e.slice(0, 20) : [e]).forEach(record); } catch (_) {}
    });
  });
  srv.on('error', e => console.error('stats server:', e.message));
  srv.listen(PORT, '127.0.0.1', () => console.log('Статистика сайта слушает 127.0.0.1:' + PORT));
}

/* ---------- сводка для админки ---------- */
function range(n, skip = 0) {                 // последние n дней (skip — сдвиг назад)
  const out = [];
  for (let i = skip; i < skip + n; i++) out.push(st.days[dayKey(Date.now() - i * 864e5)]);
  return out.filter(Boolean);
}
function sum(ds) {
  const u = (f) => { const s = new Set(); ds.forEach(d => Object.keys(d[f] || {}).forEach(k => s.add(k))); return s.size; };
  const m = (f) => { const o = {}; ds.forEach(d => Object.entries(d[f] || {}).forEach(([k, v]) => inc(o, k, v))); return o; };
  const n = (f) => ds.reduce((a, d) => a + (d[f] || 0), 0);
  return { vis: u('vis'), app: u('app'), newv: n('newv'), ses: n('ses'), pv: n('pv'), co: n('co'), coSum: n('coSum'),
    prodVis: u('prodVis'), addVis: u('addVis'), coVis: u('coVis'),
    src: m('src'), pages: m('pages'), prod: m('prod'), add: m('add'), buy: m('buy'), dev: m('dev'), out: m('out') };
}
const top = (o, names = {}, k = 5) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, k)
  .map(([key, v]) => `${esc(names[key] || key)} ${v}`).join(' · ') || '—';
const pct = (a, b) => b ? Math.round(a / b * 100) + '%' : '—';
const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

/* orders — заказы бота за период (для конца воронки) */
function report({ goodsNames = {}, money = n => n + ' ₽', ordersBetween = () => ({ all: 0, paid: 0 }) } = {}) {
  const now = Date.now();
  for (const [k, v] of live) if (now - v.t > 30 * 60e3) live.delete(k);
  const on = [...live.values()].filter(v => now - v.t < 5 * 60e3);
  const line = (name, ds) => {
    const s = sum(ds);
    return `<b>${name}</b>: 👀 ${s.vis} чел. (новых ${s.newv})` + (s.app ? ` · из них в Mini App ${s.app}` : '') +
      ` · визитов ${s.ses} · страниц ${s.pv}\n`;
  };
  const w = sum(range(7)), dev = w.dev, devAll = (dev.mobile || 0) + (dev.desktop || 0);
  const ord = ordersBetween(now - 7 * 864e5);
  const pages = { '/': 'главная', 'shop': 'каталог', 'product': 'товар', 'friends': 'друзья', 'more': 'ещё', 'cart': 'корзина', 'pick': 'подбор', 'help': 'помощь', 'about': 'о нас', 'terms': 'условия', 'p': 'товар' };
  const text = '<b>🌐 Сайт и Mini App</b>\n\n' +
    `🟢 Сейчас на сайте: <b>${on.length}</b>` + (on.length ? ` (в Mini App ${on.filter(v => v.a).length})` : '') + '\n\n' +
    line('Сегодня', range(1)) + line('Вчера', range(1, 1)) + line('7 дней', range(7)) + line('30 дней', range(30)) + '\n' +
    '<b>Воронка за 7 дней</b>\n' +
    `зашли ${w.vis} → смотрели товар ${w.prodVis} (${pct(w.prodVis, w.vis)}) → в корзину ${w.addVis} (${pct(w.addVis, w.prodVis || w.vis)})` +
    ` → нажали «Оформить» ${w.coVis} (${pct(w.coVis, w.addVis)}) → заказов в боте ${ord.all} → оплачено ${ord.paid}\n` +
    (w.co ? `сумма корзин при оформлении: ${money(w.coSum)}\n` : '') + '\n' +
    `<b>Откуда пришли (7 дн.):</b> ${top(w.src, {}, 6)}\n` +
    `<b>Смотрят товары:</b> ${top(w.prod, goodsNames)}\n` +
    `<b>Кладут в корзину:</b> ${top(Object.fromEntries(Object.keys({ ...w.add, ...w.buy }).map(k => [k, (w.add[k] || 0) + (w.buy[k] || 0)])), goodsNames)}\n` +
    `<b>Страницы:</b> ${top(w.pages, pages, 6)}\n` +
    (Object.keys(w.out).length ? `<b>Переходы наружу:</b> ${top(w.out)}\n` : '') +
    `<b>Устройства:</b> 📱 ${pct(dev.mobile || 0, devAll)} · 💻 ${pct(dev.desktop || 0, devAll)}\n\n` +
    '<i>Метка источника: akulavka.com/?s=tiktok — всё, что после s=, попадёт в «Откуда пришли».</i>';
  return text;
}

module.exports = { start, report, record, _st: () => st };
