/* AKU Лавка — общий каталог. Один файл на три места: сайт, мини-приложение и бот.
   Правите цены и товары здесь — меняется везде. */

const CONFIG = {
  telegram : 'hipnohop',
  bot      : 'akulavka_bot',
  channel  : 'https://t.me/Alekseii_AI',
  siteLink : 'https://aku-automation.io',
  guideLink: 'https://aku-automation.io/guide/?utm_source=lavka&utm_medium=site&utm_campaign=guide',
  cardLink : 'https://t.me/Cashinout_bot?start=23610',
  cardLink2: 'https://platipomiru.com/?utm_source=Aleksei_AI&utm_medium=cpa',
  lexyLink : 'https://lexygpt.com/?ref=ALEKSEIAI',
  promo    : 'NEURO500',
  openFrom : 9,
  openTo   : 23,

  rate      : 92,    // рубли за доллар на карте, со всеми комиссиями
  markup    : 1.46,  // наценка: $20 даёт 2690 ₽
  cryptoOff : 5,     // скидка за оплату криптой, %
  refFirst  : 8,     // % пригласившему с первой покупки друга
  refNext   : 5,     // % со всех следующих

  terms: [
    { months:1, label:'1 месяц',   mult:1,    off:0  },
    { months:3, label:'3 месяца',  mult:2.85, off:5  },
    { months:6, label:'6 месяцев', mult:5.4,  off:10 }
  ],

  cats: [
    { id:'chat',  name:'Чат-модели'       },
    { id:'image', name:'Картинки и видео' },
    { id:'code',  name:'Код'              },
    { id:'sound', name:'Музыка и голос'   },
    { id:'tools', name:'Полезное'         }
  ],

  // Партнёрские позиции — отдельным блоком, не в каталоге товаров
  extras: [
    { id:'lexy', name:'LexyGPT', icon:'lexy', tint:'#C77DFF', external:'LEXY', tag:'Без VPN и карты',
      short:'Картинки и видео прямо в Telegram, без оформления подписок.' },
    { id:'card', name:'Виртуальная карта Cashinout', icon:'card', tint:'#F2601A', external:'CARD', tag:'Платите сами',
      short:'Оплачивать зарубежные сервисы самому. Этой картой пользуемся сами.' },
    { id:'card2', name:'Карта «Плати по всему миру»', icon:'card', tint:'#B4A8FF', external:'CARD2',
      short:'Альтернативный сервис карт с Apple Pay и Google Pay.' },
    { id:'guide', name:'Гайд «Claude с нуля»', icon:'guide', tint:'#3C8C5C', external:'GUIDE', tag:'Бесплатно',
      short:'Как пользоваться Claude, чтобы подписка окупилась.' }
  ],

  goods: [
    { id:'claude', n:1, cat:'chat', name:'Claude Pro', icon:'claude', tint:'#F0864A', usd:20, hit:true, noLogin:true,
      short:'Сильнее всех в тексте, коде и работе с документами.',
      for:'Тексты, аналитика, программирование',
      about:'Подписка Anthropic. Продвинутые модели, длинные диалоги, загрузка файлов. Лучший выбор для работы с текстом и кодом: пишет аккуратнее конкурентов и реже выдумывает. Единственная позиция, которую мы оформляем вообще без доступа к вашему аккаунту — только по ID.',
      inc:['Оформляем по ID — пароль не нужен','Продвинутые модели вместо базовой','Загрузка документов и картинок','Проекты и сохранённые инструкции'] },

    { id:'gpt', n:2, cat:'chat', name:'ChatGPT Plus', icon:'gpt', tint:'#2FBF9A', usd:20, hit:true,
      short:'Самый универсальный. Голос, картинки, разбор файлов.',
      for:'Всё понемногу, первый выбор новичка',
      about:'Подписка OpenAI. Самый популярный сервис: помимо текста рисует картинки, говорит голосом, разбирает таблицы и ищет в интернете. Если берёте первую подписку в жизни — обычно берут эту.',
      inc:['Свежие модели без ограничений базовой версии','Генерация картинок','Голосовой режим','Анализ файлов и таблиц'] },

    { id:'heygen', n:3, cat:'image', name:'HeyGen', icon:'heygen', tint:'#5B8CFF', usd:29, hit:true,
      short:'Видео с говорящим аватаром по тексту.',
      for:'Ролики без съёмки и микрофона',
      about:'Делает видео, где аватар произносит ваш текст на нужном языке. Берут для обучающих роликов, рекламы и контента в соцсети, когда снимать себя не хочется или некогда.',
      inc:['Готовые аватары и голоса','Свой аватар по короткой записи','Озвучка на русском и других языках','Экспорт без водяного знака'] },





    { id:'gemini', n:4, cat:'chat', name:'Google Gemini Pro', icon:'gemini', tint:'#6C8CF5', usd:20,
      short:'Живёт внутри Google Документов, Почты и Диска.', for:'Работа в экосистеме Google',
      about:'Подписка Google. Помощник встроен прямо в Документы, Почту и Диск, плюс даёт дополнительное место в облаке.',
      inc:['Продвинутые модели Google','Помощник в Документах и Почте','Место на Диске','Очень длинные тексты'] },
    { id:'gptgo', n:5, cat:'chat', name:'ChatGPT Go', icon:'gpt', tint:'#2FBF9A', rub:590,
      short:'Урезанный ChatGPT за треть цены.', for:'Первая подписка, попробовать',
      about:'Облегчённый тариф OpenAI: те же свежие модели, но с лимитами пониже, чем в Plus. Берут, чтобы попробовать нейросеть на небольшой сумме и понять, нужен ли полный тариф.',
      inc:['Свежие модели вместо базовой','Генерация картинок','Анализ файлов','Лимиты ниже, чем в Plus'] },

    { id:'spotify', n:6, cat:'sound', name:'Spotify Premium', icon:'suno', tint:'#4BC27A',
      terms:[{ months:3, label:'3 месяца', price:650 },{ months:6, label:'6 месяцев', price:1190 }],
      short:'Музыка без рекламы и с офлайном.', for:'Не нейросеть, но спрашивают часто',
      about:'Подписка Spotify на ваш аккаунт: музыка без рекламы, загрузка треков на телефон и нормальное качество звука. Оформляем так же, как и остальное.',
      inc:['Без рекламы','Загрузка на телефон','Высокое качество','На ваш аккаунт'] },

    { hidden:true, id:'perplexity', n:10, cat:'chat', name:'Perplexity Pro', icon:'perplexity', tint:'#38B3B8', usd:20,
      short:'Поиск с источниками. Для research и учёбы.', for:'Проверка фактов, учёба',
      about:'Поисковик на нейросети: отвечает на вопрос и сразу показывает ссылки на источники.',
      inc:['Неограниченные подробные запросы','Ссылки на источники','Выбор модели под задачу','Загрузка своих файлов'] },
    { hidden:true, id:'grok', n:11, cat:'chat', name:'SuperGrok', icon:'grok', tint:'#B4A8FF', usd:30,
      short:'Свободнее конкурентов, видит происходящее в X.', for:'Свежие данные',
      about:'Подписка xAI. Отвечает свободнее большинства конкурентов и видит, что прямо сейчас обсуждают в X.',
      inc:['Режим рассуждений','Данные из X в реальном времени','Генерация картинок','Повышенные лимиты'] },
    { id:'midjourney', n:7, cat:'image', name:'Midjourney', icon:'midjourney', tint:'#C9CDD6', usd:10,
      short:'Лучшая картинка среди генераторов.', for:'Реклама, обложки, иллюстрации',
      about:'Генератор изображений с самой узнаваемой картинкой на рынке.',
      inc:['Быстрые генерации по тарифу','Работа в веб-версии','Апскейл и вариации','Свои референсы'] },
    { hidden:true, id:'runway', n:12, cat:'image', name:'Runway', icon:'runway', tint:'#7BE3C4', usd:15,
      short:'Видео из текста и фото, монтаж на нейросети.', for:'Ролики и обработка видео',
      about:'Оживляет фотографии, генерирует ролики по описанию, вырезает фон и объекты.',
      inc:['Видео из текста и фото','Удаление фона','Замедление и апскейл','Кредиты по тарифу'] },
    { hidden:true, id:'kling', n:13, cat:'image', name:'Kling AI', icon:'kling', tint:'#FF9BB8', usd:10,
      short:'Реалистичное видео, хорошо держит лица.', for:'Рекламные ролики с людьми',
      about:'Один из сильнейших генераторов видео. Лучше конкурентов справляется с движением людей.',
      inc:['Видео по описанию','Оживление фотографий','Повышенное качество','Приоритетная очередь'] },
    { id:'cursor', n:8, cat:'code', name:'Cursor Pro', icon:'cursor', tint:'#A78BFA', usd:20,
      short:'Редактор кода, который пишет код за вас.', for:'Разработка проектов',
      about:'Среда разработки со встроенным ИИ. Понимает проект целиком и правит несколько файлов сразу.',
      inc:['Запросы без лимитов базовой версии','Работа с проектом целиком','Автодополнение','Агент для правок'] },
    { hidden:true, id:'copilot', n:14, cat:'code', name:'GitHub Copilot', icon:'copilot', tint:'#9EA7B3', usd:10,
      short:'Подсказки кода прямо в вашем редакторе.', for:'Не меняя инструменты',
      about:'Дописывает код по мере набора внутри привычного редактора.',
      inc:['Автодополнение в редакторе','Чат по вашему коду','Объяснение чужого кода','Популярные редакторы'] },
    { id:'suno', n:9, cat:'sound', name:'Suno', icon:'suno', tint:'#F45D9B', usd:10,
      short:'Песни целиком: музыка, вокал и текст.', for:'Джинглы и треки',
      about:'Делает законченный трек с вокалом по описанию жанра и настроения.',
      inc:['Расширенный лимит','Коммерческое использование','Загрузка своего вокала','Хорошее качество'] },
    { hidden:true, id:'seedance', n:15, cat:'image', name:'Seedance 2.5', icon:'runway', tint:'#FFB443', usd:15,
      short:'Генератор видео нового поколения.', for:'Короткие ролики',
      about:'Свежий сервис генерации видео: делает короткие ролики по описанию и оживляет изображения.',
      inc:['Видео по описанию','Оживление картинок','Повышенное качество','Быстрая очередь'] },
    { hidden:true, id:'lovable', n:16, cat:'code', name:'Lovable Pro', icon:'cursor', tint:'#FF7AC6', usd:25,
      short:'Делает сайты и приложения по описанию.', for:'Запуск без разработчика',
      about:'Описываете словами, что должно получиться — сервис собирает рабочее приложение или сайт.',
      inc:['Приложение по описанию','Правки текстом','Публикация в один клик','Экспорт кода'] },
    { hidden:true, id:'eleven', n:17, cat:'sound', name:'ElevenLabs', icon:'eleven', tint:'#7FD1FF', usd:22,
      short:'Озвучка и копирование голоса на русском.', for:'Озвучка роликов',
      about:'Синтез речи, которую тяжело отличить от живой. Копирует голос по короткой записи.',
      inc:['Большой лимит символов','Копирование своего голоса','Естественная русская речь','Высокое качество'] }
  ]
};

const ICONS = {
  claude:     '<path d="M7 6v12M12 3v18M17 8v8"/>',
  gpt:        '<circle cx="12" cy="12" r="3.2"/><circle cx="12" cy="4.6" r="1.7"/><circle cx="18.4" cy="8.3" r="1.7"/><circle cx="18.4" cy="15.7" r="1.7"/><circle cx="12" cy="19.4" r="1.7"/><circle cx="5.6" cy="15.7" r="1.7"/><circle cx="5.6" cy="8.3" r="1.7"/>',
  gemini:     '<circle cx="9" cy="12" r="6"/><circle cx="15" cy="12" r="6"/>',
  perplexity: '<circle cx="11" cy="11" r="6"/><path d="M11 8v6M8 11h6M15.5 15.5 20 20"/>',
  grok:       '<circle cx="12" cy="12" r="9"/><path d="M8 16 16 8M14 8h2v2"/>',
  midjourney: '<path d="M12 3 3 18h18L12 3Z"/><path d="M12 3v15M7.5 11h9"/>',
  runway:     '<path d="M4 20 12 4l8 16"/><path d="M8 14h8M10.5 9h3"/>',
  kling:      '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 6v12M17 6v12M3 12h4M17 12h4"/>',
  heygen:     '<rect x="3" y="4" width="18" height="13" rx="2"/><circle cx="12" cy="9.5" r="2.4"/><path d="M8 14.5c1-1.6 6-1.6 7 0M9 21h6"/>',
  lexy:       '<rect x="3" y="5" width="18" height="14" rx="2.5"/><circle cx="9" cy="10" r="1.8"/><path d="m3 16 5-4 4 3 3-2 6 5"/>',
  cursor:     '<path d="M6 3 18 12l-5.5 1.2L15 20l-2.4 1-2.6-6.5L6 18V3Z"/>',
  copilot:    '<circle cx="8" cy="12" r="4.5"/><circle cx="16" cy="12" r="4.5"/>',
  suno:       '<path d="M3 12c2-6 4 6 6 0s4 6 6 0 4 6 6 0"/>',
  eleven:     '<path d="M5 9v6M9.5 5v14M14.5 7v10M19 10v4"/>',
  card:       '<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M2.5 10h19M6 15h4"/>',
  guide:      '<path d="M4 4.5h6a2.5 2.5 0 0 1 2.5 2.5v13a2 2 0 0 0-2-2H4V4.5Z"/><path d="M20 4.5h-6A2.5 2.5 0 0 0 11.5 7v13a2 2 0 0 1 2-2H20V4.5Z"/>'
};

/* ---------- расчёт цен: один на сайт, приложение и бота ---------- */
const PRICE = {
  termsOf: g => g.terms || CONFIG.terms,
  base:    g => g.rub ? g.rub : Math.round(g.usd * CONFIG.rate * CONFIG.markup / 10) * 10,
  term(g, m) { const t = PRICE.termsOf(g); return t.find(x => x.months === m) || t[0]; },
  priceFor(g, m) {
    const t = PRICE.term(g, m);
    return t.price ? t.price : Math.round(PRICE.base(g) * (t.mult || 1) / 10) * 10;
  },
  crypto: n => Math.round(n * (100 - CONFIG.cryptoOff) / 100 / 10) * 10,
  money:  n => n.toLocaleString('ru-RU') + ' ₽'
};

/* ---------- корзина ⇄ ссылка на бота ----------
   Формат: o + (номер товара ×2 + срок + кол-во) по 4 знака на позицию, затем _ и номер пригласившего.
   Пример: o0111_fcfck5 = Claude Pro, 1 мес, 1 шт., пригласил пользователь 927864149.
   Цены в ссылке не передаются — бот считает их сам по каталогу. Новые товары — с новым n. */
const CART_LINK = {
  encode(items, ref) {
    const body = items.slice(0, 14).map(i => {
      const g = CONFIG.goods.find(x => x.id === i.id);
      return g ? g.n.toString(36).padStart(2, '0') + i.months.toString(36) + Math.min(9, Math.max(1, i.qty)) : '';
    }).join('');
    return 'o' + body + (ref ? '_' + Number(ref).toString(36) : '');
  },
  decode(str) {
    const m = /^o([0-9a-z]*)(?:_([0-9a-z]+))?$/.exec(str || '');
    if (!m) return null;
    const items = [];
    for (let k = 0; k + 4 <= m[1].length; k += 4) {
      const n = parseInt(m[1].slice(k, k + 2), 36), months = parseInt(m[1][k + 2], 36), qty = +m[1][k + 3];
      const g = CONFIG.goods.find(x => x.n === n);
      if (g && PRICE.termsOf(g).some(t => t.months === months) && qty > 0) items.push({ id: g.id, months, qty });
    }
    return { items, ref: m[2] ? parseInt(m[2], 36) : null };
  },
  url(items, ref) { return 'https://t.me/' + CONFIG.bot + '?start=' + CART_LINK.encode(items, ref); }
};

if (typeof module !== 'undefined' && module.exports) module.exports = { CONFIG, ICONS, PRICE, CART_LINK };
