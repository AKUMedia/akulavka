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
  u.invitedBy = refId;
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
  const subs = mine.filter(o => o.status === 'активна' || (o.status === 'истекла' && Date.now() - o.endsAt < 30 * DAY));
  const open = mine.filter(o => ACTIVE_STATUSES.includes(o.status));
  const rows = [];

  let t = '<b>👤 Профиль</b>\n\n';
  if (subs.length) {
    t += '<b>Подписки</b>\n' + subs.map(o => {
      const left = Math.ceil((o.endsAt - Date.now()) / DAY);
      return '• ' + o.items.map(i => esc(i.name)).join(', ') + ' — ' +
        (o.status === 'активна' ? `до ${fmtDate(o.endsAt)} (${left} дн.)` : `закончилась ${fmtDate(o.endsAt)}`);
    }).join('\n') + '\n\n';
    subs.forEach(o => rows.push([Markup.button.callback('🔄 Продлить: ' + o.items.map(i => i.name).join(', ').slice(0, 40), 'renew:' + o.id)]));
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

async function screenFriends(ctx) {
  const u = touch(ctx), uid = ctx.from.id;
  const link = `https://t.me/${CAT.bot}?start=ref_${uid}`;
  return ctx.replyWithHTML(
    '<b>👥 Приводите друзей — получайте бонусы</b>\n\n' +
    `${CAT.refFirst}% с первой покупки друга и ${CAT.refNext}% со всех следующих. ` +
    'Бонус начисляется, когда заказ друга выполнен, и сам списывается с вашего следующего заказа.\n\n' +
    `<b>Ссылка на бота:</b>\n<code>${link}</code>\n\n` +
    `<b>Ссылка на сайт:</b>\n<code>${SHOP_URL}?ref=${uid}</code>\n\n` +
    `Приглашено: <b>${refCount(uid)}</b> · заработано: <b>${money(u.refEarned)}</b> · баланс: <b>${money(u.balance)}</b>`,
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
  return ctx.replyWithHTML(
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
    (claude ? '• для Claude — ID аккаунта (Settings → Account) и почту, пароль не нужен\n' : '') +
    (other ? '• для остальных сервисов — почту аккаунта. Пароль попросим, когда возьмём заказ в работу, — заранее не присылайте\n' : '') +
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

bot.action(/^renew:(\d+)$/, async ctx => {
  const o = orderOf(ctx.match[1]);
  if (!o || o.uid !== ctx.from.id) return ctx.answerCbQuery('Заказ не найден');
  if (!['активна', 'истекла'].includes(o.status)) return ctx.answerCbQuery('Эту подписку уже продлили');
  await ctx.answerCbQuery();
  return createOrder(ctx, o.items, 'продление', { renewOf: o.id });
});

/* ═══════════════ АДМИНКА ═══════════════ */
const STATUS_ICON = { 'ждёт оплаты':'⏳', 'оплата заявлена':'💰', 'оплачен':'✅', 'оформляется':'⚙️',
                      'активна':'🟢', 'отменён':'❌', 'истекла':'⚪️', 'продлена':'🔁' };
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
    (o.endsAt ? `\nДействует до: ${fmtDate(o.endsAt)}` : '');
}
function adminKb(o) {
  const done = ['активна', 'отменён', 'истекла', 'продлена'].includes(o.status);
  const rows = done ? [] : [
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
  if (['отменён', 'активна', 'истекла', 'продлена'].includes(o.status)) return ctx.answerCbQuery('Заказ уже закрыт');
  if (o.status === status) return ctx.answerCbQuery('Уже стоит этот статус');

  o.status = status; o['at_' + status] = Date.now();
  if (status === 'отменён') { returnBonus(o); revokeReferral(o); }
  if (status === 'активна') {
    const months = Math.max(...o.items.map(i => i.months));
    const prev = o.renewOf ? orderOf(o.renewOf) : null;
    const from = Math.max(Date.now(), prev && prev.endsAt ? prev.endsAt : 0);   // продление не съедает оставшиеся дни
    const d = new Date(from); d.setMonth(d.getMonth() + months); o.endsAt = d.getTime();
    if (prev && ['активна', 'истекла'].includes(prev.status)) { prev.status = 'продлена'; }
  }
  save();
  await ctx.answerCbQuery('Статус: ' + status);
  try { await ctx.editMessageText(adminCard(o), { parse_mode: 'HTML', disable_web_page_preview: true, ...adminKb(o) }); } catch (_) {}
  if (status === 'активна') await payReferral(o);

  const note = {
    'оплачен':     'Оплата получена. Берём в работу — если для оформления что-то понадобится, напишем сюда.',
    'оформляется': 'Оформляем прямо сейчас. Будьте, пожалуйста, на связи — может понадобиться код подтверждения.',
    'активна':     `Готово! Подписка активна до <b>${o.endsAt ? fmtDate(o.endsAt) : ''}</b>.\n\n` +
                   'Если передавали пароль — смените его прямо сейчас и выйдите со всех устройств. ' +
                   'Не меняйте страну в настройках аккаунта и не делитесь им с другими — так сервисы не блокируют.\n\n' +
                   'За три дня до конца напомним про продление. Всё ваши подписки — в разделе «Профиль».',
    'отменён':     'Заказ отменён.' + (o.usedBonus > 0 ? ` Бонусы ${money(o.usedBonus)} вернули на баланс.` : '') +
                   ' Если оплата уже прошла — вернём её тем же способом, напишите сюда.'
  }[status];
  if (note) send(o.uid, `<b>Заказ №${o.id}</b>\n\n${note}`,
    status === 'активна' ? Markup.inlineKeyboard([[Markup.button.callback('👤 Профиль', 'scr:profile')]]) : {});
});

bot.action(/^dm:(\d+)$/, async ctx => {
  if (ctx.from.id !== CONFIG.adminId) return ctx.answerCbQuery('Не для вас');
  await ctx.answerCbQuery();
  const uid = +ctx.match[1];
  const m = await ctx.replyWithHTML(`✍️ Ответьте <b>реплаем на это сообщение</b> — перешлю клиенту ${clientLink(uid)}`);
  rememberRelay(m.message_id, uid); save();
});

/* ---------- команды админа ---------- */
const isAdmin = ctx => ctx.from && ctx.from.id === CONFIG.adminId;

bot.command('admin', ctx => isAdmin(ctx) && ctx.replyWithHTML(
  '<b>Команды</b>\n\n/pending — заказы, которые ждут тебя\n/o 1001 — карточка заказа с кнопками\n' +
  '/last — последние 10 заказов\n/stats — выручка и заказы за сегодня, неделю, месяц\n/backup — копия базы\n\n' +
  'Чтобы ответить клиенту — сделай реплай на его сообщение или на карточку заказа.'));

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

bot.command('stats', ctx => {
  if (!isAdmin(ctx)) return;
  const now = Date.now();
  const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
  const period = (from) => {
    const os = db.orders.filter(o => o.created >= from && o.source !== 'розыгрыш');
    const paid = os.filter(o => PAID_STATUSES.includes(o.status));
    const rev = paid.reduce((s, o) => s + o.due, 0);
    return `${os.length} заказов, оплачено ${paid.length}` + (os.length ? ` (${Math.round(paid.length / os.length * 100)}%)` : '') +
           `, выручка ${money(rev)}` + (paid.length ? `, средний чек ${money(Math.round(rev / paid.length))}` : '');
  };
  const top = {};
  db.orders.filter(o => PAID_STATUSES.includes(o.status)).forEach(o => o.items.forEach(i => { top[i.name] = (top[i.name] || 0) + i.qty; }));
  const soon = db.orders.filter(o => o.status === 'активна' && o.endsAt - now < 3 * DAY);
  return ctx.replyWithHTML(
    '<b>Сводка</b>\n\n' +
    `<b>Сегодня:</b> ${period(startOfDay.getTime())}\n` +
    `<b>7 дней:</b> ${period(now - 7 * DAY)}\n` +
    `<b>30 дней:</b> ${period(now - 30 * DAY)}\n` +
    `<b>Всё время:</b> ${period(0)}\n\n` +
    `Активных подписок: ${db.orders.filter(o => o.status === 'активна').length}` +
    (soon.length ? `\nЗаканчиваются в 3 дня: ${soon.map(o => '/o' + o.id).join(', ')}` : '') + '\n\n' +
    '<b>Что берут:</b> ' + (Object.entries(top).sort((a, b) => b[1] - a[1]).map(([n, q]) => `${esc(n)} ${q}`).join(', ') || 'пока ничего') + '\n\n' +
    `Пользователей: ${Object.keys(db.users).length}, пришли по рефералке: ${Object.values(db.users).filter(u => u.invitedBy).length}, ` +
    `начислено бонусов: ${money(Object.values(db.users).reduce((s, u) => s + (u.refEarned || 0), 0))}`);
});

/* ═══════════════ ПЕРЕПИСКА КЛИЕНТ ⇄ АДМИН ═══════════════ */
bot.on('message', async ctx => {
  if (!ctx.chat || ctx.chat.type !== 'private') return;
  const msg = ctx.message;

  if (msg.web_app_data) {                                            // старый способ из приложения
    let p; try { p = JSON.parse(msg.web_app_data.data); } catch { return ctx.reply('Не удалось прочитать заказ.'); }
    return createOrder(ctx, Array.isArray(p.items) ? p.items : [], 'приложение');
  }

  if (isAdmin(ctx)) {                                                // ты отвечаешь клиенту реплаем
    const to = msg.reply_to_message && db.relay[msg.reply_to_message.message_id];
    if (!to) return ctx.reply('Чтобы ответить клиенту, сделай реплай на его сообщение или карточку заказа. Список команд — /admin');
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
    if (o.status === 'активна' && o.endsAt && !o.reminded && o.endsAt - now < 3 * DAY && work) {
      o.reminded = true; changed = true;
      const names = o.items.map(i => esc(i.name)).join(', ');
      send(o.uid, `<b>Напоминание</b>\n\n${names} — до ${fmtDate(o.endsAt)}.\n\n` +
        'Продлить можно в одно касание: заказ соберётся сам, новый срок добавится к оставшимся дням.\n' +
        'Не нужно — просто ничего не делайте, автосписаний нет.',
        Markup.inlineKeyboard([[Markup.button.callback('🔄 Продлить', 'renew:' + o.id)]]));
      send(CONFIG.adminId, `⏰ Напомнил о продлении: /o${o.id} (${names}), до ${fmtDate(o.endsAt)}`);
    }

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
  { command: 'pending', description: 'Заказы, которые ждут' },
  { command: 'last',    description: 'Последние заказы' },
  { command: 'stats',   description: 'Сводка' },
  { command: 'backup',  description: 'Копия базы' },
  { command: 'admin',   description: 'Все команды' }
], { scope: { type: 'chat', chat_id: CONFIG.adminId } }).catch(() => {});

setInterval(() => tick().catch(e => console.error('tick:', e.message)), 5 * MIN);
setTimeout(() => tick().catch(() => {}), 20 * 1000);

bot.launch().then(() => {
  console.log('AKU Лавка запущена');
  send(CONFIG.adminId, '🟢 Бот перезапущен. Команды — /admin');
});
process.once('SIGINT',  () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

module.exports = { bot, db, tick };   // для проверок
