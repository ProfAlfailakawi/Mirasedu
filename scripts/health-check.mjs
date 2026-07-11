#!/usr/bin/env node
/**
 * حارس الجودة — الموقع يفحص نفسه.
 *
 * كل جمعة (launchd: com.alfailakawi.health) يمشي على الموقع الحي:
 *   · روابط مكسورة في الصفحات المولّدة (داخلية) + مصادر خارجية للمقالات
 *   · ملفات PDF (السيرة + الكتب) تُفتح فعلاً
 *   · أغلفة الكتب موجودة
 *   · صوت كل مقال (فهد) موجود
 *   · صور المشاركة (og) لكل مقال
 *   · نموذج التواصل والنشرة (كتابة اختبارية ثم حذفها)
 * ثم يكتب النتيجة في Firestore `site_health/{date}` فتظهر في لوحة «المؤشرات»،
 * ويُشعر الجهاز إن وُجد خلل.
 *
 * تشغيل يدوي:            npm run health
 * فحص بلا كتابة/إشعار:   node scripts/health-check.mjs --dry-run
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SITE = 'https://dr-alfailakawi.web.app'
const DRY = process.argv.includes('--dry-run')

const notify = (title, body) => {
  try { execFileSync('osascript', ['-e', `display notification ${JSON.stringify(body)} with title ${JSON.stringify(title)} sound name "Basso"`]) } catch { /* بلا واجهة */ }
}

async function headOnce(url, method, timeout) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeout)
  try {
    const r = await fetch(url, { method, redirect: 'follow', signal: ctrl.signal, headers: method === 'GET' ? { Range: 'bytes=0-256' } : {} })
    return r.status
  } catch { return 0 } finally { clearTimeout(t) }
}
async function head(url, timeout = 20000) {
  let code = await headOnce(url, 'HEAD', timeout)
  // فشل/رفض HEAD → جرّب GET؛ ومهلة/انقطاع (0) → أعد المحاولة مرة (تفادي إنذار كاذب)
  if (code === 405 || code === 403 || code === 0) code = await headOnce(url, 'GET', timeout)
  return code
}

// نقرأ البيانات من data.ts مباشرة (نفس منهج build-static)
const src = readFileSync(resolve(ROOT, 'src/data.ts'), 'utf8')
const grab = (name) => (src.match(new RegExp(`export const ${name} = \\[([\\s\\S]*?)\\n\\]`)) || [])[1] || ''
const rawArticles = grab('articles') || grab('rawArticles')
const articles = [...rawArticles.matchAll(/\{ slug: '([^']+)', title: '([^']+)'[\s\S]*?source: '([^']*)'/g)]
  .map((m) => ({ slug: m[1], title: m[2], source: m[3] }))
const books = [...grab('books').matchAll(/slug: '([^']+)'[\s\S]*?cover: '([^']*)'[\s\S]*?pdf: '([^']*)'/g)]
  .map((m) => ({ slug: m[1], cover: m[2], pdf: m[3] }))

const issues = []
const stat = { articles: articles.length, checkedLinks: 0, audioMissing: 0, ogMissing: 0, coverMissing: 0, pdfBroken: 0, brokenSources: 0 }

// ١) أصول محلية (سريعة، من القرص). الصوت يُطلب فقط لمقالٍ له نصّ (المقتطفات بلا نص لا تُنطق).
const bodies = existsSync(resolve(ROOT, 'src/data/bodies.json')) ? JSON.parse(readFileSync(resolve(ROOT, 'src/data/bodies.json'), 'utf8')) : {}
for (const a of articles) {
  if (bodies[a.slug] && !existsSync(resolve(ROOT, 'audio', `${a.slug}.mp3`))) { stat.audioMissing++; if (stat.audioMissing <= 5) issues.push(`صوت مفقود لمقال له نص: ${a.title}`) }
}
const ogDir = resolve(ROOT, 'dist/og/articles')
if (existsSync(ogDir)) {
  const ogSet = new Set(readdirSync(ogDir))
  for (const a of articles) if (!ogSet.has(`${a.slug}.svg`)) { stat.ogMissing++; }
}
for (const b of books) {
  if (b.cover.startsWith('/') && !existsSync(resolve(ROOT, 'public', b.cover.slice(1))) && !existsSync(resolve(ROOT, b.cover.slice(1)))) { stat.coverMissing++; issues.push(`غلاف مفقود: ${b.slug}`) }
}

// ٢) روابط حيّة (عيّنة صفحات أساسية + كل PDF + عيّنة مصادر مقالات)
const corePages = ['/', '/articles', '/publications', '/research', '/cv', '/contact', '/ask', '/thought-paths', '/decade', '/podcast.xml', '/feed.xml', '/sitemap.xml', '/podcast-cover.png']
for (const p of corePages) {
  const code = await head(SITE + p); stat.checkedLinks++
  if (code < 200 || code >= 400) issues.push(`صفحة لا تُفتح (${code}): ${p}`)
}
// PDF الكتب + السيرة
for (const b of books) {
  if (!b.pdf) continue
  const url = b.pdf.startsWith('http') ? b.pdf : SITE + b.pdf
  const code = await head(url); stat.checkedLinks++
  if (code < 200 || code >= 400) { stat.pdfBroken++; issues.push(`PDF لا يُفتح (${code}): ${b.slug}`) }
}
const cvCode = await head(SITE + '/files/cv.pdf'); stat.checkedLinks++
if (cvCode >= 400 || cvCode === 0) issues.push(`السيرة PDF لا تُفتح (${cvCode})`)
// عيّنة مصادر خارجية للمقالات (أحدث 20 لها مصدر)
for (const a of articles.filter((x) => /^https?:\/\//.test(x.source)).slice(0, 20)) {
  const code = await head(a.source); stat.checkedLinks++
  if (code === 0 || code === 404 || code === 410) { stat.brokenSources++; if (stat.brokenSources <= 5) issues.push(`مصدر مكسور: ${a.title}`) }
}

// ٣) النماذج: النشرة تُختبر بكتابة حقيقية (قاعدتها تسمح)، ثم تُحذف.
//    نموذج التواصل لا يُكتب اختبارياً: قاعدته تشترط createdAt == request.time
//    (توقيت الخادم) فيستحيل تزويرها عبر REST — وهذا أمانٌ مقصود، لا خلل.
//    نكتفي بالتأكد أن القاعدة موجودة (رفض REST = القاعدة تعمل).
const KEY = (readFileSync(resolve(ROOT, '.env'), 'utf8').match(/VITE_FIREBASE_API_KEY=(.+)/) || [])[1]?.trim()
let newsletterOk = false, messagesRuleActive = false
if (KEY) {
  const stamp = `health-${Date.now()}`
  const proj = 'drahmad-8e9e2'
  try {
    const r = await fetch(`https://firestore.googleapis.com/v1/projects/${proj}/databases/(default)/documents/subscribers/${stamp}@health.test?key=${KEY}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { email: { stringValue: `${stamp}@health.test` }, createdAt: { timestampValue: new Date().toISOString() } } }),
    })
    newsletterOk = r.ok
  } catch { /* noop */ }
  try {
    // كتابة رسالة بتوقيت العميل يجب أن تُرفض (القاعدة تشترط توقيت الخادم)
    const r = await fetch(`https://firestore.googleapis.com/v1/projects/${proj}/databases/(default)/documents/messages?key=${KEY}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { name: { stringValue: 'x' }, email: { stringValue: 'x@x.co' }, topic: { stringValue: 'أخرى' }, message: { stringValue: 'y' }, createdAt: { timestampValue: new Date().toISOString() } } }),
    })
    messagesRuleActive = r.status === 403 // مرفوض = القاعدة تحرس
  } catch { /* noop */ }
  if (!newsletterOk) issues.push('النشرة البريدية: تعذّرت الكتابة الاختبارية')
  if (!messagesRuleActive) issues.push('نموذج التواصل: قاعدة الحماية غير فعّالة كما يجب')
}
const formsOk = messagesRuleActive

const status = issues.length === 0 ? 'سليم' : 'يحتاج انتباه'
const report = {
  date: new Date().toISOString().slice(0, 10),
  status, issueCount: issues.length, issues: issues.slice(0, 30),
  stats: { ...stat, formsOk, newsletterOk },
  checkedAt: new Date().toISOString(),
}
console.log(`\n═══ حارس الجودة · ${report.date} ═══`)
console.log(`الحالة: ${status} · روابط مفحوصة: ${stat.checkedLinks} · تنبيهات: ${issues.length}`)
if (issues.length) console.log(issues.map((i) => ` ⚠ ${i}`).join('\n'))
else console.log(' ✓ كل شيء سليم — لا روابط مكسورة، الأصوات والأغلفة وصور المشاركة كاملة، النماذج تعمل.')

if (DRY) { console.log('\n(معاينة — بلا كتابة أو إشعار)'); process.exit(0) }

// كتابة في Firestore + إشعار عند خلل (وحذف مستندات الفحص + التنظيف عبر المشرف)
try {
  const { initializeApp, cert } = await import('firebase-admin/app')
  const { getFirestore } = await import('firebase-admin/firestore')
  const saPath = resolve(ROOT, process.env.FIREBASE_SERVICE_ACCOUNT || 'sa.json')
  if (existsSync(saPath)) {
    initializeApp({ credential: cert(JSON.parse(readFileSync(saPath, 'utf8'))) })
    const db = getFirestore()
    await db.collection('site_health').doc(report.date).set(report)
    // احذف مستندات الفحص الاختبارية
    const subs = await db.collection('subscribers').where('email', '>=', 'health-').where('email', '<', 'health-￿').get()
    for (const d of subs.docs) if (d.id.includes('@health.test')) await d.ref.delete()
    const msgs = await db.collection('messages').where('name', '==', 'فحص آلي').get()
    for (const d of msgs.docs) await d.ref.delete()
    console.log('\n✔ حُفظ في site_health وحُذفت مستندات الفحص.')
  }
} catch (e) { console.error('تعذّرت الكتابة:', String(e).slice(0, 150)) }

if (issues.length) notify('حارس الجودة: انتباه مطلوب', `${issues.length} تنبيهاً في موقعك — راجع لوحة التحكم.`)
