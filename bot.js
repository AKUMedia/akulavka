/* ═══════════════════════════════════════════════════════════
   AKU Лавка — бот магазина
   Правишь только блок CONFIG ниже. Всё остальное трогать не надо.
   ═══════════════════════════════════════════════════════════ */

const fsBoot = require('fs');
function readToken() {
  if (process.env.BOT_TOKEN) return process.env.BOT_TOKEN.trim();
  try { return fsBoot.readFileSync(__dirname + '/token.txt', 'utf8').trim(); }
  catch { console.error('Нет токена: положите его в файл token.txt рядом с bot.js'); process.exit(1); }
}

const CONFIG = {
  token   : readToken(),   // лежит в файле token.txt рядом с ботом, в код не попадает
  adminId : 927864149,                       // твой Telegram ID — сюда падают заказы
  site    : 'https://akumedia.github.io/akulavka/',
  webapp  : 'https://akumedia.github.io/akulavka/app.html',  // мини-приложение (HTTPS обязателен)
  channel : 'https://t.me/Alekseii_AI',
  guide   : 'https://aku-automation.io/guide/?utm_source=bot&utm_medium=telegram',
  cardRef : 'https://t.me/Cashinout_bot?start=23610',
  cardRef2: 'https://platipomiru.com/?utm_source=Aleksei_AI&utm_medium=cpa',
  lexyRef : 'https://lexygpt.com/?ref=ALEKSEIAI',

  usdtTrc : 'TTeBmEYoWSWGvaATRALL6hFud3hmjbaqTx',   // USDT и TRX, сеть TRC-20 (Tron)
  usdtBep : '0xd731da2010d88d03ac8eba6bdce17b2eea8cb625', // USDT, сеть BEP-20 (BNB Smart Chain)
  yoomoney: '4100118055761665',

  rate    : 92,     // рублей за доллар на карте, со всеми комиссиями
  markup  : 1.46,   // наценка
  cryptoOff: 5,     // скидка за крипту, %
  refFirst : 8,     // % рефереру с ПЕРВОЙ покупки приглашённого
  refNext  : 5,     // % рефереру со всех последующих
  openFrom: 9,
  openTo  : 23,

  terms: [
    { months: 1, label: '1 месяц',   mult: 1    },
    { months: 3, label: '3 месяца',  mult: 2.85 },
    { months: 6, label: '6 месяцев', mult: 5.4  }
  ],

};


/* ═══════════════ ДАЛЬШЕ КОД — МЕНЯТЬ НЕ НАДО ═══════════════ */

/* Товары, цены и сроки берутся из общего catalog.js — того же,
   что использует сайт и мини-приложение. Правите там — меняется везде. */
const SHARED = require('./catalog.js').CONFIG;
const LINK_OF = { LEXY:'lexyRef', CARD:'cardRef', CARD2:'cardRef2', GUIDE:'guide' };

CONFIG.rate      = SHARED.rate;
CONFIG.markup    = SHARED.markup;
CONFIG.cryptoOff = SHARED.cryptoOff;
CONFIG.terms     = SHARED.terms;
CONFIG.goods = SHARED.goods.filter(g => !g.hidden).map(g => ({
  id: g.id, name: g.name, usd: g.usd, rub: g.rub, noLogin: g.noLogin,
  desc: g.short + (g.about ? '\n\n' + g.about : '')
})).concat(SHARED.extras.map(e => ({
  id: e.id, name: e.name, link: LINK_OF[e.external], desc: e.short
})));
CONFIG.onRequest = SHARED.goods.filter(g => g.hidden).map(g => g.name);

const { Telegraf, Markup } = require('telegraf');
const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'data.json');

/* ---------- Хранилище: обычный JSON-файл ---------- */
function load() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
  catch { return { orders: [], carts: {}, users: {}, seq: 1000 }; }
}
function save(db) {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}
let db = load();

/* ---------- Хелперы ---------- */
const G = id => CONFIG.goods.find(g => g.id === id);
const term = m => CONFIG.terms.find(t => t.months === m) || CONFIG.terms[0];
const money = n => n.toLocaleString('ru-RU') + ' ₽';
const base = g => g.rub ? g.rub : Math.round(g.usd * CONFIG.rate * CONFIG.markup / 10) * 10;
const priceFor = (g, m) => Math.round(base(g) * term(m).mult / 10) * 10;
const crypto = n => Math.round(n * (100 - CONFIG.cryptoOff) / 100 / 10) * 10;
const isOpen = () => { const h = new Date().getHours(); return h >= CONFIG.openFrom && h < CONFIG.openTo; };
const who = u => u.username ? '@' + u.username : (u.first_name || 'клиент') + ' (id ' + u.id + ')';
const fmtDate = d => new Date(d).toLocaleDateString('ru-RU');

function userOf(uid) {
  if (!db.users[uid]) db.users[uid] = { balance: 0, refEarned: 0, seen: Date.now() };
  const u = db.users[uid];
  if (u.balance === undefined)   u.balance = 0;
  if (u.refEarned === undefined) u.refEarned = 0;
  return u;
}
function refCount(uid) {
  return Object.values(db.users).filter(u => String(u.invitedBy) === String(uid)).length;
}
function paidOrdersOf(uid) {
  return db.orders.filter(o => o.uid === uid && o.refPaid).length;
}
async function payReferral(order) {
  const buyer = userOf(order.uid);
  if (!buyer.invitedBy || order.refPaid) return;
  const first  = paidOrdersOf(order.uid) === 0;
  const pct    = first ? CONFIG.refFirst : CONFIG.refNext;
  const bonus  = Math.round(order.due * pct / 100 / 10) * 10;
  const ref    = userOf(buyer.invitedBy);
  ref.balance   += bonus;
  ref.refEarned += bonus;
  order.refPaid  = { to: buyer.invitedBy, bonus, pct };
  save(db);
  try {
    await bot.telegram.sendMessage(buyer.invitedBy,
      `💰 <b>+${money(bonus)} на баланс</b>\n\n` +
      `Ваш приглашённый оформил заказ. Начислено ${pct}%.\n` +
      `Баланс: <b>${money(ref.balance)}</b> — спишется автоматически со следующей покупки.`,
      { parse_mode: 'HTML' });
  } catch (e) { console.error('payReferral:', e.message); }
}

function cartOf(uid) { return db.carts[uid] || []; }
function cartTotal(uid) {
  return cartOf(uid).reduce((s, i) => s + priceFor(G(i.id), i.months) * i.qty, 0);
}
function cartText(uid) {
  const c = cartOf(uid);
  if (!c.length) return null;
  const lines = c.map(i => {
    const g = G(i.id);
    return '• ' + g.name + ' — ' + term(i.months).label +
           (i.qty > 1 ? ' ×' + i.qty : '') + ' — ' + money(priceFor(g, i.months) * i.qty);
  }).join('\n');
  const t = cartTotal(uid);
  return lines + '\n\nИтого: <b>' + money(t) + '</b>\nКриптой: <b>' + money(crypto(t)) + '</b>';
}

const bot = new Telegraf(CONFIG.token);

/* ---------- Главное меню ---------- */
function mainMenu() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🛒 Каталог', 'shop')],
    [Markup.button.callback('📦 Моя корзина', 'cart'),
     Markup.button.callback('🧾 Мои заказы', 'my')],
    [Markup.button.callback('👥 Пригласить друзей', 'ref')],
    [Markup.button.callback('❓ Как это работает', 'help'),
     Markup.button.callback('💬 Написать нам', 'contact')],
    [Markup.button.url('🌐 Сайт лавки', CONFIG.site)]
  ]);
}

const BTN = {
  shop   : '🛍 Открыть магазин',
  orders : '🧾 Мои заказы',
  friends: '👥 Пригласить друзей',
  help   : '❓ Как это работает',
  ask    : '💬 Написать нам'
};

function shopKeyboard() {
  return Markup.keyboard([
    [Markup.button.webApp(BTN.shop, CONFIG.webapp)],
    [BTN.orders, BTN.friends],
    [BTN.help, BTN.ask]
  ]).resize();
}

const HELLO = (name) =>
  `Привет${name ? ', ' + name : ''}! Это <b>AKU Лавка</b> — подписки на нейросети.\n\n` +
  `Оформляем на ваш собственный аккаунт: переписка, файлы и история остаются у вас. ` +
  `Claude — вообще без пароля, только по номеру аккаунта.\n\n` +
  `Нажмите <b>«${'🛍 Открыть магазин'}»</b> внизу — там каталог, цены и оформление.\n\n` +
  (isOpen()
    ? '🟢 Лавка открыта, отвечаем сейчас.'
    : `🌙 Сейчас закрыто. Заявку оставить можно — ответим с ${CONFIG.openFrom}:00.`);

bot.start(async ctx => {
  const u = userOf(ctx.from.id);
  u.name = ctx.from.first_name; u.username = ctx.from.username; u.seen = Date.now();
  const payload = (ctx.startPayload || '').trim();
  const m = payload.match(/^ref_(\d+)$/);
  if (m && !u.invitedBy && String(m[1]) !== String(ctx.from.id)) {
    u.invitedBy = +m[1];
    try {
      await bot.telegram.sendMessage(u.invitedBy,
        `👥 По вашей ссылке пришёл новый человек. Как он оформит заказ — начислим ${CONFIG.refFirst}%.`);
    } catch (_) {}
  }
  save(db);
  await ctx.replyWithHTML(HELLO(ctx.from.first_name), shopKeyboard());
});

bot.command('menu', ctx => ctx.replyWithHTML(HELLO(ctx.from.first_name), shopKeyboard()));

/* ---------- Каталог ---------- */
bot.action('shop', async ctx => {
  await ctx.answerCbQuery();
  const rows = CONFIG.goods.filter(g => !g.link).map(g =>
    [Markup.button.callback(`${g.name} — ${money(priceFor(g, 1))}`, 'g:' + g.id)]);
  rows.push([Markup.button.callback('📋 Другие сервисы', 'more')]);
  rows.push([Markup.button.callback('🧰 Полезное рядом', 'extras')]);
  rows.push([Markup.button.callback('◀︎ Назад', 'home')]);
  await ctx.editMessageText(
    '<b>Каталог</b>\n\nЦены за месяц. При оплате криптой — минус ' + CONFIG.cryptoOff + '%.',
    { parse_mode: 'HTML', ...Markup.inlineKeyboard(rows) }
  );
});

bot.action('extras', async ctx => {
  await ctx.answerCbQuery();
  const list = CONFIG.goods.filter(g => g.link);
  await ctx.editMessageText(
    '<b>Полезное рядом</b>\n\nНе подписки, а инструменты, которыми пользуемся сами:\n\n' +
    list.map(g => '• <b>' + g.name + '</b> — ' + g.desc).join('\n\n'),
    { parse_mode: 'HTML', ...Markup.inlineKeyboard(
        list.map(g => [Markup.button.url(g.name, CONFIG[g.link])])
            .concat([[Markup.button.callback('◀︎ В каталог', 'shop')]])) }
  );
});

bot.action('more', async ctx => {
  await ctx.answerCbQuery();
  await ctx.editMessageText(
    '<b>Под заказ</b>\n\nЭти сервисы оформляем по запросу — напишите, ответим по срокам и цене:\n\n' +
    CONFIG.onRequest.map(n => '• ' + n).join('\n') +
    '\n\nНет в списке? Тоже напишите — скорее всего сможем.',
    { parse_mode: 'HTML', ...Markup.inlineKeyboard([
      [Markup.button.callback('💬 Написать нам', 'contact')],
      [Markup.button.callback('◀︎ В каталог', 'shop')]
    ]) }
  );
});

/* ---------- Карточка товара ---------- */
bot.action(/^g:(.+)$/, async ctx => {
  await ctx.answerCbQuery();
  const g = G(ctx.match[1]);
  if (!g) return;

  if (g.link) {
    return ctx.editMessageText(
      `<b>${g.name}</b>\n\n${g.desc}`,
      { parse_mode: 'HTML', ...Markup.inlineKeyboard([
        [Markup.button.url('Открыть', CONFIG[g.link])],
        [Markup.button.callback('◀︎ В каталог', 'shop')]
      ]) }
    );
  }

  const rows = CONFIG.terms.map(t =>
    [Markup.button.callback(`${t.label} — ${money(priceFor(g, t.months))}`, `add:${g.id}:${t.months}`)]
  );
  rows.push([Markup.button.callback('◀︎ В каталог', 'shop')]);

  await ctx.editMessageText(
    `<b>${g.name}</b>\n\n${g.desc}\n\n` +
    (g.noLogin ? '🔒 Пароль не нужен — оформляем по ID аккаунта.\n' : '🔑 Нужен временный пароль, который вы меняете сразу после.\n') +
    `\nВыберите срок:`,
    { parse_mode: 'HTML', ...Markup.inlineKeyboard(rows) }
  );
});

/* ---------- Корзина ---------- */
bot.action(/^add:(.+):(\d+)$/, async ctx => {
  const [, id, m] = ctx.match;
  const months = +m;
  const uid = ctx.from.id;
  const c = cartOf(uid);
  const found = c.find(i => i.id === id && i.months === months);
  if (found) found.qty++; else c.push({ id, months, qty: 1 });
  db.carts[uid] = c; save(db);
  await ctx.answerCbQuery(G(id).name + ' — в корзине');
  await showCart(ctx, true);
});

async function showCart(ctx, edit) {
  const uid = ctx.from.id;
  const txt = cartText(uid);
  if (!txt) {
    const body = '<b>Корзина пуста</b>\n\nВыберите что-нибудь в каталоге.';
    const kb = Markup.inlineKeyboard([
      [Markup.button.callback('🛒 В каталог', 'shop')],
      [Markup.button.callback('◀︎ Назад', 'home')]
    ]);
    return edit ? ctx.editMessageText(body, { parse_mode:'HTML', ...kb })
                : ctx.replyWithHTML(body, kb);
  }
  const kb = Markup.inlineKeyboard([
    [Markup.button.callback('✅ Оформить заказ', 'checkout')],
    [Markup.button.callback('🗑 Очистить', 'clear'),
     Markup.button.callback('🛒 Добавить ещё', 'shop')],
    [Markup.button.callback('◀︎ Назад', 'home')]
  ]);
  const body = '<b>Корзина</b>\n\n' + txt;
  return edit ? ctx.editMessageText(body, { parse_mode:'HTML', ...kb })
              : ctx.replyWithHTML(body, kb);
}

bot.action('cart',  async ctx => { await ctx.answerCbQuery(); await showCart(ctx, true); });
bot.action('clear', async ctx => {
  delete db.carts[ctx.from.id]; save(db);
  await ctx.answerCbQuery('Корзина очищена');
  await showCart(ctx, true);
});

/* ---------- Оформление ---------- */
bot.action('checkout', async ctx => {
  await ctx.answerCbQuery();
  if (!cartOf(ctx.from.id).length) return showCart(ctx, true);
  await ctx.editMessageText(
    '<b>Как удобнее оплатить?</b>\n\n' +
    `Крипта выгоднее на ${CONFIG.cryptoOff}% — сумма ниже.`,
    { parse_mode:'HTML', ...Markup.inlineKeyboard([
      [Markup.button.callback('₮ Крипта USDT (−' + CONFIG.cryptoOff + '%)', 'pay:crypto')],
      [Markup.button.callback('💳 ЮMoney', 'pay:yoomoney')],
      [Markup.button.callback('◀︎ Назад', 'cart')]
    ]) }
  );
});

bot.action(/^pay:(crypto|yoomoney)$/, async ctx => {
  await ctx.answerCbQuery();
  const method = ctx.match[1];
  const uid = ctx.from.id;
  const items = cartOf(uid);
  if (!items.length) return showCart(ctx, true);

  const total = cartTotal(uid);
  let due = method === 'crypto' ? crypto(total) : total;

  const u = userOf(uid);
  const usedBonus = Math.min(u.balance, Math.max(0, due - 100));   // 100 ₽ оставляем к оплате
  if (usedBonus > 0) { due -= usedBonus; u.balance -= usedBonus; }

  const id = ++db.seq;
  db.orders.push({
    id, uid, user: who(ctx.from),
    items: items.map(i => ({ ...i, name: G(i.id).name, price: priceFor(G(i.id), i.months) })),
    total, due, usedBonus, method, status: 'ждёт оплаты', created: Date.now()
  });
  delete db.carts[uid];
  save(db);

  const reqs = method === 'crypto'
    ? `<b>USDT — выберите одну сеть</b>\n\n` +
      `<b>TRC-20</b> (Tron, комиссия копеечная):\n<code>${CONFIG.usdtTrc}</code>\n\n` +
      `<b>BEP-20</b> (BNB Smart Chain):\n<code>${CONFIG.usdtBep}</code>\n\n` +
      `⚠️ Сеть и адрес должны совпадать. Отправите в другой сети — средства не дойдут.\n\n` +
      `Точную сумму в USDT подтвердим в переписке по курсу на момент оплаты.`
    : `<b>ЮMoney</b>\n<code>${CONFIG.yoomoney}</code>\n\nСумма: <b>${money(due)}</b>`;

  await ctx.editMessageText(
    `<b>Заказ №${id} создан</b>\n\n` + cartTextFromOrder(id) +
    (usedBonus > 0 ? `\n\nСписано с бонусного баланса: <b>−${money(usedBonus)}</b>` : '') +
    `\n\nК оплате: <b>${money(due)}</b>\n\n${reqs}\n\n` +
    `Как отправите — нажмите кнопку ниже, и мы начнём оформлять.`,
    { parse_mode:'HTML', ...Markup.inlineKeyboard([
      [Markup.button.callback('✅ Я оплатил', 'paid:' + id)],
      [Markup.button.callback('💬 Написать нам', 'contact')]
    ]) }
  );

  await notifyAdmin(id, 'новый заказ');
});

function cartTextFromOrder(id) {
  const o = db.orders.find(x => x.id === id);
  if (!o) return '';
  return o.items.map(i =>
    '• ' + i.name + ' — ' + term(i.months).label + (i.qty > 1 ? ' ×' + i.qty : '') +
    ' — ' + money(i.price * i.qty)).join('\n');
}

bot.action(/^paid:(\d+)$/, async ctx => {
  const id = +ctx.match[1];
  const o = db.orders.find(x => x.id === id);
  if (!o) return ctx.answerCbQuery('Заказ не найден');
  o.status = 'оплата заявлена'; save(db);
  await ctx.answerCbQuery('Принято!');
  await ctx.editMessageText(
    `<b>Заказ №${id}</b>\n\nСпасибо! Проверим поступление и напишем вам.\n\n` +
    (o.items.some(i => G(i.id) && G(i.id).noLogin)
      ? 'Для Claude понадобится только <b>ID вашего аккаунта</b> — пароль не нужен.\n\n'
      : 'Для оформления понадобится доступ к аккаунту — расскажем, как передать безопасно.\n\n') +
    (isOpen() ? 'Обычно оформляем в течение часа.' : `Сейчас закрыто, возьмём в работу с ${CONFIG.openFrom}:00.`),
    { parse_mode:'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('◀︎ В меню', 'home')]]) }
  );
  await notifyAdmin(id, '💰 КЛИЕНТ ЗАЯВИЛ ОПЛАТУ');
});

/* ---------- Уведомление админу ---------- */
async function notifyAdmin(id, title) {
  const o = db.orders.find(x => x.id === id);
  if (!o) return;
  const text =
    `<b>${title}</b>\n\n` +
    `Заказ №${o.id}\n` +
    `Клиент: ${o.user}\n` +
    `Способ: ${o.method === 'crypto' ? 'крипта USDT' : 'ЮMoney'}\n\n` +
    cartTextFromOrder(id) +
    `\n\nК оплате: <b>${money(o.due)}</b>\n` +
    `Статус: ${o.status}`;
  try {
    await bot.telegram.sendMessage(CONFIG.adminId, text, {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('💰 Оплачено', `st:${id}:оплачен`),
         Markup.button.callback('⚙️ Оформляю', `st:${id}:оформляется`)],
        [Markup.button.callback('✅ Готово', `st:${id}:активна`),
         Markup.button.callback('❌ Отмена', `st:${id}:отменён`)],
        [Markup.button.callback('✉️ Написать клиенту', `dm:${o.uid}`)]
      ])
    });
  } catch (e) { console.error('notifyAdmin:', e.message); }
}

bot.action(/^st:(\d+):(.+)$/, async ctx => {
  if (ctx.from.id !== CONFIG.adminId) return ctx.answerCbQuery('Не для вас');
  const id = +ctx.match[1], status = ctx.match[2];
  const o = db.orders.find(x => x.id === id);
  if (!o) return ctx.answerCbQuery('Заказ не найден');

  o.status = status;
  if (status === 'оплачен') payReferral(o);
  if (status === 'активна' && !o.endsAt) {
    const months = Math.max(...o.items.map(i => i.months));
    const d = new Date(); d.setMonth(d.getMonth() + months);
    o.endsAt = d.getTime();
  }
  save(db);
  await ctx.answerCbQuery('Статус: ' + status);
  await ctx.editMessageText(ctx.callbackQuery.message.text.replace(/Статус:.*$/, 'Статус: ' + status) +
    (o.endsAt ? '\nДействует до: ' + fmtDate(o.endsAt) : ''), { parse_mode: 'HTML' });

  const note = {
    'оплачен':     'Оплата получена, начинаем оформлять.',
    'оформляется': 'Взяли в работу. Скоро напишем.',
    'активна':     `Готово! Подписка активна${o.endsAt ? ' до ' + fmtDate(o.endsAt) : ''}.\n\nЕсли передавали пароль — поменяйте его на свой. Если что-то отвалится в течение месяца, напишите: чиним за свой счёт.`,
    'отменён':     'Заказ отменён. Если это ошибка — напишите нам.'
  }[status];
  if (note) {
    try { await bot.telegram.sendMessage(o.uid, `<b>Заказ №${id}</b>\n\n${note}`, { parse_mode:'HTML' }); }
    catch (e) { console.error('notify client:', e.message); }
  }
});

bot.action(/^dm:(\d+)$/, async ctx => {
  if (ctx.from.id !== CONFIG.adminId) return ctx.answerCbQuery('Не для вас');
  await ctx.answerCbQuery();
  await ctx.reply(`Напиши клиенту напрямую: tg://user?id=${ctx.match[1]}`);
});

/* ---------- Мои заказы ---------- */
bot.action('my', async ctx => {
  await ctx.answerCbQuery();
  const mine = db.orders.filter(o => o.uid === ctx.from.id).slice(-8).reverse();
  const body = mine.length
    ? '<b>Ваши заказы</b>\n\n' + mine.map(o =>
        `№${o.id} · ${o.status}\n${o.items.map(i => i.name).join(', ')} — ${money(o.due)}` +
        (o.endsAt ? `\nДо ${fmtDate(o.endsAt)}` : '')).join('\n\n')
    : '<b>Заказов пока нет</b>\n\nВыберите что-нибудь в каталоге.';
  const bal = userOf(ctx.from.id).balance;
  await ctx.editMessageText(
    body + (bal > 0 ? `\n\n💰 Бонусный баланс: <b>${money(bal)}</b> — спишется со следующего заказа.` : ''),
    { parse_mode:'HTML', ...Markup.inlineKeyboard([
      [Markup.button.callback('🛒 В каталог', 'shop')],
      [Markup.button.callback('👥 Пригласить друзей', 'ref')],
      [Markup.button.callback('◀︎ Назад', 'home')]
    ]) });
});

/* ---------- Кнопки постоянного меню ---------- */
async function screenOrders(ctx) {
  const mine = db.orders.filter(o => o.uid === ctx.from.id).slice(-8).reverse();
  const bal = userOf(ctx.from.id).balance;
  const body = mine.length
    ? '<b>Ваши заказы</b>\n\n' + mine.map(o =>
        `№${o.id} · ${o.status}\n${o.items.map(i => i.name).join(', ')} — ${money(o.due)}` +
        (o.endsAt ? `\nДо ${fmtDate(o.endsAt)}` : '')).join('\n\n')
    : '<b>Заказов пока нет</b>\n\nОткройте магазин и выберите подписку.';
  await ctx.replyWithHTML(body + (bal > 0
    ? `\n\n💰 Бонусный баланс: <b>${money(bal)}</b> — спишется со следующего заказа.` : ''));
}

async function screenFriends(ctx) {
  const u = userOf(ctx.from.id);
  const me = (ctx.botInfo && ctx.botInfo.username) || 'akulavka_bot';
  const link = `https://t.me/${me}?start=ref_${ctx.from.id}`;
  await ctx.replyWithHTML(
    '<b>👥 Приводите друзей — получайте деньги</b>\n\n' +
    `${CONFIG.refFirst}% с первой покупки приглашённого и ${CONFIG.refNext}% со всех следующих. ` +
    'Бонус падает на баланс и списывается с вашего следующего заказа.\n\n' +
    '<b>Ваша ссылка:</b>\n<code>' + link + '</code>\n\n' +
    `Приглашено: <b>${refCount(ctx.from.id)}</b>\nЗаработано: <b>${money(u.refEarned)}</b>\n` +
    `Баланс: <b>${money(u.balance)}</b>`,
    Markup.inlineKeyboard([[Markup.button.url('📨 Отправить другу',
      'https://t.me/share/url?url=' + encodeURIComponent(link) +
      '&text=' + encodeURIComponent('Подписки на нейросети на свой аккаунт — Claude, ChatGPT и другие'))]])
  );
}

async function screenHelp(ctx) {
  await ctx.replyWithHTML(
    '<b>Как это работает</b>\n\n' +
    '1. Открываете магазин и собираете заказ\n' +
    '2. Выбираете оплату: крипта (−' + CONFIG.cryptoOff + '%) или ЮMoney\n' +
    '3. Даёте данные: для Claude — только ID аккаунта, пароль не нужен. ' +
    'Для остальных — временный пароль, который меняете сразу после оформления\n' +
    '4. Пользуетесь. За три дня до конца напомним про продление\n\n' +
    '<b>Если подписка слетит</b> в течение оплаченного срока — восстанавливаем за свой счёт ' +
    'или возвращаем деньги за оставшиеся дни.\n\n' +
    `Работаем с ${CONFIG.openFrom}:00 до ${CONFIG.openTo}:00.`,
    Markup.inlineKeyboard([
      [Markup.button.url('📖 Бесплатный гайд по Claude', CONFIG.guide)],
      [Markup.button.url('📣 Канал про нейросети', CONFIG.channel)],
      [Markup.button.callback('🧰 Полезное рядом', 'extras')]
    ])
  );
}

bot.hears(BTN.orders,  screenOrders);
bot.hears(BTN.friends, screenFriends);
bot.hears(BTN.help,    screenHelp);
bot.hears(BTN.ask, ctx => ctx.replyWithHTML(
  'Пишите сюда — отвечает человек, не автоответчик.\n\n' +
  'Подскажем, что выбрать под задачу, посчитаем срок и поможем с оплатой.',
  Markup.inlineKeyboard([[Markup.button.url('💬 Открыть чат', 'https://t.me/' + CONFIG.telegram)]])
));

/* ---------- Заказ из мини-приложения ---------- */
bot.on('message', async (ctx, next) => {
  const wad = ctx.message && ctx.message.web_app_data;
  if (!wad) return next();
  let payload;
  try { payload = JSON.parse(wad.data); }
  catch { return ctx.reply('Не удалось прочитать заказ. Попробуйте ещё раз.'); }
  if (!payload || payload.type !== 'order' || !Array.isArray(payload.items) || !payload.items.length) {
    return ctx.reply('Корзина пустая.');
  }

  const uid = ctx.from.id;
  const u = userOf(uid);
  u.name = ctx.from.first_name; u.username = ctx.from.username;

  const items = payload.items.map(i => ({
    id: i.id, name: String(i.name).slice(0, 60), months: +i.months || 1,
    qty: Math.max(1, Math.min(10, +i.qty || 1)), price: +i.price || 0
  }));
  const total = items.reduce((s2, i) => s2 + i.price * i.qty, 0);
  let due = total;
  const usedBonus = Math.min(u.balance, Math.max(0, due - 100));
  if (usedBonus > 0) { due -= usedBonus; u.balance -= usedBonus; }

  const id = ++db.seq;
  db.orders.push({ id, uid, user: who(ctx.from), items, total, due, usedBonus,
                   method: 'не выбран', status: 'ждёт оплаты', created: Date.now(), fromApp: true });
  delete db.carts[uid];
  save(db);

  const lines = items.map(i => '• ' + i.name + ' — ' + term(i.months).label +
                   (i.qty > 1 ? ' ×' + i.qty : '') + ' — ' + money(i.price * i.qty)).join('\n');
  await ctx.replyWithHTML(
    `<b>Заказ №${id} принят</b>\n\n${lines}` +
    (usedBonus > 0 ? `\n\nСписано с бонусного баланса: <b>−${money(usedBonus)}</b>` : '') +
    `\n\nИтого: <b>${money(due)}</b>\nКриптой: <b>${money(crypto(due))}</b>\n\n` +
    'Выберите, чем платить:',
    Markup.inlineKeyboard([
      [Markup.button.callback('₮ Крипта USDT (−' + CONFIG.cryptoOff + '%)', 'appay:crypto:' + id)],
      [Markup.button.callback('💳 ЮMoney', 'appay:yoomoney:' + id)],
      [Markup.button.callback('💬 Написать нам', 'contact')]
    ])
  );
  await notifyAdmin(id, '🛍 заказ из мини-приложения');
});

bot.action(/^appay:(crypto|yoomoney):(\d+)$/, async ctx => {
  await ctx.answerCbQuery();
  const method = ctx.match[1], id = +ctx.match[2];
  const o = db.orders.find(x => x.id === id);
  if (!o) return ctx.editMessageText('Заказ не найден.');
  o.method = method;
  if (method === 'crypto') o.due = crypto(o.due);
  save(db);

  const reqs = method === 'crypto'
    ? `<b>USDT — выберите одну сеть</b>\n\n` +
      `<b>TRC-20</b> (Tron, комиссия копеечная):\n<code>${CONFIG.usdtTrc}</code>\n\n` +
      `<b>BEP-20</b> (BNB Smart Chain):\n<code>${CONFIG.usdtBep}</code>\n\n` +
      `⚠️ Сеть и адрес должны совпадать.\n\nТочную сумму в USDT подтвердим в переписке.`
    : `<b>ЮMoney</b>\n<code>${CONFIG.yoomoney}</code>\n\nСумма: <b>${money(o.due)}</b>`;

  await ctx.editMessageText(
    `<b>Заказ №${id}</b>\n\nК оплате: <b>${money(o.due)}</b>\n\n${reqs}\n\n` +
    'Как отправите — нажмите кнопку ниже.',
    { parse_mode: 'HTML', ...Markup.inlineKeyboard([
      [Markup.button.callback('✅ Я оплатил', 'paid:' + id)],
      [Markup.button.callback('💬 Написать нам', 'contact')]
    ]) }
  );
  await notifyAdmin(id, 'выбран способ оплаты');
});

/* ---------- Реферальная программа ---------- */
bot.action('ref', async ctx => {
  await ctx.answerCbQuery();
  const u = userOf(ctx.from.id);
  const me = ctx.botInfo && ctx.botInfo.username ? ctx.botInfo.username : 'akulavka_bot';
  const link = `https://t.me/${me}?start=ref_${ctx.from.id}`;
  const n = refCount(ctx.from.id);
  await ctx.editMessageText(
    '<b>👥 Приводите друзей — получайте деньги</b>\n\n' +
    `${CONFIG.refFirst}% с первой покупки приглашённого и ${CONFIG.refNext}% со всех следующих. ` +
    'Бонус падает на баланс и автоматически списывается с вашего следующего заказа.\n\n' +
    '<b>Ваша ссылка:</b>\n<code>' + link + '</code>\n\n' +
    `Приглашено: <b>${n}</b>\nЗаработано всего: <b>${money(u.refEarned)}</b>\n` +
    `Баланс сейчас: <b>${money(u.balance)}</b>`,
    { parse_mode:'HTML', ...Markup.inlineKeyboard([
      [Markup.button.url('📨 Отправить другу',
        'https://t.me/share/url?url=' + encodeURIComponent(link) +
        '&text=' + encodeURIComponent('Подписки на нейросети на свой аккаунт — Claude, ChatGPT и другие'))],
      [Markup.button.callback('◀︎ Назад', 'home')]
    ]) }
  );
});

/* ---------- Справка и контакты ---------- */
bot.action('help', async ctx => {
  await ctx.answerCbQuery();
  await ctx.editMessageText(
    '<b>Как это работает</b>\n\n' +
    '1. Выбираете в каталоге и оформляете заказ\n' +
    '2. Оплачиваете криптой или на ЮMoney\n' +
    '3. Даёте данные: для Claude — только ID аккаунта, пароль не нужен. Для остальных — временный пароль, который меняете сразу после\n' +
    '4. Пользуетесь. За три дня до конца месяца напомним про продление\n\n' +
    '<b>Если подписка слетит</b> в течение оплаченного месяца — восстанавливаем за свой счёт или возвращаем деньги за оставшиеся дни.\n\n' +
    `Работаем с ${CONFIG.openFrom}:00 до ${CONFIG.openTo}:00.`,
    { parse_mode:'HTML', ...Markup.inlineKeyboard([
      [Markup.button.url('📖 Бесплатный гайд по Claude', CONFIG.guide)],
      [Markup.button.callback('💬 Написать нам', 'contact')],
      [Markup.button.callback('◀︎ Назад', 'home')]
    ]) }
  );
});

bot.action('contact', async ctx => {
  await ctx.answerCbQuery();
  await ctx.editMessageText(
    '<b>Напишите нам</b>\n\nОтветим лично — без ботов-автоответчиков.\n\n' +
    (isOpen() ? '🟢 Сейчас на связи.' : `🌙 Сейчас закрыто, ответим с ${CONFIG.openFrom}:00.`),
    { parse_mode:'HTML', ...Markup.inlineKeyboard([
      [Markup.button.url('💬 Открыть чат', 'https://t.me/hipnohop')],
      [Markup.button.url('📢 Канал про нейросети', CONFIG.channel)],
      [Markup.button.callback('◀︎ Назад', 'home')]
    ]) }
  );
});

bot.action('home', async ctx => {
  await ctx.answerCbQuery();
  await ctx.editMessageText(HELLO(ctx.from.first_name), { parse_mode:'HTML', ...mainMenu() });
});

/* ---------- Команды для тебя ---------- */
bot.command('stats', ctx => {
  if (ctx.from.id !== CONFIG.adminId) return;
  const o = db.orders;
  const active = o.filter(x => x.status === 'активна');
  const revenue = o.filter(x => ['оплачен','оформляется','активна'].includes(x.status))
                   .reduce((s, x) => s + x.due, 0);
  const soon = active.filter(x => x.endsAt && x.endsAt - Date.now() < 4 * 864e5);
  ctx.replyWithHTML(
    `<b>Сводка</b>\n\n` +
    `Всего заказов: ${o.length}\n` +
    `Ждут оплаты: ${o.filter(x => x.status.includes('ждёт') || x.status.includes('заявлена')).length}\n` +
    `Активных подписок: ${active.length}\n` +
    `Истекают в 3 дня: ${soon.length}\n` +
    `Выручка: ${money(revenue)}\n` +
    `Пользователей в боте: ${Object.keys(db.users).length}\n` +
    `Пришли по рефералкам: ${Object.values(db.users).filter(u => u.invitedBy).length}\n` +
    `Начислено бонусов: ${money(Object.values(db.users).reduce((s2,u)=>s2+(u.refEarned||0),0))}`
  );
});

bot.command('orders', ctx => {
  if (ctx.from.id !== CONFIG.adminId) return;
  const last = db.orders.slice(-10).reverse();
  if (!last.length) return ctx.reply('Заказов пока нет.');
  ctx.replyWithHTML('<b>Последние заказы</b>\n\n' + last.map(o =>
    `№${o.id} · ${o.user}\n${o.items.map(i => i.name).join(', ')} — ${money(o.due)} · ${o.status}` +
    (o.endsAt ? `\nДо ${fmtDate(o.endsAt)}` : '')).join('\n\n'));
});

/* ---------- Напоминания о продлении ---------- */
async function checkRenewals() {
  const now = Date.now();
  for (const o of db.orders) {
    if (o.status !== 'активна' || !o.endsAt || o.reminded) continue;
    const daysLeft = (o.endsAt - now) / 864e5;
    if (daysLeft > 3 || daysLeft < 0) continue;

    const names = o.items.map(i => i.name).join(', ');
    try {
      await bot.telegram.sendMessage(o.uid,
        `<b>Напоминание о продлении</b>\n\n${names} заканчивается ${fmtDate(o.endsAt)}.\n\n` +
        `Продление — ${money(o.total)}, криптой ${money(crypto(o.total))}. Оформим в тот же день.\n\n` +
        `Если не нужно — просто не отвечайте, ничего списываться не будет.`,
        { parse_mode:'HTML', ...Markup.inlineKeyboard([
          [Markup.button.callback('🔄 Продлить', 'shop')],
          [Markup.button.callback('💬 Написать нам', 'contact')]
        ]) });
      await bot.telegram.sendMessage(CONFIG.adminId,
        `⏰ Напомнил о продлении: ${o.user}, заказ №${o.id} (${names}), до ${fmtDate(o.endsAt)}`);
      o.reminded = true; save(db);
    } catch (e) { console.error('renewal:', e.message); }
  }
}
setInterval(checkRenewals, 60 * 60 * 1000);  // раз в час
setTimeout(checkRenewals, 30 * 1000);        // и через полминуты после старта

/* ---------- Запуск ---------- */
bot.catch(err => console.error('Ошибка бота:', err));

bot.launch().then(() => {
  console.log('AKU Лавка запущена');
  bot.telegram.sendMessage(CONFIG.adminId, '🟢 Бот AKU Лавка запущен и готов принимать заказы.')
     .catch(() => {});
});

process.once('SIGINT',  () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
