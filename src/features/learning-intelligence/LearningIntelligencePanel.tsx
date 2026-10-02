import {useMemo, useState} from "react";
import {AlertTriangle, BookOpenCheck, Brain, GraduationCap, MessageCircleQuestion, Mic, ShieldCheck} from "lucide-react";
import {MIRAS_LEARNING_DECISION_BOUNDARY_AR} from "./core";

type PanelMode = "student" | "teacher";

type Props = {
  mode: PanelMode;
  headers: () => Record<string, string>;
  courseCode?: string;
  courseName?: string;
  studentId?: string;
};

const asList = (value: any): any[] => (Array.isArray(value) ? value : []);

function CompactResult({result}: {result: any}) {
  if (!result) return null;
  const microPlan = asList(result.microPlan);
  const usefulSignals = asList(result.usefulSignals);
  const criteria = asList(result.criteria);
  const questions = asList(result.questions);
  const reviewQueue = asList(result.reviewQueue);
  const flags = asList(result.misconceptionScan?.flags);
  return (
    <div className="mt-3 space-y-2 rounded-[1.35rem] border border-[color:var(--dna-line-2)] bg-[var(--dna-surface)] p-3 text-right shadow-sm">
      {result.reply && (
        <p className="text-[12px] font-bold leading-6 text-[color:var(--dna-ink)]">
          {result.reply}
        </p>
      )}
      {result.studentFriendlyBrief && (
        <p className="text-[12px] font-bold leading-6 text-[color:var(--dna-ink)]">
          {result.studentFriendlyBrief}
        </p>
      )}
      {result.transcriptReview && (
        <p className="text-[12px] font-bold leading-6 text-[color:var(--dna-ink)]">
          {result.transcriptReview}
        </p>
      )}
      {[...microPlan, ...usefulSignals, ...questions].slice(0, 6).map((item, index) => (
        <div
          key={`li-line-${index}`}
          className="rounded-2xl border border-[color:var(--dna-line)] bg-[var(--dna-surface-2)] px-3 py-2 text-[11px] font-bold leading-5 text-[color:var(--dna-muted)]"
        >
          {String(item)}
        </div>
      ))}
      {criteria.slice(0, 4).map((item, index) => (
        <div
          key={`li-criterion-${index}`}
          className="rounded-2xl border border-[color:var(--dna-line)] bg-[var(--dna-accent-soft)] px-3 py-2 text-[11px] font-bold leading-5 text-[color:var(--dna-accent)]"
        >
          <b className="block text-[11px] text-[color:var(--dna-ink)]">{item.criterion}</b>
          {item.feedback}
        </div>
      ))}
      {reviewQueue.slice(0, 4).map((item, index) => (
        <div
          key={`li-review-${item.id || index}`}
          className="rounded-2xl border border-[color:var(--dna-line)] bg-[var(--dna-warn-soft)] px-3 py-2 text-[11px] font-bold leading-5 text-[color:var(--dna-warn)]"
        >
          {item.studentName || item.studentId} — {item.activityTitle || item.kind}
        </div>
      ))}
      {flags.length > 0 && (
        <div className="rounded-2xl border border-[color:var(--dna-line)] bg-[var(--dna-danger-soft)] px-3 py-2 text-[11px] font-bold leading-5 text-[color:var(--dna-danger)]">
          {flags
            .slice(0, 3)
            .map((flag: any) => flag.label || flag.type)
            .join("، ")}
        </div>
      )}
      <p className="text-[11px] font-black leading-5 text-[color:var(--dna-muted)]">
        {result.decisionBoundary || MIRAS_LEARNING_DECISION_BOUNDARY_AR}
      </p>
    </div>
  );
}

export default function LearningIntelligencePanel({
  mode,
  headers,
  courseCode = "",
  courseName = "",
  studentId = "",
}: Props) {
  const [prompt, setPrompt] = useState("");
  const [transcript, setTranscript] = useState("");
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState<"" | "tutor" | "summary" | "viva" | "course">("");
  const [error, setError] = useState("");

  const title = mode === "teacher" ? "ذكاء التعلم" : "مساعد التعلم";
  const subtitle = useMemo(
    () =>
      mode === "teacher"
        ? "ملخصات وتغذية راجعة قابلة للمراجعة"
        : "Tutor تكيفي يشرح ولا يرصد درجة",
    [mode],
  );

  const request = async (kind: typeof busy) => {
    if (!kind) return;
    setBusy(kind);
    setError("");
    try {
      const endpoint =
        kind === "summary"
          ? "/api/learning-intelligence/teacher-summary"
          : kind === "course"
            ? "/api/learning-intelligence/course-understanding"
            : kind === "viva"
              ? "/api/learning-intelligence/viva"
              : "/api/learning-intelligence/student/tutor";
      const resp = await fetch(endpoint, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          courseCode,
          courseName,
          studentId,
          question: prompt,
          transcript,
          assignment: {title: prompt || courseName},
          materials: [{text: prompt}],
        }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        setError(data.error || "تعذر تشغيل مساعد التعلم الآن.");
        return;
      }
      setResult(data);
    } catch {
      setError("تعذر الاتصال بمساعد التعلم الآن.");
    } finally {
      setBusy("");
    }
  };

  return (
    <section
      className="miras-learning-intelligence rounded-[1.7rem] border border-[color:var(--dna-line-2)] bg-[var(--dna-surface)] p-3 text-right shadow-[var(--dna-shadow)] sm:p-4"
      dir="rtl"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2.5">
          <span
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[var(--dna-accent-soft)] text-[color:var(--dna-accent)]"
            aria-hidden="true"
          >
            <Brain className="h-[18px] w-[18px]" strokeWidth={1.6} />
          </span>
          <div>
            <p className="text-[11px] font-black text-[color:var(--dna-accent)]">
              {title}
            </p>
            <h3 className="mt-0.5 text-sm font-black text-[color:var(--dna-ink)]">{subtitle}</h3>
          </div>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full border border-[color:var(--dna-line-2)] bg-[var(--dna-surface-2)] px-3 py-1 text-[11px] font-black text-[color:var(--dna-muted)]">
          <ShieldCheck className="h-3.5 w-3.5" strokeWidth={1.6} aria-hidden="true" />
          مراجعة بشرية
        </span>
      </div>

      <div className="mt-3 grid gap-2">
        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          rows={3}
          placeholder={
            mode === "teacher"
              ? "الصق وصف واجب أو اختر ملخص المقرر..."
              : "اكتب سؤالك أو جزء الواجب الذي تريد فهمه..."
          }
          className="min-h-[5.5rem] w-full resize-y rounded-2xl border border-[color:var(--dna-line-2)] bg-[var(--dna-surface)] px-3 py-2 text-[12px] font-bold leading-6 text-[color:var(--dna-ink)] outline-none transition focus:border-[color:var(--dna-accent)] focus:ring-4 focus:ring-[var(--dna-accent-soft)]"
        />
        <textarea
          value={transcript}
          onChange={(event) => setTranscript(event.target.value)}
          rows={2}
          placeholder="نص Viva الصوتي أو ملاحظات الطالب المنطوقة..."
          className="min-h-[3.8rem] w-full resize-y rounded-2xl border border-[color:var(--dna-line-2)] bg-[var(--dna-surface)] px-3 py-2 text-[12px] font-bold leading-6 text-[color:var(--dna-ink)] outline-none transition focus:border-[color:var(--dna-accent)] focus:ring-4 focus:ring-[var(--dna-accent-soft)]"
        />
      </div>

      <div className="mt-3 flex flex-wrap justify-end gap-2">
        {mode === "teacher" && (
          <>
            <button
              type="button"
              onClick={() => request("summary")}
              disabled={!!busy}
              className="inline-flex items-center gap-1.5 rounded-2xl bg-[var(--dna-core)] px-3 py-2 text-[11px] font-black text-[color:var(--dna-on-core)] disabled:opacity-60"
            >
              <GraduationCap className="h-3.5 w-3.5" strokeWidth={1.6} aria-hidden="true" />
              {busy === "summary" ? "..." : "ملخص الأستاذ"}
            </button>
            <button
              type="button"
              onClick={() => request("course")}
              disabled={!!busy}
              className="inline-flex items-center gap-1.5 rounded-2xl border border-[color:var(--dna-line-2)] bg-[var(--dna-surface)] px-3 py-2 text-[11px] font-black text-[color:var(--dna-accent)] disabled:opacity-60"
            >
              <BookOpenCheck className="h-3.5 w-3.5" strokeWidth={1.6} aria-hidden="true" />
              فهم المقرر/الواجب
            </button>
          </>
        )}
        {mode === "student" && (
          <button
            type="button"
            onClick={() => request("tutor")}
            disabled={!!busy}
            className="inline-flex items-center gap-1.5 rounded-2xl bg-[var(--dna-accent)] px-3 py-2 text-[11px] font-black text-[color:var(--dna-on-accent)] disabled:opacity-60"
          >
            <MessageCircleQuestion className="h-3.5 w-3.5" strokeWidth={1.6} aria-hidden="true" />
            {busy === "tutor" ? "..." : "اسأل Tutor"}
          </button>
        )}
        <button
          type="button"
          onClick={() => request("viva")}
          disabled={!!busy}
          className="inline-flex items-center gap-1.5 rounded-2xl border border-[color:var(--dna-line-2)] bg-[var(--dna-surface)] px-3 py-2 text-[11px] font-black text-[color:var(--dna-accent)] disabled:opacity-60"
        >
          <Mic className="h-3.5 w-3.5" strokeWidth={1.6} aria-hidden="true" />
          Viva
        </button>
      </div>

      {error && (
        <div
          className="mt-3 flex items-center gap-1.5 rounded-2xl border border-[color:var(--dna-line)] bg-[var(--dna-danger-soft)] px-3 py-2 text-[11px] font-black text-[color:var(--dna-danger)]"
        >
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" strokeWidth={1.6} aria-hidden="true" />
          {error}
        </div>
      )}
      <CompactResult result={result} />
    </section>
  );
}
