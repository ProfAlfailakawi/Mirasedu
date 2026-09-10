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

// بوابة الدخول: عناصر النظام تظهر متناثرة ثم تنجذب وتتراصّ لتكوّن مدخلاً بصرياً
// قصيراً (~1.6 ثانية) نحو لوحة الطالب أو المعلم. تُعرض مرة واحدة فقط بعد تسجيل
// الدخول (حارس sessionStorage في App)، ولا تعترض أي تفاعل: الطبقة كاملة
// pointer-events-none والحركة transform/opacity فقط حفاظاً على 60fps.

type RevealRole = "student" | "teacher";

const STUDENT_PIECES = [
  { Icon: BookOpen, label: "الكتاب", from: { x: -110, y: -84, r: -14 } },
  { Icon: PlayCircle, label: "الدرس", from: { x: 96, y: -70, r: 10 } },
  { Icon: FileQuestion, label: "الاختبار", from: { x: -88, y: 78, r: 8 } },
  { Icon: TrendingUp, label: "التقدم", from: { x: 112, y: 64, r: -10 } },
];

const TEACHER_PIECES = [
  { Icon: GraduationCap, label: "التدريس", from: { x: -110, y: -84, r: -14 } },
  { Icon: Users, label: "الطلاب", from: { x: 96, y: -70, r: 10 } },
  { Icon: ClipboardCheck, label: "التقييم", from: { x: -88, y: 78, r: 8 } },
  { Icon: BarChart3, label: "التقارير", from: { x: 112, y: 64, r: -10 } },
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
    // مغادرة عند ~1.25 ثانية وإزالة كاملة عند ~1.65 ثانية؛ لا تعليق أطول من ذلك.
    const t1 = window.setTimeout(() => setLeaving(true), 1250);
    const t2 = window.setTimeout(onDone, 1680);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [onDone]);

  const pieces = role === "teacher" ? TEACHER_PIECES : STUDENT_PIECES;
  const title = role === "teacher" ? "لوحة المعلم" : "مسارك الأكاديمي";
  const subtitle =
    role === "teacher"
      ? "تجهيز فصولك وأدواتك…"
      : "تجهيز رحلتك التعليمية…";

  return (
    <motion.div
      dir="rtl"
      className="fixed inset-0 z-[220] grid place-items-center overflow-hidden bg-gradient-to-b from-slate-50 via-white to-slate-100"
      style={{ pointerEvents: "none", willChange: "opacity" }}
      initial={{ opacity: 1 }}
      animate={{ opacity: leaving ? 0 : 1 }}
      transition={{ duration: 0.42, ease: [0.32, 0.72, 0, 1] }}
      aria-hidden="true"
    >
      <motion.div
        className="flex flex-col items-center px-6"
        animate={leaving ? { scale: 1.05, opacity: 0 } : { scale: 1, opacity: 1 }}
        transition={{ duration: 0.42, ease: [0.32, 0.72, 0, 1] }}
        style={{ willChange: "transform, opacity" }}
      >
        <div className="flex items-center gap-2.5 sm:gap-3">
          {pieces.map(({ Icon, label, from }, i) => (
            <motion.div
              key={label}
              className="flex h-[62px] w-[62px] flex-col items-center justify-center gap-1 rounded-2xl border border-slate-200/80 bg-white shadow-[0_10px_30px_-14px_rgba(15,23,42,0.25)] sm:h-[72px] sm:w-[72px]"
              initial={{
                x: from.x,
                y: from.y,
                rotate: from.r,
                scale: 0.72,
                opacity: 0,
              }}
              animate={{ x: 0, y: 0, rotate: 0, scale: 1, opacity: 1 }}
              transition={{
                duration: 0.78,
                delay: 0.05 + i * 0.07,
                ease: [0.22, 1, 0.36, 1],
              }}
              style={{ willChange: "transform, opacity" }}
            >
              <Icon className="h-6 w-6 text-slate-700 sm:h-7 sm:w-7" strokeWidth={1.75} />
              <span className="text-[9px] font-bold text-slate-400 sm:text-[10px]">
                {label}
              </span>
            </motion.div>
          ))}
        </div>

        <motion.div
          className="mt-5 h-px w-40 origin-center bg-gradient-to-l from-transparent via-slate-300 to-transparent sm:w-56"
          initial={{ scaleX: 0, opacity: 0 }}
          animate={{ scaleX: 1, opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.55, ease: [0.22, 1, 0.36, 1] }}
          style={{ willChange: "transform, opacity" }}
        />

        <motion.div
          className="mt-4 text-center"
          initial={{ y: 14, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.62, ease: [0.22, 1, 0.36, 1] }}
          style={{ willChange: "transform, opacity" }}
        >
          <p className="text-[17px] font-black tracking-tight text-slate-900 sm:text-[19px]">
            {title}
          </p>
          <p className="mt-1 text-[11.5px] font-bold text-slate-400 sm:text-[12.5px]">
            {subtitle}
          </p>
        </motion.div>
      </motion.div>
    </motion.div>
  );
}
