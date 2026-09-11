import { useEffect, useState, type CSSProperties } from "react";

// محمّل مِراس المصغّر — هوية مشتقّة مباشرة من بوابة الدخول (LoginRevealOverlay):
// أربع قطع تنجذب من التشتت وتتراصّ كمعيّن صغير حول المركز مرة واحدة، ثم نبضة
// سكون هادئة (لا إعادة تجميع عنيفة). الطالب: أربع قطع متساوية (معيّن الكتاب
// والتقدم)؛ المعلم: قطع بأشكال لوحة مصغّرة (شريطان + مربّعان). أشكال فقط دون
// نصوص داخل المحمّل. لا يظهر قبل ~250ms كي لا يومض في العمليات السريعة،
// وحركته transform/opacity حصراً (CSS في index.css §٢٨).

type LoaderRole = "student" | "teacher" | "neutral";

const ROLE_COLOR: Record<LoaderRole, string> = {
  student: "text-indigo-600",
  teacher: "text-emerald-600",
  neutral: "text-indigo-600",
};

// نقاط التراصّ (معيّن) ونقاط التشتت — نِسَب من حجم المحمّل، لا إحداثيات شاشة.
const POSTS = [
  { x: 0, y: -0.3 },
  { x: 0.3, y: 0 },
  { x: -0.3, y: 0 },
  { x: 0, y: 0.3 },
];
const SCATTER = [
  { x: -0.22, y: -0.62 },
  { x: 0.66, y: -0.18 },
  { x: -0.66, y: 0.26 },
  { x: 0.28, y: 0.62 },
];

export default function MirasLoader({
  size = 24,
  role = "neutral",
  label = "جارٍ التحميل…",
  delay = 250,
  className = "",
}: {
  /** القطر الكلي بالبكسل: 16–20 داخل زر، 24–32 بطاقة، 32–48 لوحة، 64 حد أقصى. */
  size?: number;
  role?: LoaderRole;
  label?: string;
  /** مهلة الظهور — لا يظهر المحمّل إن انتهت العملية قبلها. 0 = فوري. */
  delay?: number;
  className?: string;
}) {
  const [visible, setVisible] = useState(delay <= 0);

  useEffect(() => {
    if (delay <= 0) return;
    const t = window.setTimeout(() => setVisible(true), delay);
    return () => window.clearTimeout(t);
  }, [delay]);

  const isTeacher = role === "teacher";
  const unit = size * 0.3; // الضلع الأساسي للقطعة

  return (
    <span
      role="status"
      aria-live="polite"
      className={`miras-loader align-middle ${ROLE_COLOR[role]} ${className}`}
      style={{
        width: size,
        height: size,
        opacity: visible ? 1 : 0,
        transition: "opacity 160ms ease-out",
      }}
    >
      {visible && (
        <span aria-hidden="true">
          {POSTS.map((post, i) => {
            // المعلم: لوحة مصغّرة — القطعتان الجانبيتان شريطان أفقيان قصيران.
            const isBar = isTeacher && (i === 1 || i === 2);
            const w = isBar ? unit * 1.5 : unit;
            const h = isBar ? unit * 0.62 : unit;
            const style: CSSProperties & Record<string, string> = {
              width: w,
              height: h,
              marginLeft: -w / 2,
              marginTop: -h / 2,
              "--tx": `${post.x * size}px`,
              "--ty": `${post.y * size}px`,
              "--fx": `${SCATTER[i].x * size}px`,
              "--fy": `${SCATTER[i].y * size}px`,
              "--ad": `${i * 0.06}s`,
            };
            return <span key={i} className="miras-loader-piece" style={style} />;
          })}
        </span>
      )}
      <span className="sr-only">{label}</span>
    </span>
  );
}
