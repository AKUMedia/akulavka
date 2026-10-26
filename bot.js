/* ═══════════════════════════════════════════════════════════
   AKU Лавка — бот магазина
   Здесь правишь только блок CONFIG. Товары, цены, сроки, каналы,
   часы работы и проценты рефералки лежат в catalog.js.
   Токен лежит в файле token.txt рядом с ботом.
   ═══════════════════════════════════════════════════════════ */

process.env.TZ = 'Europe/Minsk';   // все даты и часы — по Минску, независимо от сервера

const CONFIG = {
  adminId : 927864149,                                       // твой Telegram ID
  yoomoney: '4100118055761665',                              // кошелёк ЮMoney
  usdtTrc : 'TTeBmEYoWSWGvaATRALL6hFud3hmjbaqTx',            // USDT, сеть TRC-20 (Tron)
  usdtBep : '0xd731da2010d88d03ac8eba6bdce17b2eea8cb625',    // USDT, сеть BEP-20 (BNB Smart Chain)
  usdtRate: 92,      // ₽ за 1 USDT, по нему клиенту показывается сумма в USDT
  lexyRef : 'https://lexygpt.com/?ref=ALEKSEIAI'
};

/* ═══════════════ ДАЛЬШЕ КОД — МЕНЯТЬ НЕ НАДО ═══════════════ */

const fs = require('fs');
const path = require('path');
const { Telegraf, Markup } = require('telegraf');
const { CONFIG: CAT, PRICE, CART_LINK } = require('./catalog.js');

function readToken() {
  if (process.env.BOT_TOKEN) return process.env.BOT_TOKEN.trim();
  try { return fs.readFileSync(path.join(__dirname, 'token.txt'), 'utf8').trim(); }
  catch { console.error('Нет токена: положите его в файл token.txt рядом с bot.js'); process.exit(1); }
}

const SHOP_URL  = CAT.site;
const APP_URL   = CAT.site + 'app.html';
const CHANNEL   = CAT.shopChannel;
const FOUNDER   = CAT.channel;
const OPEN_FROM = CAT.openFrom, OPEN_TO = CAT.openTo;
const GOODS     = CAT.goods.filter(g => !g.hidden);
const ON_REQ    = CAT.goods.filter(g => g.hidden).map(g => g.name);

/* ---------- база: один JSON-файл ---------- */
const DB_FILE = path.join(__dirname, 'data.json');
function load() {
  if (!fs.existsSync(DB_FILE)) return { orders: [], users: {}, seq: 1000 };
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
  catch (e) {
    // файл есть, но испорчен — не стартуем с пустой базой, иначе затрём все заказы
    console.error('data.json повреждён, бот остановлен. Восстановите файл из бэкапа.', e.message);
    process.exit(1);
  }
}
function save() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 1));
  fs.renameSync(tmp, DB_FILE);
}
const db = load();
db.orders = db.orders || []; db.users = db.users || {}; db.seq = db.seq || 1000;
db.relay = db.relay || {};       // id сообщения у админа → id клиента (для ответов реплаем)
db.daily = db.daily || {};       // отметки ежедневных дел
db.costs = db.costs || {};       // твоя себестоимость за 1 месяц товара: { claude: 1150 }
db.expenses = db.expenses || []; // расходы: сервер, реклама, розыгрыши
db.broadcasts = db.broadcasts || [];

/* ---------- мелочи ---------- */
const esc   = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));
const money = PRICE.money;
const crypto = PRICE.crypto;
const usdt  = rub => (Math.ceil(rub / CONFIG.usdtRate * 100) / 100).toFixed(2);
const G     = id => GOODS.find(g => g.id === id);
const termLabel = i => { const g = G(i.id); return g ? PRICE.term(g, i.months).label : i.months + ' мес.'; };
const fmtDate = d => new Date(d).toLocaleDateString('ru-RU');
const hour  = () => new Date().getHours();
const isOpen = () => hour() >= OPEN_FROM && hour() < OPEN_TO;
const today = () => { const d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); };
const MIN = 60e3, HOUR = 60 * MIN, DAY = 24 * HOUR;

const ACTIVE_STATUSES = ['ждёт оплаты', 'оплата заявлена', 'оплачен', 'оформляется'];
const PAID_STATUSES   = ['оплачен', 'оформляется', 'активна', 'истекла', 'продлена'];
const METHOD_NAME = { card: 'банковская карта (ЮMoney)', wallet: 'кошелёк ЮMoney', crypto: 'USDT',
                      yoomoney: 'ЮMoney', 'не выбран': 'не выбран' };

function userOf(uid) {
  if (!db.users[uid]) db.users[uid] = { balance: 0, refEarned: 0, created: Date.now(), seen: Date.now() };
  const u = db.users[uid];
  if (u.balance === undefined)   u.balance = 0;
  if (u.refEarned === undefined) u.refEarned = 0;
  return u;
}
function touch(ctx) {
  const u = userOf(ctx.from.id);
  u.name = ctx.from.first_name || ''; u.username = ctx.from.username || ''; u.seen = Date.now();
  return u;
}
/* картинка Кислого для товара (лежит на сайте в папке img) */
const picOf = o => { const g = o.items.map(i => CAT.goods.find(x => x.id === i.id)).find(x => x && x.pic);
                     return g ? SHOP_URL + g.id + '.jpg' : null; };
/* сообщение с картинкой; если картинка не грузится или текст длинный — обычным текстом */
async function replyPic(ctx, pic, text, extra = {}) {
  if (pic && text.length <= 1000) {
    try { return await ctx.replyWithPhoto(pic, { caption: text, parse_mode: 'HTML', ...extra }); } catch (_) {}
  }
  return ctx.replyWithHTML(text, extra);
}
async function sendPic(chatId, pic, text, extra = {}) {
  if (pic && text.length <= 1000) {
    try { return await bot.telegram.sendPhoto(chatId, pic, { caption: text, parse_mode: 'HTML', ...extra }); } catch (_) {}
  }
  return send(chatId, text, extra);
}

function clientLink(uid) {
  const u = db.users[uid] || {};
  const name = esc(u.name || 'клиент');
  return `<a href="tg://user?id=${uid}">${name}</a>` + (u.username ? ' @' + esc(u.username) : '') + ` · id ${uid}`;
}
const orderOf = id => db.orders.find(o => o.id === +id);
const itemsText = o => o.items.map(i =>
  '• ' + esc(i.name) + ' — ' + termLabel(i) + (i.qty > 1 ? ' ×' + i.qty : '') + ' — ' + money(i.price * i.qty)).join('\n');

/* ---------- Telegram ---------- */
const bot = new Telegraf(readToken());
const send = (chatId, text, extra = {}) =>
  bot.telegram.sendMessage(chatId, text, { parse_mode: 'HTML', disable_web_page_preview: true, ...extra })
     .catch(e => console.error('send →', chatId, e.message));

function rememberRelay(adminMsgId, uid) {
  db.relay[adminMsgId] = uid;
  const keys = Object.keys(db.relay);
  if (keys.length > 1500) keys.slice(0, keys.length - 1500).forEach(k => delete db.relay[k]);
}

/* ═══════════════ ГЛАВНОЕ МЕНЮ ═══════════════ */
function hello(name) {
  return `Привет${name ? ', ' + esc(name) : ''}! Это <b>AKU Лавка</b> — подписки на нейросети.\n\n` +
    'Оформляем на ваш собственный аккаунт: переписка, файлы и история остаются у вас. ' +
    'Claude — вообще без пароля, только по номеру аккаунта.\n\n' +
    'Каталог, цены и оформление — по кнопке ниже.\n\n' +
    (isOpen() ? '🟢 Лавка открыта, отвечаем сейчас.'
              : `🌙 Сейчас закрыто. Заказ оставить можно — возьмём в работу с ${OPEN_FROM}:00.`);
}
function startMenu() {
  return Markup.inlineKeyboard([
    [Markup.button.webApp('🛍 Открыть магазин', APP_URL)],
    [Markup.button.callback('👤 Профиль', 'scr:profile'), Markup.button.callback('👥 Друзья', 'scr:friends')],
    [Markup.button.callback('❓ Помощь', 'scr:help'), Markup.button.callback('💬 Написать', 'scr:ask')],
    [Markup.button.url('📣 Канал Лавки — розыгрыши', CHANNEL)]
  ]);
}

/* ---------- рефералка ---------- */
async function setRef(ctx, u, refId) {
  refId = +refId;
  if (!refId || u.invitedBy || refId === ctx.from.id) return;
  if (!u.created || Date.now() - u.created > 15 * MIN) return;        // только совсем новые люди
  if (db.orders.some(o => o.uid === ctx.from.id)) return;             // уже покупал сам
  const ref = db.users[refId];
  if (!ref) return;                                                   // пригласивший должен быть в боте
  if (ref.invitedBy === ctx.from.id) return;                          // запрет взаимной петли A↔B
  u.invitedBy = refId; u.refAt = Date.now();
  send(refId, `👥 По вашей ссылке пришёл новый человек. Как только его заказ будет выполнен — начислим ${CAT.refFirst}%.`);
}
async function payReferral(o) {
  const buyer = db.users[o.uid];
  if (!buyer || !buyer.invitedBy || o.refPaid || o.source === 'розыгрыш') return;
  const first = !db.orders.some(x => x.uid === o.uid && x.refPaid && !x.refPaid.revoked);
  const pct = first ? CAT.refFirst : CAT.refNext;
  const bonus = Math.round(o.due * pct / 100 / 10) * 10;
  if (bonus <= 0) return;
  const ref = userOf(buyer.invitedBy);
  ref.balance += bonus; ref.refEarned += bonus;
  o.refPaid = { to: buyer.invitedBy, bonus, pct };
  save();
  send(buyer.invitedBy, `💰 <b>+${money(bonus)} на баланс</b>\n\nВаш друг получил подписку — начислили ${pct}%.\n` +
    `Баланс: <b>${money(ref.balance)}</b>. Спишется автоматически со следующего заказа.`);
}
function revokeReferral(o) {
  if (!o.refPaid || o.refPaid.revoked) return;
  const r = userOf(o.refPaid.to);
  r.balance = Math.max(0, r.balance - o.refPaid.bonus);
  r.refEarned = Math.max(0, r.refEarned - o.refPaid.bonus);
  o.refPaid.revoked = true;
}
function returnBonus(o) {
  if (o.usedBonus > 0 && !o.bonusReturned) { userOf(o.uid).balance += o.usedBonus; o.bonusReturned = true; }
}

/* ═══════════════ /start ═══════════════ */
bot.start(async ctx => {
  const isLegacy = db.users[ctx.from.id] && !db.users[ctx.from.id].created;
  const u = touch(ctx);
  const payload = (ctx.startPayload || '').trim();

  const fromLink = CART_LINK.decode(payload);                        // ?start=o… — корзина с сайта или из приложения
  if (fromLink) {
    await setRef(ctx, u, fromLink.ref); save();
    if (fromLink.items.length) return createOrder(ctx, fromLink.items, 'сайт / приложение');
  }
  const m = payload.match(/^ref_(\d+)$/);
  if (m) await setRef(ctx, u, m[1]);
  if (isLegacy) { u.created = Date.now(); await ctx.reply('Обновили меню 👇', Markup.removeKeyboard()); }
  save();
  if (payload === 'profile') return screenProfile(ctx);             // кнопка «Профиль» из приложения
  if (payload === 'ask')     return screenAsk(ctx);
  if (payload === 'friends') return screenFriends(ctx);
  return ctx.replyWithHTML(hello(ctx.from.first_name), startMenu());
});
bot.command('menu',    ctx => ctx.replyWithHTML(hello(ctx.from.first_name), startMenu()));
bot.command('profile', ctx => screenProfile(ctx));
bot.command('help',    ctx => screenHelp(ctx));
bot.command('orders',  ctx => ctx.from.id === CONFIG.adminId ? adminLast(ctx) : screenProfile(ctx));

bot.action(/^scr:(profile|friends|help|ask)$/, async ctx => {
  await ctx.answerCbQuery();
  const k = ctx.match[1];
  if (k === 'profile') return screenProfile(ctx);
  if (k === 'friends') return screenFriends(ctx);
  if (k === 'help')    return screenHelp(ctx);
  return screenAsk(ctx);
});

/* ═══════════════ ЭКРАНЫ ═══════════════ */
async function screenProfile(ctx) {
  const uid = ctx.from.id, u = touch(ctx);
  const mine = db.orders.filter(o => o.uid === uid);
  const subs = [];                                                   // каждая подписка отдельно, со своим сроком
  mine.filter(o => o.status === 'активна' || (o.status === 'истекла' && Date.now() - o.endsAt < 30 * DAY))
      .forEach(o => o.items.forEach((i, idx) => { if (!i.renewed) subs.push({ o, i, idx, end: itemEnd(o, i) }); }));
  subs.sort((a, b) => a.end - b.end);
  const open = mine.filter(o => ACTIVE_STATUSES.includes(o.status));
  const rows = [];

  let t = '<b>👤 Профиль</b>\n\n';
  if (subs.length) {
    t += '<b>Подписки</b>\n' + subs.map(({ i, end }) => {
      const left = Math.ceil((end - Date.now()) / DAY);
      return `• ${esc(i.name)} — ` + (left > 0 ? `до ${fmtDate(end)} (${left} дн.)` : `закончилась ${fmtDate(end)}`);
    }).join('\n') + '\n\n';
    subs.forEach(({ o, i, idx }) => rows.push([Markup.button.callback('🔄 Продлить: ' + i.name.slice(0, 40), `renew:${o.id}:${idx}`)]));
  } else t += 'Активных подписок пока нет.\n\n';

  if (open.length) {
    t += '<b>Заказы в работе</b>\n' + open.map(o => `• №${o.id} — ${esc(o.status)}, ${money(o.due)}`).join('\n') + '\n\n';
    open.filter(o => o.status === 'ждёт оплаты').forEach(o => rows.push([Markup.button.callback(`💳 Оплатить заказ №${o.id}`, 'payfor:' + o.id)]));
  }
  t += `💰 Бонусный баланс: <b>${money(u.balance)}</b>` + (u.balance > 0 ? ' — спишется со следующего заказа' : '') + '\n';
  t += `👥 Приглашено друзей: <b>${refCount(uid)}</b>, заработано <b>${money(u.refEarned)}</b>`;

  const done = mine.filter(o => !ACTIVE_STATUSES.includes(o.status)).slice(-5).reverse();
  if (done.length) t += '\n\n<b>История</b>\n' + done.map(o => `№${o.id} · ${fmtDate(o.created)} · ${esc(o.status)} · ${money(o.due)}`).join('\n');

  rows.push([Markup.button.webApp('🛍 Открыть магазин', APP_URL)]);
  rows.push([Markup.button.callback('👥 Пригласить друзей', 'scr:friends')]);
  return ctx.replyWithHTML(t, Markup.inlineKeyboard(rows));
}

const refCount = uid => Object.values(db.users).filter(u => u.invitedBy === uid).length;

/* список приглашённых: имя, ник, когда пришёл, покупал ли и сколько принёс */
function friendsList(uid) {
  const fr = Object.entries(db.users).filter(([, f]) => f.invitedBy === uid)
    .sort((a, b) => (b[1].refAt || b[1].created || 0) - (a[1].refAt || a[1].created || 0));
  if (!fr.length) return '\n\nПока никто не пришёл по вашей ссылке.';
  const LIMIT = 30;
  const rows = fr.slice(0, LIMIT).map(([fid, f], i) => {
    const bonus = db.orders.filter(o => o.uid === +fid && o.refPaid && o.refPaid.to === uid)
                           .reduce((s, o) => s + o.refPaid.bonus, 0);
    const who = esc(f.name || 'без имени') + (f.username ? ' @' + esc(f.username) : '');
    const when = fmtDate(f.refAt || f.created);
    return `${i + 1}. ${who} · ${when} · ` + (bonus ? `✅ купил, +${money(bonus)}` : '⏳ ещё не покупал');
  });
  return '\n\n<b>Ваши друзья</b>\n' + rows.join('\n') +
    (fr.length > LIMIT ? `\n…и ещё ${fr.length - LIMIT}` : '');
}

async function screenFriends(ctx) {
  const u = touch(ctx), uid = ctx.from.id;
  const link = `https://t.me/${CAT.bot}?start=ref_${uid}`;
  return ctx.replyWithHTML(
    '<b>👥 Приводите друзей — получайте бонусы</b>\n\n' +
    `${CAT.refFirst}% с первой покупки друга и ${CAT.refNext}% со всех следующих. ` +
    'Бонус начисляется, когда заказ друга выполнен, и сам списывается с вашего следующего заказа.\n\n' +
    `<b>Ссылка на бота:</b>\n<code>${link}</code>\n\n` +
    `<b>Ссылка на сайт:</b>\n<code>${SHOP_URL}?ref=${uid}</code>\n\n` +
    `Приглашено: <b>${refCount(uid)}</b> · заработано: <b>${money(u.refEarned)}</b> · баланс: <b>${money(u.balance)}</b>` +
    friendsList(uid),
    Markup.inlineKeyboard([[Markup.button.url('📨 Отправить другу',
      'https://t.me/share/url?url=' + encodeURIComponent(link) +
      '&text=' + encodeURIComponent('Подписки на нейросети на свой аккаунт — Claude, ChatGPT и другие'))]])
  );
}

async function screenHelp(ctx) {
  return ctx.replyWithHTML(
    '<b>Как это работает</b>\n\n' +
    '1. Открываете магазин и собираете заказ\n' +
    `2. Оплачиваете: банковской картой или кошельком ЮMoney, либо USDT со скидкой ${CAT.cryptoOff}%\n` +
    '3. Присылаете данные прямо сюда, в чат: для Claude — только ID аккаунта, пароль не нужен. ' +
    'Для остальных — временный пароль, который вы меняете сразу после оформления\n' +
    '4. Обычно оформляем в течение часа. За три дня до конца срока напомним про продление\n\n' +
    '<b>Гарантия.</b> Если подписка перестала работать в оплаченный срок не по вашей вине — ' +
    'восстановим за свой счёт или вернём деньги за оставшиеся дни. ' +
    'Блокировка аккаунта самим сервисом за нарушение его правил (общий доступ, смена страны и т. п.) гарантией не покрывается.\n\n' +
    (ON_REQ.length ? '<b>Под заказ:</b> ' + ON_REQ.join(', ') + '. Нужного нет в списке — просто напишите сюда.\n\n' : '') +
    `Работаем с ${OPEN_FROM}:00 до ${OPEN_TO}:00 по Минску. Заказы ночью берём в работу утром.`,
    Markup.inlineKeyboard([
      [Markup.button.url('📄 Условия и возврат', SHOP_URL + '#/terms')],
      [Markup.button.url('📣 Канал Лавки', CHANNEL), Markup.button.url('🧑‍💻 Канал основателя', FOUNDER)],
      [Markup.button.url('🎨 Картинки и видео без подписки — LexyGPT', CONFIG.lexyRef)]
    ])
  );
}

async function screenAsk(ctx) {
  return ctx.replyWithHTML(
    '<b>Напишите сообщение прямо сюда</b> — его увидит основатель Лавки, ответ придёт в этот же чат.\n\n' +
    'Подскажем, что выбрать под задачу, посчитаем срок, оформим то, чего нет в каталоге.\n\n' +
    (isOpen() ? '🟢 Сейчас на связи.' : `🌙 Сейчас закрыто — ответим с ${OPEN_FROM}:00.`));
}

/* ═══════════════ ЗАКАЗ ═══════════════ */
const sig = items => items.map(i => i.id + ':' + i.months + ':' + i.qty).sort().join('|');

async function createOrder(ctx, rawItems, source, extra = {}) {
  const uid = ctx.from.id, u = touch(ctx);
  const items = rawItems.map(i => {
    const g = G(i.id);
    if (!g) return null;
    const months = PRICE.termsOf(g).some(t => t.months === +i.months) ? +i.months : PRICE.termsOf(g)[0].months;
    return { id: g.id, name: g.name, months, qty: Math.max(1, Math.min(9, +i.qty || 1)), price: PRICE.priceFor(g, months) };
  }).filter(Boolean);
  if (!items.length) return ctx.reply('Корзина пустая — откройте магазин и выберите подписку.');

  // повторный переход по той же ссылке не плодит заказы
  const dup = db.orders.find(o => o.uid === uid && o.status === 'ждёт оплаты' &&
                                  Date.now() - o.created < 30 * MIN && sig(o.items) === sig(items));
  if (dup) return showPayChoice(ctx, dup, true);

  const total = items.reduce((s, i) => s + i.price * i.qty, 0);
  const usedBonus = Math.min(u.balance, Math.max(0, total - 100));
  if (usedBonus > 0) u.balance -= usedBonus;
  const base = total - usedBonus;

  const o = { id: ++db.seq, uid, items, total, base, due: base, usedBonus, method: 'не выбран',
              status: 'ждёт оплаты', created: Date.now(), source, ...extra };
  db.orders.push(o); save();
  await showPayChoice(ctx, o, false);
  await notifyAdmin(o, extra.renewOf ? '🔄 Продление' : '🛍 Новый заказ');
}

function payKeyboard(o) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('💳 Банковской картой', `pay:card:${o.id}`)],
    [Markup.button.callback('👛 Кошельком ЮMoney', `pay:wallet:${o.id}`)],
    [Markup.button.callback(`₮ USDT (−${CAT.cryptoOff}%)`, `pay:crypto:${o.id}`)],
    [Markup.button.callback('✖️ Отменить заказ', `ccl:${o.id}`)]
  ]);
}
async function showPayChoice(ctx, o, isRepeat) {
  return replyPic(ctx, picOf(o),
    `<b>Заказ №${o.id}${isRepeat ? ' — уже создан' : ' принят'}</b>\n\n${itemsText(o)}` +
    (o.usedBonus > 0 ? `\n\nСписано с бонусного баланса: <b>−${money(o.usedBonus)}</b>` : '') +
    `\n\nИтого: <b>${money(o.base)}</b>\nВ USDT со скидкой: <b>${money(crypto(o.base))}</b>\n\nВыберите, чем платить:`,
    payKeyboard(o));
}

bot.action(/^payfor:(\d+)$/, async ctx => {
  const o = orderOf(ctx.match[1]);
  if (!o || o.uid !== ctx.from.id) return ctx.answerCbQuery('Заказ не найден');
  if (o.status !== 'ждёт оплаты') return ctx.answerCbQuery('Заказ уже в работе');
  await ctx.answerCbQuery();
  return showPayChoice(ctx, o, true);
});

const quickpay = (o, type) => 'https://yoomoney.ru/quickpay/confirm?' + new URLSearchParams({
  receiver: CONFIG.yoomoney, 'quickpay-form': 'button', paymentType: type, sum: String(o.due),
  label: 'lavka-' + o.id, targets: 'AKU Лавка, заказ №' + o.id,
  successURL: `https://t.me/${CAT.bot}`
}).toString();

bot.action(/^pay:(card|wallet|crypto):(\d+)$/, async ctx => {
  const method = ctx.match[1], o = orderOf(ctx.match[2]);
  if (!o || o.uid !== ctx.from.id) return ctx.answerCbQuery('Заказ не найден');
  if (o.status !== 'ждёт оплаты') return ctx.answerCbQuery('Заказ уже в работе');
  await ctx.answerCbQuery();
  o.method = method;
  o.due = method === 'crypto' ? crypto(o.base) : o.base;
  save();

  let text = `<b>Заказ №${o.id}</b> · к оплате <b>${money(o.due)}</b>\n\n`;
  const rows = [];
  if (method === 'card') {
    text += 'Оплата банковской картой через защищённую форму ЮMoney. Нажмите кнопку — сумма и номер заказа уже подставлены.';
    rows.push([Markup.button.url('💳 Оплатить картой', quickpay(o, 'AC'))]);
  } else if (method === 'wallet') {
    text += 'Оплата с кошелька ЮMoney. Нажмите кнопку или переведите вручную на кошелёк ' +
            `<code>${CONFIG.yoomoney}</code>, в комментарии укажите <b>заказ ${o.id}</b>.`;
    rows.push([Markup.button.url('👛 Оплатить из ЮMoney', quickpay(o, 'PC'))]);
  } else {
    text += `Сумма: <b>${usdt(o.due)} USDT</b>\n\n` +
      `<b>TRC-20</b> (Tron, комиссия копеечная):\n<code>${CONFIG.usdtTrc}</code>\n\n` +
      `<b>BEP-20</b> (BNB Smart Chain):\n<code>${CONFIG.usdtBep}</code>\n\n` +
      '⚠️ Сеть и адрес должны совпадать, иначе деньги не дойдут. ' +
      'Сумма должна прийти полностью — комиссию сети оплачивает отправитель.';
  }
  text += '\n\nКак оплатите — нажмите «Я оплатил». Проверим поступление и начнём оформлять.';
  rows.push([Markup.button.callback('✅ Я оплатил', 'paid:' + o.id)]);
  rows.push([Markup.button.callback('↩️ Другой способ', 'payfor:' + o.id)]);
  await ctx.replyWithHTML(text, Markup.inlineKeyboard(rows));
  await updateAdminCard(o);
});

bot.action(/^paid:(\d+)$/, async ctx => {
  const o = orderOf(ctx.match[1]);
  if (!o || o.uid !== ctx.from.id) return ctx.answerCbQuery('Заказ не найден');
  if (o.status !== 'ждёт оплаты') return ctx.answerCbQuery('Уже получили, спасибо!');
  if (o.method === 'не выбран') return ctx.answerCbQuery('Сначала выберите способ оплаты');
  o.status = 'оплата заявлена'; o.claimedAt = Date.now(); save();
  await ctx.answerCbQuery('Принято!');
  const claude = o.items.some(i => G(i.id) && G(i.id).noLogin);
  const other  = o.items.some(i => !(G(i.id) && G(i.id).noLogin));
  await ctx.replyWithHTML(
    `<b>Заказ №${o.id}</b> — спасибо! Проверим поступление и напишем сюда.\n\n` +
    '<b>Пока пришлите данные следующим сообщением:</b>\n' +
    (claude ? '• для Claude — только ID аккаунта (Settings → Account), пароль и почта не нужны\n' : '') +
    (other ? '• для остальных сервисов — почту аккаунта. Пароль попросим, когда возьмём заказ в работу, — заранее не присылайте\n' : '') +
    (o.items.some(i => i.qty > 1) ? '• несколько штук одного сервиса — это разные аккаунты: пришлите данные для каждого\n' : '') +
    '\n' + (isOpen() ? 'Обычно оформляем в течение часа.' : `Сейчас закрыто, возьмём в работу с ${OPEN_FROM}:00.`));
  await notifyAdmin(o, '💰 Клиент сообщил об оплате — проверь поступление');
});

bot.action(/^ccl:(\d+)$/, async ctx => {
  const o = orderOf(ctx.match[1]);
  if (!o || o.uid !== ctx.from.id) return ctx.answerCbQuery('Заказ не найден');
  if (o.status !== 'ждёт оплаты') return ctx.answerCbQuery('Заказ уже в работе — напишите нам');
  o.status = 'отменён'; returnBonus(o); save();
  await ctx.answerCbQuery('Заказ отменён');
  await ctx.replyWithHTML(`Заказ №${o.id} отменён.` + (o.usedBonus > 0 ? ` Бонусы ${money(o.usedBonus)} вернули на баланс.` : ''));
  await updateAdminCard(o);
});

bot.action(/^renew:(\d+)(?::(\d+))?$/, async ctx => {
  const o = orderOf(ctx.match[1]);
  if (!o || o.uid !== ctx.from.id) return ctx.answerCbQuery('Заказ не найден');
  if (!['активна', 'истекла'].includes(o.status)) return ctx.answerCbQuery('Эту подписку уже продлили');
  const idx = ctx.match[2] != null ? +ctx.match[2] : null;
  const items = (idx != null ? [o.items[idx]] : o.items).filter(i => i && !i.renewed);
  if (!items.length) return ctx.answerCbQuery('Эту подписку уже продлили');
  await ctx.answerCbQuery();
  return createOrder(ctx, items, 'продление', { renewOf: o.id });
});

/* ═══════════════ АДМИНКА ═══════════════ */
const STATUS_ICON = { 'ждёт оплаты':'⏳', 'оплата заявлена':'💰', 'оплачен':'✅', 'оформляется':'⚙️',
                      'активна':'🟢', 'отменён':'❌', 'истекла':'⚪️', 'продлена':'🔁', 'возврат':'↩️' };
const itemEnd = (o, i) => i.endsAt || o.endsAt || 0;              // у старых заказов дата одна на весь заказ
const addMonths = (from, m) => { const d = new Date(from); d.setMonth(d.getMonth() + m); return d.getTime(); };
function adminCard(o) {
  const who = db.users[o.uid] ? clientLink(o.uid) : esc(o.user || o.uid);
  return `<b>Заказ №${o.id}</b> · ${STATUS_ICON[o.status] || ''} ${esc(o.status)}\n` +
    `Клиент: ${who}\n` +
    `Создан: ${new Date(o.created).toLocaleString('ru-RU')} · ${esc(o.source || '')}\n` +
    (o.renewOf ? `Продление заказа №${o.renewOf}\n` : '') +
    `Оплата: ${METHOD_NAME[o.method] || esc(o.method)}\n\n${itemsText(o)}\n\n` +
    (o.usedBonus > 0 ? `Бонусами: −${money(o.usedBonus)}\n` : '') +
    `К оплате: <b>${money(o.due)}</b>` + (o.method === 'crypto' ? ` (${usdt(o.due)} USDT)` : '') +
    (o.method === 'card' || o.method === 'wallet' ? `\nМетка в ЮMoney: lavka-${o.id}` : '') +
    (o.endsAt ? '\nДействует до: ' + (o.items.length > 1 ? o.items.map(i => `${esc(i.name)} — ${fmtDate(itemEnd(o, i))}`).join(', ') : fmtDate(o.endsAt)) : '');
}
function adminKb(o) {
  const done = ['активна', 'отменён', 'истекла', 'продлена', 'возврат'].includes(o.status);
  const rows = done ? (['активна', 'истекла', 'продлена'].includes(o.status) && o.due > 0
    ? [[Markup.button.callback('↩️ Оформить возврат', `rf:${o.id}`)]] : []) : [
    [Markup.button.callback('💰 Оплачено', `st:${o.id}:оплачен`), Markup.button.callback('⚙️ Оформляю', `st:${o.id}:оформляется`)],
    [Markup.button.callback('✅ Готово', `st:${o.id}:активна`),  Markup.button.callback('❌ Отменить', `st:${o.id}:отменён`)]
  ];
  rows.push([Markup.button.callback('✉️ Написать клиенту', `dm:${o.uid}`)]);
  return Markup.inlineKeyboard(rows);
}
async function notifyAdmin(o, title) {
  try {
    const m = await bot.telegram.sendMessage(CONFIG.adminId, `<b>${esc(title)}</b>\n\n` + adminCard(o),
      { parse_mode: 'HTML', disable_web_page_preview: true, ...adminKb(o) });
    o.adminMsg = m.message_id; rememberRelay(m.message_id, o.uid); save();
  } catch (e) { console.error('notifyAdmin:', e.message); }
}
async function updateAdminCard(o) {
  if (!o.adminMsg) return;
  try {
    await bot.telegram.editMessageText(CONFIG.adminId, o.adminMsg, undefined, adminCard(o),
      { parse_mode: 'HTML', disable_web_page_preview: true, ...adminKb(o) });
  } catch (_) { /* не изменилось или слишком старое — не страшно */ }
}

bot.action(/^st:(\d+):(.+)$/, async ctx => {
  if (ctx.from.id !== CONFIG.adminId) return ctx.answerCbQuery('Не для вас');
  const o = orderOf(ctx.match[1]), status = ctx.match[2];
  if (!o) return ctx.answerCbQuery('Заказ не найден');
  if (['отменён', 'активна', 'истекла', 'продлена', 'возврат'].includes(o.status)) return ctx.answerCbQuery('Заказ уже закрыт');
  if (o.status === status) return ctx.answerCbQuery('Уже стоит этот статус');

  o.status = status; o['at_' + status] = Date.now();
  if (status === 'отменён') { returnBonus(o); revokeReferral(o); }
  if (status === 'активна') {
    o.cost = sumBy(o.items, costOf);                                 // фиксируем закупку на момент выполнения
    const prev = o.renewOf ? orderOf(o.renewOf) : null;
    for (const i of o.items) {                                       // у каждой подписки свой срок
      const pi = prev ? prev.items.find(x => x.id === i.id && !x.renewed) : null;
      const from = Math.max(Date.now(), pi ? itemEnd(prev, pi) : 0); // продление не съедает оставшиеся дни
      i.endsAt = addMonths(from, i.months);
      if (pi) pi.renewed = true;
    }
    o.endsAt = Math.max(...o.items.map(i => i.endsAt));
    if (prev && ['активна', 'истекла'].includes(prev.status) && prev.items.every(x => x.renewed)) prev.status = 'продлена';
  }
  save();
  await ctx.answerCbQuery('Статус: ' + status);
  try { await ctx.editMessageText(adminCard(o), { parse_mode: 'HTML', disable_web_page_preview: true, ...adminKb(o) }); } catch (_) {}
  if (status === 'активна') await payReferral(o);

  const note = {
    'оплачен':     'Оплата получена. Берём в работу — если для оформления что-то понадобится, напишем сюда.',
    'оформляется': 'Оформляем прямо сейчас. Будьте, пожалуйста, на связи — может понадобиться код подтверждения.',
    'активна':     'Готово! ' + (o.items.length > 1
                     ? 'Подписки активны:\n' + o.items.map(i => `• ${esc(i.name)} — до <b>${fmtDate(i.endsAt)}</b>`).join('\n') + '\n\n'
                     : `Подписка активна до <b>${fmtDate(o.endsAt)}</b>.\n\n`) +
                   'Если передавали пароль — смените его прямо сейчас и выйдите со всех устройств. ' +
                   'Не меняйте страну в настройках аккаунта и не делитесь им с другими — так сервисы не блокируют.\n\n' +
                   'За три дня до конца напомним про продление. Всё ваши подписки — в разделе «Профиль».',
    'отменён':     'Заказ отменён.' + (o.usedBonus > 0 ? ` Бонусы ${money(o.usedBonus)} вернули на баланс.` : '') +
                   ' Если оплата уже прошла — вернём её тем же способом, напишите сюда.'
  }[status];
  if (note) (status === 'активна' ? sendPic : (id, _p, t, e) => send(id, t, e))(o.uid, picOf(o), `<b>Заказ №${o.id}</b>\n\n${note}`,
    status === 'активна' ? Markup.inlineKeyboard([[Markup.button.callback('👤 Профиль', 'scr:profile')]]) : {});
});

bot.action(/^rf:(\d+)$/, async ctx => {
  if (ctx.from.id !== CONFIG.adminId) return ctx.answerCbQuery('Не для вас');
  const o = orderOf(ctx.match[1]);
  if (!o || o.status === 'возврат') return ctx.answerCbQuery('Уже оформлен');
  await ctx.answerCbQuery();
  return ctx.reply(`Точно оформить возврат по заказу №${o.id} на ${money(o.due)}? Бонус пригласившего спишется, заказ уйдёт из выручки.`,
    Markup.inlineKeyboard([[Markup.button.callback('✅ Да, возврат', `rfok:${o.id}`), Markup.button.callback('Нет', 'adm:noop')]]));
});
bot.action(/^rfok:(\d+)$/, async ctx => {
  if (ctx.from.id !== CONFIG.adminId) return ctx.answerCbQuery('Не для вас');
  const o = orderOf(ctx.match[1]);
  if (!o || o.status === 'возврат') return ctx.answerCbQuery('Уже оформлен');
  o.status = 'возврат'; o.at_возврат = Date.now(); revokeReferral(o); returnBonus(o); save();
  await ctx.answerCbQuery('Возврат оформлен');
  try { await ctx.editMessageText(`↩️ Возврат по заказу №${o.id} оформлен. Не забудь вернуть ${money(o.due)} клиенту тем же способом.`); } catch (_) {}
  await updateAdminCard(o);
  send(o.uid, `<b>Заказ №${o.id}</b>\n\nОформили возврат. Деньги вернём тем же способом, которым вы платили.` +
    (o.usedBonus > 0 ? ` Бонусы ${money(o.usedBonus)} вернули на баланс.` : ''));
});

bot.action(/^dm:(\d+)$/, async ctx => {
  if (ctx.from.id !== CONFIG.adminId) return ctx.answerCbQuery('Не для вас');
  await ctx.answerCbQuery();
  const uid = +ctx.match[1];
  const m = await ctx.replyWithHTML(`✍️ Ответьте <b>реплаем на это сообщение</b> — перешлю клиенту ${clientLink(uid)}`);
  rememberRelay(m.message_id, uid); save();
});

/* ---------- команды админа ---------- */
/* ═══════════════ ПАНЕЛЬ АДМИНА (/admin) ═══════════════
   Всё в одном сообщении: кнопки переключают экраны, сообщение обновляется на месте. */
const isAdmin = ctx => ctx.from && ctx.from.id === CONFIG.adminId;
const sumBy  = (arr, f) => arr.reduce((s, x) => s + (f(x) || 0), 0);
const pct    = (a, b) => b ? Math.round(a / b * 100) + '%' : '—';
const dayStart = (offsetDays = 0) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - offsetDays); return d.getTime(); };
const monthStart = (back = 0) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(1); d.setMonth(d.getMonth() - back); return d.getTime(); };
const MONTHS = ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'];
const bar = (v, max, w = 10) => max ? '▇'.repeat(Math.round(v / max * w)) || (v ? '▏' : '') : '';
const nick = uid => { const u = db.users[uid] || {}; return esc(u.name || 'без имени') + (u.username ? ' @' + esc(u.username) : ''); };

/* себестоимость: что ты платишь поставщику за 1 месяц товара.
   Пока не задана командой /cost — считается примерно из каталога. */
function costOf(item) {
  const g = CAT.goods.find(x => x.id === item.id);
  const set = db.costs[item.id];
  let perMonth;
  if (set != null) perMonth = set;
  else if (g && g.usd) perMonth = g.usd * CAT.rate;
  else perMonth = Math.round(item.price / (CAT.markup || 1.46) / item.months);
  return Math.round(perMonth * item.months * item.qty);
}
const orderCost   = o => o.cost != null ? o.cost : sumBy(o.items, costOf);
const isPaid      = o => PAID_STATUSES.includes(o.status) && o.source !== 'розыгрыш';
const paidAt      = o => o.at_оплачен || o.at_оформляется || o.at_активна || o.claimedAt || o.created;
const paidBetween = (from, to = Infinity) => db.orders.filter(o => isPaid(o) && paidAt(o) >= from && paidAt(o) < to);
const expBetween  = (from, to = Infinity) => db.expenses.filter(e => e.at >= from && e.at < to);

function money3(os) {                        // выручка, себестоимость, прибыль
  const rev = sumBy(os, o => o.due), cost = sumBy(os, orderCost);
  return { rev, cost, gross: rev - cost, n: os.length };
}

/* ---------- экраны ---------- */
const back = [Markup.button.callback('◀️ В панель', 'adm:home')];

function scrHome() {
  const t0 = dayStart(), now = Date.now();
  const today = money3(paidBetween(t0)), month = money3(paidBetween(monthStart()));
  const exp = sumBy(expBetween(monthStart()), e => e.sum);
  const waiting = db.orders.filter(o => ['оплата заявлена', 'оплачен', 'оформляется'].includes(o.status));
  const unpaid  = db.orders.filter(o => o.status === 'ждёт оплаты');
  const active  = db.orders.filter(o => o.status === 'активна');
  const soon    = active.filter(o => o.endsAt - now < 3 * DAY);
  const users   = Object.values(db.users);
  const text =
    `<b>🛠 Панель AKU Лавки</b> · ${new Date().toLocaleString('ru-RU', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })}\n\n` +
    `<b>Сегодня</b>\n💰 ${money(today.rev)} · заказов оплачено: ${today.n} · прибыль ≈ ${money(today.gross)}\n` +
    `👤 новых пользователей: ${users.filter(u => u.created >= t0).length}\n\n` +
    `<b>${MONTHS[new Date().getMonth()]}</b>\n💰 ${money(month.rev)} · прибыль ≈ ${money(month.gross - exp)}` + (exp ? ` (с учётом расходов ${money(exp)})` : '') + '\n\n' +
    `<b>Сейчас</b>\n` +
    `🔥 ждут тебя: <b>${waiting.length}</b>` + (waiting.length ? ' — ' + waiting.slice(0, 5).map(o => '/o' + o.id).join(' ') : '') + '\n' +
    `⏳ не оплачены: ${unpaid.length}\n` +
    `🟢 активных подписок: ${active.length}` + (soon.length ? ` · кончаются в 3 дня: ${soon.length}` : '') + '\n' +
    `👥 всего пользователей: ${users.length}`;
  const kb = Markup.inlineKeyboard([
    [Markup.button.callback('📊 Статистика', 'adm:stats'), Markup.button.callback('💰 Доход', 'adm:money')],
    [Markup.button.callback('🔥 Ждут меня', 'adm:orders:wait:0'), Markup.button.callback('📦 Все заказы', 'adm:orders:all:0')],
    [Markup.button.callback('👥 Клиенты', 'adm:users'), Markup.button.callback('🤝 Рефералы', 'adm:refs')],
    [Markup.button.callback('🛍 Товары', 'adm:goods'), Markup.button.callback('🔁 Продления', 'adm:renew')],
    [Markup.button.callback('💸 Расходы', 'adm:exp'), Markup.button.callback('📣 Рассылка', 'adm:bc')],
    [Markup.button.callback('💾 Бэкап', 'adm:backup'), Markup.button.callback('🔄 Обновить', 'adm:home')]
  ]);
  return [text, kb];
}

function scrStats() {
  const users = Object.values(db.users), uids = Object.keys(db.users).map(Number);
  const row = (name, from, to = Infinity) => {
    const nu = users.filter(u => u.created >= from && u.created < to).length;
    const os = db.orders.filter(o => o.created >= from && o.created < to && o.source !== 'розыгрыш');
    const paid = os.filter(isPaid), m = money3(paid);
    return `<b>${name}</b>\n👤 +${nu} · 🧾 заказов ${os.length} · ✅ оплачено ${paid.length} (${pct(paid.length, os.length)})\n` +
           `💰 ${money(m.rev)}` + (paid.length ? ` · средний чек ${money(Math.round(m.rev / paid.length))}` : '') + '\n';
  };
  // воронка: зашёл в бота → создал заказ → оплатил → купил повторно
  const ordered = new Set(db.orders.filter(o => o.source !== 'розыгрыш').map(o => o.uid));
  const payers = {}; db.orders.filter(isPaid).forEach(o => { payers[o.uid] = (payers[o.uid] || 0) + 1; });
  const nPay = Object.keys(payers).length, nRepeat = Object.values(payers).filter(n => n > 1).length;
  const paidAll = db.orders.filter(isPaid);
  const by = (key, names) => { const m = {}; paidAll.forEach(o => { const k = names ? (names[o[key]] || o[key]) : o[key]; m[k] = (m[k] || 0) + 1; });
    return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${esc(k || '—')} ${v}`).join(' · ') || '—'; };
  const active7 = users.filter(u => u.seen >= Date.now() - 7 * DAY).length;
  const text = '<b>📊 Статистика</b>\n\n' +
    row('Сегодня', dayStart()) + '\n' + row('Вчера', dayStart(1), dayStart()) + '\n' +
    row('7 дней', dayStart(6)) + '\n' + row('30 дней', dayStart(29)) + '\n' + row('Всё время', 0) + '\n' +
    `<b>Воронка</b>\nзапустили бота ${uids.length} → сделали заказ ${ordered.size} (${pct(ordered.size, uids.length)}) → ` +
    `оплатили ${nPay} (${pct(nPay, ordered.size)}) → купили ещё раз ${nRepeat} (${pct(nRepeat, nPay)})\n\n` +
    `<b>Откуда заказы:</b> ${by('source')}\n<b>Чем платят:</b> ${by('method', { card:'карта', wallet:'ЮMoney', crypto:'USDT' })}\n` +
    `<b>Заходили за 7 дней:</b> ${active7} чел.`;
  return [text, Markup.inlineKeyboard([back])];
}

function scrMoney() {
  // 14 дней столбиками
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const m = money3(paidBetween(dayStart(i), dayStart(i - 1)));
    const d = new Date(dayStart(i));
    days.push({ label: String(d.getDate()).padStart(2, '0') + '.' + String(d.getMonth() + 1).padStart(2, '0'), ...m });
  }
  const maxD = Math.max(...days.map(d => d.rev));
  // 6 месяцев
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const from = monthStart(i), to = i ? monthStart(i - 1) : Infinity;
    const m = money3(paidBetween(from, to)), exp = sumBy(expBetween(from, to), e => e.sum);
    months.push({ label: MONTHS[new Date(from).getMonth()], ...m, exp, net: m.gross - exp });
  }
  const all = money3(paidBetween(0)), expAll = sumBy(db.expenses, e => e.sum);
  const usd = r => '$' + Math.round(r / CAT.rate);
  const text = '<b>💰 Доход</b>\n\n<b>По дням (выручка)</b>\n<code>' +
    days.map(d => `${d.label} ${bar(d.rev, maxD).padEnd(10, ' ')} ${d.rev ? money(d.rev) : '·'}`).join('\n') + '</code>\n\n' +
    '<b>По месяцам</b>\n' + months.filter(m => m.n || m.exp).map(m =>
      `<b>${m.label}</b>: выручка ${money(m.rev)} · закупка ≈ ${money(m.cost)} · расходы ${money(m.exp)} → <b>${money(m.net)}</b> (${usd(m.net)})`).join('\n') +
    (months.some(m => m.n || m.exp) ? '' : 'пока пусто') + '\n\n' +
    `<b>За всё время</b>\nвыручка ${money(all.rev)} · закупка ≈ ${money(all.cost)} · расходы ${money(expAll)}\n` +
    `чистыми ≈ <b>${money(all.gross - expAll)}</b> (${usd(all.gross - expAll)})\n\n` +
    `<i>Цель $1000/мес = ${money(1000 * CAT.rate)} чистыми. В этом месяце: ${pct(Math.max(0, months[5].net), 1000 * CAT.rate)}</i>\n\n` +
    '<i>«≈» — закупка считается по себестоимости. Точные цены поставщика задай: /cost claude 1150 (за 1 месяц)</i>';
  return [text, Markup.inlineKeyboard([[Markup.button.callback('🧮 Себестоимость', 'adm:costs')], back])];
}

function scrCosts() {
  const text = '<b>🧮 Себестоимость за 1 месяц</b>\n\n' + GOODS.map(g => {
    const set = db.costs[g.id] != null;
    const t = PRICE.termsOf(g)[0];
    const c = costOf({ id: g.id, months: 1, qty: 1, price: PRICE.priceFor(g, t.months) / t.months });
    const p = Math.round(PRICE.priceFor(g, t.months) / t.months);
    return `${set ? '✅' : '≈'} <b>${esc(g.name)}</b> (<code>${g.id}</code>): ${money(c)} → продаём ${money(p)}, маржа ${pct(p - c, p)}`;
  }).join('\n') +
  '\n\n✅ — задано тобой, ≈ — примерно.\nЗадать: <code>/cost gpt 1400</code>\nСбросить: <code>/cost gpt -</code>';
  return [text, Markup.inlineKeyboard([[Markup.button.callback('◀️ Доход', 'adm:money')], back])];
}

const ORDER_FILTERS = {
  wait:   { name: '🔥 Ждут меня', f: o => ['оплата заявлена', 'оплачен', 'оформляется'].includes(o.status) },
  unpaid: { name: '⏳ Не оплачены', f: o => o.status === 'ждёт оплаты' },
  active: { name: '🟢 Активные', f: o => o.status === 'активна' },
  closed: { name: '❌ Отменённые', f: o => o.status === 'отменён' },
  all:    { name: '📦 Все', f: () => true }
};
function scrOrders(filter, page) {
  const F = ORDER_FILTERS[filter] || ORDER_FILTERS.all, PER = 10;
  const list = db.orders.filter(F.f).slice().reverse();
  const pages = Math.max(1, Math.ceil(list.length / PER)); page = Math.min(Math.max(0, page), pages - 1);
  const part = list.slice(page * PER, page * PER + PER);
  const text = `<b>${F.name}</b> · ${list.length} шт.\n\n` + (part.map(o =>
    `${STATUS_ICON[o.status] || ''} /o${o.id} · ${money(o.due)} · ${fmtDate(o.created)}\n   ${nick(o.uid)} · ${o.items.map(i => esc(i.name)).join(', ')}` +
    (o.endsAt && o.status === 'активна' ? ` · до ${fmtDate(o.endsAt)}` : '')).join('\n') || 'пусто') +
    '\n\n<i>Нажми /o1001 — откроется карточка с кнопками</i>';
  const tabs = Object.keys(ORDER_FILTERS).map(k => Markup.button.callback((k === filter ? '• ' : '') + ORDER_FILTERS[k].name.split(' ')[0], `adm:orders:${k}:0`));
  const nav = [];
  if (page > 0) nav.push(Markup.button.callback('← Назад', `adm:orders:${filter}:${page - 1}`));
  if (pages > 1) nav.push(Markup.button.callback(`${page + 1}/${pages}`, 'adm:noop'));
  if (page < pages - 1) nav.push(Markup.button.callback('Дальше →', `adm:orders:${filter}:${page + 1}`));
  return [text, Markup.inlineKeyboard([tabs, ...(nav.length ? [nav] : []), back])];
}

function clientStats() {
  const m = {};
  db.orders.filter(isPaid).forEach(o => { const x = m[o.uid] = m[o.uid] || { n: 0, sum: 0, last: 0 }; x.n++; x.sum += o.due; x.last = Math.max(x.last, o.created); });
  return m;
}
function scrUsers() {
  const users = Object.values(db.users), cs = clientStats(), buyers = Object.keys(cs);
  const ltv = buyers.length ? Math.round(sumBy(Object.values(cs), x => x.sum) / buyers.length) : 0;
  const top = Object.entries(cs).sort((a, b) => b[1].sum - a[1].sum).slice(0, 10);
  const fresh = Object.entries(db.users).sort((a, b) => (b[1].created || 0) - (a[1].created || 0)).slice(0, 10);
  const text = '<b>👥 Клиенты</b>\n\n' +
    `Всего в боте: <b>${users.length}</b>\nновых: сегодня ${users.filter(u => u.created >= dayStart()).length} · 7 дн. ${users.filter(u => u.created >= dayStart(6)).length} · 30 дн. ${users.filter(u => u.created >= dayStart(29)).length}\n` +
    `Покупали: <b>${buyers.length}</b> · больше одного раза: ${Object.values(cs).filter(x => x.n > 1).length}\n` +
    `Средний клиент принёс: ${money(ltv)}\n` +
    `Пришли по рефералке: ${users.filter(u => u.invitedBy).length}\n\n` +
    '<b>Топ по сумме</b>\n' + (top.map(([uid, x], i) => `${i + 1}. ${nick(uid)} — ${money(x.sum)}, заказов ${x.n} · /u${uid}`).join('\n') || 'пока нет') + '\n\n' +
    '<b>Последние пришедшие</b>\n' + fresh.map(([uid, u]) => `${nick(uid)} · ${u.created ? fmtDate(u.created) : '—'}` +
      (cs[uid] ? ' · ✅ ' + money(cs[uid].sum) : '') + ` · /u${uid}`).join('\n') +
    '\n\n<i>Карточка клиента: /u 123456789 или /u @ник</i>';
  return [text, Markup.inlineKeyboard([back])];
}

function userCard(uid) {
  const u = db.users[uid]; if (!u) return null;
  const os = db.orders.filter(o => o.uid === uid);
  const paid = os.filter(isPaid);
  const refs = Object.entries(db.users).filter(([, f]) => f.invitedBy === uid);
  const text = `<b>👤 ${clientLink(uid)}</b>\n\n` +
    `В боте с ${u.created ? fmtDate(u.created) : '—'}, последний раз ${u.seen ? new Date(u.seen).toLocaleString('ru-RU') : '—'}\n` +
    (u.invitedBy ? `Пригласил: ${nick(u.invitedBy)} · /u${u.invitedBy}\n` : '') +
    `Заказов: ${os.length}, оплачено ${paid.length} на <b>${money(sumBy(paid, o => o.due))}</b>\n` +
    `Бонусный баланс: ${money(u.balance)} · заработал на друзьях: ${money(u.refEarned)} · привёл: ${refs.length}\n\n` +
    (os.slice(-10).reverse().map(o => `${STATUS_ICON[o.status] || ''} /o${o.id} · ${money(o.due)} · ${o.items.map(i => esc(i.name)).join(', ')}`).join('\n') || 'Заказов нет');
  return [text, Markup.inlineKeyboard([[Markup.button.callback('✉️ Написать', `dm:${uid}`)], back])];
}

function scrRefs() {
  const m = {};
  Object.entries(db.users).forEach(([uid, u]) => { if (u.invitedBy) { const x = m[u.invitedBy] = m[u.invitedBy] || { n: 0, buy: 0 }; x.n++; if (db.orders.some(o => o.uid === +uid && isPaid(o))) x.buy++; } });
  const top = Object.entries(m).sort((a, b) => b[1].n - a[1].n).slice(0, 15);
  const paidOut = sumBy(Object.values(db.users), u => u.refEarned);
  const onBal = sumBy(Object.values(db.users), u => u.balance);
  const refRev = sumBy(db.orders.filter(o => isPaid(o) && db.users[o.uid] && db.users[o.uid].invitedBy), o => o.due);
  const text = '<b>🤝 Рефералы</b>\n\n' +
    `Пришли по ссылкам: <b>${sumBy(Object.values(m), x => x.n)}</b>, из них купили ${sumBy(Object.values(m), x => x.buy)}\n` +
    `Выручка с приглашённых: ${money(refRev)}\nНачислено бонусов: ${money(paidOut)} · ещё на балансах: ${money(onBal)}\n\n` +
    '<b>Кто приводит</b>\n' + (top.map(([uid, x], i) => `${i + 1}. ${nick(uid)} — привёл ${x.n}, купили ${x.buy}, заработал ${money((db.users[uid] || {}).refEarned || 0)} · /u${uid}`).join('\n') || 'пока никого');
  return [text, Markup.inlineKeyboard([back])];
}

function scrGoods() {
  const m = {};
  db.orders.filter(isPaid).forEach(o => o.items.forEach(i => {
    const x = m[i.name] = m[i.name] || { q: 0, rev: 0, cost: 0, terms: {} };
    const share = o.total ? o.due / o.total : 1;           // скидки и бонусы делим пропорционально
    x.q += i.qty; x.rev += Math.round(i.price * i.qty * share); x.cost += costOf(i);
    x.terms[i.months] = (x.terms[i.months] || 0) + i.qty;
  }));
  const rows = Object.entries(m).sort((a, b) => b[1].rev - a[1].rev);
  const total = sumBy(rows, r => r[1].rev);
  const viewsLine = GOODS.filter(g => !m[g.name]).map(g => esc(g.name)).join(', ');
  const text = '<b>🛍 Товары</b>\n\n' + (rows.map(([n, x]) =>
    `<b>${esc(n)}</b> — ${x.q} шт. · ${money(x.rev)} (${pct(x.rev, total)}) · прибыль ≈ ${money(x.rev - x.cost)}\n   сроки: ${Object.entries(x.terms).map(([k, v]) => k + ' мес × ' + v).join(', ')}`).join('\n') || 'Продаж пока нет') +
    (viewsLine ? `\n\n<b>Ещё не продавались:</b> ${viewsLine}` : '');
  return [text, Markup.inlineKeyboard([back])];
}

function scrRenew() {
  const now = Date.now();
  const soon = db.orders.filter(o => o.status === 'активна' && o.endsAt - now < 7 * DAY).sort((a, b) => a.endsAt - b.endsAt);
  const ended = db.orders.filter(o => ['истекла', 'продлена'].includes(o.status));
  const renewed = ended.filter(o => o.status === 'продлена').length;
  const lost = db.orders.filter(o => o.status === 'истекла' && o.endsAt > now - 30 * DAY);
  const text = '<b>🔁 Продления</b>\n\n' +
    `Продлевают: <b>${pct(renewed, ended.length)}</b> (${renewed} из ${ended.length} закончившихся)\n\n` +
    '<b>Кончаются в 7 дней</b>\n' + (soon.map(o => `/o${o.id} · ${nick(o.uid)} · ${o.items.map(i => esc(i.name)).join(', ')} · до ${fmtDate(o.endsAt)}${o.reminded ? ' · напомнили' : ''}`).join('\n') || 'нет') + '\n\n' +
    '<b>Не продлили за 30 дней</b> — можно написать лично\n' + (lost.map(o => `/o${o.id} · ${nick(o.uid)} · ${o.items.map(i => esc(i.name)).join(', ')}`).join('\n') || 'нет');
  return [text, Markup.inlineKeyboard([back])];
}

function scrExp() {
  const list = expBetween(monthStart()).slice().reverse();
  const text = `<b>💸 Расходы — ${MONTHS[new Date().getMonth()]}</b>\n\n` +
    (list.map(e => `${fmtDate(e.at)} · ${money(e.sum)} · ${esc(e.note)}`).join('\n') || 'В этом месяце пусто') +
    `\n\nИтого за месяц: <b>${money(sumBy(list, e => e.sum))}</b>\n\n` +
    'Добавить: <code>/spend 900 сервер</code>\nУдалить последнюю: <code>/spend -</code>\n\n' +
    '<i>Закупку у поставщика сюда не пиши — она считается сама по себестоимости. Сюда: сервер, подписка Claude, реклама, розыгрыши, налог.</i>';
  return [text, Markup.inlineKeyboard([back])];
}

/* ---------- рассылка ---------- */
let bcDraft = null;          // { mode: 'wait' } или { mode: 'ready', chatId, msgId, seg }
const BC_SEG = {
  all:    { name: 'всем',          f: () => true },
  buyers: { name: 'покупателям',   f: uid => db.orders.some(o => o.uid === uid && isPaid(o)) },
  never:  { name: 'кто не покупал', f: uid => !db.orders.some(o => o.uid === uid && isPaid(o)) }
};
const bcCount = seg => Object.keys(db.users).map(Number).filter(uid => uid !== CONFIG.adminId && !db.users[uid].blocked && BC_SEG[seg].f(uid)).length;
function scrBc() {
  bcDraft = { mode: 'wait' };
  return ['<b>📣 Рассылка</b>\n\nПришли следующим сообщением то, что нужно разослать: текст, фото с подписью или видео. ' +
    'Я покажу превью и спрошу, кому отправить.\n\n<i>Не чаще раза-двух в неделю — иначе люди блокируют бота.</i>',
    Markup.inlineKeyboard([[Markup.button.callback('✖️ Отмена', 'adm:bccancel')]])];
}
async function bcPreview(ctx) {
  bcDraft = { mode: 'ready', chatId: ctx.chat.id, msgId: ctx.message.message_id };
  await ctx.reply('👆 Так увидят люди. Кому отправить?', Markup.inlineKeyboard([
    ...Object.keys(BC_SEG).map(k => [Markup.button.callback(`📣 ${BC_SEG[k].name} (${bcCount(k)})`, 'adm:bcgo:' + k)]),
    [Markup.button.callback('✖️ Отмена', 'adm:bccancel')]]));
}
async function bcRun(ctx, seg) {
  const d = bcDraft; bcDraft = null;
  if (!d || d.mode !== 'ready') return ctx.reply('Черновик потерялся — начни заново: /admin → Рассылка');
  const ids = Object.keys(db.users).map(Number).filter(uid => uid !== CONFIG.adminId && !db.users[uid].blocked && BC_SEG[seg].f(uid));
  await ctx.reply(`Отправляю ${ids.length} людям…`);
  let ok = 0, fail = 0;
  for (const uid of ids) {
    try { await bot.telegram.copyMessage(uid, d.chatId, d.msgId); ok++; }
    catch (e) { fail++; if (/blocked|deactivated|not found/i.test(e.message)) db.users[uid].blocked = true; }
    await new Promise(r => setTimeout(r, 60));               // лимит Telegram ~30 сообщений в секунду
  }
  db.broadcasts.push({ at: Date.now(), seg, ok, fail }); save();
  return ctx.reply(`✅ Рассылка готова: доставлено ${ok}` + (fail ? `, не дошло ${fail} (заблокировали бота)` : ''));
}

/* ---------- маршрутизация ---------- */
const SCREENS = { home: scrHome, stats: scrStats, money: scrMoney, costs: scrCosts, users: scrUsers,
                  refs: scrRefs, goods: scrGoods, renew: scrRenew, exp: scrExp, bc: scrBc };
async function show(ctx, [text, kb]) {
  const extra = { parse_mode: 'HTML', disable_web_page_preview: true, ...kb };
  if (ctx.callbackQuery) {
    try { return await ctx.editMessageText(text, extra); }
    catch (e) { if (/not modified/.test(e.message)) return; }
  }
  return ctx.reply(text, extra);
}

bot.command('admin', ctx => isAdmin(ctx) && show(ctx, scrHome()));
bot.command('stats', ctx => isAdmin(ctx) && show(ctx, scrStats()));
bot.command('money', ctx => isAdmin(ctx) && show(ctx, scrMoney()));

bot.action(/^adm:(.+)$/, async ctx => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('Не для вас');
  const [k, a, b] = ctx.match[1].split(':');
  if (k === 'noop') return ctx.answerCbQuery();
  if (k === 'backup') { await ctx.answerCbQuery('Отправляю'); return sendBackup('по запросу'); }
  if (k === 'bccancel') { bcDraft = null; await ctx.answerCbQuery('Отменено'); return show(ctx, scrHome()); }
  if (k === 'bcgo') { await ctx.answerCbQuery(); try { await ctx.editMessageReplyMarkup(undefined); } catch (_) {} return bcRun(ctx, a); }
  await ctx.answerCbQuery();
  if (k === 'orders') return show(ctx, scrOrders(a, +b || 0));
  if (SCREENS[k]) return show(ctx, SCREENS[k]());
});

bot.hears(/^\/u_?(\d+)$/, ctx => {
  if (!isAdmin(ctx)) return;
  const c = userCard(+ctx.match[1]); return c ? show(ctx, c) : ctx.reply('Нет такого пользователя');
});
bot.command('u', ctx => {
  if (!isAdmin(ctx)) return;
  const q = (ctx.message.text.split(/\s+/)[1] || '').replace('@', '').toLowerCase();
  if (!q) return ctx.reply('Напиши так: /u 123456789 или /u @ник');
  const uid = /^\d+$/.test(q) ? +q : +(Object.entries(db.users).find(([, u]) => (u.username || '').toLowerCase() === q) || [])[0];
  const c = uid && userCard(uid); return c ? show(ctx, c) : ctx.reply('Не нашёл. Человек должен хотя бы раз запустить бота.');
});

bot.command('cost', ctx => {
  if (!isAdmin(ctx)) return;
  const [, id, val] = ctx.message.text.split(/\s+/);
  if (!id || !CAT.goods.some(g => g.id === id)) return show(ctx, scrCosts());
  if (val === '-') delete db.costs[id];
  else { const n = Math.round(+String(val).replace(',', '.')); if (!(n >= 0)) return ctx.reply('Напиши так: /cost claude 1150'); db.costs[id] = n; }
  save(); return show(ctx, scrCosts());
});

/* ручной заказ: приз розыгрыша или оплата мимо бота
   /neworder @ник claude          — оплачен, 1 месяц
   /neworder 123456789 gpt 1 приз — приз розыгрыша, сумма 0 */
bot.command('neworder', async ctx => {
  if (!isAdmin(ctx)) return;
  const [, who, gid, m, kind] = ctx.message.text.split(/\s+/);
  const q = (who || '').replace('@', '').toLowerCase();
  const uid = /^\d+$/.test(q) ? +q : +(Object.entries(db.users).find(([, u]) => (u.username || '').toLowerCase() === q) || [])[0];
  const g = G(gid || '');
  if (!uid || !db.users[uid] || !g) return ctx.replyWithHTML(
    'Напиши так:\n<code>/neworder @ник claude</code> — заказ оплачен мимо бота\n<code>/neworder @ник gpt 1 приз</code> — приз розыгрыша (сумма 0)\n\n' +
    'Человек должен хотя бы раз запустить бота. Товары: ' + GOODS.map(x => '<code>' + x.id + '</code>').join(', '));
  const months = PRICE.termsOf(g).some(t => t.months === +m) ? +m : PRICE.termsOf(g)[0].months;
  const prize = /приз|розыгр/i.test(kind || m || '');
  const price = PRICE.priceFor(g, months);
  const o = { id: ++db.seq, uid, items: [{ id: g.id, name: g.name, months, qty: 1, price }], total: price,
              base: prize ? 0 : price, due: prize ? 0 : price, usedBonus: 0, method: prize ? 'приз' : 'вручную',
              status: 'оплачен', at_оплачен: Date.now(), created: Date.now(), source: prize ? 'розыгрыш' : 'вручную' };
  db.orders.push(o); save();
  await notifyAdmin(o, prize ? '🎁 Приз розыгрыша' : '✍️ Ручной заказ');
  send(uid, prize
    ? `🎉 <b>Вы выиграли ${esc(g.name)}!</b>\n\nЗаказ №${o.id}. Пришлите сюда данные аккаунта — ` + (g.noLogin ? 'для Claude только ID аккаунта (Settings → Account).' : 'почту аккаунта, пароль попросим позже.')
    : `<b>Заказ №${o.id}</b> — ${esc(g.name)}, оплата получена. Пришлите сюда данные аккаунта — ` + (g.noLogin ? 'для Claude только ID аккаунта.' : 'почту аккаунта.'));
});

bot.command('spend', ctx => {
  if (!isAdmin(ctx)) return;
  const parts = ctx.message.text.split(/\s+/).slice(1);
  if (parts[0] === '-') { const e = db.expenses.pop(); save(); return ctx.replyWithHTML(e ? `Удалил: ${money(e.sum)} · ${esc(e.note)}` : 'Нечего удалять'); }
  const sum = Math.round(+String(parts[0] || '').replace(',', '.'));
  if (!(sum > 0)) return show(ctx, scrExp());
  db.expenses.push({ at: Date.now(), sum, note: parts.slice(1).join(' ') || 'без описания' }); save();
  return show(ctx, scrExp());
});

bot.command('pending', ctx => {
  if (!isAdmin(ctx)) return;
  const list = db.orders.filter(o => ACTIVE_STATUSES.includes(o.status));
  if (!list.length) return ctx.reply('Ничего не ждёт. 👌');
  const order = { 'оплата заявлена': 0, 'оплачен': 1, 'оформляется': 2, 'ждёт оплаты': 3 };
  list.sort((a, b) => order[a.status] - order[b.status] || a.created - b.created);
  return ctx.replyWithHTML('<b>Ждут тебя</b>\n\n' + list.map(o =>
    `${STATUS_ICON[o.status]} /o${o.id} · ${esc(o.status)} · ${money(o.due)}\n` +
    `   ${o.items.map(i => esc(i.name)).join(', ')} · ${Math.round((Date.now() - (o.claimedAt || o.created)) / MIN)} мин назад`).join('\n'));
});

bot.hears(/^\/o_?(\d+)/, async ctx => {
  if (!isAdmin(ctx)) return;
  const o = orderOf(ctx.match[1]);
  if (!o) return ctx.reply('Нет такого заказа');
  const m = await ctx.replyWithHTML(adminCard(o), adminKb(o));
  o.adminMsg = m.message_id; rememberRelay(m.message_id, o.uid); save();
});
bot.command('o', async ctx => {
  if (!isAdmin(ctx)) return;
  const id = (ctx.message.text.split(/\s+/)[1] || '').replace(/\D/g, '');
  const o = orderOf(id);
  if (!o) return ctx.reply('Напиши так: /o 1001');
  const m = await ctx.replyWithHTML(adminCard(o), adminKb(o));
  o.adminMsg = m.message_id; rememberRelay(m.message_id, o.uid); save();
});

function adminLast(ctx) {
  const last = db.orders.slice(-10).reverse();
  if (!last.length) return ctx.reply('Заказов пока нет.');
  return ctx.replyWithHTML('<b>Последние заказы</b>\n\n' + last.map(o =>
    `${STATUS_ICON[o.status] || ''} /o${o.id} · ${money(o.due)} · ${esc(o.status)}\n   ${o.items.map(i => esc(i.name)).join(', ')}`).join('\n'));
}
bot.command('last', ctx => isAdmin(ctx) && adminLast(ctx));

/* ═══════════════ ПЕРЕПИСКА КЛИЕНТ ⇄ АДМИН ═══════════════ */
bot.on('message', async ctx => {
  if (!ctx.chat || ctx.chat.type !== 'private') return;
  const msg = ctx.message;

  if (msg.web_app_data) {                                            // старый способ из приложения
    let p; try { p = JSON.parse(msg.web_app_data.data); } catch { return ctx.reply('Не удалось прочитать заказ.'); }
    return createOrder(ctx, Array.isArray(p.items) ? p.items : [], 'приложение');
  }

  if (isAdmin(ctx)) {
    if (bcDraft && bcDraft.mode === 'wait' && !msg.reply_to_message) return bcPreview(ctx);   // текст для рассылки
    // ты отвечаешь клиенту реплаем
    const to = msg.reply_to_message && db.relay[msg.reply_to_message.message_id];
    if (!to) return ctx.reply('Чтобы ответить клиенту, сделай реплай на его сообщение или карточку заказа. Панель — /admin');
    try {
      await bot.telegram.copyMessage(to, ctx.chat.id, msg.message_id);
      return ctx.reply('✓ Отправлено');
    } catch (e) { return ctx.reply('Не доставлено: ' + e.message); }
  }

  // клиент пишет — пересылаем тебе с контекстом
  const u = touch(ctx);
  const open = db.orders.filter(o => o.uid === ctx.from.id && ACTIVE_STATUSES.includes(o.status)).pop();
  try {
    const head = await bot.telegram.sendMessage(CONFIG.adminId,
      `✉️ ${clientLink(ctx.from.id)}` + (open ? `\nЗаказ /o${open.id} · ${esc(open.status)}` : '') + '\n<i>Ответь реплаем — уйдёт клиенту</i>',
      { parse_mode: 'HTML', disable_web_page_preview: true });
    const copy = await bot.telegram.copyMessage(CONFIG.adminId, ctx.chat.id, msg.message_id, { reply_to_message_id: head.message_id });
    rememberRelay(head.message_id, ctx.from.id); rememberRelay(copy.message_id, ctx.from.id);
  } catch (e) { console.error('relay:', e.message); }

  if (!u.lastAck || Date.now() - u.lastAck > 30 * MIN) {
    u.lastAck = Date.now();
    await ctx.reply(isOpen() ? 'Получили ✓ Ответим сюда же, обычно в течение часа.'
                             : `Получили ✓ Сейчас закрыто — ответим с ${OPEN_FROM}:00.`);
  }
  save();
});

/* ═══════════════ АВТОМАТИКА (каждые 5 минут) ═══════════════ */
async function tick() {
  const now = Date.now(), h = hour(), work = isOpen();
  let changed = false;

  for (const o of db.orders) {
    // подписка закончилась
    if (o.status === 'активна' && o.endsAt && o.endsAt < now) { o.status = 'истекла'; changed = true; }

    // напоминание о продлении за 3 дня, только днём
    if (o.status === 'активна' && o.endsAt && work) o.items.forEach((i, idx) => {
      const end = itemEnd(o, i);
      if (i.reminded || o.reminded || i.renewed || end - now >= 3 * DAY) return;
      i.reminded = true; changed = true;
      sendPic(o.uid, picOf({ items: [i] }), `<b>Напоминание</b>\n\n${esc(i.name)} — до ${fmtDate(end)}.\n\n` +
        'Продлить можно в одно касание: заказ соберётся сам, новый срок добавится к оставшимся дням.\n' +
        'Не нужно — просто ничего не делайте, автосписаний нет.',
        Markup.inlineKeyboard([[Markup.button.callback('🔄 Продлить', `renew:${o.id}:${idx}`)]]));
      send(CONFIG.adminId, `⏰ Напомнил о продлении: /o${o.id} (${esc(i.name)}), до ${fmtDate(end)}`);
    });

    // неоплаченный заказ: одно напоминание через 2 часа, отмена через 48
    if (o.status === 'ждёт оплаты') {
      if (now - o.created > 48 * HOUR) {
        o.status = 'отменён'; o.autoCancelled = true; returnBonus(o); changed = true;
        send(o.uid, `Заказ №${o.id} не был оплачен и закрылся автоматически.` +
          (o.usedBonus > 0 ? ` Бонусы ${money(o.usedBonus)} вернули на баланс.` : '') + ' Собрать новый можно в магазине.');
        updateAdminCard(o);
      } else if (!o.payReminded && now - o.created > 2 * HOUR && work) {
        o.payReminded = true; changed = true;
        send(o.uid, `Заказ №${o.id} ждёт оплаты. Если остались вопросы — напишите сюда, поможем.`,
          Markup.inlineKeyboard([[Markup.button.callback('💳 Оплатить', 'payfor:' + o.id)], [Markup.button.callback('✖️ Отменить', 'ccl:' + o.id)]]));
      }
    }

    // клиент сообщил об оплате, а ты молчишь 30 минут — напомню тебе
    if (o.status === 'оплата заявлена' && !o.adminPinged && work && now - (o.claimedAt || o.created) > 30 * MIN) {
      o.adminPinged = true; changed = true;
      notifyAdmin(o, '⏰ Клиент ждёт уже 30 минут');
    }
  }

  // утренняя сводка в 9:00 — что пришло за ночь
  if (h === OPEN_FROM && db.daily.morning !== today()) {
    db.daily.morning = today(); changed = true;
    const waiting = db.orders.filter(o => ACTIVE_STATUSES.includes(o.status) && o.status !== 'ждёт оплаты');
    if (waiting.length) send(CONFIG.adminId, `☀️ Доброе утро. Ждут тебя: ${waiting.map(o => '/o' + o.id).join(', ')}\nВесь список — /pending`);
  }

  // копия базы в 3:00
  if (h === 3 && db.daily.backup !== today()) { db.daily.backup = today(); changed = true; sendBackup('ежедневная'); }

  if (changed) save();
}

async function sendBackup(reason) {
  try {
    if (!fs.existsSync(DB_FILE)) return;
    const d = new Date().toISOString().slice(0, 10);
    await bot.telegram.sendDocument(CONFIG.adminId, { source: DB_FILE, filename: `lavka-backup-${d}.json` },
      { caption: `💾 Копия базы (${reason}). Заказов: ${db.orders.length}, пользователей: ${Object.keys(db.users).length}.\n\n` +
                 'Как восстановить: pm2 stop lavka-bot → положить файл на сервер как data.json → pm2 start lavka-bot' });
  } catch (e) { console.error('backup:', e.message); }
}
bot.command('backup', ctx => isAdmin(ctx) && sendBackup('по запросу'));

/* ═══════════════ ЗАПУСК ═══════════════ */
bot.catch(err => console.error('Ошибка бота:', err));

bot.telegram.setChatMenuButton({ menuButton: { type: 'web_app', text: 'Магазин', web_app: { url: APP_URL } } })
  .catch(e => console.error('menu button:', e.message));
bot.telegram.setMyCommands([
  { command: 'start',   description: 'Главное меню' },
  { command: 'profile', description: 'Профиль, подписки и продление' },
  { command: 'help',    description: 'Как это работает' }
]).catch(() => {});
bot.telegram.setMyCommands([
  { command: 'admin',   description: '🛠 Панель: доход, заказы, клиенты' },
  { command: 'pending', description: 'Заказы, которые ждут' },
  { command: 'stats',   description: 'Статистика' },
  { command: 'money',   description: 'Доход и прибыль' },
  { command: 'u',       description: 'Карточка клиента: /u @ник' },
  { command: 'spend',   description: 'Записать расход: /spend 900 сервер' },
  { command: 'cost',    description: 'Себестоимость: /cost claude 1150' },
  { command: 'neworder', description: 'Ручной заказ или приз: /neworder @ник gpt 1 приз' },
  { command: 'backup',  description: 'Копия базы' }
], { scope: { type: 'chat', chat_id: CONFIG.adminId } }).catch(() => {});

setInterval(() => tick().catch(e => console.error('tick:', e.message)), 5 * MIN);
setTimeout(() => tick().catch(() => {}), 20 * 1000);

bot.launch().then(() => {
  console.log('AKU Лавка запущена');
  send(CONFIG.adminId, '🟢 Бот перезапущен. Панель — /admin');
});
process.once('SIGINT',  () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

module.exports = { bot, db, tick };   // для проверок
