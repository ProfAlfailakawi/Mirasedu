import { useCallback, useEffect, useRef, useState } from 'react'
import { motion, useInView, useMotionValue, useReducedMotion, useScroll, useSpring, AnimatePresence } from 'framer-motion'
import { Link, useLocation } from 'react-router-dom'
import { LINK_OUT, SHOW_EN_TOGGLE, profile, socials, links } from '../data'
import { ThemeToggle } from './extras'
import { useCvLinks } from '../lib/settings'
import { SocialIcon } from './icons'

export { EASE } from './motion'
export { SocialIcon } from './icons'
import { EASE } from './motion'

/* ---------- Masked reveal ----------
   يعتمد useInView مع شبكة أمان: إن كان العنصر داخل الشاشة ولم يُطلق المراقب
   (يحدث خلف شاشة التحميل أو مع انتقالات الصفحات) يُكشف النصّ قسراً.
   لا يُترك عنوانٌ مخفياً أبداً. */
export function Reveal({ children, delay = 0, className = '' }: { children: React.ReactNode; delay?: number; className?: string }) {
  const reduce = useReducedMotion()
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { once: true, amount: 0.15 })
  const [safety, setSafety] = useState(false)

  useEffect(() => {
    if (reduce) { setSafety(true); return }
    const t = setTimeout(() => {
      const el = ref.current
      if (!el) return
      const r = el.getBoundingClientRect()
      // داخل الشاشة رأسياً؟ اكشفه.
      if (r.top < window.innerHeight && r.bottom > 0) setSafety(true)
    }, 900)
    return () => clearTimeout(t)
  }, [reduce])

  const show = reduce || inView || safety

  return (
    // الحشوة العمودية تمنع قصّ التنوين والهمزات فوق الحروف وذيولها تحتها، والهامش السالب يلغي أثرها على التخطيط
    <span ref={ref} className={`-my-[0.3em] block overflow-hidden py-[0.3em] ${className}`}>
      <motion.span
        className="block"
        initial={reduce ? false : { y: '150%' }}
        animate={show ? { y: 0 } : { y: '150%' }}
        transition={{ duration: 1, ease: EASE, delay }}
      >
        {children}
      </motion.span>
    </span>
  )
}

/* ---------- Fade up ---------- */
export function FadeUp({ children, delay = 0, className = '' }: { children: React.ReactNode; delay?: number; className?: string }) {
  const reduce = useReducedMotion()
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, amount: 0.12 })
  const [safety, setSafety] = useState(false)

  useEffect(() => {
    if (reduce) { setSafety(true); return }
    const t = setTimeout(() => {
      const el = ref.current
      if (!el) return
      const r = el.getBoundingClientRect()
      if (r.top < window.innerHeight && r.bottom > 0) setSafety(true)
    }, 900)
    return () => clearTimeout(t)
  }, [reduce])

  const show = reduce || inView || safety

  return (
    <motion.div
      ref={ref}
      className={className}
      initial={reduce ? false : { opacity: 0, y: 28 }}
      animate={show ? { opacity: 1, y: 0 } : { opacity: 0, y: 28 }}
      transition={{ duration: 0.9, ease: EASE, delay }}
    >
      {children}
    </motion.div>
  )
}

/* ---------- Label ---------- */
export const Label = ({ children, center = false }: { children: React.ReactNode; center?: boolean }) => (
  <div className={`mb-5 flex items-center gap-3 ${center ? 'justify-center' : ''}`}>
    <span className="h-[1.5px] w-7 bg-accent" />
    <span className="text-[.8rem] font-semibold uppercase text-accent">{children}</span>
  </div>
)

/* ---------- Page heading (used by inner pages) ---------- */
export function PageHead({ label, title, sub }: { label: string; title: string; sub?: string }) {
  return (
    <header className="border-b border-hair px-6 pb-12 pt-32 md:px-11 md:pb-14 md:pt-40">
      <div className="mx-auto max-w-shell">
        <FadeUp>
          <Label>{label}</Label>
          <h1 className="font-display text-[clamp(2.4rem,6vw,4rem)] font-bold leading-[1.15] text-ink">
            <Reveal>{title}</Reveal>
          </h1>
          {sub && <p className="mt-4 max-w-[620px] text-[1.05rem] font-light text-ink/80">{sub}</p>}
        </FadeUp>
      </div>
    </header>
  )
}

/* ---------- Safe link (old-site links gated) ---------- */
export function SafeLink({
  href,
  external,
  className = '',
  children,
  ...rest
}: {
  href?: string
  external?: boolean
  className?: string
  children: React.ReactNode
  [k: string]: any
}) {
  const allowed = external || (LINK_OUT && !!href)
  if (!allowed) return <div className={className} {...rest}>{children}</div>
  return (
    <a href={href} target="_blank" rel="noreferrer" className={className} {...rest}>
      {children}
    </a>
  )
}

/* ---------- Magnetic button ---------- */
export function Magnetic({ children, className = '', to, href }: { children: React.ReactNode; className?: string; to?: string; href?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const x = useMotionValue(0)
  const y = useMotionValue(0)
  const sx = useSpring(x, { stiffness: 300, damping: 20 })
  const sy = useSpring(y, { stiffness: 300, damping: 20 })
  const reduce = useReducedMotion()

  const move = (e: React.MouseEvent) => {
    if (reduce || !ref.current) return
    const r = ref.current.getBoundingClientRect()
    x.set((e.clientX - r.left - r.width / 2) * 0.25)
    y.set((e.clientY - r.top - r.height / 2) * 0.4)
  }
  const leave = () => { x.set(0); y.set(0) }

  const inner = to ? <Link to={to} className={className}>{children}</Link> : <a href={href} target="_blank" rel="noreferrer" className={className}>{children}</a>
  return (
    <motion.div ref={ref} onMouseMove={move} onMouseLeave={leave} style={{ x: sx, y: sy }} className="inline-block">
      {inner}
    </motion.div>
  )
}

/* ---------- Custom cursor ---------- */
export function Cursor() {
  const [enabled, setEnabled] = useState(false)
  const [big, setBig] = useState(false)
  const x = useMotionValue(-100)
  const y = useMotionValue(-100)
  const rx = useSpring(x, { stiffness: 400, damping: 40, mass: 0.4 })
  const ry = useSpring(y, { stiffness: 400, damping: 40, mass: 0.4 })
  const loc = useLocation()

  useEffect(() => {
    const fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!fine || reduce) return
    setEnabled(true)
    document.body.classList.add('cursor-none-desktop')
    const move = (e: MouseEvent) => { x.set(e.clientX); y.set(e.clientY) }
    window.addEventListener('mousemove', move)
    return () => { window.removeEventListener('mousemove', move); document.body.classList.remove('cursor-none-desktop') }
  }, [x, y])

  useEffect(() => {
    if (!enabled) return
    const targets = document.querySelectorAll('a, button, img, [data-hover]')
    const on = () => setBig(true)
    const off = () => setBig(false)
    targets.forEach((t) => { t.addEventListener('mouseenter', on); t.addEventListener('mouseleave', off) })
    return () => targets.forEach((t) => { t.removeEventListener('mouseenter', on); t.removeEventListener('mouseleave', off) })
  }, [enabled, loc.pathname])

  if (!enabled) return null
  return (
    <>
      <motion.div
        className="cursor-ring pointer-events-none fixed z-[251] rounded-full border-[1.5px]"
        style={{ left: rx, top: ry, x: '-50%', y: '-50%' }}
        animate={{
          width: big ? 70 : 34,
          height: big ? 70 : 34,
          borderColor: big ? 'rgba(0,0,0,0)' : '#3E5C78',
          backgroundColor: big ? 'rgba(62,92,120,.07)' : 'rgba(0,0,0,0)',
        }}
        transition={{ duration: 0.28 }}
      />
      <motion.div className="cursor-dot pointer-events-none fixed z-[252] h-[5px] w-[5px] rounded-full bg-accent" style={{ left: x, top: y, x: '-50%', y: '-50%' }} />
    </>
  )
}

/* ---------- Section head: label + title + "الكل" ---------- */
export function SectionHead({ label, title, to, cta = 'الكل' }: { label: string; title: string; to: string; cta?: string }) {
  return (
    <div className="mb-10 flex items-end justify-between gap-6">
      <FadeUp>
        <Label>{label}</Label>
        <h2 className="font-display text-[clamp(2rem,5vw,3.3rem)] font-semibold leading-[1.25] text-ink">
          <Reveal>{title}</Reveal>
        </h2>
      </FadeUp>
      <Link to={to} className="group shrink-0 pb-2 text-[.92rem] font-semibold text-accent">
        {cta}
        <span className="inline-block transition-transform duration-300 group-hover:-translate-x-1.5"> ←</span>
      </Link>
    </div>
  )
}

/* ---------- Accordion (CV sections) ---------- */
export function Accordion({
  title,
  count,
  children,
  defaultOpen = false,
}: {
  title: string
  count?: string | number
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const reduce = useReducedMotion()
  return (
    <div className="border-b border-hair">
      <button onClick={() => setOpen(!open)} aria-expanded={open} className="group flex w-full items-baseline justify-between gap-5 py-6 text-right">
        <span className="flex items-baseline gap-3">
          <span className="font-display text-[1.22rem] font-medium text-ink transition-colors group-hover:text-accent md:text-[1.4rem]">{title}</span>
          {count !== undefined && <span className="text-[.82rem] text-soft">{count}</span>}
        </span>
        <span className="relative flex h-7 w-7 shrink-0 items-center justify-center">
          <span className="absolute h-[1.5px] w-3.5 bg-accent" />
          <motion.span className="absolute h-[1.5px] w-3.5 bg-accent" animate={{ rotate: open ? 0 : 90 }} transition={{ duration: 0.35, ease: EASE }} />
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={reduce ? false : { height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={reduce ? undefined : { height: 0, opacity: 0 }}
            transition={{ duration: 0.45, ease: EASE }}
            className="overflow-hidden"
          >
            <div className="pb-9">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/* ---------- Nav: closed menu, opens full-screen ---------- */
type NavItem = { to: string; label: string; allLabel?: string; sub?: { to: string; label: string }[] }
const GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: 'هويتي الأكاديمية',
    items: [
      { to: '/cv', label: 'السيرة الأكاديمية' },
      { to: '/decade', label: 'وثيقة العقد' },
      { to: '/research', label: 'المساهمات العلمية' },
      { to: '/publications', label: 'الكتب المنشورة' },
    ],
  },
  {
    label: 'محتواي المعرفي',
    items: [
      { to: '/articles', label: 'مقالاتي الفكرية', allLabel: 'عرض كل المقالات', sub: [
        { to: '/search', label: 'البحث العميق' },
        { to: '/atlas', label: 'سماء المقالات' },
      ] },
      { to: '/thought-paths', label: 'مسار الفكرة' },
      { to: '/ask', label: 'اسأل مكتبتي' },
      { to: '/media', label: 'الظهور الإعلامي' },
      { to: '/upcoming', label: 'اللقاءات القادمة' },
    ],
  },
  {
    label: 'من اختياراتي',
    items: [
      // المختارات هي الأمّ، وفروعها تحتها (بدل تكرارها كبنود مستقلة)
      { to: '/curated', label: 'المختارات', allLabel: 'عرض كل المختارات', sub: [
        { to: '/questions', label: 'سؤال يُقلق التعليم' },
        { to: '/radar', label: 'أرشيف الرادار' },
        { to: '/inbox', label: 'من بريدي الوارد' },
      ] },
    ],
  },
]

function Overlay({ close }: { close: () => void }) {
  const reduce = useReducedMotion()
  const loc = useLocation()
  const dialogRef = useRef<HTMLDivElement>(null)
  // الفروع مطويّة عند فتح القائمة، والعنوان الأبّ نفسه يفتحها.
  const [openSub, setOpenSub] = useState<string | null>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )).filter((element) => element.offsetParent !== null)

    const frame = window.requestAnimationFrame(() => (focusable()[0] || dialog).focus())
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        close()
        return
      }
      if (event.key !== 'Tab') return
      const items = focusable()
      if (!items.length) {
        event.preventDefault()
        dialog.focus()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      window.cancelAnimationFrame(frame)
      document.removeEventListener('keydown', onKeyDown)
      previouslyFocused?.focus()
    }
  }, [close])

  return (
    <motion.div
      ref={dialogRef}
      id="site-menu-dialog"
      role="dialog"
      aria-modal="true"
      aria-label="القائمة الرئيسية"
      tabIndex={-1}
      className="fixed inset-0 z-[220] isolate flex flex-col bg-canvas outline-none"
      style={{ backgroundColor: 'rgb(var(--c-canvas))' }}
      initial={reduce ? { opacity: 0 } : { y: '-100%' }}
      animate={reduce ? { opacity: 1 } : { y: 0 }}
      exit={reduce ? { opacity: 0 } : { y: '-100%' }}
      transition={{ duration: 0.75, ease: EASE }}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_55%_at_75%_35%,rgba(62,92,120,.07),transparent_65%)]" />

      <div className="relative flex-1 overflow-y-auto overscroll-contain">
        <div className="flex min-h-full items-start px-6 pb-10 pt-[calc(6rem+env(safe-area-inset-top))] md:items-center md:px-11 md:py-28">
        <div className="mx-auto grid w-full max-w-shell grid-cols-1 gap-8 sm:grid-cols-2 md:grid-cols-3 md:gap-x-12 md:gap-y-10">
          {GROUPS.map((g, gi) => (
            <div key={g.label}>
              <motion.span
                className="block text-[.68rem] font-semibold uppercase text-accent md:text-[.72rem]"
                initial={reduce ? false : { opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.35 + gi * 0.08, ease: EASE }}
              >
                {g.label}
              </motion.span>

              <ul className="mt-3 space-y-1 md:mt-4">
                {g.items.map((it, ii) => {
                  const expanded = openSub === it.to
                  const active = loc.pathname === it.to || Boolean(it.sub?.some((sub) => sub.to === loc.pathname))
                  const subId = `menu-sub-${gi}-${ii}`
                  return (
                  <li key={it.to} className="-my-[0.2em] overflow-hidden py-[0.2em]">
                    <motion.div
                      initial={reduce ? false : { y: '150%' }}
                      animate={{ y: 0 }}
                      transition={{ duration: 0.7, delay: 0.45 + gi * 0.08 + ii * 0.06, ease: EASE }}
                    >
                      {it.sub ? (
                        <button
                          type="button"
                          onClick={() => setOpenSub(expanded ? null : it.to)}
                          aria-expanded={expanded}
                          aria-controls={subId}
                          className={`group flex w-full items-center justify-between gap-3 py-1 text-right font-display text-[1.15rem] font-medium leading-[1.5] transition-colors duration-300 hover:text-accent md:py-1.5 md:text-[1.35rem] ${
                            active ? 'text-accent' : 'text-ink'
                          }`}
                        >
                          <span>{it.label}</span>
                          <motion.svg
                            aria-hidden
                            width="13"
                            height="13"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.4"
                            strokeLinecap="round"
                            animate={{ rotate: expanded ? 180 : 0 }}
                            transition={{ duration: 0.3, ease: EASE }}
                            className="shrink-0 text-soft group-hover:text-accent"
                          >
                            <path d="M6 9l6 6 6-6" />
                          </motion.svg>
                        </button>
                      ) : (
                        <Link
                          to={it.to}
                          onClick={close}
                          className={`block py-1 font-display text-[1.15rem] font-medium leading-[1.5] transition-colors duration-300 hover:text-accent md:py-1.5 md:text-[1.35rem] ${
                            loc.pathname === it.to ? 'text-accent' : 'text-ink'
                          }`}
                        >
                          {it.label}
                        </Link>
                      )}
                      {it.sub && (
                        <AnimatePresence initial={false}>
                          {expanded && (
                            <motion.ul
                              id={subId}
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: 'auto', opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.35, ease: EASE }}
                              className="mt-1 overflow-hidden border-r border-hair pr-4"
                            >
                              <li>
                                <Link
                                  to={it.to}
                                  onClick={close}
                                  className={`block py-1.5 text-[.9rem] font-semibold transition-colors hover:text-accent ${loc.pathname === it.to ? 'text-accent' : 'text-soft'}`}
                                >
                                  {it.allLabel || `عرض ${it.label}`}
                                </Link>
                              </li>
                              {it.sub.map((s) => (
                                <li key={s.to}>
                                  <Link
                                    to={s.to}
                                    onClick={close}
                                    className={`block py-1.5 text-[.9rem] font-light transition-colors duration-300 hover:text-accent ${
                                      loc.pathname === s.to ? 'text-accent' : 'text-soft'
                                    }`}
                                  >
                                    {s.label}
                                  </Link>
                                </li>
                              ))}
                            </motion.ul>
                          )}
                        </AnimatePresence>
                      )}
                    </motion.div>
                  </li>
                )})}
              </ul>
            </div>
          ))}
        </div>
        </div>
      </div>

      <motion.div
        className="relative border-t border-hair px-6 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-5 md:px-11 md:py-7"
        initial={reduce ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6, delay: 0.8 }}
      >
        <div className="mx-auto flex max-w-shell flex-wrap items-center justify-between gap-5">
          <Link
            to="/contact#booking-form"
            onClick={close}
            className="rounded-full bg-accent px-6 py-2.5 text-[.88rem] font-semibold text-white transition-colors duration-300 hover:bg-accent-deep"
          >
            احجز موعداً مباشراً
          </Link>
          <div className="flex flex-wrap items-center gap-5 text-soft">
            {socials.map((s) => (
              <a key={s.label} href={s.url} target="_blank" rel="noreferrer" aria-label={s.label} className="transition-colors hover:text-accent">
                <SocialIcon name={s.label} />
              </a>
            ))}
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}

/* خريطة التبديل بين المرآتين — الصفحات الثلاث تتقابل، وما عداها يذهب لرئيسية اللغة الأخرى */
const EN_OF: Record<string, string> = { '/': '/en', '/cv': '/en/cv', '/research': '/en/research' }
const AR_OF: Record<string, string> = { '/en': '/', '/en/cv': '/cv', '/en/research': '/research' }

export function Nav() {
  const [scrolled, setScrolled] = useState(false)
  const [open, setOpen] = useState(false)
  const { scrollY, scrollYProgress } = useScroll()
  const progress = useSpring(scrollYProgress, { stiffness: 200, damping: 40 })
  const loc = useLocation()
  const closeMenu = useCallback(() => setOpen(false), [])

  useEffect(() => scrollY.on('change', (v) => setScrolled(v > 50)), [scrollY])
  useEffect(() => setOpen(false), [loc.pathname])
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [open])

  const english = loc.pathname === '/en' || loc.pathname.startsWith('/en/')
  const solid = (scrolled || (loc.pathname !== '/' && loc.pathname !== '/en')) && !open

  /* ---- الهيدر الإنجليزي: ثلاثة روابط هادئة بلا قائمة ---- */
  if (english) {
    const items = [
      { to: '/en', label: 'Home' },
      { to: '/en/cv', label: 'CV' },
      { to: '/en/research', label: 'Research' },
    ]
    return (
      <>
        <motion.div className="fixed left-0 top-0 z-[240] h-[2px] w-full origin-left bg-accent" style={{ scaleX: progress }} />
        <nav aria-label="Main navigation" dir="ltr" className={`fixed inset-x-0 top-0 z-[230] border-b transition-[background-color,border-color] duration-500 ${solid ? 'border-hair bg-canvas/[.82] backdrop-blur-lg backdrop-saturate-150' : 'border-transparent'}`}>
          <div className={`mx-auto flex max-w-shell items-center justify-between px-6 transition-all duration-300 md:px-11 ${solid ? 'h-16' : 'h-[76px]'}`}>
            <Link to="/en" aria-label="Ahmad H. Alfailakawi">
              <img src="/logo.png" alt="" className="h-[34px] w-14 object-contain opacity-90 dark:invert" style={{ objectPosition: 'left' }} />
            </Link>
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-5 pe-2 text-[.88rem]">
                {items.map((it) => (
                  <Link key={it.to} to={it.to} className={`transition-colors hover:text-accent ${loc.pathname === it.to ? 'font-semibold text-accent' : 'font-medium text-ink'}`}>
                    {it.label}
                  </Link>
                ))}
              </span>
              <ThemeToggle />
              <Link
                to={AR_OF[loc.pathname] || '/'}
                aria-label="النسخة العربية"
                title="النسخة العربية"
                className="flex h-9 w-9 items-center justify-center rounded-full border border-hair text-[.82rem] font-semibold text-soft transition-colors hover:border-accent hover:text-accent"
              >
                ع
              </Link>
            </div>
          </div>
        </nav>
      </>
    )
  }

  return (
    <>
      <motion.div className="fixed right-0 top-0 z-[240] h-[2px] w-full origin-right bg-accent" style={{ scaleX: progress }} />

      <AnimatePresence>{open && <Overlay key="ov" close={closeMenu} />}</AnimatePresence>

      <nav aria-label="التنقّل الرئيسي" className={`fixed inset-x-0 top-0 z-[230] border-b transition-[background-color,border-color] duration-500 ${solid ? 'border-hair bg-canvas/[.82] backdrop-blur-lg backdrop-saturate-150' : 'border-transparent'}`}>
        <div className={`mx-auto flex max-w-shell items-center justify-between px-6 transition-all duration-300 md:px-11 ${solid ? 'h-16' : 'h-[76px]'}`}>
          <Link to="/" aria-label={profile.name}>
            <img src="/logo.png" alt="" className="h-[34px] w-14 object-contain opacity-90 dark:invert" style={{ objectPosition: 'right' }} />
          </Link>

          <div className="flex items-center gap-3">
            {/* زر الإنجليزية مخفي حتى بناء الموقع كاملاً بالإنجليزية — الكشف بقلب SHOW_EN_TOGGLE في data.ts */}
            {SHOW_EN_TOGGLE && (
              <Link
                to={EN_OF[loc.pathname] || '/en'}
                aria-label="English version"
                title="English"
                className={`flex h-9 w-9 items-center justify-center rounded-full border border-hair text-[.68rem] font-semibold tracking-wide text-soft transition-colors hover:border-accent hover:text-accent ${open ? 'invisible pointer-events-none' : ''}`}
              >
                EN
              </Link>
            )}
            <ThemeToggle className={open ? 'invisible pointer-events-none' : ''} />
            <Link
              to="/contact#booking-form"
              aria-label="حجز موعد"
              title="حجز موعد"
              className={`flex h-9 w-9 items-center justify-center rounded-full border border-accent text-accent transition-colors hover:bg-accent hover:text-white ${open ? 'invisible pointer-events-none' : ''}`}
            >
              <SocialIcon name="Calendar" size={16} />
            </Link>
          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-label={open ? 'إغلاق القائمة' : 'فتح القائمة'}
            aria-expanded={open}
            aria-controls="site-menu-dialog"
            className="group flex items-center gap-3.5"
          >
            <span className="hidden text-[.9rem] font-medium text-ink transition-colors group-hover:text-accent sm:block">
              {open ? 'إغلاق' : 'القائمة'}
            </span>
            <span className="relative flex h-9 w-9 flex-col items-center justify-center gap-[6px] rounded-full border border-hair transition-colors duration-300 group-hover:border-accent">
              <motion.span
                className="block h-[1.5px] w-4 bg-ink transition-colors group-hover:bg-accent"
                animate={open ? { rotate: 45, y: 3.75 } : { rotate: 0, y: 0 }}
                transition={{ duration: 0.35, ease: EASE }}
              />
              <motion.span
                className="block h-[1.5px] w-4 bg-ink transition-colors group-hover:bg-accent"
                animate={open ? { rotate: -45, y: -3.75 } : { rotate: 0, y: 0 }}
                transition={{ duration: 0.35, ease: EASE }}
              />
            </span>
          </button>
          </div>
        </div>
      </nav>
    </>
  )
}

/* ---------- Footer ---------- */
export function Footer() {
  const cv = useCvLinks()
  const loc = useLocation()
  const english = loc.pathname === '/en' || loc.pathname.startsWith('/en/')

  if (english) {
    return (
      <footer dir="ltr" className="border-t border-hair px-6 py-12 md:px-11">
        <div className="mx-auto max-w-shell">
          <div className="flex flex-wrap items-center justify-between gap-5">
            <Link to="/en">
              <img src="/logo.png" alt="Ahmad H. Alfailakawi" className="h-10 w-16 object-contain dark:invert" style={{ objectPosition: 'left' }} />
            </Link>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-3 text-[.9rem] text-soft">
              <Link to="/" className="transition-colors hover:text-accent">العربية</Link>
              <span className="flex items-center gap-3">
                <a href={cv.en || cv.ar} target="_blank" rel="noreferrer" aria-label="CV (PDF)" title="CV (PDF)" className="text-soft transition-colors hover:text-accent">
                  <SocialIcon name="CV" />
                </a>
                {socials.map((s) => (
                  <a key={s.label} href={s.url} target="_blank" rel="noreferrer" aria-label={s.label} title={s.label} className="text-soft transition-colors hover:text-accent">
                    <SocialIcon name={s.label} />
                  </a>
                ))}
              </span>
            </div>
          </div>
          <div className="mt-8 flex flex-wrap justify-between gap-2.5 border-t border-hair pt-5 text-[.78rem] text-soft">
            <span>© {new Date().getFullYear()} Ahmad H. Alfailakawi — All rights reserved</span>
          </div>
        </div>
      </footer>
    )
  }

  return (
    <footer className="border-t border-hair px-6 py-12 md:px-11">
      <div className="mx-auto max-w-shell">
        <div className="flex flex-wrap items-center justify-between gap-5">
          <Link to="/">
            <img src="/logo.png" alt={profile.name} className="h-10 w-16 object-contain dark:invert" style={{ objectPosition: 'right' }} />
          </Link>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3 text-[.9rem] text-soft">
            <Link to="/about" className="transition-colors hover:text-accent">حول الموقع</Link>
            <span className="flex items-center gap-3">
              <a href={cv.ar} target="_blank" rel="noreferrer" aria-label="السيرة الذاتية PDF" title="السيرة الذاتية PDF" className="text-soft transition-colors hover:text-accent">
                <SocialIcon name="CV" />
              </a>
              {socials.map((s) => (
                <a key={s.label} href={s.url} target="_blank" rel="noreferrer" aria-label={s.label} title={s.label} className="text-soft transition-colors hover:text-accent">
                  <SocialIcon name={s.label} />
                </a>
              ))}
            </span>
          </div>
        </div>
        <div className="mt-8 flex flex-wrap justify-between gap-2.5 border-t border-hair pt-5 text-[.78rem] text-soft">
          <span>© {new Date().getFullYear()} {profile.fullName} — جميع الحقوق محفوظة</span>
        </div>
      </div>
    </footer>
  )
}

/* ---------- Page transition wrapper ---------- */
export function Page({ children }: { children: React.ReactNode }) {
  const reduce = useReducedMotion()
  useEffect(() => { window.scrollTo(0, 0) }, [])
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduce ? undefined : { opacity: 0, y: -8 }}
      transition={{ duration: 0.5, ease: EASE }}
    >
      {children}
    </motion.div>
  )
}
