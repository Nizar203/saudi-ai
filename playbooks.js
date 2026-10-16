// معرفة متخصصة تُضاف لطلب البناء حسب نوع التطبيق.
// الهدف: أن يعرف المحرك ما يتوقعه صاحب النشاط السعودي من هذا النوع من الأنظمة، بدل أن يخمّن.
// لإضافة نوع جديد: أضف عنصراً بكلمات مفتاحية وملاحظات قصيرة.

const SAUDI = [
  'Saudi context: currency ر.س (SAR) with 2 decimals; VAT is 15% and prices may be entered tax-inclusive or tax-exclusive (make it a setting).',
  'Mobile numbers look like 05XXXXXXXX; for WhatsApp links convert to 9665XXXXXXXX. Work week Sunday-Thursday, weekend Friday-Saturday.',
  'Show Gregorian dates by default and optionally the Hijri date via Intl.DateTimeFormat("ar-SA-u-ca-islamic-umalqura").',
  'Business identity fields: trade name, commercial registration number (رقم السجل التجاري), VAT number (الرقم الضريبي, 15 digits), address, phone, logo.',
];

const PLAYBOOKS = [
  {
    match: /محاسب|فاتور|فواتير|دفتر|ضريب|مصروف|ميزاني|حسابات|قيود|invoice|account|bookkeep|erp|billing/i,
    notes: [
      'Accounting / invoicing system. Modules: لوحة التحكم، المبيعات (فواتير، عروض أسعار، إشعارات دائنة/مرتجعات، مدفوعات العملاء)، العملاء،',
      'المنتجات والخدمات، المشتريات (فواتير موردين، مدفوعات)، الموردون، المصروفات بتصنيفات، الخزينة والبنوك، التقارير، الإعدادات.',
      'Invoice: sequential number (INV-0001), issue and due dates, customer, line items (item, qty, unit price, discount, VAT 15%),',
      'subtotal, total discount, VAT amount, grand total, paid, balance due, status (مسودة، مرسلة، مدفوعة جزئياً، مدفوعة، متأخرة، ملغاة).',
      'Recording a payment updates paid/balance/status. An overdue invoice is unpaid past its due date.',
      'A printable tax invoice view titled "فاتورة ضريبية" (or "فاتورة ضريبية مبسطة" for walk-in customers) shows the seller trade name, address,',
      'VAT number and CR number, buyer name and buyer VAT number when B2B, the line table, VAT breakdown and totals, with a print button',
      '(@media print hides the app chrome). Leave a clearly labelled box for the ZATCA e-invoicing QR code; do not claim the app is ZATCA certified.',
      'Dashboard KPIs computed from data: إجمالي الفواتير، المحصّل، المستحق، المتأخر، المصروفات، صافي الربح التقريبي، plus a monthly sales vs expenses chart',
      'and lists of overdue invoices and top customers. Reports: sales by period/customer/item, expenses by category, VAT report (output VAT on sales minus',
      'input VAT on purchases), customer statement. Customer page shows its invoices, payments and balance. Export tables to CSV.',
    ],
  },
  {
    match: /مخزون|مستودع|جرد|منتجات|باركود|inventory|stock|warehouse|sku/i,
    notes: [
      'Inventory: items with SKU/barcode, category, unit, cost, sale price, quantity, minimum stock with low-stock alerts.',
      'Stock movements (in from purchases, out from sales, adjustments, transfers between branches) with a history per item.',
      'Suppliers and purchase orders. Inventory value report. Barcode field searchable from the top search.',
    ],
  },
  {
    match: /عياد|مستشف|طبي|مريض|مرضى|طبيب|أطباء|موعد|مواعيد|مجمع|صيدلي|clinic|patient|doctor|medical|dental|hospital/i,
    notes: [
      'Clinic / medical complex: patients (file number, name, national ID or iqama 10 digits, mobile, date of birth, gender, insurance company',
      'and policy number, allergies, notes), doctors with specialty and working hours, appointments calendar by day/week and by doctor',
      '(statuses: محجوز، مؤكد، حضر، لم يحضر، ملغى), visit records (complaint, diagnosis, prescription, procedures), services price list,',
      'billing split between patient share and insurance share, daily cash closing, reception view showing today\'s queue.',
      'Send appointment reminders through WhatsApp links. Keep patient data views behind the app and avoid putting it in URLs.',
    ],
  },
  {
    match: /مطعم|مطاعم|كافي|مقهى|بروست|عصير|عصائر|وجبات|طلبات|كاشير|نقاط البيع|منيو|قائمة الطعام|restaurant|cafe|pos|menu|juice|kitchen/i,
    notes: [
      'Restaurant / café / POS: menu categories and items with sizes and add-ons, a fast cashier screen (large touch buttons, cart, quantity,',
      'discount, payment method: نقداً، مدى، بطاقة، تحويل), order types (محلي، سفري، توصيل) with table number or customer address,',
      'kitchen screen with order statuses (جديد، قيد التحضير، جاهز، مُسلَّم), printable 80mm receipt with VAT, daily sales closing by payment method,',
      'best-selling items report. Customer-facing menus send the order to WhatsApp.',
    ],
  },
  {
    match: /حجز|حجوزات|صالون|مشغل|سبا|ملعب|فندق|شاليه|استراح|booking|reservation|salon|appointment/i,
    notes: [
      'Booking business: services with duration and price, staff/resources, available time slots that prevent double booking,',
      'customer booking form that sends details via WhatsApp, admin calendar with statuses, deposits, cancellation notes.',
    ],
  },
  {
    match: /موظف|رواتب|حضور|انصراف|موارد بشرية|إجاز|اجاز|hr\b|payroll|attendance|employee/i,
    notes: [
      'HR: employees (name, ID/iqama, nationality, job title, branch, hire date, basic salary, housing and transport allowances),',
      'attendance with check-in/out, leave requests with approval, monthly payroll sheet (allowances, deductions, net), documents with expiry alerts',
      '(iqama, contract) shown on the dashboard.',
    ],
  },
  {
    match: /فحص|ورشة|ورش|صيانة|سيارات|سيارة|inspection|garage|workshop|maintenance/i,
    notes: [
      'Inspection / workshop: vehicles (plate number, make, model, year, owner mobile), job cards with checklist items and results',
      '(سليم، يحتاج صيانة، خطر), technician, parts and labour lines, status board, printable report and invoice, WhatsApp to the customer when ready.',
    ],
  },
  {
    match: /متجر|تسوق|سلة|منتج|عروض|بيع أونلاين|store|shop|ecommerce|cart/i,
    notes: [
      'Online store: product grid with categories, search and filters, product page with images and options, cart with quantities,',
      'checkout form (name, mobile, city, district, address) that sends the order summary via WhatsApp, admin side for products and orders.',
    ],
  },
];

export function domainNotes(text) {
  const t = String(text || '');
  const hits = PLAYBOOKS.filter((p) => p.match.test(t)).slice(0, 3);
  if (!hits.length) return '';
  const arabic = /[؀-ۿ]/.test(t);
  return [...(arabic ? SAUDI : []), ...hits.flatMap((h) => h.notes)].join('\n');
}
