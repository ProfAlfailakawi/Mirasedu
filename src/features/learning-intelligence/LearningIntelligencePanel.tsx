import {useMemo, useState} from "react";
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
    <div className="mt-3 space-y-2 rounded-[1.35rem] border border-indigo-100 bg-white/92 p-3 text-right shadow-sm">
      {result.reply && (
        <p className="text-[12px] font-bold leading-6 text-slate-700">
          {result.reply}
        </p>
      )}
      {result.studentFriendlyBrief && (
        <p className="text-[12px] font-bold leading-6 text-slate-700">
          {result.studentFriendlyBrief}
        </p>
      )}
      {result.transcriptReview && (
        <p className="text-[12px] font-bold leading-6 text-slate-700">
          {result.transcriptReview}
        </p>
      )}
      {[...microPlan, ...usefulSignals, ...questions].slice(0, 6).map((item, index) => (
        <div
          key={`li-line-${index}`}
          className="rounded-2xl border border-slate-100 bg-slate-50 px-3 py-2 text-[11px] font-bold leading-5 text-slate-600"
        >
          {String(item)}
        </div>
      ))}
      {criteria.slice(0, 4).map((item, index) => (
        <div
          key={`li-criterion-${index}`}
          className="rounded-2xl border border-emerald-100 bg-emerald-50/60 px-3 py-2 text-[11px] font-bold leading-5 text-emerald-800"
        >
          <b className="block text-[11px] text-emerald-950">{item.criterion}</b>
          {item.feedback}
        </div>
      ))}
      {reviewQueue.slice(0, 4).map((item, index) => (
        <div
          key={`li-review-${item.id || index}`}
          className="rounded-2xl border border-amber-100 bg-amber-50/70 px-3 py-2 text-[11px] font-bold leading-5 text-amber-800"
        >
          {item.studentName || item.studentId} — {item.activityTitle || item.kind}
        </div>
      ))}
      {flags.length > 0 && (
        <div className="rounded-2xl border border-rose-100 bg-rose-50/70 px-3 py-2 text-[11px] font-bold leading-5 text-rose-800">
          {flags
            .slice(0, 3)
            .map((flag: any) => flag.label || flag.type)
            .join("، ")}
        </div>
      )}
      <p className="text-[10px] font-black leading-5 text-slate-400">
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

  const title = mode === "teacher" ? "Learning Intelligence" : "مساعد التعلم";
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
      className="miras-learning-intelligence rounded-[1.7rem] border border-indigo-100/75 bg-gradient-to-br from-white via-indigo-50/35 to-emerald-50/25 p-3 text-right shadow-[0_16px_46px_rgba(79,70,229,0.07)] sm:p-4"
      dir="rtl"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[10px] font-black uppercase text-indigo-500">
            {title}
          </p>
          <h3 className="mt-0.5 text-sm font-black text-slate-950">{subtitle}</h3>
        </div>
        <span className="rounded-full border border-white/80 bg-white/80 px-3 py-1 text-[10px] font-black text-slate-500">
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
          className="min-h-[5.5rem] w-full resize-y rounded-2xl border border-slate-200 bg-white/86 px-3 py-2 text-[12px] font-bold leading-6 text-slate-700 outline-none transition focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100"
        />
        <textarea
          value={transcript}
          onChange={(event) => setTranscript(event.target.value)}
          rows={2}
          placeholder="نص Viva الصوتي أو ملاحظات الطالب المنطوقة..."
          className="min-h-[3.8rem] w-full resize-y rounded-2xl border border-slate-200 bg-white/70 px-3 py-2 text-[12px] font-bold leading-6 text-slate-700 outline-none transition focus:border-emerald-300 focus:ring-4 focus:ring-emerald-100"
        />
      </div>

      <div className="mt-3 flex flex-wrap justify-end gap-2">
        {mode === "teacher" && (
          <>
            <button
              type="button"
              onClick={() => request("summary")}
              disabled={!!busy}
              className="rounded-2xl bg-slate-950 px-3 py-2 text-[11px] font-black text-white disabled:opacity-60"
            >
              {busy === "summary" ? "..." : "ملخص الأستاذ"}
            </button>
            <button
              type="button"
              onClick={() => request("course")}
              disabled={!!busy}
              className="rounded-2xl border border-indigo-100 bg-white px-3 py-2 text-[11px] font-black text-indigo-700 disabled:opacity-60"
            >
              فهم المقرر/الواجب
            </button>
          </>
        )}
        {mode === "student" && (
          <button
            type="button"
            onClick={() => request("tutor")}
            disabled={!!busy}
            className="rounded-2xl bg-indigo-600 px-3 py-2 text-[11px] font-black text-white disabled:opacity-60"
          >
            {busy === "tutor" ? "..." : "اسأل Tutor"}
          </button>
        )}
        <button
          type="button"
          onClick={() => request("viva")}
          disabled={!!busy}
          className="rounded-2xl border border-emerald-100 bg-white px-3 py-2 text-[11px] font-black text-emerald-700 disabled:opacity-60"
        >
          Viva
        </button>
      </div>

      {error && (
        <div className="mt-3 rounded-2xl border border-rose-100 bg-rose-50 px-3 py-2 text-[11px] font-black text-rose-700">
          {error}
        </div>
      )}
      <CompactResult result={result} />
    </section>
  );
}
