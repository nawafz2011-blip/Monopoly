// بيانات البطاقات — مأخوذة من بطاقات ولوحة اللعبة (صور مجلد cards)
// تقدر تعدلها كلها من داخل الموقع (تبويب البطاقات ← اضغط البطاقة ← تعديل)
// rent للشوارع: [أرض فاضية، بيت، بيتين، 3 بيوت، 4 بيوت، فندق]
// rent للمحطات: [محطة وحدة، محطتين، 3، 4]
// rent للشركات: [مضاعف النرد لو عنده شركة وحدة، مضاعف النرد لو عنده الثنتين]

const DEFAULT_GROUPS = [
  { id: 'brown',     name: 'وردي',          color: '#b8307a', type: 'street' },
  { id: 'lightblue', name: 'أزرق فاتح',     color: '#6ec3ea', type: 'street' },
  { id: 'pink',      name: 'بنفسجي',        color: '#7a3fa3', type: 'street', family: 'purple' },
  { id: 'orange',    name: 'أحمر',          color: '#d81b55', type: 'street', family: 'red' },
  { id: 'red',       name: 'أحمر',          color: '#e3261b', type: 'street', family: 'red' },
  { id: 'yellow',    name: 'أصفر',          color: '#f2d200', type: 'street' },
  { id: 'green',     name: 'أخضر',          color: '#1f9e58', type: 'street' },
  { id: 'darkblue',  name: 'بنفسجي',        color: '#4a2585', type: 'street', family: 'purple' },
  { id: 'station',   name: 'المحطات',       color: '#2b2b2b', type: 'station' },
  { id: 'utility',   name: 'الشركات',       color: '#6f8496', type: 'utility' },
];

// الألوان اللي تطلع مع بعض في صفحة البطاقات (القوانين تبقى كل طقم لحاله)
const FAMILIES = [
  { id: 'brown' }, { id: 'lightblue' },
  { id: 'purple', name: 'بنفسجي', color: '#6a33a0', groups: ['pink', 'darkblue'] },
  { id: 'red', name: 'أحمر', color: '#e3261b', groups: ['orange', 'red'] },
  { id: 'yellow' }, { id: 'green' }, { id: 'station' }, { id: 'utility' },
];

// في هذي النسخة: سعر البيت والفندق 50 لكل البطاقات، وقيمة الرهن = سعر الأرض
const HOUSE = 50;
const DEFAULT_PROPS = [
  // [المجموعة, الاسم بالعربي, الاسم بالإنجليزي, السعر, الإيجارات]
  ['brown', 'طريق أولد كنت', 'Old Kent Road', 60, [10, 50, 150, 450, 625, 750]],
  ['brown', 'طريق ويتشابل', 'Whitechapel Road', 60, [4, 20, 60, 180, 320, 450]],

  ['lightblue', 'منطقة أنجل إيسلنجتون', 'The Angel Islington', 100, [6, 30, 90, 270, 400, 550]],
  ['lightblue', 'طريق يوستون', 'Euston Road', 100, [6, 30, 90, 270, 400, 550]],
  ['lightblue', 'طريق بنتونفل', 'Pentonville Road', 120, [8, 40, 100, 300, 450, 600]],

  ['pink', 'منطقة بال مال', 'Pall Mall', 140, [2, 10, 30, 90, 160, 250]],
  ['pink', 'منطقة ويتهول', 'Whitehall', 140, [10, 50, 150, 450, 625, 750]],
  ['pink', 'شارع نورثمبرلاند', "Northumberl'd Avenue", 160, [12, 60, 180, 500, 700, 900]],

  ['orange', 'شارع بو', 'Bow Street', 180, [14, 70, 200, 550, 750, 950]],
  ['orange', 'شارع مارلبورو', 'Marlborough Street', 180, [14, 70, 200, 550, 750, 950]],
  ['orange', 'شارع فاين', 'Vine Street', 200, [16, 80, 220, 600, 800, 1000]],

  ['red', 'منطقة ستراند', 'The Strand', 220, [18, 90, 250, 700, 875, 1050]],
  ['red', 'شارع فليت', 'Fleet Street', 220, [18, 90, 250, 700, 875, 1050]],
  ['red', 'ميدان ترافلجار', 'Trafalgar Square', 240, [20, 100, 300, 750, 925, 1100]],

  ['yellow', 'ميدان ليستر', 'Leicester Square', 260, [22, 110, 330, 800, 975, 1150]],
  ['yellow', 'شارع كوفنتري', 'Coventry Street', 260, [22, 110, 330, 800, 975, 1150]],
  ['yellow', 'منطقة بيكادلي', 'Piccadilly', 280, [24, 120, 360, 850, 1025, 1200]],

  ['green', 'شارع ريجنت', 'Regent Street', 300, [26, 130, 390, 900, 1100, 1275]],
  ['green', 'شارع أكسفورد', 'Oxford Street', 300, [26, 130, 390, 900, 1100, 1275]],
  ['green', 'شارع بوند', 'Bond Street', 320, [28, 150, 450, 1000, 1200, 1400]],

  ['darkblue', 'منطقة بارك لين', 'Park Lane', 350, [35, 175, 500, 1100, 1300, 1500]],
  ['darkblue', 'منطقة مايفير', 'Mayfair', 400, [50, 200, 600, 1400, 1700, 2000]],

  ['station', 'محطة كنجز كروس', "King's Cross Station", 200, [25, 50, 100, 200]],
  ['station', 'محطة مارليبون', 'Marylebone Station', 200, [25, 50, 100, 200]],
  ['station', 'محطة فنتشيرش ستريت', 'Fenchurch St. Station', 200, [25, 50, 100, 200]],
  ['station', 'محطة ليفربول ستريت', 'Liverpool St. Station', 200, [25, 50, 100, 200]],

  ['utility', 'شركة الكهرباء', 'Electric Company', 150, [4, 10]],
  ['utility', 'شركة المياه', 'Water Works', 150, [4, 10]],
];

// مبلغ الخروج من السجن
const JAIL_FEE = 50;

// مبالغ سريعة تطلع في "دفع للبنك"
const TAXES = [
  { name: 'ضريبة الدخل', amount: 200 },
  { name: 'الضريبة العظمى', amount: 100 },
];

function defaultProps() {
  return DEFAULT_PROPS.map(([group, name, en, price, rent], i) => ({
    id: 'p' + (i + 1),
    group, name, en, price, rent: rent.slice(),
    house: group === 'station' || group === 'utility' ? 0 : HOUSE,
    mortgage: price,
  }));
}

// ترتيب اللوحة (40 خانة) — مثل لوحتكم في الفيديو. الخانة 0 = البداية، ونمشي عكس عقارب الساعة
// p = رقم البطاقة من القائمة فوق
const BOARD = [
  { t: 'go', name: 'البداية' },
  { t: 'prop', p: 'p1' },                      // 1 طريق أولد كنت
  { t: 'chest', name: 'صندوق الجماعة' },
  { t: 'prop', p: 'p2' },                      // 3 طريق ويتشابل
  { t: 'tax', name: 'ضريبة الدخل', amount: 200 },
  { t: 'prop', p: 'p25' },                     // 5 محطة فنتشيرش ستريت
  { t: 'prop', p: 'p3' },                      // 6 أنجل إيسلنجتون
  { t: 'chance', name: 'الحظ' },
  { t: 'prop', p: 'p4' },                      // 8 طريق يوستون
  { t: 'prop', p: 'p5' },                      // 9 طريق بنتونفل
  { t: 'jail', name: 'السجن (زيارة)' },        // 10
  { t: 'prop', p: 'p6' },                      // 11 بال مال
  { t: 'prop', p: 'p27' },                     // 12 شركة الكهرباء
  { t: 'prop', p: 'p7' },                      // 13 ويتهول
  { t: 'prop', p: 'p8' },                      // 14 نورثمبرلاند
  { t: 'prop', p: 'p24' },                     // 15 محطة مارليبون
  { t: 'prop', p: 'p9' },                      // 16 شارع بو
  { t: 'chest', name: 'صندوق الجماعة' },
  { t: 'prop', p: 'p10' },                     // 18 مارلبورو
  { t: 'prop', p: 'p11' },                     // 19 فاين
  { t: 'parking', name: 'موقف السيارات' },     // 20
  { t: 'prop', p: 'p12' },                     // 21 ستراند
  { t: 'chance', name: 'الحظ' },
  { t: 'prop', p: 'p13' },                     // 23 فليت
  { t: 'prop', p: 'p14' },                     // 24 ترافلجار
  { t: 'prop', p: 'p23' },                     // 25 محطة كنجز كروس
  { t: 'prop', p: 'p15' },                     // 26 ليستر
  { t: 'prop', p: 'p16' },                     // 27 كوفنتري
  { t: 'prop', p: 'p28' },                     // 28 شركة المياه
  { t: 'prop', p: 'p17' },                     // 29 بيكادلي
  { t: 'gotojail', name: 'روح للسجن' },        // 30
  { t: 'prop', p: 'p18' },                     // 31 ريجنت
  { t: 'prop', p: 'p19' },                     // 32 أكسفورد
  { t: 'chest', name: 'صندوق الجماعة' },
  { t: 'prop', p: 'p20' },                     // 34 بوند
  { t: 'prop', p: 'p26' },                     // 35 محطة ليفربول ستريت
  { t: 'chance', name: 'الحظ' },
  { t: 'prop', p: 'p21' },                     // 37 بارك لين
  { t: 'tax', name: 'الضريبة العظمى', amount: 100 },
  { t: 'prop', p: 'p22' },                     // 39 مايفير
];
const JAIL_POS = 10;
