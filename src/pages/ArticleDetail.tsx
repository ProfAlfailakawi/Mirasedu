import { Link, useParams } from 'react-router-dom'
import { motion, useScroll, useSpring } from 'framer-motion'
import { useEffect, useMemo, useState } from 'react'
import { FadeUp, Page, Reveal } from '../components/ui'
import { getArticleNeighbors, relatedArticles } from '../lib/cms'
import { books, papers } from '../data'
import { useCmsContent } from '../lib/content'
import { CiteButton, Listen, OwnerEdit, Share } from '../components/extras'
import { QuoteCard } from '../components/QuoteCard'
import { JsonLd, useSeo } from '../components/seo'
import { fetchOwnerCounts, useTrackView } from '../lib/views'
import { useAdminAuth } from '../lib/admin-auth'
import { CitationCopy } from '../components/CitationCopy'

/** تقدير زمن القراءة — ٢٠٠ كلمة/دقيقة للعربية */
const readTime = (t?: string) => {
  if (!t) return null
  const words = t.trim().split(/\s+/).length
  const m = Math.max(1, Math.round(words / 200))
  return `${m.toLocaleString('en-US')} دقائق قراءة`.replace('1 دقائق', 'دقيقة واحدة')
}

function ReaderPanel({ slug }: { slug: string }) {
  const [focus, setFocus] = useState(false)
  const [scale, setScale] = useState(1)
  const [saved, setSaved] = useState(0)

  useEffect(() => {
    try {
      setSaved(Number(localStorage.getItem(`reader:${slug}:progress`) || 0))
      setScale(Number(localStorage.getItem('reader:scale') || 1))
    } catch { /* noop */ }
  }, [slug])

  useEffect(() => {
    document.documentElement.classList.toggle('reader-focus', focus)
    return () => document.documentElement.classList.remove('reader-focus')
  }, [focus])

  useEffect(() => {
    document.documentElement.style.setProperty('--article-scale', String(scale))
    try { localStorage.setItem('reader:scale', String(scale)) } catch { /* noop */ }
  }, [scale])

  useEffect(() => {
    const save = () => {
      const doc = document.documentElement
      const max = doc.scrollHeight - window.innerHeight
      if (max <= 0) return
      const pct = Math.min(Math.max(window.scrollY / max, 0), 1)
      try { localStorage.setItem(`reader:${slug}:progress`, String(pct)) } catch { /* noop */ }
    }
    window.addEventListener('scroll', save, { passive: true })
    return () => window.removeEventListener('scroll', save)
  }, [slug])

  const restore = () => {
    const doc = document.documentElement
    window.scrollTo({ top: saved * (doc.scrollHeight - window.innerHeight), behavior: 'smooth' })
  }

  return (
    <div className="mt-7 flex flex-wrap items-center gap-2 border-y border-hair py-3">
      {saved > 0.08 && saved < 0.92 && (
        <button onClick={restore} className="rounded-full border border-hair px-4 py-1.5 text-[.8rem] text-soft transition-colors hover:border-accent hover:text-accent">
          متابعة من {Math.round(saved * 100).toLocaleString('en-US')}٪
        </button>
      )}
      <button
        onClick={() => setFocus(!focus)}
        className={`rounded-full border px-4 py-1.5 text-[.8rem] transition-colors ${
          focus ? 'border-accent bg-accent text-canvas' : 'border-hair text-soft hover:border-accent hover:text-accent'
        }`}
      >
        وضع التركيز
      </button>
      <div className="ms-auto flex items-center gap-2 text-[.8rem] text-soft">
        <span>حجم النص</span>
        {[0.94, 1, 1.08].map((value) => (
          <button
            key={value}
            onClick={() => setScale(value)}
            aria-pressed={scale === value}
            className={`h-8 w-8 rounded-full border text-[.78rem] transition-colors ${
              scale === value ? 'border-accent bg-accent text-canvas' : 'border-hair hover:border-accent hover:text-accent'
            }`}
          >
            {value === 0.94 ? 'أ' : value === 1 ? 'أ+' : 'أ++'}
          </button>
        ))}
      </div>
    </div>
  )
}


/* ---------- «حوار عبر الزمن» — الأرشيف يتحاور مع نفسه ----------
   يربط المقال بأقربه موضوعاً على بُعد ٣ سنوات فأكثر: القديم يشير للعودة،
   والجديد يشير للجذر — فيرى القارئ فكراً يتطوّر عبر عقد، لا أرشيفاً يتكدّس. */
const AR_STOP = new Set(['على','إلى','من','في','عن','مع','هذا','هذه','ذلك','التي','الذي','بين','بعد','قبل','عند','حتى','كان','كانت','هل','ما','لا','لم','لن','قد','ثم','أو','أم','بل','كل','بعض','غير','نحو','لدى','منذ','حين','حول','أن','إن','لأن','كيف','أين','ليس','وهو','وهي'])
const normAr = (s: string) => s
  .replace(/[\u064B-\u0652\u0670]/g, '')
  .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
  .replace(/[^\w\u0600-\u06FF ]/g, ' ')
const tokensOf = (s: string) => new Set(normAr(s).split(/\s+/).filter((w) => w.length > 2 && !AR_STOP.has(w) && !/^ال..$/.test(w)))

function TimeDialogue({ a, articles }: { a: { slug: string; title: string; iso: string; cat: string; excerpt?: string }; articles: { slug: string; title: string; iso: string; cat: string; excerpt?: string }[] }) {
  const pair = useMemo(() => {
    const mine = tokensOf(a.title + ' ' + (a.excerpt || ''))
    const myYear = +a.iso.slice(0, 4)
    let older: { art: typeof a; score: number } | null = null
    let newer: { art: typeof a; score: number } | null = null
    for (const o of articles) {
      if (o.slug === a.slug) continue
      const gap = +o.iso.slice(0, 4) - myYear
      if (Math.abs(gap) < 3) continue
      let score = 0
      for (const w of tokensOf(o.title + ' ' + (o.excerpt || ''))) if (mine.has(w)) score++
      if (o.cat === a.cat) score += 1
      if (score < 3) continue
      if (gap < 0 && (!older || score > older.score)) older = { art: o, score }
      if (gap > 0 && (!newer || score > newer.score)) newer = { art: o, score }
    }
    return { older: older?.art ?? null, newer: newer?.art ?? null }
  }, [a, articles])

  if (!pair.older && !pair.newer) return null
  const yr = (iso: string) => iso.slice(0, 4)
  const diff = (iso: string) => Math.abs(+yr(iso) - +yr(a.iso))
  const yearsWord = (n: number) => (n === 1 ? 'سنة' : n === 2 ? 'سنتين' : n <= 10 ? `${n} سنوات` : `${n} سنة`)

  return (
    <FadeUp>
      <aside className="mt-14 border-t border-hair pt-8">
        <p className="text-[.76rem] font-semibold text-accent">✦ حوار عبر الزمن</p>
        <div className="mt-4 space-y-4">
          {pair.older && (
            <Link to={`/articles/${pair.older.slug}`} className="group block">
              <p className="text-[.95rem] font-light leading-[1.9] text-soft">
                كتبتُ في هذا قبل {yearsWord(diff(pair.older.iso))} —{' '}
                <span className="font-medium text-ink transition-colors group-hover:text-accent">«{pair.older.title}» ({yr(pair.older.iso)})</span>. كيف تغيّر المشهد؟ قارن بنفسك{' '}
                <span className="inline-block text-accent transition-transform duration-300 group-hover:-translate-x-1">←</span>
              </p>
            </Link>
          )}
          {pair.newer && (
            <Link to={`/articles/${pair.newer.slug}`} className="group block">
              <p className="text-[.95rem] font-light leading-[1.9] text-soft">
                ثم عدتُ إلى هذا الموضوع عام {yr(pair.newer.iso)} —{' '}
                <span className="font-medium text-ink transition-colors group-hover:text-accent">«{pair.newer.title}»</span>{' '}
                <span className="inline-block text-accent transition-transform duration-300 group-hover:-translate-x-1">←</span>
              </p>
            </Link>
          )}
        </div>
      </aside>
    </FadeUp>
  )
}


/* «مسار قراءة» لا مجرد مقالات مرتبطة: أفضل بحثٍ وكتابٍ يلامسان فكرة المقال */
function deepDive(a: { title: string; excerpt?: string }) {
  const mine = tokensOf(a.title + ' ' + (a.excerpt || ''))
  const best = <T extends { title: string }>(items: T[], extra: (x: T) => string) => {
    let top: T | null = null, topScore = 1
    for (const it of items) {
      let s = 0
      for (const w of tokensOf(it.title + ' ' + extra(it))) if (mine.has(w)) s++
      if (s > topScore) { topScore = s; top = it }
    }
    return top
  }
  return {
    paper: best(papers as { slug: string; title: string; meta?: string }[], (p) => p.meta || ''),
    book: best(books as { slug: string; title: string; desc?: string }[], (b) => b.desc || ''),
  }
}


/* شارة المالك: تظهر للمشرف وحده بجانب العنوان — مشاهدات ومشاركات المقال */
function OwnerBadge({ path }: { path: string }) {
  const { isAdmin } = useAdminAuth()
  const [c, setC] = useState<{ views: number; shares: number } | null>(null)
  useEffect(() => {
    if (!isAdmin) return
    let on = true
    fetchOwnerCounts(path).then((r) => { if (on) setC(r) })
    return () => { on = false }
  }, [isAdmin, path])
  if (!isAdmin || !c) return null
  return (
    <span className="ms-3 inline-flex items-center gap-2 rounded-full border border-hair px-3 py-1 align-middle text-[.72rem] font-medium text-soft" title="يظهر لك وحدك">
      <span>{c.views} مشاهدة</span>
      <span className="text-hair">·</span>
      <span>{c.shares} مشاركة</span>
    </span>
  )
}

export default function ArticleDetail() {
  const { slug } = useParams()
  const { articles, loading } = useCmsContent()
  const a = articles.find((article) => article.slug === slug)

  const { scrollYProgress } = useScroll()
  const bar = useSpring(scrollYProgress, { stiffness: 200, damping: 40 })
  const neighbors = useMemo(() => a ? getArticleNeighbors(a.slug, articles) : { prev: undefined, next: undefined }, [a, articles])
  const related = useMemo(() => a ? relatedArticles(a, 3, articles) : [], [a, articles])
  const dive = useMemo(() => (a ? deepDive(a) : { paper: null, book: null }), [a])

  useSeo({
    title: a?.title ?? 'مقال',
    description: a?.excerpt,
    path: `/articles/${slug}`,
    type: 'article',
    image: slug ? `/og/articles/${slug}.svg` : undefined,
  })
  useTrackView(`/articles/${slug || ''}`, a?.title || 'مقال', Boolean(a))

  // يتذكّر جهازُك آخر مقالٍ فتحتَه — بلا حساب ولا تتبّع خارجي، ليُقدَّم لك عند العودة
  useEffect(() => {
    if (!a) return
    try { localStorage.setItem('read:last', JSON.stringify({ slug: a.slug, title: a.title, at: Date.now() })) } catch { /* noop */ }
  }, [a])

  if (!a && loading)
    return (
      <Page>
        <div className="px-6 pt-44 text-center text-soft">لحظة…</div>
      </Page>
    )

  if (!a)
    return (
      <Page>
        <div className="px-6 pt-44 text-center text-soft">لم يُعثر على المقال.</div>
      </Page>
    )

  const { prev, next } = neighbors
  const rt = readTime(a.body)

  return (
    <Page>
      {/* شريط تقدّم القراءة */}
      <motion.div className="fixed right-0 top-0 z-[245] h-[3px] w-full origin-right bg-accent" style={{ scaleX: bar }} />

      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'Article',
          headline: a.title,
          datePublished: a.iso,
          author: { '@type': 'Person', name: 'أحمد حسين الفيلكاوي' },
          articleSection: a.cat,
          inLanguage: 'ar',
        }}
      />
      <QuoteCard />
      <article className="px-6 pb-24 pt-32 md:px-11 md:pt-40">
        <div className="mx-auto max-w-[720px]">
          <FadeUp>
            <Link to="/articles" className="text-[.85rem] text-soft transition-colors hover:text-accent">
              ← كل المقالات
            </Link>
          </FadeUp>

          <FadeUp delay={0.05}>
            <div className="mt-8 flex flex-wrap items-center gap-3 text-[.8rem]">
              <span className="font-semibold text-accent">{a.cat}</span>
              <span className="h-1 w-1 rounded-full bg-hair" />
              <time className="text-soft">{a.date}</time>
              {rt && (
                <>
                  <span className="h-1 w-1 rounded-full bg-hair" />
                  <span className="text-soft">{rt}</span>
                </>
              )}
            </div>

            <h1 className="mt-5 font-display text-[clamp(2rem,4.6vw,3.1rem)] font-bold leading-[1.3] text-ink">
              <Reveal>{a.title}</Reveal>
            </h1>
            <OwnerBadge path={`/articles/${a.slug}`} />
            <OwnerEdit tab="articles" slug={a.slug} className="ms-2" />
            <div className="mt-7 h-[2px] w-16 bg-accent" />
            {a.body && <Listen slug={a.slug} title={a.title} text={a.body} audio={(a as { audio?: { fahed?: boolean | string; noura?: boolean | string } }).audio} />}
            {a.body && <ReaderPanel slug={a.slug} />}
          </FadeUp>

          <FadeUp delay={0.12}>
            {a.body ? (
              <div className="article-body mt-11">
                {a.body.split('\n\n').map((p, k) => (
                  <p key={k}>{p}</p>
                ))}
              </div>
            ) : (
              <>
                {a.excerpt && (
                  <p className="mt-11 border-r-2 border-accent ps-6 font-display text-[1.28rem] font-light leading-[1.95] text-ink/90">
                    {a.excerpt}
                  </p>
                )}
                <div className="mt-12 rounded-2xl border border-hair bg-wash p-8 text-center md:p-10">
                  <p className="font-display text-[1.4rem] font-semibold leading-[1.7] text-ink">
                    النص الكامل قيد الإضافة للأرشيف.
                  </p>
                  <p className="mx-auto mt-3 max-w-[420px] text-[.95rem] font-light leading-[1.9] text-soft">
                    أبقيت بيانات المقال ومصدره حتى لا ينقطع أثره، وسيُضاف النص الكامل ضمن دورة تنقية الأرشيف.
                  </p>
                  {a.source && (
                    <a
                      href={a.source}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-6 inline-block rounded-full bg-accent px-8 py-3.5 font-semibold text-white transition-colors duration-300 hover:bg-accent-deep"
                    >
                      اقرأ في مصدره الأصلي ←
                    </a>
                  )}
                </div>
              </>
            )}
          </FadeUp>

          {a.body && a.source && (
            <FadeUp>
              <p className="mt-14 border-t border-hair pt-6 text-[.85rem] text-soft">
                نُشر أولاً في{' '}
                <a href={a.source} target="_blank" rel="noreferrer" className="text-accent underline underline-offset-4">
                  المصدر الأصلي
                </a>
              </p>
            </FadeUp>
          )}

          <FadeUp>
            <CitationCopy
              title={a.title}
              path={`/articles/${a.slug}`}
              iso={a.iso}
              date={a.date}
              source={a.source}
              url={a.source}
            />
          </FadeUp>

          {/* «ما الجملة التي بقيت معك؟» — لحظة الأثر (فكرة نووية ٦): دعوة صريحة لا أداة مخفية */}
          {a.body && (
            <FadeUp>
              <div className="mt-14 rounded-2xl border border-hair bg-wash p-7 text-center md:p-8">
                <p className="font-display text-[clamp(1.15rem,2.4vw,1.5rem)] font-semibold leading-[1.7] text-ink">ما الجملة التي بقيت معك؟</p>
                <p className="mx-auto mt-2 max-w-[440px] text-[.88rem] font-light leading-[1.9] text-soft">
                  ظلّل أيّ جملةٍ من المقال بإصبعك أو مؤشرك، وستظهر لك بطاقة اقتباسٍ أنيقة تحفظها أو تشاركها.
                </p>
              </div>
            </FadeUp>
          )}

          <TimeDialogue a={a} articles={articles} />

          <Share title={a.title} path={`/articles/${a.slug}`} />

          <CiteButton title={a.title} year={a.iso.slice(0, 4)} container="الموقع الرسمي للدكتور أحمد حسين الفيلكاوي" url={`https://dr-alfailakawi.com/articles/${a.slug}`} />

          {related.length > 0 && (
            <FadeUp>
              <section className="mt-16 border-t border-hair pt-9">
                <span className="text-[.76rem] font-semibold uppercase text-accent">أكمل هذا المسار</span>
                <p className="mt-2 text-[.9rem] font-light text-soft">مقالاتٌ على الخيط الفكري نفسه.</p>
                <ul className="mt-6 grid gap-6 sm:grid-cols-3">
                  {related.slice(0, dive.paper || dive.book ? 2 : 3).map((r) => (
                    <li key={r.slug}>
                      <Link to={`/articles/${r.slug}`} className="group block">
                        <span className="text-[.72rem] font-semibold text-accent">مقال</span>
                        <span className="mt-1.5 block font-display text-[1.05rem] font-medium leading-[1.6] text-ink transition-colors group-hover:text-accent">
                          {r.title}
                        </span>
                        <time className="mt-1 block text-[.76rem] text-soft">{r.date}</time>
                      </Link>
                    </li>
                  ))}
                  {dive.paper && (
                    <li key={dive.paper.slug}>
                      <Link to={`/research/${dive.paper.slug}`} className="group block">
                        <span className="text-[.72rem] font-semibold text-accent">بحث محكّم</span>
                        <span className="mt-1.5 block font-display text-[1.05rem] font-medium leading-[1.6] text-ink transition-colors group-hover:text-accent">
                          {dive.paper.title}
                        </span>
                        <span className="mt-1 block text-[.76rem] text-soft">للتعمّق الأكاديمي</span>
                      </Link>
                    </li>
                  )}
                  {dive.book && !dive.paper && (
                    <li key={dive.book.slug}>
                      <Link to={`/publications/${dive.book.slug}`} className="group block">
                        <span className="text-[.72rem] font-semibold text-accent">كتاب</span>
                        <span className="mt-1.5 block font-display text-[1.05rem] font-medium leading-[1.6] text-ink transition-colors group-hover:text-accent">
                          {dive.book.title}
                        </span>
                        <span className="mt-1 block text-[.76rem] text-soft">للإحاطة الكاملة</span>
                      </Link>
                    </li>
                  )}
                </ul>
              </section>
            </FadeUp>
          )}

          <FadeUp>
            <nav className="mt-16 grid gap-6 border-t border-hair pt-8 sm:grid-cols-2">
              {next ? (
                <Link to={`/articles/${next.slug}`} className="group">
                  <span className="text-[.78rem] text-soft">السابق</span>
                  <span className="mt-1 block font-display text-[1.05rem] font-medium leading-[1.5] text-ink transition-colors group-hover:text-accent">
                    {next.title}
                  </span>
                </Link>
              ) : (
                <span />
              )}
              {prev && (
                <Link to={`/articles/${prev.slug}`} className="group sm:text-left">
                  <span className="text-[.78rem] text-soft">التالي</span>
                  <span className="mt-1 block font-display text-[1.05rem] font-medium leading-[1.5] text-ink transition-colors group-hover:text-accent">
                    {prev.title}
                  </span>
                </Link>
              )}
            </nav>
          </FadeUp>
        </div>
      </article>
    </Page>
  )
}
