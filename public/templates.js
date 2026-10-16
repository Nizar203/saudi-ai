// قوالب سعودي AI الجاهزة: تطبيق كامل لنشاط محلي يُبنى فوراً من نموذج قصير، بدون استدعاء ذكاء اصطناعي.
// كل طلب أو حجز يُرسل لواتساب صاحب النشاط برسالة جاهزة.
(function () {
  const PALETTES = {
    green: { name: 'أخضر', a: '#006c35', s: '#e3f1e8', g: '#b8892b' },
    navy: { name: 'كحلي', a: '#1d3b6e', s: '#e6ecf6', g: '#c79a3b' },
    rose: { name: 'وردي', a: '#a23b62', s: '#f8e8ee', g: '#c08a4a' },
    oud: { name: 'عودي', a: '#5b3a24', s: '#f3ebe3', g: '#b8892b' },
    teal: { name: 'فيروزي', a: '#0e6e73', s: '#e1f2f2', g: '#c4943a' },
  };

  const TYPES = {
    salon: {
      label: 'صالون / مشغل', icon: '💇‍♀️', kind: 'booking', palette: 'rose',
      tagline: 'احجزي موعدك بسهولة، ونأكد لك على الواتساب',
      itemsTitle: 'خدماتنا',
      items: 'قص وتسريح | 80\nصبغة كاملة | 250\nبروتين | 400\nمكياج مناسبات | 300\nعناية بالبشرة | 150',
      fields: [],
      cta: 'احجز الآن',
    },
    car: {
      label: 'ورشة / مركز سيارات', icon: '🚗', kind: 'booking', palette: 'navy',
      tagline: 'صيانة بأسعار واضحة ومواعيد بدون انتظار',
      itemsTitle: 'الخدمات',
      items: 'تغيير زيت وفلتر | 150\nفحص شامل قبل الشراء | 200\nفحص كمبيوتر | 100\nتوازن ووزن أذرعة | 120\nتنظيف بخار للمكينة | 90',
      fields: [{ id: 'car', label: 'نوع السيارة وموديلها', type: 'text', ph: 'مثال: كامري 2021' }],
      cta: 'احجز موعد',
    },
    clinic: {
      label: 'عيادة / مجمع طبي', icon: '🩺', kind: 'booking', palette: 'teal',
      tagline: 'احجز موعدك، ويتواصل معك الاستقبال للتأكيد',
      itemsTitle: 'العيادات',
      items: 'طب عام | 150\nأسنان | 200\nجلدية | 250\nأطفال | 180\nنساء وولادة | 250',
      fields: [{ id: 'age', label: 'عمر المريض', type: 'text', ph: 'مثال: 34' }],
      cta: 'احجز موعد',
      note: 'الحجز عبر هذه الصفحة لا يغني عن الطوارئ. في الحالات الطارئة اتصل على 997.',
    },
    perfume: {
      label: 'متجر عطور وبخور', icon: '🌹', kind: 'order', palette: 'oud',
      tagline: 'اختر طلبك، ونرتب التوصيل معك على الواتساب',
      itemsTitle: 'المنتجات',
      items: 'دهن عود كمبودي 3 مل | 350\nعطر مسك أبيض 100 مل | 180\nبخور معمول فاخر | 120\nعطر ورد طائفي 50 مل | 290\nطقم هدايا | 450',
      fields: [{ id: 'addr', label: 'الحي / عنوان التوصيل', type: 'text', ph: 'الحي واسم الشارع' }],
      cta: 'أرسل الطلب',
    },
    realestate: {
      label: 'مكتب عقار', icon: '🏠', kind: 'listing', palette: 'green',
      tagline: 'عروض موثوقة، واستفسارك يصلنا مباشرة',
      itemsTitle: 'العروض المتاحة',
      items: 'شقة 3 غرف للإيجار - حي النرجس | 45000 | سنوي\nفيلا دورين للبيع - حي الياسمين | 2400000\nأرض سكنية 600م - حي الملقا | 1800000\nمحل تجاري للإيجار - شارع رئيسي | 60000 | سنوي',
      fields: [],
      cta: 'استفسر',
    },
    tutor: {
      label: 'مدرب / دروس خصوصية', icon: '📚', kind: 'booking', palette: 'navy',
      tagline: 'احجز حصتك حضورياً أو عن بعد',
      itemsTitle: 'المواد والبرامج',
      items: 'رياضيات - ابتدائي ومتوسط | 100\nرياضيات - ثانوي | 150\nلغة إنجليزية | 120\nتأسيس قراءة وكتابة | 90\nتحضير قدرات وتحصيلي | 180',
      fields: [
        { id: 'level', label: 'المرحلة الدراسية', type: 'text', ph: 'مثال: ثالث متوسط' },
        { id: 'mode', label: 'طريقة الحصة', type: 'select', options: ['حضوري', 'عن بعد'] },
      ],
      cta: 'احجز حصة',
    },
  };

  // 05XXXXXXXX أو 5XXXXXXXX أو +9665... → 9665XXXXXXXX
  function normPhone(v) {
    let d = String(v || '').replace(/[٠-٩]/g, (c) => '٠١٢٣٤٥٦٧٨٩'.indexOf(c)).replace(/\D/g, '');
    if (d.startsWith('00')) d = d.slice(2);
    if (d.startsWith('05')) d = '966' + d.slice(1);
    else if (/^5\d{8}$/.test(d)) d = '966' + d;
    return /^\d{10,15}$/.test(d) ? d : '';
  }

  function parseItems(text, kind) {
    return String(text || '').split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 40).map((l) => {
      const [name, price, unit] = l.split('|').map((x) => (x || '').trim());
      const n = Number(String(price || '').replace(/[٠-٩]/g, (c) => '٠١٢٣٤٥٦٧٨٩'.indexOf(c)).replace(/[^\d.]/g, ''));
      return { name: name.slice(0, 120), price: Number.isFinite(n) && n > 0 ? n : null, unit: (unit || '').slice(0, 30) };
    }).filter((i) => i.name);
  }

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function build(typeKey, form) {
    const T = TYPES[typeKey];
    if (!T) throw new Error('قالب غير معروف');
    const P = PALETTES[form.palette] || PALETTES[T.palette];
    const cfg = {
      kind: T.kind,
      name: (form.name || 'نشاطي').slice(0, 60),
      tagline: (form.tagline || T.tagline).slice(0, 140),
      city: (form.city || '').slice(0, 60),
      hours: (form.hours || '').slice(0, 80),
      wa: normPhone(form.whatsapp),
      maps: /^https:\/\/(maps\.app\.goo\.gl|goo\.gl|www\.google\.com\/maps|maps\.google\.com)\//.test(form.maps || '') ? form.maps : '',
      itemsTitle: T.itemsTitle,
      items: parseItems(form.items || T.items, T.kind),
      fields: T.fields,
      cta: T.cta,
      note: T.note || '',
      icon: T.icon,
    };
    const data = JSON.stringify(cfg).replace(/</g, '\\u003c');
    return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(cfg.name)}</title>
<meta name="description" content="${esc(cfg.tagline)}">
<style>
:root{--a:${P.a};--s:${P.s};--g:${P.g};--ink:#1b1f1d;--mute:#5d6762;--line:#e3e7e4;--bg:#f7f8f7;--card:#fff}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.7 system-ui,-apple-system,"Segoe UI","Noto Sans Arabic",Tahoma,sans-serif}
a{color:inherit}
.wrap{max-width:880px;margin:0 auto;padding:0 16px}
header.hero{background:var(--a);color:#fff;padding:36px 0 28px;position:relative;overflow:hidden}
header.hero::after{content:"";position:absolute;inset:auto 0 0 0;height:6px;background:repeating-linear-gradient(135deg,var(--g) 0 8px,transparent 8px 16px)}
.logo{width:56px;height:56px;border-radius:16px;background:rgba(255,255,255,.15);display:grid;place-items:center;font-size:28px;margin-bottom:12px}
h1{margin:0 0 6px;font-size:1.9rem;line-height:1.3}
.tag{margin:0 0 14px;opacity:.92}
.meta{display:flex;flex-wrap:wrap;gap:8px;font-size:.9rem}
.meta span,.meta a{background:rgba(255,255,255,.14);padding:4px 10px;border-radius:99px;text-decoration:none}
.qa{display:flex;gap:8px;margin-top:18px;flex-wrap:wrap}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;border:0;border-radius:12px;padding:11px 18px;font:inherit;font-weight:600;cursor:pointer;text-decoration:none}
.btn.wa{background:#25d366;color:#fff}
.btn.light{background:#fff;color:var(--a)}
.btn.main{background:var(--a);color:#fff;width:100%;font-size:1.05rem;padding:13px}
.btn:disabled{opacity:.5;cursor:not-allowed}
section{padding:26px 0 6px}
h2{font-size:1.25rem;margin:0 0 14px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:12px}
.item{background:var(--card);border:1.5px solid var(--line);border-radius:16px;padding:14px;display:flex;flex-direction:column;gap:6px;text-align:start;font:inherit;color:inherit;cursor:pointer;transition:border-color .15s,box-shadow .15s}
.item:hover{border-color:var(--a)}
.item.on{border-color:var(--a);box-shadow:0 0 0 3px var(--s)}
.item b{font-size:1.02rem}
.price{color:var(--a);font-weight:700}
.price small{color:var(--mute);font-weight:400}
.qty{display:flex;align-items:center;gap:8px;margin-top:4px}
.qty button{width:32px;height:32px;border-radius:10px;border:1px solid var(--line);background:var(--bg);font:inherit;font-size:1.1rem;cursor:pointer}
.qty output{min-width:22px;text-align:center;font-weight:600}
form.card{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:18px;display:grid;gap:12px}
label{display:grid;gap:4px;font-size:.92rem;color:var(--mute)}
input,select,textarea{font:inherit;color:var(--ink);background:var(--bg);border:1px solid var(--line);border-radius:12px;padding:10px 12px;width:100%}
input:focus,select:focus,textarea:focus{outline:2px solid var(--a);outline-offset:1px;border-color:transparent}
.row2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.sum{background:var(--s);border-radius:12px;padding:10px 12px;font-size:.95rem}
.note{font-size:.85rem;color:var(--mute);background:var(--card);border:1px dashed var(--line);border-radius:12px;padding:10px 12px}
.err{color:#a12a2a;font-size:.88rem;min-height:1.2em}
footer{padding:30px 0 70px;text-align:center;color:var(--mute);font-size:.85rem}
.float{position:fixed;bottom:16px;right:16px;width:56px;height:56px;border-radius:50%;background:#25d366;color:#fff;display:grid;place-items:center;box-shadow:0 8px 20px -6px rgba(0,0,0,.35);text-decoration:none;z-index:5}
.float svg{width:28px;height:28px}
@media (max-width:560px){h1{font-size:1.55rem}.row2{grid-template-columns:1fr}}
</style>
</head>
<body>
<div id="root"></div>
<script>
const C=${data};
const WA_ICON='<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.7.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6a2.7 2.7 0 0 0 1.8-1.2 2.2 2.2 0 0 0 .1-1.2c0-.1-.2-.2-.5-.3Z"/></svg>';
const $=(s,r=document)=>r.querySelector(s);
const h=(tag,attrs={},...kids)=>{const e=document.createElement(tag);for(const[k,v]of Object.entries(attrs)){if(k==='class')e.className=v;else if(k.startsWith('on'))e[k]=v;else if(v!==false&&v!=null)e.setAttribute(k,v===true?'':v)}kids.flat().forEach(c=>e.append(c instanceof Node?c:document.createTextNode(c)));return e};
const fmt=n=>Number(n).toLocaleString('ar-SA')+' ريال';
const db=window.appDB||{get:(k,f)=>f,set:()=>{}};
const sel=new Map();
const waLink=t=>'https://wa.me/'+C.wa+'?text='+encodeURIComponent(t);

function itemCard(it,i){
  const price=it.price!=null?h('span',{class:'price'},fmt(it.price),it.unit?h('small',{},' / '+it.unit):''):h('span',{class:'price'},'السعر عند التواصل');
  if(C.kind==='order'){
    const out=h('output',{},'0');
    const set=q=>{q=Math.max(0,Math.min(20,q));q?sel.set(i,q):sel.delete(i);out.value=q;card.classList.toggle('on',q>0);upd()};
    const card=h('div',{class:'item'},h('b',{},it.name),price,h('div',{class:'qty'},
      h('button',{type:'button','aria-label':'إنقاص',onclick:()=>set((sel.get(i)||0)-1)},'−'),out,
      h('button',{type:'button','aria-label':'زيادة',onclick:()=>set((sel.get(i)||0)+1)},'+')));
    return card;
  }
  const card=h('button',{type:'button',class:'item','aria-pressed':'false',onclick:()=>{
    if(C.kind==='listing'){sel.clear();document.querySelectorAll('.item').forEach(x=>{x.classList.remove('on');x.setAttribute('aria-pressed','false')})}
    sel.has(i)?sel.delete(i):sel.set(i,1);card.classList.toggle('on',sel.has(i));card.setAttribute('aria-pressed',sel.has(i));upd();
    if(sel.has(i))$('#f-name').focus({preventScroll:false})}},h('b',{},it.name),price);
  return card;
}
function total(){let t=0,known=true;sel.forEach((q,i)=>{const p=C.items[i].price;p!=null?t+=p*q:known=false});return{t,known}}
function upd(){
  const s=$('#sum');if(!s)return;
  if(!sel.size){s.textContent=C.kind==='order'?'لم تختر منتجات بعد.':C.kind==='listing'?'اختر العرض الذي تريد الاستفسار عنه من الأعلى.':'اختر خدمة أو أكثر من الأعلى.';return}
  const names=[...sel].map(([i,q])=>C.items[i].name+(q>1?' × '+q:''));const {t,known}=total();
  s.textContent='اخترت: '+names.join('، ')+(t&&C.kind!=='listing'?' — الإجمالي التقريبي: '+fmt(t)+(known?'':' + بنود تُسعّر لاحقاً'):'');
}
function field(f){
  const id='f-'+f.id;
  if(f.type==='select')return h('label',{for:id},f.label,h('select',{id},f.options.map(o=>h('option',{},o))));
  return h('label',{for:id},f.label,h('input',{id,type:f.type||'text',placeholder:f.ph||''}));
}
function submit(e){
  e.preventDefault();const err=$('#err');err.textContent='';
  const name=$('#f-name').value.trim(),phone=$('#f-phone').value.trim();
  if(!sel.size){err.textContent=C.kind==='order'?'اختر منتجاً واحداً على الأقل.':'اختر من القائمة أولاً.';return}
  if(!name){err.textContent='اكتب اسمك من فضلك.';$('#f-name').focus();return}
  if(!C.wa){err.textContent='رقم واتساب النشاط غير مضبوط بعد.';return}
  const lines=[];
  lines.push(C.kind==='order'?'طلب جديد 🛍️':C.kind==='listing'?'استفسار عن عرض 🏠':'طلب حجز 📅');
  lines.push('الاسم: '+name);if(phone)lines.push('الجوال: '+phone);
  [...sel].forEach(([i,q])=>{const it=C.items[i];lines.push('• '+it.name+(q>1?' × '+q:'')+(it.price!=null&&C.kind!=='listing'?' ('+fmt(it.price*q)+')':''))});
  const {t}=total();if(C.kind==='order'&&t)lines.push('الإجمالي التقريبي: '+fmt(t));
  if(C.kind==='booking'){const d=$('#f-date').value,tm=$('#f-time').value;if(d)lines.push('التاريخ المفضل: '+d);if(tm)lines.push('الوقت المفضل: '+tm)}
  C.fields.forEach(f=>{const v=$('#f-'+f.id).value.trim();if(v)lines.push(f.label+': '+v)});
  const notes=$('#f-notes').value.trim();if(notes)lines.push('ملاحظات: '+notes);
  db.set('customer',{name,phone});
  const u=waLink(lines.join('\\n'));const w=window.open(u,'_blank');if(w)w.opener=null;else location.href=u;
}
function app(){
  const saved=db.get('customer',{name:'',phone:''})||{};
  const meta=h('div',{class:'meta'});
  if(C.city)meta.append(h('span',{},'📍 '+C.city));
  if(C.hours)meta.append(h('span',{},'🕘 '+C.hours));
  if(C.maps)meta.append(h('a',{href:C.maps,target:'_blank',rel:'noopener'},'🗺️ الموقع على الخريطة'));
  const qa=h('div',{class:'qa'},h('a',{class:'btn light',href:'#book'},C.cta));
  if(C.wa)qa.append(h('a',{class:'btn wa',href:waLink('السلام عليكم، عندي استفسار'),target:'_blank',rel:'noopener'},'واتساب'),h('a',{class:'btn light',href:'tel:+'+C.wa},'اتصال'));
  const today=new Date();today.setMinutes(today.getMinutes()-today.getTimezoneOffset());
  const form=h('form',{class:'card',onsubmit:submit,novalidate:true},
    h('div',{class:'sum',id:'sum','aria-live':'polite'}),
    h('div',{class:'row2'},
      h('label',{for:'f-name'},'الاسم',h('input',{id:'f-name',autocomplete:'name',value:saved.name||''})),
      h('label',{for:'f-phone'},'رقم الجوال',h('input',{id:'f-phone',type:'tel',inputmode:'tel',autocomplete:'tel',placeholder:'05XXXXXXXX',value:saved.phone||'',dir:'ltr'}))),
    C.kind==='booking'?h('div',{class:'row2'},
      h('label',{for:'f-date'},'التاريخ المفضل',h('input',{id:'f-date',type:'date',min:today.toISOString().slice(0,10)})),
      h('label',{for:'f-time'},'الوقت المفضل',h('input',{id:'f-time',type:'time'}))):'',
    C.fields.length?h('div',{class:'row2'},C.fields.map(field)):'',
    h('label',{for:'f-notes'},'ملاحظات (اختياري)',h('textarea',{id:'f-notes',rows:'2'})),
    h('div',{class:'err',id:'err',role:'alert'}),
    h('button',{class:'btn main',type:'submit'},C.cta+' عبر واتساب'),
    h('div',{class:'note'},'عند الضغط يُفتح واتساب برسالة جاهزة فيها تفاصيل طلبك، أرسلها ليصلنا ونؤكد معك.'));
  const root=$('#root');
  root.append(
    h('header',{class:'hero'},h('div',{class:'wrap'},h('div',{class:'logo','aria-hidden':'true'},C.icon),h('h1',{},C.name),h('p',{class:'tag'},C.tagline),meta,qa)),
    h('main',{},
      h('section',{},h('div',{class:'wrap'},h('h2',{},C.itemsTitle),h('div',{class:'grid'},C.items.map(itemCard)))),
      h('section',{id:'book'},h('div',{class:'wrap'},h('h2',{},C.kind==='order'?'إتمام الطلب':C.kind==='listing'?'أرسل استفسارك':'بيانات الحجز'),form,
        C.note?h('p',{class:'note',style:'margin-top:12px'},C.note):''))),
    h('footer',{},h('div',{class:'wrap'},'© '+new Date().getFullYear()+' '+C.name)));
  if(C.wa){const f=h('a',{class:'float',href:waLink('السلام عليكم'),target:'_blank',rel:'noopener','aria-label':'تواصل عبر واتساب'});f.innerHTML=WA_ICON;root.append(f)}
  upd();
}
app();
<\/script>
</body>
</html>`;
  }

  // ملف المشروع (الذاكرة) المبدئي للقالب، حتى يلتزم الذكاء الاصطناعي بالقرارات عند أي تعديل لاحق
  function brief(typeKey, form) {
    const T = TYPES[typeKey];
    const wa = normPhone(form.whatsapp);
    const P = PALETTES[form.palette] || PALETTES[T.palette];
    return [
      '## الهدف',
      `- صفحة ${T.label} باسم «${form.name || 'نشاطي'}»${form.city ? ' في ' + form.city : ''}، يحجز/يطلب منها العملاء.`,
      '## التصميم',
      `- اللون الأساسي ${P.a} (${P.name})، واجهة عربية من اليمين لليسار، مناسبة للجوال أولاً.`,
      '## الشاشات والميزات',
      `- قائمة «${T.itemsTitle}» بالأسعار بالريال، ونموذج ${T.kind === 'order' ? 'طلب بسلة كميات' : T.kind === 'listing' ? 'استفسار عن عرض' : 'حجز موعد'}.`,
      '- كل طلب يُرسل لواتساب صاحب النشاط برسالة جاهزة عبر رابط wa.me، مع زر واتساب عائم وزر اتصال.',
      '## البيانات المحفوظة',
      '- appDB "customer": اسم وجوال العميل لتعبئتهما تلقائياً في المرة القادمة.',
      '## قرارات المستخدم',
      wa ? `- رقم واتساب النشاط: ${wa} (لا تغيّره إلا بطلب صريح).` : '- رقم واتساب النشاط لم يُضبط بعد.',
      '- لا يوجد دفع إلكتروني حالياً؛ التأكيد يتم عبر واتساب.',
    ].join('\n');
  }

  window.SaudiTemplates = { TYPES, PALETTES, build, brief, normPhone };
})();
