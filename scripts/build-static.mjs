#!/usr/bin/env node
/**
 * بعد `vite build` — يولّد:
 *   1) صفحة HTML ثابتة لكل مسار مع وسوم SEO و OG و Schema صحيحة
 *      (روبوتات واتساب/تويتر/غوغل لا تشغّل JS — هذا ما يجعلها تراك)
 *   2) sitemap.xml
 *   3) feed.xml  (RSS)
 *   4) 404.html
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = resolve(ROOT, 'dist')
if (!existsSync(DIST)) { console.error('✘ شغّل `npm run build` أولاً.'); process.exit(1) }

/* لا نسمح ببناء ينسخ أصواتاً لا يعرفها bundle. لأن Vite يعمل قبل هذا
   السكربت، فالحل الآمن عند الاختلاف هو إيقاف البناء وطلب المزامنة ثم الإعادة. */
const audioCheck = spawnSync(process.execPath, [resolve(ROOT, 'scripts/sync-audio.mjs'), '--check'], {
  cwd: ROOT,
  encoding: 'utf8',
})
if (audioCheck.status !== 0) {
  console.error(audioCheck.stderr.trim() || 'audio.json غير متزامن')
  console.error('شغّل: node scripts/sync-audio.mjs ثم أعد npm run build')
  process.exit(1)
}

const SITE = 'https://dr-alfailakawi.com'
const AUTHOR = 'أحمد حسين الفيلكاوي'
const src = readFileSync(resolve(ROOT, 'src/data.ts'), 'utf8')
const esc = (s = '') => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const attr = (s = '') => esc(s).replace(/'/g, '&#39;')

/* ---------- قراءة البيانات من data.ts ---------- */
const grab = (name) => (src.match(new RegExp(`export const ${name} = \\[([\\s\\S]*?)\\n\\]`)) || [])[1] || ''

const articles = [...grab('articles').matchAll(
  /\{ slug: '([^']+)', title: '([^']+)', date: '([^']*)', iso: '([^']*)', cat: '([^']*)',\s*excerpt: '([^']*)'/g
)].map((m) => ({ slug: m[1], title: m[2].replace(/\\'/g, "'"), date: m[3], iso: m[4], cat: m[5], excerpt: m[6].replace(/\\'/g, "'") }))

const books = [...grab('books').matchAll(/slug: '([^']+)', title: '([^']+)'[\s\S]*?desc: '([^']*)'/g)]
  .map((m) => ({ slug: m[1], title: m[2], desc: m[3] }))

const papers = [...grab('papers').matchAll(/slug: '([^']+)', title: '([^']+)', meta: '([^']*)'/g)]
  .map((m) => ({ slug: m[1], title: m[2], desc: m[3] }))

const STATIC = [
  { path: '/', title: 'د. أحمد حسين الفيلكاوي — أستاذ تكنولوجيا التعليم والذكاء الاصطناعي', desc: 'الموقع الرسمي للدكتور أحمد حسين الفيلكاوي، أستاذ تكنولوجيا التعليم والذكاء الاصطناعي. تسعة كتب، ثمانية عشر بحثاً محكّماً، وأكثر من 160 مقالاً فكرياً منذ 2016.' },
  { path: '/publications', title: 'الكتب المنشورة', desc: 'تسعة كتب في التعليم والتكنولوجيا والتغيير المجتمعي.' },
  { path: '/research', title: 'المساهمات العلمية', desc: 'ثمانية عشر بحثاً محكّماً في تكنولوجيا التعليم.' },
  { path: '/articles', title: 'مقالاتي الفكرية', desc: 'أكثر من 160 مقالاً فكرياً في التعليم والتقنية والمجتمع، منذ 2016.' },
  { path: '/atlas', title: 'سماء المقالات', desc: 'خريطة بصرية لأكثر من 160 مقالاً عبر عشر سنوات.' },
  { path: '/media', title: 'الظهور الإعلامي', desc: 'لقاءات تلفزيونية وإذاعية.' },
  { path: '/questions', title: 'سؤال يُقلق التعليم', desc: 'زاوية أسبوعية: كل جمعة سؤال جديد يوقظ التفكير في التعليم — بالعربية والإنجليزية.' },
  { path: '/radar', title: 'أرشيف الرادار', desc: 'كل ما التقطه الرادار من مصادر موثوقة — حصاد أسبوعي مؤرشف كمرجع بحثي، بالعربية والإنجليزية.' },
  { path: '/upcoming', title: 'اللقاءات القادمة', desc: 'محاضرات وورش عمل ومؤتمرات قادمة.' },
  { path: '/curated', title: 'من اختياراتي', desc: 'كتاب، ومقالة، وأداة، واقتباس — مساحة تتجدّد.' },
  { path: '/inbox', title: 'من بريدي الوارد', desc: 'مختارات من رسائل وروابط وصلتني.' },
  { path: '/cv', title: 'السيرة الأكاديمية', desc: 'التعليم والخبرات والعضويات والمؤتمرات.' },
  { path: '/about', title: 'حول الموقع', desc: 'فضاءٌ مُنتقى بعناية… حيث لكل قسم غاية، ولكل اختيار فلسفة.' },
  { path: '/contact', title: 'للاستشارة أو التعاون', desc: 'استشارات ومحاضرات ومشاريع تحوّل رقمي.' },
  { path: '/ask', title: 'اسأل مكتبتي', desc: 'اسأل، وتُجيبك مكتبة د. أحمد حسين الفيلكاوي بكلماته حرفياً — من مقالاته المنشورة حصراً، مع مصدر كل جواب.' },
  { path: '/decade', title: 'وثيقة العقد', desc: 'سيرة فكرية حيّة تقرأ عشر سنوات من الكتابة وتكشف تحولات الأسئلة والموضوعات الأكثر إلحاحاً.' },
  { path: '/thought-paths', title: 'مسار الفكرة', desc: 'رحلات تربط المقال بالسؤال والبحث والكتاب واللقاء لتكشف كيف تطورت الفكرة عبر السنوات.' },
  { path: '/search', title: 'البحث العميق', desc: 'بحث متقدم في عناوين المقالات ونصوصها وتصنيفاتها وسنواتها.' },
  { path: '/admin', title: 'لوحة التحكم', desc: 'لوحة إدارة خاصة.', robots: 'noindex, nofollow' },
]

const routes = [
  ...STATIC,
  ...books.map((b) => ({ path: `/publications/${b.slug}`, title: b.title, desc: b.desc })),
  ...papers.map((p) => ({ path: `/research/${p.slug}`, title: p.title, desc: `بحث محكّم — ${p.desc}`, type: 'article' })),
  ...articles.map((a) => ({ path: `/articles/${a.slug}`, title: a.title, desc: a.excerpt, type: 'article', iso: a.iso, cat: a.cat, image: `/og/articles/${a.slug}.svg` })),
]

/* ---------- حقن الوسوم ---------- */
const shell = readFileSync(resolve(DIST, 'index.html'), 'utf8')

function stripManagedHead(html) {
  return html
    .replace(/<title>[\s\S]*?<\/title>/gi, '')
    .replace(/<meta\s+name=["']description["'][^>]*>/gi, '')
    .replace(/<meta\s+name=["']robots["'][^>]*>/gi, '')
    .replace(/<meta\s+(?:property|name)=["'](?:og:[^"']+|twitter:[^"']+)["'][^>]*>/gi, '')
    .replace(/<link\s+rel=["']canonical["'][^>]*>/gi, '')
    .replace(/<script\s+type=["']application\/ld\+json["'][\s\S]*?<\/script>/gi, '')
}

function render({ path, title, desc, type = 'website', iso, cat, image, robots }) {
  const full = path === '/' ? title : `${title} — د. أحمد حسين الفيلكاوي`
  const url = SITE + path
  const img = `${SITE}${image || '/og.png'}`

  const ld = type === 'article'
    ? { '@context': 'https://schema.org', '@type': 'Article', headline: title, description: desc, datePublished: iso, articleSection: cat, image: img, inLanguage: 'ar', author: { '@type': 'Person', name: AUTHOR }, mainEntityOfPage: url }
    : { '@context': 'https://schema.org', '@type': 'WebPage', name: full, description: desc, url, inLanguage: 'ar' }

  const head = `
    <title>${esc(full)}</title>
    <meta name="description" content="${esc(desc)}" />
    ${robots ? `<meta name="robots" content="${robots}" />` : ''}
    <link rel="canonical" href="${url}" />
    <meta property="og:type" content="${type}" />
    <meta property="og:title" content="${esc(full)}" />
    <meta property="og:description" content="${esc(desc)}" />
    <meta property="og:url" content="${url}" />
    <meta property="og:image" content="${img}" />
    <meta property="og:locale" content="ar_KW" />
    <meta property="og:site_name" content="د. أحمد حسين الفيلكاوي" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${esc(full)}" />
    <meta name="twitter:description" content="${esc(desc)}" />
    <meta name="twitter:image" content="${img}" />
    <meta name="twitter:creator" content="@drahmadkw" />
    <script type="application/ld+json">${JSON.stringify(ld)}</script>
  `

  const html = stripManagedHead(shell)
  return html.replace('</head>', `${head}\n  </head>`)
}

function writeRoute(path, html) {
  if (path === '/') {
    writeFileSync(resolve(DIST, 'index.html'), html, 'utf8')
    return
  }

  const withoutSlash = path.replace(/^\/+/, '')
  const dir = resolve(DIST, withoutSlash)
  mkdirSync(dir, { recursive: true })
  writeFileSync(resolve(dir, 'index.html'), html, 'utf8')

  // يخدم /path مباشرة على المنصات التي تبحث عن path.html قبل fallback.
  writeFileSync(resolve(DIST, `${withoutSlash}.html`), html, 'utf8')
}

function wrapSvgText(text, max = 28) {
  const words = String(text || '').split(/\s+/).filter(Boolean)
  const lines = []
  let line = ''
  for (const word of words) {
    const next = line ? `${line} ${word}` : word
    if (next.length > max && line) {
      lines.push(line)
      line = word
    } else {
      line = next
    }
  }
  if (line) lines.push(line)
  return lines.slice(0, 4)
}

function generateArticleOg() {
  const out = resolve(DIST, 'og/articles')
  mkdirSync(out, { recursive: true })
  for (const article of articles) {
    const titleLines = wrapSvgText(article.title, 29)
    const excerptLines = wrapSvgText(article.excerpt, 58).slice(0, 2)
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" dir="rtl">
  <defs>
    <style>
      .bg{fill:#FCFCFA}.ink{fill:#15161A}.soft{fill:#626A76}.accent{fill:#3E5C78}.hair{stroke:#3E5C78;stroke-opacity:.18}
      text{font-family:"Tajawal","Arial",sans-serif}.display{font-family:"El Messiri","Tajawal",serif}
    </style>
  </defs>
  <rect class="bg" width="1200" height="630"/>
  <circle cx="210" cy="118" r="280" fill="#3E5C78" opacity=".07"/>
  <rect x="64" y="64" width="1072" height="502" rx="0" fill="none" class="hair" stroke-width="2"/>
  <text x="1080" y="134" text-anchor="end" class="accent" font-size="30" font-weight="700">${attr(article.cat)} · ${attr(article.date)}</text>
  ${titleLines.map((line, i) => `<text x="1080" y="${226 + i * 74}" text-anchor="end" class="display ink" font-size="58" font-weight="700">${attr(line)}</text>`).join('\n  ')}
  ${excerptLines.map((line, i) => `<text x="1080" y="${466 + i * 42}" text-anchor="end" class="soft" font-size="29" font-weight="400">${attr(line)}</text>`).join('\n  ')}
  <rect x="898" y="526" width="182" height="4" class="accent"/>
  <text x="1080" y="564" text-anchor="end" class="ink" font-size="26" font-weight="700">د. أحمد الفيلكاوي</text>
  <text x="1080" y="596" text-anchor="end" class="soft" font-size="21">dr-alfailakawi.com</text>
</svg>`
    writeFileSync(resolve(out, `${article.slug}.svg`), svg, 'utf8')
  }
}

let n = 0
for (const r of routes) {
  writeRoute(r.path, render(r))
  n++
}
writeFileSync(resolve(DIST, '404.html'), render({ path: '/404', title: 'الصفحة غير موجودة', desc: 'الصفحة المطلوبة غير موجودة.' }), 'utf8')
writeFileSync(resolve(DIST, 'admin.html'), render({ path: '/admin', title: 'لوحة التحكم', desc: 'لوحة إدارة خاصة.', robots: 'noindex, nofollow' }), 'utf8')
writeFileSync(resolve(DIST, 'offline.html'), render({ path: '/offline', title: 'أنت غير متصل', desc: 'هذه الصفحة متاحة عند انقطاع الاتصال.' }), 'utf8')
generateArticleOg()

/* ---------- sitemap ---------- */
const sm = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${routes.map((r) => `  <url><loc>${SITE}${r.path}</loc>${r.iso ? `<lastmod>${r.iso}</lastmod>` : ''}<priority>${r.path === '/' ? '1.0' : r.type === 'article' ? '0.6' : '0.8'}</priority></url>`).join('\n')}
</urlset>
`
writeFileSync(resolve(DIST, 'sitemap.xml'), sm, 'utf8')

/* ---------- RSS ---------- */
const items = articles.slice(0, 30).map((a) => `    <item>
      <title>${esc(a.title)}</title>
      <link>${SITE}/articles/${a.slug}</link>
      <guid isPermaLink="true">${SITE}/articles/${a.slug}</guid>
      <pubDate>${new Date(a.iso).toUTCString()}</pubDate>
      <category>${esc(a.cat)}</category>
      <description>${esc(a.excerpt)}</description>
    </item>`).join('\n')

writeFileSync(resolve(DIST, 'feed.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
    <title>د. أحمد الفيلكاوي — مقالات فكرية</title>
    <link>${SITE}</link>
    <description>مقالات في التعليم والتقنية والمجتمع.</description>
    <language>ar</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items}
</channel></rss>
`, 'utf8')

/* ---------- بودكاست: خلاصة RSS قياسية من الأرشيف الصوتي (صوت فهد) ----------
   كل مقالٍ له MP3 يصبح حلقة؛ تُقبل مباشرة في Apple Podcasts وSpotify.
   بلا أثر بصري على الموقع — قناة موازية للمستمعين. */
const podcastArt = `${SITE}/podcast-cover.png`
const podcastEpisodes = articles
  .map((a) => ({ a, file: resolve(ROOT, 'audio', `${a.slug}.mp3`) }))
  .filter((e) => existsSync(e.file))
  .sort((x, y) => (y.a.iso || '').localeCompare(x.a.iso || ''))
  .map(({ a, file }) => {
    const bytes = statSync(file).size
    const url = `${SITE}/audio/${a.slug}.mp3`
    return `    <item>
      <title>${esc(a.title)}</title>
      <itunes:author>د. أحمد حسين الفيلكاوي</itunes:author>
      <itunes:subtitle>${esc(a.excerpt).slice(0, 120)}</itunes:subtitle>
      <description>${esc(a.excerpt)}</description>
      <itunes:summary>${esc(a.excerpt)}</itunes:summary>
      <link>${SITE}/articles/${a.slug}</link>
      <guid isPermaLink="false">podcast-${a.slug}</guid>
      <pubDate>${new Date(`${a.iso}T08:00:00Z`).toUTCString()}</pubDate>
      <enclosure url="${url}" length="${bytes}" type="audio/mpeg"/>
      <itunes:image href="${podcastArt}"/>
      <itunes:explicit>false</itunes:explicit>
    </item>`
  }).join('\n')

writeFileSync(resolve(DIST, 'podcast.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>د. أحمد الفيلكاوي — مقالاتي المسموعة · Dr. Ahmad Alfailakawi</title>
    <link>${SITE}</link>
    <language>ar</language>
    <copyright>© د. أحمد حسين الفيلكاوي</copyright>
    <description>أفكاري عن التعليم والتقنية والمجتمع، وكيف نُبقي الإنسان في قلب الآلة — بصوتي، مقالاً تلو الآخر. حلقة جديدة مع كل مقال.

My reflections on education, technology, and society — and how we keep the human at the heart of the machine. In my own voice, essay by essay. A new episode with every article.</description>
    <itunes:author>د. أحمد حسين الفيلكاوي · Dr. Ahmad Alfailakawi</itunes:author>
    <itunes:summary>أفكاري عن التعليم والتقنية والمجتمع، وكيف نُبقي الإنسان في قلب الآلة — بصوتي. · My reflections on education, technology, and society, in my own voice.</itunes:summary>
    <itunes:type>episodic</itunes:type>
    <itunes:owner><itunes:name>د. أحمد حسين الفيلكاوي</itunes:name><itunes:email>ah_f@hotmail.com</itunes:email></itunes:owner>
    <itunes:image href="${podcastArt}"/>
    <itunes:category text="Education"/>
    <itunes:category text="Society &amp; Culture"/>
    <itunes:explicit>false</itunes:explicit>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${podcastEpisodes}
  </channel>
</rss>
`, 'utf8')

/* ---------- أصول الإنتاج ----------
   المصدر المعتمد لهذه الملفات هو مجلدات الجذر، لا public/.
   نحذف وجهة الصوت أولاً كي لا تبقى ملفات قديمة أو تالفة نسخها Vite من public. */
function syncDirectory(name, extension) {
  const from = resolve(ROOT, name)
  const to = resolve(DIST, name)
  if (!existsSync(from)) throw new Error(`مجلد الأصول مفقود: ${name}`)
  rmSync(to, { recursive: true, force: true })
  mkdirSync(to, { recursive: true })
  const files = readdirSync(from, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(extension))
  for (const entry of files) copyFileSync(resolve(from, entry.name), resolve(to, entry.name))
  return files.length
}

const copiedAssets = Object.fromEntries(
  [['audio', '.mp3'], ['covers', '.png'], ['files', '.pdf']]
    .map(([name, extension]) => [name, syncDirectory(name, extension)]),
)

const firebaseAppletConfig = resolve(ROOT, 'firebase-applet-config.json')
if (!existsSync(firebaseAppletConfig)) throw new Error('firebase-applet-config.json مفقود')
copyFileSync(firebaseAppletConfig, resolve(DIST, 'firebase-applet-config.json'))

/* ---------- service worker: إصدار تلقائي + توافق Cloud Run ---------- */
const sw = resolve(DIST, 'sw.js')
if (existsSync(sw)) {
  const id = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 12)
  const text = readFileSync(sw, 'utf8').replace(/__BUILD_ID__/g, id)
  writeFileSync(sw, text, 'utf8')
}

/* بعض بيئات Cloud Run/App Hosting تتعامل مع assets المستوردة من Vite بشكل مختلف.
   إبقاء نسخة public واضحة من الشعار والبورتريه يحمي الواجهة من 404 إن تغيّر مسار الحزمة. */
for (const [from, to] of [
  ['src/assets/logo.png', 'dist/logo.png'],
  ['src/assets/portrait.webp', 'dist/portrait.webp'],
]) {
  const srcFile = resolve(ROOT, from)
  if (existsSync(srcFile)) copyFileSync(srcFile, resolve(ROOT, to))
}

console.log(`✔ ${n} صفحة ثابتة · sitemap (${routes.length}) · feed.xml · 404.html`)
console.log(`✔ أصول الإنتاج: audio ${copiedAssets.audio} · covers ${copiedAssets.covers} · files ${copiedAssets.files} · Firebase config`)
