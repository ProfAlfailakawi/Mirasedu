import { useSeo } from '../components/seo'
import { useEffect, useState } from 'react'
import { motion, useMotionValue, useReducedMotion, useScroll, useSpring, useTransform } from 'framer-motion'
import { Link } from 'react-router-dom'
import { EASE, FadeUp, Label, Magnetic, Page, Reveal, SectionHead } from '../components/ui'
import { books as staticBooks, papers as staticPapers, profile, upcoming, type Event as SiteEvent } from '../data'
import { useCmsContent, useExtras } from '../lib/content'
import { Newsletter } from '../components/extras'
import { type Curio } from '../data-curated'
import { staticQuestions, LAUNCH_DATE } from './Questions'

const arNum = (n: number) => String(n).padStart(2, '0')
const ytId = (u: string) => (u.match(/v=([\w-]{6,})/) || [])[1] || ''

/* ---------- «فكرة اليوم» — بطاقة واحدة هادئة تتبدل كل منتصف ليل ----------
   تعيد استخدام محرك المختارات اليومي؛ تُحمَّل كسولاً فلا تُثقل الرئيسية */
function DailySpark() {
  const [c, setC] = useState<Curio | null>(null)
  useEffect(() => {
    let on = true
    import('../data-curated').then((m) => { if (on) setC(m.todaysPick()) })
    return () => { on = false }
  }, [])
  if (!c) return null
  return (
    <section className="border-t border-hair px-6 py-[56px] md:px-11 md:py-[72px]">
      <div className="mx-auto max-w-shell">
        <FadeUp>
          {/* بطاقة مميّزة بنفس الثيم: حافة مميّزة + علامة اقتباس كبيرة خافتة */}
          <Link
            to="/curated"
            data-hover
            className="group relative block overflow-hidden rounded-2xl border border-hair border-r-[3px] border-r-accent bg-wash p-8 transition-colors duration-300 hover:border-accent md:p-11"
          >
            <span aria-hidden className="pointer-events-none absolute -top-6 left-6 select-none font-display text-[8rem] leading-none text-accent/10 md:text-[11rem]">”</span>
            <p className="relative mb-5 flex items-center gap-2.5 text-[.8rem] font-semibold text-accent">
              <span className="pulse relative h-1.5 w-1.5 rounded-full bg-accent" />
              فكرة اليوم · {c.kind}
            </p>
            <p className="relative max-w-3xl font-display text-[clamp(1.35rem,3vw,2rem)] font-semibold leading-[1.7] text-ink transition-colors group-hover:text-accent">
              {c.ar}
            </p>
            {c.en && (
              <p className="relative mt-3 max-w-2xl text-[.95rem] font-light text-soft" dir="ltr" style={{ textAlign: 'left' }}>{c.en}</p>
            )}
            <p className="relative mt-6 flex flex-wrap items-center gap-2 border-t border-hair pt-4 text-[.82rem] text-soft">
              <span>{c.source}</span>
              <span className="text-hair">·</span>
              <span>تتبدّل كل منتصف ليل</span>
              <span className="ms-auto text-accent transition-transform duration-300 group-hover:-translate-x-1">المزيد في المختارات ←</span>
            </p>
          </Link>
        </FadeUp>
      </div>
    </section>
  )
}

/* ---------- «ابدأ من هنا» — ثلاث بوابات هادئة (لا إجبار ولا ازدحام) ---------- */
/* ---------- الشخصنة: «الموقع يعرف من دخل» (فكرة نووية ١) ----------
   سؤال هادئ مرّة واحدة، يُحفظ محلياً، فتتكيّف الرئيسية — بلا نافذة حاجزة ولا ألوان جديدة. */
type Persona = 'reader' | 'scholar' | 'org'
const PERSONAS: {
  key: Persona; label: string; gate: string; d: string; greet: string
  to: string; links: { to: string; t: string }[]
}[] = [
  { key: 'reader', label: 'قارئ متأمّل', gate: 'للقارئ المتأمل',
    d: 'أكثر من 160 مقالاً فكرياً — اقرأها، وبعضها بصوتي.',
    greet: 'بدأتُ لك من الكلمة.', to: '/articles',
    links: [{ to: '/articles', t: 'أحدث ما كتبت' }, { to: '/articles', t: 'كل المقالات' }] },
  { key: 'scholar', label: 'معلّم وباحث', gate: 'للمعلم والباحث',
    d: 'ثمانية عشر بحثاً محكّماً، وأدوات ومفاهيم منتقاة.',
    greet: 'من المعرفة المحكّمة.', to: '/research',
    links: [{ to: '/research', t: 'المساهمات العلمية' }, { to: '/publications', t: 'الكتب المنشورة' }] },
  { key: 'org', label: 'جهة أو صانع قرار', gate: 'للجهات وصنّاع القرار',
    d: 'استشارة، محاضرة، أو مشروع تحول رقمي — بصيرة لا أرقام فقط.',
    greet: 'جاهزٌ للتعاون.', to: '/contact',
    links: [{ to: '/contact', t: 'احجز موعداً' }, { to: '/cv', t: 'السيرة الذاتية' }, { to: '/upcoming', t: 'اللقاءات القادمة' }] },
]

function WhoAreYou() {
  // القراءة في المُهيّئ (createRoot) تمنع أي وميض للزائر العائد
  const [persona, setPersona] = useState<Persona | null>(() => {
    try { return (localStorage.getItem('visitor:persona') as Persona) || null } catch { return null }
  })
  const [skipped, setSkipped] = useState(() => {
    try { return localStorage.getItem('visitor:skip') === '1' } catch { return false }
  })

  const choose = (p: Persona) => {
    setPersona(p); setSkipped(false)
    try { localStorage.setItem('visitor:persona', p); localStorage.removeItem('visitor:skip') } catch { /* noop */ }
  }
  const skip = () => {
    setSkipped(true)
    try { localStorage.setItem('visitor:skip', '1') } catch { /* noop */ }
  }
  const reset = () => {
    setPersona(null); setSkipped(false)
    try { localStorage.removeItem('visitor:persona'); localStorage.removeItem('visitor:skip') } catch { /* noop */ }
  }

  const active = persona ? PERSONAS.find((x) => x.key === persona) ?? null : null

  return (
    <section className="border-t border-hair bg-wash px-6 py-11 md:px-11 md:py-[72px]">
      <div className="mx-auto max-w-shell">
        {active ? (
          /* ── مُشخصَن: لمحة تُقدّم الأنسب له ── */
          <FadeUp>
            <div className="rounded-2xl border border-hair bg-canvas p-7 md:p-9">
              <p className="text-[.76rem] font-semibold uppercase text-accent">بما أنك {active.label}</p>
              <h2 className="mt-3 font-display text-[clamp(1.5rem,3.4vw,2.2rem)] font-semibold leading-[1.4] text-ink">{active.greet}</h2>
              <div className="mt-6 flex flex-wrap gap-3">
                {active.links.map((l, i) => (
                  <Magnetic key={l.to} to={l.to}
                    className={`inline-block rounded-full px-6 py-3 text-[.9rem] font-semibold transition-colors duration-300 ${i === 0 ? 'bg-accent text-white hover:bg-accent-deep' : 'border border-hair text-ink hover:border-accent hover:text-accent'}`}>
                    {l.t} ←
                  </Magnetic>
                ))}
              </div>
              <button onClick={reset} className="mt-6 text-[.8rem] text-soft transition-colors hover:text-accent">لستَ {active.label}؟ غيّر اختيارك</button>
            </div>
          </FadeUp>
        ) : skipped ? (
          /* ── تصفّح حرّ: البوابات الثلاث كروابط ── */
          <div className="-mx-6 flex snap-x snap-mandatory gap-4 overflow-x-auto px-6 pb-2 md:mx-0 md:grid md:grid-cols-3 md:gap-5 md:overflow-visible md:px-0 md:pb-0">
            {PERSONAS.map((g, i) => (
              <FadeUp key={g.key} delay={i * 0.08} className="w-[78vw] shrink-0 snap-start md:w-auto">
                <Link to={g.to} data-hover className="group flex h-full flex-col rounded-2xl border border-hair bg-canvas p-7 transition-colors duration-300 hover:border-accent">
                  <h3 className="font-display text-[1.15rem] font-semibold text-ink">{g.gate}</h3>
                  <p className="mt-2.5 text-[.92rem] font-light leading-relaxed text-soft">{g.d}</p>
                  <span className="mt-auto pt-5 text-[.85rem] text-soft transition-colors group-hover:text-accent">ابدأ ←</span>
                </Link>
              </FadeUp>
            ))}
          </div>
        ) : (
          /* ── الزيارة الأولى: سؤال هادئ ── */
          <>
            <FadeUp><Label>قبل أن تبدأ</Label></FadeUp>
            <FadeUp delay={0.05}>
              <h2 className="mb-8 font-display text-[clamp(1.6rem,4vw,2.6rem)] font-semibold leading-[1.3] text-ink">ما الذي جاء بك؟</h2>
            </FadeUp>
            <div className="-mx-6 flex snap-x snap-mandatory gap-4 overflow-x-auto px-6 pb-2 md:mx-0 md:grid md:grid-cols-3 md:gap-5 md:overflow-visible md:px-0 md:pb-0">
              {PERSONAS.map((g, i) => (
                <FadeUp key={g.key} delay={0.1 + i * 0.08} className="w-[78vw] shrink-0 snap-start md:w-auto">
                  <button onClick={() => choose(g.key)} data-hover className="group flex h-full w-full flex-col rounded-2xl border border-hair bg-canvas p-7 text-right transition-colors duration-300 hover:border-accent">
                    <h3 className="font-display text-[1.15rem] font-semibold text-ink">{g.gate}</h3>
                    <p className="mt-2.5 text-[.92rem] font-light leading-relaxed text-soft">{g.d}</p>
                    <span className="mt-auto pt-5 text-[.85rem] text-soft transition-colors group-hover:text-accent">هذا أنا ←</span>
                  </button>
                </FadeUp>
              ))}
            </div>
            <FadeUp delay={0.34}>
              <button onClick={skip} className="mt-7 text-[.85rem] text-soft transition-colors hover:text-accent">أتصفّح بحرّية ←</button>
            </FadeUp>
          </>
        )}
      </div>
    </section>
  )
}

/* ---------- لمحة «سماء المقالات» — نجوم هادئة تمهد للخريطة الكاملة ---------- */
function MiniAtlas() {
  const reduce = useReducedMotion()
  const { articles } = useCmsContent()
  // موضع حتمي: الزمن أفقياً (الأقدم يميناً كما في السماء الكاملة)، وتشتت رأسي من بصمة العنوان
  const t0 = new Date('2019-01-01').getTime()
  const t1 = new Date('2026-12-31').getTime()
  const hash = (s: string) => [...s].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 997, 7)
  // عيّنة هادئة موزعة عبر الزمن — لا كل الأرشيف (الزحام يقتل السحر، والسماء الكاملة في /atlas)
  const step = Math.max(1, Math.ceil(articles.length / 54))
  const sample = articles.filter((_, i) => i % step === 0)
  const stars = sample.map((a) => ({
    slug: a.slug, title: a.title,
    x: 100 - ((new Date(a.iso).getTime() - t0) / (t1 - t0)) * 100,
    y: 12 + (hash(a.slug) % 76),
    r: 2 + (hash(a.title) % 3),
  }))
  return (
    <section className="border-t border-hair px-6 py-11 md:px-11 md:py-[72px]">
      <div className="mx-auto max-w-shell">
        <SectionHead label="سماء المقالات" title="كل نجمة مقال." to="/atlas" cta="الخريطة الكاملة" />
        <FadeUp>
          <div className="relative mt-7 h-[120px] overflow-hidden rounded-2xl border border-hair bg-wash md:mt-10 md:h-[150px]">
            {stars.map((s, i) => (
              <Link
                key={s.slug}
                to={`/articles/${s.slug}`}
                title={s.title}
                data-hover
                className="group absolute -translate-x-1/2 -translate-y-1/2"
                style={{ right: `${s.x}%`, top: `${s.y}%` }}
              >
                <motion.span
                  className="block rounded-full bg-accent/70 transition-all duration-300 group-hover:scale-[2.2] group-hover:bg-accent"
                  style={{ width: s.r * 2, height: s.r * 2 }}
                  initial={reduce ? false : { opacity: 0, scale: 0 }}
                  whileInView={{ opacity: 1, scale: 1 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.6, delay: Math.min(i * 0.012, 0.9), ease: EASE }}
                />
              </Link>
            ))}
            <span className="pointer-events-none absolute bottom-3 right-4 text-[.72rem] text-soft">مرّر على نجمة — واضغطها لتقرأ</span>
          </div>
        </FadeUp>
      </div>
    </section>
  )
}

/* ---------- «منذ زيارتك الأخيرة» — الموقع يتذكّر (فكرة نووية ٣ لصديقه) ----------
   تخزين محلي بسيط: يظهر سطر هادئ للعائد بعد ٱ٢ ساعة+ يخبره بالجديد فقط. */
function SinceLastVisit() {
  const { articles } = useCmsContent()
  const [last] = useState<number | null>(() => {
    try {
      const prev = localStorage.getItem('visit:last')
      localStorage.setItem('visit:last', String(Date.now()))
      return prev ? +prev : null
    } catch { return null }
  })
  // آخر مقالٍ فتحه الزائر (من جهازه فقط) — يُعرض له بهدوء ليُكمل من حيث توقّف
  const [lastRead] = useState<{ slug: string; title: string; at: number } | null>(() => {
    try { return JSON.parse(localStorage.getItem('read:last') || 'null') } catch { return null }
  })

  const away = last ? Date.now() - last : 0
  const showSince = last && away >= 12 * 3600e3
  const lastIso = last ? new Date(last).toISOString().slice(0, 10) : ''
  const newArticles = showSince ? articles.filter((a) => a.iso > lastIso).length : 0
  const weekOf = (ms: number) => Math.floor((ms / 864e5 - 4) / 7)
  const newQuestion = showSince && weekOf(Date.now()) !== weekOf(last!)
  const daysGone = showSince ? Math.floor(away / 864e5) : 0

  const bits: { to: string; t: string }[] = []
  if (newArticles > 0) bits.push({ to: '/articles', t: newArticles === 1 ? 'مقال جديد' : `${newArticles} مقالات جديدة` })
  if (newQuestion) bits.push({ to: '/questions', t: 'سؤال أسبوعي جديد' })
  if (daysGone >= 1) bits.push({ to: '/curated', t: 'اختيارات تبدّلت' })

  // «أكمل قراءتك» يظهر متى وُجد مقالٌ سابق (حتى دون غياب طويل)
  const resume = lastRead && Date.now() - lastRead.at < 45 * 864e5 ? lastRead : null
  if (!bits.length && !resume) return null

  return (
    <div className="border-t border-hair bg-wash px-6 py-3.5 md:px-11">
      <div className="mx-auto flex max-w-shell flex-col gap-1.5">
        {resume && (
          <Link to={`/articles/${resume.slug}`} className="group flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[.82rem] text-soft">
            <span className="font-semibold text-accent">↩ أكمل قراءتك</span>
            <span className="text-ink transition-colors group-hover:text-accent">«{resume.title}»</span>
            <span className="text-accent opacity-0 transition-opacity duration-300 group-hover:opacity-100">←</span>
          </Link>
        )}
        {bits.length > 0 && (
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[.82rem] text-soft">
            <span className="font-semibold text-accent">✦ منذ زيارتك الأخيرة</span>
            {bits.map((b, i) => (
              <Link key={b.to} to={b.to} className="transition-colors hover:text-accent">
                {b.t}{i < bits.length - 1 ? ' ·' : ''}
              </Link>
            ))}
          </p>
        )}
      </div>
    </div>
  )
}

/* ---------- «كوكبة التوقيعات» — العائلة المعلنة لما لا يشبه غيره ----------
   أفقٌ شعري تعلوه نجوم بارتفاعات متفاوتة (صدى «سماء المقالات»)؛ كل نجمة
   تتلألأ بهدوء وتتوهج حين يلمس الزائر اسمها. لون واحد، حركة همس. */
function Signatures() {
  const sigs = [
    { to: '/atlas', t: 'سماء المقالات', dy: -14 },
    { to: '/thought-paths', t: 'مسار الفكرة', dy: -4 },
    { to: '/ask', t: 'اسأل مكتبتي', dy: -18 },
    { to: '/decade', t: 'وثيقة العقد', dy: -8 },
    { to: '/questions', t: 'سؤال يُقلق التعليم', dy: -12 },
  ]
  return (
    <section className="border-t border-hair px-6 py-12 md:px-11 md:py-14">
      <div className="mx-auto max-w-shell">
        <FadeUp>
          <p className="text-[.78rem] font-semibold text-accent">✦ توقيعات الموقع</p>
        </FadeUp>
        <FadeUp delay={0.08}>
          <div className="relative mt-9">
            {/* الأفق */}
            <span aria-hidden className="pointer-events-none absolute left-0 right-0 top-[13px] h-px bg-hair" />
            <div className="flex flex-wrap items-end gap-x-10 gap-y-8 md:gap-x-14">
              {sigs.map((s, i) => (
                <Link
                  key={s.to}
                  to={s.to}
                  data-hover
                  className="sig-item group relative pt-8"
                  style={{ ['--dy' as string]: `${s.dy}px`, ['--tw' as string]: `${(i * 0.9).toFixed(1)}s` }}
                >
                  <span aria-hidden className="sig-star" />
                  <span className="block font-display text-[.98rem] font-medium text-soft transition-colors duration-300 group-hover:text-ink">
                    {s.t}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </FadeUp>
      </div>
    </section>
  )
}

/* ---------- «في مثل هذا الأسبوع» — الذاكرة الحيّة ----------
   يطابق أسبوع السنة الحالي مع الأرشيف (٢٠١٦ فصاعداً) ويُخرج مقالاً كتبه الدكتور
   في مثل هذه الأيام قبل سنوات — يتبدّل أسبوعياً، بلا خادم وبلا تدخل. */
const yearsAgo = (n: number) => (n === 1 ? 'قبل سنة' : n === 2 ? 'قبل سنتين' : n <= 10 ? `قبل ${n} سنوات` : `قبل ${n} سنة`)

function OnThisWeek() {
  const { articles } = useCmsContent()
  const today = new Date()
  const doy = (d: Date) => Math.floor((d.getTime() - new Date(d.getFullYear(), 0, 1).getTime()) / 864e5)
  const t = doy(today)
  const y = today.getFullYear()

  const cands = articles
    .map((a) => ({ a, d: new Date(a.iso + 'T12:00:00') }))
    .filter((x) => !Number.isNaN(x.d.getTime()) && x.d.getFullYear() < y)
    .map((x) => {
      let diff = Math.abs(doy(x.d) - t)
      if (diff > 182) diff = 365 - diff
      return { ...x, diff }
    })
    .filter((x) => x.diff <= 7)
    .sort((p, q) => p.diff - q.diff || p.d.getFullYear() - q.d.getFullYear())

  if (!cands.length) return null
  // اختيار حتمي يتبدّل مع رقم الأسبوع — نفس المقال طوال الأسبوع لكل الزوار
  const week = Math.floor(today.getTime() / (7 * 864e5))
  const pick = cands[week % cands.length]
  const n = y - pick.d.getFullYear()
  const when = pick.d.toLocaleDateString('ar-u-nu-latn', { month: 'long', year: 'numeric' })

  return (
    <section className="border-t border-hair px-6 py-11 md:px-11 md:py-[72px]">
      <div className="mx-auto max-w-shell">
        <FadeUp>
          <Link to={`/articles/${pick.a.slug}`} data-hover className="group block max-w-3xl">
            <p className="flex items-center gap-3 text-[.8rem] font-semibold text-accent">
              <span className="h-[1.5px] w-7 bg-accent" />
              في مثل هذا الأسبوع · {yearsAgo(n)}
            </p>
            <h2 className="mt-4 font-display text-[clamp(1.4rem,3.2vw,2.1rem)] font-semibold leading-[1.6] text-ink transition-colors duration-300 group-hover:text-accent">
              «{pick.a.title}»
            </h2>
            <p className="mt-3 text-[.9rem] text-soft transition-colors group-hover:text-accent">
              اقرأ ما كتبتُه في {when} <span className="inline-block transition-transform duration-300 group-hover:-translate-x-1">←</span>
            </p>
          </Link>
        </FadeUp>
      </div>
    </section>
  )
}

/* ---------- «بوصلة الفكر» (فكرة نووية ٣) ----------
   تصفّح بالفكرة لا بنوع الملف: كل محور يصله أعماله. أرشيف → عقل يُستكشف. */
const AXIS_KEYS: Record<string, string[]> = {
  'التعليم': ['تعليم', 'تدريس', 'مناهج', 'تعلم', 'التعلم', 'مدرس', 'طلبة', 'التعليمية'],
  'التربية': ['تربية', 'طفل', 'أطفال', 'أبناء', 'أسرة'],
  'مجتمع': ['مجتمع', 'إعلام', 'شباب', 'اجتماعي'],
  'تقنية': ['تكنولوجيا', 'ذكاء', 'رقمي', 'بيانات', 'تطبيقات', 'أجهزة', 'افتراضي'],
  'هوية': ['هوية', 'تراث', 'لغة', 'قيم', 'احتياجات'],
}
function axisDeepDive(axis: string) {
  const keys = AXIS_KEYS[axis] || []
  const hit = <T extends { title: string }>(items: T[], extra: (x: T) => string) => {
    let top: T | null = null, best = 0
    for (const it of items) {
      const text = it.title + ' ' + extra(it)
      let s = 0; for (const k of keys) if (text.includes(k)) s++
      if (s > best) { best = s; top = it }
    }
    return top
  }
  return {
    paper: hit(staticPapers as { slug: string; title: string; meta?: string }[], (p) => p.meta || ''),
    book: hit(staticBooks as { slug: string; title: string; desc?: string }[], (b) => b.desc || ''),
  }
}

function ThoughtCompass() {
  const { articles } = useCmsContent()
  const axes = [
    { key: 'التعليم', label: 'التعليم' },
    { key: 'التربية', label: 'التربية' },
    { key: 'مجتمع', label: 'المجتمع' },
    { key: 'تقنية', label: 'التقنية' },
    { key: 'هوية', label: 'الهوية' },
  ]
  const [active, setActive] = useState(axes[0].key)
  const related = articles.filter((a) => a.cat === active).slice(0, 3)
  const dive = axisDeepDive(active)

  return (
    <section className="border-t border-hair px-6 py-11 md:px-11 md:py-[100px]">
      <div className="mx-auto max-w-shell">
        <FadeUp><Label>بوصلة الفكر</Label></FadeUp>
        <FadeUp delay={0.05}>
          <h2 className="mb-7 font-display text-[clamp(2rem,5vw,3.3rem)] font-semibold leading-[1.25] text-ink md:mb-10">
            <Reveal>تصفّح بالفكرة.</Reveal>
          </h2>
        </FadeUp>

        {/* المحاور */}
        <FadeUp delay={0.1}>
          <div className="flex flex-wrap gap-2.5">
            {axes.map((a) => (
              <button
                key={a.key}
                onMouseEnter={() => setActive(a.key)}
                onClick={() => setActive(a.key)}
                data-hover
                className={`rounded-full border px-5 py-2 font-display text-[1.02rem] transition-colors duration-300 ${
                  active === a.key ? 'border-accent bg-accent text-white' : 'border-hair text-soft hover:border-accent hover:text-accent'
                }`}
              >
                {a.label}
              </button>
            ))}
          </div>
        </FadeUp>

        {/* أعمال المحور */}
        <div className="mt-8 grid gap-5 md:mt-10 md:grid-cols-3 md:gap-6">
          {related.map((a, i) => (
            <FadeUp key={a.slug} delay={Math.min(i * 0.06, 0.2)} className={i > 0 ? 'hidden md:block' : ''}>
              <Link to={`/articles/${a.slug}`} data-hover className="group flex h-full flex-col rounded-2xl border border-hair bg-canvas p-6 transition-colors duration-300 hover:border-accent">
                <time className="text-[.76rem] text-soft">{a.date}</time>
                <h3 className="mt-3 font-display text-[1.12rem] font-medium leading-[1.6] text-ink transition-colors group-hover:text-accent">{a.title}</h3>
                <span className="mt-auto pt-6 text-[.82rem] text-soft transition-colors group-hover:text-accent">اقرأ ←</span>
              </Link>
            </FadeUp>
          ))}
        </div>
        <FadeUp delay={0.15}>
          <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 text-[.9rem]">
            <Link to="/thought-paths" className="font-semibold text-accent">مسار الفكرة الكامل ←</Link>
            <Link to="/articles" className="text-soft transition-colors hover:text-accent">كل ما كتبته في {axes.find((a) => a.key === active)?.label} ←</Link>
            {dive.paper && (
              <Link to={`/research/${dive.paper.slug}`} className="group text-soft transition-colors hover:text-accent">
                <span className="me-1.5 rounded-full border border-hair px-2 py-0.5 text-[.7rem]">بحث</span>{dive.paper.title.slice(0, 42)}{dive.paper.title.length > 42 ? '…' : ''} <span className="text-accent">←</span>
              </Link>
            )}
            {dive.book && (
              <Link to={`/publications/${dive.book.slug}`} className="group text-soft transition-colors hover:text-accent">
                <span className="me-1.5 rounded-full border border-hair px-2 py-0.5 text-[.7rem]">كتاب</span>{dive.book.title.slice(0, 42)}{dive.book.title.length > 42 ? '…' : ''} <span className="text-accent">←</span>
              </Link>
            )}
          </div>
        </FadeUp>
      </div>
    </section>
  )
}

/* ---------- سؤال الأسبوع التفاعلي (فكرة نووية ٧) ----------
   الزائر يصوّت بلا تسجيل ولا تتبّع، فيُكشف له رأي الدكتور — مشاركٌ لا متفرّج. */
function WeeklyPoll() {
  // يدور على البنك بلا توقف — كل جمعة سؤال، وبعد نفاد البنك يعيد الدورة
  const week = Math.max(0, Math.floor((Date.now() - new Date(LAUNCH_DATE).getTime()) / (7 * 24 * 60 * 60 * 1000))) % staticQuestions.length
  const q = staticQuestions[week]
  const key = `poll:${week}`
  const [voted, setVoted] = useState<string | null>(null)
  useEffect(() => { try { setVoted(localStorage.getItem(key)) } catch { /* noop */ } }, [key])
  const vote = (o: string) => { setVoted(o); try { localStorage.setItem(key, o) } catch { /* noop */ } }
  const options = ['أوافق', 'لا أوافق', 'المسألة أعقد']

  return (
    <section className="border-t border-hair bg-wash px-6 py-11 md:px-11 md:py-[100px]">
      <div className="mx-auto max-w-shell">
        <FadeUp><Label>سؤال الأسبوع</Label></FadeUp>
        <FadeUp delay={0.05}>
          <h2 className="max-w-3xl font-display text-[clamp(1.5rem,3.6vw,2.4rem)] font-semibold leading-[1.5] text-ink">{q.ar}</h2>
          <p className="mt-3 max-w-2xl text-[.95rem] font-light text-soft" dir="ltr" style={{ textAlign: 'left' }}>{q.en}</p>
        </FadeUp>

        {!voted ? (
          <FadeUp delay={0.12}>
            <div className="mt-8 flex flex-wrap gap-3">
              {options.map((o) => (
                <button key={o} onClick={() => vote(o)} data-hover
                  className="rounded-full border-[1.5px] border-hair px-7 py-3 text-[.95rem] font-semibold text-ink transition-colors duration-300 hover:border-accent hover:text-accent">
                  {o}
                </button>
              ))}
            </div>
            <p className="mt-4 text-[.8rem] text-soft">رأيك يبقى على جهازك — بلا تسجيل، بلا تتبّع.</p>
          </FadeUp>
        ) : (
          <FadeUp delay={0.05}>
            <div className="mt-8">
              <p className="text-[.9rem] text-soft">اخترت: <span className="font-semibold text-accent">{voted}</span></p>
              <div className="mt-5 max-w-3xl rounded-2xl border border-accent/40 bg-canvas p-7 md:p-8">
                <p className="mb-3 text-[.8rem] font-semibold text-accent">رأيي في المسألة</p>
                <p className="text-[1.05rem] leading-[2] text-ink">{q.take}</p>
              </div>
              <Link to="/questions" className="mt-6 inline-block text-[.9rem] font-semibold text-accent">
                إلى زاوية «سؤال يُقلق التعليم» ←
              </Link>
            </div>
          </FadeUp>
        )}
      </div>
    </section>
  )
}

/* ---------- «الأثر» — رحلة فكر لا أرقام صاخبة (فكرة نووية ٥) ----------
   خط زمني هادئ يُحسب من المحتوى نفسه، فيقول «ماذا صنعت» لا «كم». */
function ImpactTimeline() {
  const { articles, books, papers } = useCmsContent()
  const years = articles.map((a) => +a.iso.slice(0, 4))
  if (!articles.length) return null
  const firstYear = Math.min(...years)
  const latestYear = Math.max(...years)
  const byYear: Record<number, number> = {}
  years.forEach((y) => { byYear[y] = (byYear[y] || 0) + 1 })
  const peakYear = Object.entries(byYear).sort((a, b) => b[1] - a[1])[0]
  const latest = articles[0]

  const steps = [
    { y: String(firstYear), t: 'البداية — أول مقالٍ فكري في الصحافة الكويتية.' },
    { y: `${peakYear[0]}`, t: `ذروة الإنتاج — ${peakYear[1]} مقالاً في عامٍ واحد.` },
    { y: 'مرجع', t: `أرشيفٌ مؤلَّف — ${books.length} كتب و${papers.length} بحثاً محكّماً.` },
    { y: String(latestYear), t: `الأحدث — «${latest.title}».` },
  ]

  return (
    <section className="border-t border-hair px-6 py-11 md:px-11 md:py-[100px]">
      <div className="mx-auto max-w-shell">
        <FadeUp><Label>الأثر</Label></FadeUp>
        <FadeUp delay={0.05}>
          <h2 className="mb-8 font-display text-[clamp(2rem,5vw,3.3rem)] font-semibold leading-[1.25] text-ink md:mb-12">
            <Reveal>رحلة فكر.</Reveal>
          </h2>
        </FadeUp>
        <ol className="relative mr-2 border-r-2 border-hair pr-8">
          {steps.map((s, i) => (
            <FadeUp key={s.t} delay={Math.min(i * 0.1, 0.4)} className={i > 0 && i < steps.length - 1 ? 'hidden md:block' : ''}>
              <li className="relative pb-7 last:pb-0 md:pb-10">
                <span className="absolute right-[-2.6rem] top-1.5 h-3 w-3 rounded-full border-2 border-accent bg-canvas" />
                <span className="font-display text-[1.05rem] font-bold text-accent">{s.y}</span>
                <p className="mt-1.5 max-w-xl text-[1.05rem] font-light leading-[1.85] text-ink/80">{s.t}</p>
              </li>
            </FadeUp>
          ))}
        </ol>
        <FadeUp delay={0.2}>
          <div className="mt-8 flex flex-wrap items-center justify-between gap-4 border-t border-hair pt-6 md:mt-10 md:pt-8">
            <p className="font-display text-[clamp(1.2rem,2.6vw,1.7rem)] font-semibold leading-relaxed text-ink">هذا ليس أرشيفاً… هذه رحلة فكر.</p>
            <Link to="/decade" className="text-[.88rem] font-semibold text-accent">اقرأ «وثيقة العقد» ←</Link>
          </div>
        </FadeUp>
      </div>
    </section>
  )
}

/* ---------- The single "Latest" card ---------- */
function LatestCard() {
  const reduce = useReducedMotion()
  const { articles } = useCmsContent()
  const latest = articles[0]
  if (!latest) return null
  return (
    <section className="px-6 pb-[56px] md:px-11 md:pb-[100px]">
      <div className="mx-auto max-w-shell">
        <FadeUp>
          <motion.div
            whileHover={reduce ? {} : { y: -4 }}
            transition={{ duration: 0.4, ease: EASE }}
            className="group relative overflow-hidden rounded-2xl border border-hair bg-wash p-8 md:p-12"
          >
            <div className="pointer-events-none absolute -left-24 -top-24 h-64 w-64 rounded-full bg-accent/[.07] blur-3xl" />
            <div className="relative flex flex-wrap items-center justify-between gap-6">
              <div className="min-w-0 flex-1">
                <span className="inline-flex items-center gap-2.5 text-[.78rem] font-semibold text-accent">
                  <span className="pulse relative h-2 w-2 rounded-full bg-accent" />
                  الأحدث · مقال
                </span>
                <h2 className="mt-4 max-w-[720px] font-display text-[clamp(1.6rem,3.6vw,2.5rem)] font-semibold leading-[1.35] text-ink">
                  {latest.title}
                </h2>
              </div>
              <Link
                to={`/articles/${latest.slug}`}
                data-hover
                className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border-[1.5px] border-accent text-[1.4rem] text-accent transition-all duration-300 group-hover:bg-accent group-hover:text-white md:h-20 md:w-20"
                aria-label="اقرأ المزيد"
              >
                ←
              </Link>
            </div>
          </motion.div>
        </FadeUp>
      </div>
    </section>
  )
}

/* ---------- Soft card wrapper ---------- */
function Card({ children, delay = 0, className = '' }: { children: React.ReactNode; delay?: number; className?: string }) {
  const reduce = useReducedMotion()
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 26 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.7, delay, ease: EASE }}
      whileHover={reduce ? {} : { y: -6 }}
      className={className}
    >
      {children}
    </motion.div>
  )
}

export default function Home() {
  useSeo({ title: 'د. أحمد حسين الفيلكاوي — أستاذ تكنولوجيا التعليم والذكاء الاصطناعي', path: '/' })
  const { articles, books, papers, media } = useCmsContent()
  const addedEvents = useExtras<SiteEvent & { id: string }>('site_upcoming')
  const upcomingItems = [...addedEvents, ...upcoming]
    .filter((event, index, list) => list.findIndex((candidate) => candidate.iso === event.iso && candidate.title === event.title) === index)
    .filter((event) => event.iso >= new Date().toISOString().slice(0, 10))
    .sort((left, right) => left.iso.localeCompare(right.iso))
  const reduce = useReducedMotion()
  const { scrollY } = useScroll()
  const parY = useTransform(scrollY, [0, 800], [0, 40])
  const tx = useMotionValue(0)
  const ty = useMotionValue(0)
  const stx = useSpring(tx, { stiffness: 120, damping: 20 })
  const sty = useSpring(ty, { stiffness: 120, damping: 20 })

  useEffect(() => {
    if (reduce) return
    const m = (e: MouseEvent) => {
      tx.set((e.clientX / window.innerWidth - 0.5) * 14)
      ty.set((e.clientY / window.innerHeight - 0.5) * 14)
    }
    window.addEventListener('mousemove', m)
    return () => window.removeEventListener('mousemove', m)
  }, [reduce, tx, ty])

  const topArticles = articles.slice(0, 3)
  const topPapers = papers.slice(0, 3)
  const topMedia = media.slice(0, 3)

  return (
    <Page>
      {/* hero — البيان الفكري أولاً (100svh للجوال) */}
      <header className="relative flex min-h-[100svh] items-center px-6 pb-16 pt-24 md:px-11 md:pb-24 md:pt-28">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(55%_50%_at_78%_40%,rgba(62,92,120,.06),transparent_62%)]" />
        <div className="relative z-10 mx-auto grid w-full max-w-shell items-center gap-8 md:grid-cols-[1.15fr_.85fr] md:gap-16">
          {/* البيان أولاً — على الجوال والكمبيوتر */}
          <div className="order-1">
            {/* الجملة التي تراها أول ثانية — بيان الدكتور الفكري، لا نبذة */}
            <h1 className="font-display text-[clamp(2.1rem,5.4vw,4rem)] font-bold leading-[1.28] text-ink">
              {['أُبقي الإنسانَ', 'في قلبِ الآلة.'].map((line, i) => (
                // حشوة تحمي الهمزة والضمة فوق الألف من القصّ، وهامش سالب يحيّد أثرها
                <span key={line} className="-my-[0.3em] block overflow-hidden py-[0.3em]">
                  <motion.span
                    className="block"
                    initial={reduce ? false : { y: '150%' }}
                    animate={{ y: 0 }}
                    transition={{ duration: 1, delay: 0.25 + i * 0.14, ease: EASE }}
                  >
                    {line}
                  </motion.span>
                </span>
              ))}
            </h1>

            <motion.div className="my-7 h-[2px] bg-accent" initial={{ width: 0 }} animate={{ width: 74 }} transition={{ duration: 0.9, delay: 0.7, ease: EASE }} />

            {/* الاسم والصفة — أصغر، ثانويّان */}
            <motion.div
              initial={reduce ? false : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.85, ease: EASE }}
            >
              <p className="font-display text-[clamp(1.15rem,2.4vw,1.6rem)] font-semibold text-ink">د. {profile.name}</p>
              <p className="mt-1.5 text-[.95rem] font-light text-soft">أستاذ تكنولوجيا التعليم والذكاء الاصطناعي · مؤلف · باحث · مستشار</p>
            </motion.div>

            {/* زرّ واحد فقط */}
            <motion.div
              className="mt-9"
              initial={reduce ? false : { opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 1, ease: EASE }}
            >
              <Magnetic to="/articles" className="inline-block rounded-full bg-accent px-9 py-4 font-semibold text-white transition-colors duration-300 hover:bg-accent-deep">
                ادخل إلى عالمي الفكري ←
              </Magnetic>
            </motion.div>
          </div>

          <div className="order-2 flex justify-center">
            <motion.div style={{ y: parY }}>
              <motion.div style={{ x: stx, y: sty }} className="portrait-wrap" data-hover>
                <motion.div
                  className="portrait relative max-w-[210px] overflow-hidden rounded-2xl shadow-[0_36px_64px_-36px_rgba(21,22,26,.42)] sm:max-w-[260px] md:max-w-[400px]"
                  initial={reduce ? false : { opacity: 0, y: 26, scale: 1.03 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ duration: 1.1, delay: 0.75, ease: EASE }}
                >
                  <img src="/portrait.jpg" alt={`د. ${profile.fullName}`} className="block w-full" />
                </motion.div>
              </motion.div>
            </motion.div>
          </div>
        </div>

        <motion.div
          className="cue absolute bottom-8 left-1/2 -translate-x-1/2 text-[.74rem] text-soft"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1, delay: 2 }}
        >
          اكتشف
          <span className="relative mx-auto mt-2.5 block h-[30px] w-px overflow-hidden bg-hair" />
        </motion.div>
      </header>

      <LatestCard />

      <SinceLastVisit />

      <DailySpark />

      {/* about */}
      <section className="border-t border-hair px-6 py-11 md:px-11 md:py-[100px]">
        <div className="mx-auto grid max-w-shell items-start gap-10 md:grid-cols-2 md:gap-14">
          <FadeUp>
            <Label>نبذة</Label>
            <h2 className="font-display text-[clamp(2rem,5vw,3.3rem)] font-semibold leading-[1.25] text-ink">
              {profile.aboutHeading.split('\n').map((line, i) => (
                <Reveal key={i} delay={i * 0.08}>{line}</Reveal>
              ))}
            </h2>
          </FadeUp>
          <FadeUp delay={0.1}>
            <p className="text-[1.12rem] font-light leading-[1.9] text-ink/80">{profile.about}</p>
            <Link to="/cv" className="mt-7 inline-block border-b-[1.5px] border-accent pb-1 font-semibold text-accent">
              السيرة الكاملة ←
            </Link>
          </FadeUp>
        </div>
      </section>

      <WhoAreYou />

      {/* books */}
      <section className="border-t border-hair bg-wash py-[56px] md:py-[100px]">
        <div className="mx-auto max-w-shell px-6 md:px-11">
          <SectionHead label="المؤلفات" title={`${books.length} كتب.`} to="/publications" />
        </div>
        <div className="rail flex snap-x snap-mandatory gap-6 overflow-x-auto px-6 pb-4 md:px-11">
          {books.map((b, i) => (
            <Card key={b.slug} delay={Math.min(i * 0.05, 0.3)} className="w-[240px] shrink-0 snap-start md:w-[300px]">
              <Link to={`/publications/${b.slug}`} data-hover className="group block">
                <div className="overflow-hidden rounded-xl bg-white shadow-[0_22px_44px_-26px_rgba(21,22,26,.4)] transition-transform duration-500 group-hover:-translate-y-1.5" style={{ aspectRatio: '1024 / 700' }}>
                  <img src={b.cover} alt={b.title} loading="lazy" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
                </div>
                {/* انعكاس فاخر خافت — معرض لا شبكة منتجات */}
                <div aria-hidden className="mt-0.5 h-10 overflow-hidden rounded-b-xl opacity-25 [mask-image:linear-gradient(to_bottom,rgba(0,0,0,.5),transparent)]" style={{ transform: 'scaleY(-1)' }}>
                  <img src={b.cover} alt="" loading="lazy" className="h-full w-full object-cover object-top" />
                </div>
                <h3 className="mt-2 font-display text-[1.15rem] font-medium leading-[1.45] text-ink transition-colors group-hover:text-accent">{b.title}</h3>
              </Link>
            </Card>
          ))}
        </div>
      </section>

      <MiniAtlas />

      <OnThisWeek />

      <ThoughtCompass />

      {/* المقالات — لغة: مقال كبير مميّز + عنوانان فقط */}
      <section className="border-t border-hair px-6 py-[56px] md:px-11 md:py-[100px]">
        <div className="mx-auto max-w-shell">
          <SectionHead label="مقالاتي الفكرية" title="بصوتي الخاص." to="/articles" cta="عرض الكل" />
          <div className="grid gap-8 md:grid-cols-[1.5fr_.5fr] md:gap-12">
            <FadeUp>
              {topArticles[0] && <Link to={`/articles/${topArticles[0].slug}`} data-hover className="group block">
                <div className="flex items-center gap-2.5 text-[.78rem]">
                  <span className="font-semibold text-accent">{topArticles[0].cat}</span>
                  <span className="h-1 w-1 rounded-full bg-hair" />
                  <time className="text-soft">{topArticles[0].date}</time>
                </div>
                <h3 className="mt-4 font-display text-[clamp(1.6rem,3.4vw,2.4rem)] font-semibold leading-[1.4] text-ink transition-colors group-hover:text-accent">
                  {topArticles[0].title}
                </h3>
                {topArticles[0].excerpt && <p className="mt-4 max-w-xl text-[1.02rem] font-light leading-[1.9] text-ink/80">{topArticles[0].excerpt}</p>}
                <span className="mt-6 inline-block text-[.9rem] font-semibold text-accent">اقرأ المقال ←</span>
              </Link>}
            </FadeUp>
            <FadeUp delay={0.12} className="hidden md:block">
              <div className="flex flex-col divide-y divide-hair border-t border-hair md:border-r md:border-t-0 md:pr-8">
                {topArticles.slice(1, 3).map((a) => (
                  <Link key={a.slug} to={`/articles/${a.slug}`} data-hover className="group py-6 first:pt-6 md:first:pt-0">
                    <time className="text-[.76rem] text-soft">{a.date}</time>
                    <h4 className="mt-2 font-display text-[1.1rem] font-medium leading-[1.6] text-ink transition-colors group-hover:text-accent">{a.title}</h4>
                  </Link>
                ))}
              </div>
            </FadeUp>
          </div>
        </div>
      </section>

      {/* الأبحاث — لغة: قائمة مرقّمة أنيقة، لا بطاقات */}
      <section className="border-t border-hair bg-wash px-6 py-11 md:px-11 md:py-[100px]">
        <div className="mx-auto max-w-shell">
          <SectionHead label="المساهمات العلمية" title="أبحاث محكّمة." to="/research" cta="عرض الكل" />
          <ol className="mt-2">
            {topPapers.map((p, i) => (
              <FadeUp key={p.slug} delay={Math.min(i * 0.06, 0.24)} className={i > 1 ? 'hidden md:block' : ''}>
                <li className={i === 0 ? '' : 'border-t border-hair'}>
                  <Link to={`/research/${p.slug}`} data-hover className="group flex items-baseline gap-6 py-6 transition-[padding] duration-300 hover:pe-3">
                    <span className="w-8 shrink-0 font-display text-[1.4rem] font-bold text-accent/70 transition-colors group-hover:text-accent">{arNum(i + 1)}</span>
                    <span className="flex-1">
                      <span className="block text-[1.1rem] font-medium leading-[1.7] text-ink transition-colors group-hover:text-accent">{p.title}</span>
                      <span className="mt-1 block text-[.8rem] text-soft">{p.meta}</span>
                    </span>
                    <span className="shrink-0 text-soft transition-transform duration-300 group-hover:-translate-x-1">←</span>
                  </Link>
                </li>
              </FadeUp>
            ))}
          </ol>
        </div>
      </section>

      {/* الإعلام — لغة: فيديو سينمائي واحد + رابطان نصيان */}
      <section className="border-t border-hair px-6 py-11 md:px-11 md:py-[100px]">
        <div className="mx-auto max-w-shell">
          <SectionHead label="الظهور الإعلامي" title="على الشاشة." to="/media" cta="عرض الكل" />
          <div className="grid gap-8 md:grid-cols-[1.55fr_.45fr] md:gap-12">
            <FadeUp>
              {topMedia[0] && <a href={topMedia[0].url} target="_blank" rel="noreferrer" data-hover className="group block overflow-hidden rounded-2xl">
                <div className="relative overflow-hidden bg-wash" style={{ aspectRatio: '16 / 9' }}>
                  {ytId(topMedia[0].url) && (
                    <img src={`https://i.ytimg.com/vi/${ytId(topMedia[0].url)}/hqdefault.jpg`} alt={topMedia[0].title} loading="lazy" className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105" />
                  )}
                  <span className="absolute inset-0 bg-ink/10 transition-colors duration-300 group-hover:bg-ink/25" />
                  <span className="absolute left-1/2 top-1/2 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-[1.5px] border-white/80 bg-ink/40 text-white backdrop-blur-sm transition-all duration-300 group-hover:scale-110 group-hover:border-accent group-hover:bg-accent">▶</span>
                </div>
                <div className="mt-4">
                  <span className="text-[.74rem] font-semibold text-accent">{topMedia[0].outlet}</span>
                  <h3 className="mt-1.5 font-display text-[1.2rem] font-medium leading-[1.55] text-ink transition-colors group-hover:text-accent">{topMedia[0].title}</h3>
                </div>
              </a>}
            </FadeUp>
            <FadeUp delay={0.12} className="hidden md:block">
              <div className="flex flex-col divide-y divide-hair border-t border-hair md:border-r md:border-t-0 md:pr-8">
                {topMedia.slice(1, 3).map((m) => (
                  <a key={m.url} href={m.url} target="_blank" rel="noreferrer" data-hover className="group flex items-start gap-3 py-5 first:pt-5 md:first:pt-0">
                    <span className="mt-1 text-[.7rem] text-accent">▶</span>
                    <span>
                      <span className="block text-[.72rem] font-semibold text-accent">{m.outlet}</span>
                      <span className="mt-1 block text-[.98rem] font-medium leading-[1.55] text-ink transition-colors group-hover:text-accent">{m.title}</span>
                    </span>
                  </a>
                ))}
              </div>
            </FadeUp>
          </div>
        </div>
      </section>

      <ImpactTimeline />

      <WeeklyPoll />

      <Signatures />

      {/* اللقاءات + النشرة — شريط خفيف لا كتلة عملاقة */}
      <section className="border-t border-hair px-6 py-12 md:px-11 md:py-16">
        <div className="mx-auto grid max-w-shell gap-9 md:grid-cols-[1.1fr_.9fr] md:gap-14">
          <FadeUp>
            <div className="mb-6 flex items-end justify-between gap-5">
              <div>
                <Label>اللقاءات القادمة</Label>
                <h2 className="font-display text-[clamp(1.5rem,3.2vw,2rem)] font-semibold leading-[1.35] text-ink">أين ألتقيك؟</h2>
              </div>
              <Link to="/upcoming" className="shrink-0 pb-1 text-[.84rem] font-semibold text-accent">الجدول ←</Link>
            </div>
            {upcomingItems.length > 0 ? (
              <ul className="space-y-2.5">
                {upcomingItems.slice(0, 2).map((e) => (
                  <li key={e.iso + e.title} className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-hair px-4 py-3 transition-colors hover:border-accent">
                    <time className="shrink-0 text-[.78rem] font-semibold text-accent">{e.date}</time>
                    <span className="min-w-0 flex-1">
                      <span className="block font-display text-[1rem] font-medium leading-[1.5] text-ink">{e.title}</span>
                      <span className="block text-[.76rem] text-soft">{e.org} · {e.place}</span>
                    </span>
                    {e.url && <a href={e.url} target="_blank" rel="noreferrer" className="text-[.76rem] font-semibold text-accent">التسجيل ←</a>}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-hair bg-wash px-4 py-3">
                <p className="text-[.88rem] font-light leading-[1.7] text-soft">لا لقاءات معلنة حالياً.</p>
                <Link to="/contact#booking-form" className="text-[.82rem] font-semibold text-accent">احجز موعداً ←</Link>
              </div>
            )}
          </FadeUp>

          <FadeUp delay={0.1}>
            <Newsletter />
          </FadeUp>
        </div>
      </section>
    </Page>
  )
}
