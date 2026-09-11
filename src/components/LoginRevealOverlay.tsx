import { useEffect, useState } from "react";
import { motion } from "motion/react";
import {
  BookOpen,
  PlayCircle,
  FileQuestion,
  TrendingUp,
  GraduationCap,
  Users,
  ClipboardCheck,
  BarChart3,
} from "lucide-react";

// بوابة الدخول: ستارة كاملة بعمق لوني هادئ، تتجمّع فيها عناصر النظام من التشتت
// لتتراصّ كشعارٍ صغير (أربع شارات حول إطار شعري يحمل عنوان الدور)، تتنفّس
// المنظومة نفَساً واحداً هادئاً ثم تتقدّم بلطف «داخل» اللوحة بينما ترتفع الستارة
// — كشفٌ عبر البوابة لا تلاشٍ مسطّح. تُعرض مرة واحدة فقط بعد تسجيل الدخول
// (حارس sessionStorage في App)، لا تعترض أي تفاعل (pointer-events: none)،
// والحركة transform/opacity فقط حفاظاً على 60fps. المدة الكلية ~1.68 ثانية.

type RevealRole = "student" | "teacher";

// مواقع الشارات حول الإطار المركزي (شكل معيّن: أعلى/يمين/يسار/أسفل).
// القيم بالبكسل نسبةً إلى مركز التكوين — تعمل حتى عرض 400px.
const POSTS = [
  { x: 0, y: -86 },
  { x: 118, y: 0 },
  { x: -118, y: 0 },
  { x: 0, y: 86 },
];

const SCATTER = [
  { x: -70, y: -170, r: -18 },
  { x: 200, y: -70, r: 14 },
  { x: -200, y: 90, r: 10 },
  { x: 80, y: 180, r: -12 },
];

const STUDENT_PIECES = [
  { Icon: BookOpen, label: "الكتاب" },
  { Icon: PlayCircle, label: "الدرس" },
  { Icon: FileQuestion, label: "الاختبار" },
  { Icon: TrendingUp, label: "التقدم" },
];

const TEACHER_PIECES = [
  { Icon: GraduationCap, label: "التدريس" },
  { Icon: Users, label: "الطلاب" },
  { Icon: ClipboardCheck, label: "التقييم" },
  { Icon: BarChart3, label: "التقارير" },
];

export default function LoginRevealOverlay({
  role,
  onDone,
}: {
  role: RevealRole;
  onDone: () => void;
}) {
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    // مغادرة عند ~1.25 ثانية وإزالة كاملة عند ~1.68 ثانية؛ لا تعليق أطول من ذلك.
    const t1 = window.setTimeout(() => setLeaving(true), 1250);
    const t2 = window.setTimeout(onDone, 1680);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [onDone]);

  const isTeacher = role === "teacher";
  const pieces = isTeacher ? TEACHER_PIECES : STUDENT_PIECES;
  const title = isTeacher ? "لوحة المعلم" : "مسارك الأكاديمي";
  const subtitle = isTeacher ? "تجهيز فصولك وأدواتك…" : "تجهيز رحلتك التعليمية…";

  // نغمة قطرية هادئة بلون الدور: الطالب نيلي، المعلم زمردي — من لوحة التطبيق.
  const tone = isTeacher
    ? "radial-gradient(120% 90% at 50% 38%, rgba(16,185,129,0.10) 0%, rgba(16,185,129,0.03) 42%, rgba(255,255,255,0) 72%)"
    : "radial-gradient(120% 90% at 50% 38%, rgba(99,102,241,0.10) 0%, rgba(99,102,241,0.03) 42%, rgba(255,255,255,0) 72%)";
  const accentText = isTeacher ? "text-emerald-700" : "text-indigo-700";
  const chipBorder = isTeacher ? "border-emerald-100" : "border-indigo-100";
  const frameBorder = isTeacher ? "border-emerald-200/70" : "border-indigo-200/70";
  const hairline = isTeacher ? "via-emerald-300" : "via-indigo-300";

  const easeOut: [number, number, number, number] = [0.22, 1, 0.36, 1];
  const easeLift: [number, number, number, number] = [0.32, 0.72, 0, 1];

  return (
    <motion.div
      dir="rtl"
      className="fixed inset-0 z-[220] grid place-items-center overflow-hidden bg-gradient-to-b from-slate-50 via-white to-slate-100"
      style={{ pointerEvents: "none", willChange: "opacity" }}
      initial={{ opacity: 1 }}
      animate={{ opacity: leaving ? 0 : 1 }}
      transition={{ duration: 0.43, ease: easeLift }}
      aria-hidden="true"
    >
      {/* عمق الستارة: نغمة قطرية بلون الدور + هالة علوية خافتة (طبقات ثابتة) */}
      <div className="absolute inset-0" style={{ background: tone }} />
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(90% 55% at 50% 108%, rgba(15,23,42,0.055) 0%, rgba(15,23,42,0) 60%)",
        }}
      />

      {/* التكوين الكامل: عند المغادرة يتقدّم بلطف داخل اللوحة (كشفٌ عبر البوابة) */}
      <motion.div
        className="relative flex items-center justify-center px-6"
        animate={
          leaving ? { scale: 1.14, opacity: 0 } : { scale: 1, opacity: 1 }
        }
        transition={
          leaving
            ? { duration: 0.43, ease: easeLift }
            : { duration: 0.01 }
        }
        style={{ willChange: "transform, opacity" }}
      >
        {/* نفَسٌ واحد هادئ للمنظومة بعد اكتمال التراصّ */}
        <motion.div
          className="relative flex items-center justify-center"
          initial={{ scale: 1 }}
          animate={leaving ? { scale: 1 } : { scale: [1, 1, 1.02, 1] }}
          transition={{
            duration: 1.2,
            times: [0, 0.62, 0.82, 1],
            ease: "easeInOut",
          }}
          style={{ willChange: "transform" }}
        >
          {/* الإطار الشعري المركزي حول عنوان الدور */}
          <motion.div
            className={`relative z-10 flex w-[176px] flex-col items-center rounded-[22px] border ${frameBorder} bg-white/85 px-5 py-5 shadow-[0_18px_50px_-24px_rgba(15,23,42,0.28)] sm:w-[196px]`}
            initial={{ scale: 0.88, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.55, delay: 0.32, ease: easeOut }}
            style={{ willChange: "transform, opacity" }}
          >
            <div
              className={`h-px w-16 origin-center bg-gradient-to-l from-transparent ${hairline} to-transparent`}
            />
            <p
              className={`mt-3 text-center text-[17px] font-black tracking-tight text-slate-900 sm:text-[19px]`}
            >
              {title}
            </p>
            <p
              className={`mt-1.5 text-center text-[11px] font-bold sm:text-[12px] ${accentText}`}
            >
              {subtitle}
            </p>
            <div
              className={`mt-3 h-px w-16 origin-center bg-gradient-to-l from-transparent ${hairline} to-transparent`}
            />
          </motion.div>

          {/* حلقة شعرية خارجية تلتئم حول الشعار */}
          <motion.div
            className={`absolute h-[248px] w-[316px] rounded-full border ${frameBorder}`}
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 0.55 }}
            transition={{ duration: 0.65, delay: 0.42, ease: easeOut }}
            style={{ willChange: "transform, opacity" }}
          />

          {/* الشارات الأربع تنجذب من التشتت إلى مواقعها حول الإطار */}
          {pieces.map(({ Icon, label }, i) => {
            const post = POSTS[i];
            const from = SCATTER[i];
            return (
              <motion.div
                key={label}
                className={`absolute z-20 flex h-[58px] w-[58px] flex-col items-center justify-center gap-0.5 rounded-2xl border ${chipBorder} bg-white shadow-[0_10px_30px_-14px_rgba(15,23,42,0.3)] sm:h-[66px] sm:w-[66px]`}
                initial={{
                  x: from.x,
                  y: from.y,
                  rotate: from.r,
                  scale: 0.7,
                  opacity: 0,
                }}
                animate={{
                  x: post.x,
                  y: post.y,
                  rotate: 0,
                  scale: 1,
                  opacity: 1,
                }}
                transition={{
                  duration: 0.72,
                  delay: 0.06 + i * 0.07,
                  ease: easeOut,
                }}
                style={{ willChange: "transform, opacity" }}
              >
                <Icon
                  className={`h-[22px] w-[22px] sm:h-6 sm:w-6 ${accentText}`}
                  strokeWidth={1.75}
                />
                <span className="text-[8.5px] font-bold text-slate-400 sm:text-[9.5px]">
                  {label}
                </span>
              </motion.div>
            );
          })}
        </motion.div>
      </motion.div>
    </motion.div>
  );
}
