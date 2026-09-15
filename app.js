const sectorData = {
  construction: {
    category: 'Долговечность в реальных условиях',
    title: 'Гражданское<br>строительство',
    description: 'От усиления конструкций до защитных покрытий — свойства системы определяет среда, в которой она будет работать.',
    list: ['Наружное усиление конструкций', 'Гидроизоляционные решения', 'Составы для защитных покрытий'],
    photo: 'assets/construction-light.jpg',
    photoAlt: 'Изогнутый фасад современного здания из голубого стекла на фоне неба',
    photoLabel: 'Материалы для инфраструктуры',
    counter: '01 / 04',
    topic: 'Система для строительства'
  },
  industry: {
    category: 'Высокоточные процессы',
    title: 'Промышленность',
    description: 'Разрабатываем композиты для производственного оборудования и компонентов, где материал одновременно должен выдерживать механические нагрузки и отвечать требованиям точности.',
    list: ['Композитные детали для оборудования', 'Системы для высокотемпературных условий', 'Защита от химического воздействия'],
    photo: 'assets/industry-light.jpg',
    photoAlt: 'Промышленное оборудование, ёмкости и трубопроводы из нержавеющей стали',
    photoLabel: 'Промышленные объекты',
    counter: '02 / 04',
    topic: 'Система для промышленности'
  },
  sport: {
    category: 'Лёгкость и прочность',
    title: 'Спорт и композиты',
    description: 'Помогаем разработчикам спортивного оборудования и дизайнерам подобрать эпоксидную систему под технологию формования — инфузию, компрессионную формовку или ручную укладку.',
    list: ['Высокопрочные композитные изделия', 'Клюшки, ракетки и велорамы', 'Системы для инфузии и формовки'],
    photo: 'assets/sport-light.jpg',
    photoAlt: 'Бирюзовый шоссейный велосипед у светло-голубой стены',
    photoLabel: 'Инновационные материалы',
    counter: '03 / 04',
    topic: 'Система для спортивных композитов'
  },
  electronics: {
    category: 'Диэлектрические свойства',
    title: 'Электроника',
    description: 'Составы для заливки компонентов, герметизации, защитных покрытий плат и корпусов, где важны диэлектрические характеристики и термостабильность материала.',
    list: ['Заливочные компаунды', 'Защита электронных узлов', 'Системы для прецизионных применений'],
    photo: 'assets/electronics-light.jpg',
    photoAlt: 'Электронная плата и компоненты на светло-голубой рабочей поверхности',
    photoLabel: 'Специальные свойства',
    counter: '04 / 04',
    topic: 'Система для электроники'
  }
};

function $(s) { return document.querySelector(s); }
function $$(s) { return Array.from(document.querySelectorAll(s)); }

const menuToggle = $('#menu-toggle');
const nav = $('#site-nav');
menuToggle.addEventListener('click', () => {
  const open = nav.classList.toggle('nav-open');
  menuToggle.setAttribute('aria-expanded', open);
});
$$('#site-nav a').forEach(a => a.addEventListener('click', () => {
  nav.classList.remove('nav-open');
  menuToggle.setAttribute('aria-expanded', 'false');
}));

const sectorButtons = $$('[data-sector]');
sectorButtons.forEach(btn => btn.addEventListener('click', () => {
  const sector = btn.dataset.sector;
  sectorButtons.forEach(b => b.setAttribute('aria-pressed', b === btn));
  const data = sectorData[sector];
  $('#application-category').textContent = data.category;
  $('#application-title').innerHTML = data.title;
  $('#application-description').textContent = data.description;
  const list = $('#application-list');
  list.innerHTML = data.list.map(t => `<li>${t}</li>`).join('');
  const img = $('#application-image');
  img.src = data.photo;
  img.alt = data.photoAlt;
  $('#application-photo-label').textContent = data.photoLabel;
  $('#application-counter').textContent = data.counter;
  $('#application-cta').dataset.topic = data.topic;
}));

const form = $('#contact-form');
const status = $('#form-status');
const name = $('#name'), nameErr = $('#name-error');
const email = $('#email'), emailErr = $('#email-error');
form.addEventListener('submit', ev => {
  ev.preventDefault();
  let valid = true;
  nameErr.textContent = emailErr.textContent = status.textContent = '';
  if (!name.value.trim()) { nameErr.textContent = 'Заполните имя'; valid = false; }
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email.value.trim()) { emailErr.textContent = 'Заполните e-mail'; valid = false; }
  else if (!emailPattern.test(email.value.trim())) { emailErr.textContent = 'Укажите корректный e-mail'; valid = false; }
  if (!valid) {
    status.textContent = 'Проверьте заполнение полей.';
    return;
  }
  status.textContent = '✓ Проверка пройдена. Ничего не отправлено — это демонстрационная форма.';
});

$$('a[href^="#"]').forEach(a => a.addEventListener('click', ev => {
  const href = a.getAttribute('href');
  if (href.length > 1) {
    ev.preventDefault();
    const target = $(href);
    if (target) target.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
  }
}));

$$('[data-topic]').forEach(el => el.addEventListener('click', () => {
  const topic = el.dataset.topic;
  const select = $('#topic');
  for (let i = 0; i < select.options.length; i++) {
    if (select.options[i].value === topic) {
      select.selectedIndex = i;
      break;
    }
  }
}));
