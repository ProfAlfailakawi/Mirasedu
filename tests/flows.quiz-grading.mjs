// Exam auto-grading flows (run on a fresh seed).
//
// The crown jewel of an exam platform: submitted answers must be scored
// correctly. The security suite already proves the exam LOCK (one session at a
// time, blocked contexts get no questions); this proves the SCORING itself:
//   1. a correct answer earns full marks;
//   2. a wrong answer earns zero (same exam, different student);
//   3. per-question correctness/points are reported;
//   4. a submitted exam locks — it cannot be retaken (409) without a teacher return.
//
// Seed fixture: exam "exam-lock-1" on course S_A1 (points=1), question
// "q-lock-1" (multiple-choice, correctAnswer "أ", 1pt). Students 1001 and 2002
// are both enrolled in S_A1.
import { api, makeJar, createReporter } from "./lib.mjs";

const { check, done } = createReporter("FLOWS / QUIZ-GRADING");

const EXAM = "exam-lock-1";
const Q = "q-lock-1";
const CORRECT = "أ";
const WRONG = "ب";

const loginStudent = async (id, tok) => {
  const jar = makeJar();
  const r = await api("POST", "/api/auth/login", { idNumber: id, password: `pass${id}` }, { jar, deviceToken: tok });
  return { jar, ok: r.ok && r.data.success === true && typeof r.data.authToken === "string", raw: r };
};

const acquireLock = (id, tok, jar, sessionId) =>
  api("POST", "/api/exam-lock/acquire",
    { studentId: id, examId: EXAM, sessionId, deviceId: tok, displayMode: "pwa" },
    { deviceToken: tok, jar });

const submitExam = (id, tok, jar, sessionId, answer) =>
  api("POST", "/api/quizzes/submit",
    { studentId: id, chapterId: EXAM, answers: { [Q]: answer }, startTime: Date.now() - 15000, deviceToken: tok, examSessionId: sessionId, displayMode: "pwa" },
    { deviceToken: tok, jar });

const s1 = await loginStudent("1001", "tok-1001");
check("Q0a) student 1001 login", s1.ok, `${s1.raw.status} ${JSON.stringify(s1.raw.data).slice(0, 120)}`);
const s2 = await loginStudent("2002", "tok-2002");
check("Q0b) student 2002 login", s2.ok, `${s2.raw.status} ${JSON.stringify(s2.raw.data).slice(0, 120)}`);

// Q1: a correct answer earns full marks.
await (async () => {
  const lock = await acquireLock("1001", "tok-1001", s1.jar, "grade-q-correct");
  check("Q1a) student 1001 acquires exam lock", lock.ok && lock.data.activeExamSessionId === "grade-q-correct", `${lock.status} ${JSON.stringify(lock.data).slice(0, 140)}`);

  const r = await submitExam("1001", "tok-1001", s1.jar, "grade-q-correct", CORRECT);
  const sub = r.data.submission || {};
  const mq = (sub.matchedQuestions || [])[0] || {};
  check("Q1b) correct submission succeeds", r.ok && r.data.success === true, `${r.status} ${JSON.stringify(r.data).slice(0, 160)}`);
  check("Q1c) correct answer earns full marks (score=1)", Number(sub.score) === 1, `score=${sub.score}`);
  check("Q1d) total points reported (=1)", Number(sub.totalPoints) === 1, `totalPoints=${sub.totalPoints}`);
  check("Q1e) the question is marked correct with its point", mq.isCorrect === true && Number(mq.pointsEarned) === 1, JSON.stringify(mq).slice(0, 160));
})();

// Q2: a wrong answer to the SAME exam earns zero (different student, no lock clash).
await (async () => {
  const lock = await acquireLock("2002", "tok-2002", s2.jar, "grade-q-wrong");
  check("Q2a) student 2002 acquires exam lock", lock.ok && lock.data.activeExamSessionId === "grade-q-wrong", `${lock.status} ${JSON.stringify(lock.data).slice(0, 140)}`);

  const r = await submitExam("2002", "tok-2002", s2.jar, "grade-q-wrong", WRONG);
  const sub = r.data.submission || {};
  const mq = (sub.matchedQuestions || [])[0] || {};
  check("Q2b) wrong submission still succeeds (records the attempt)", r.ok && r.data.success === true, `${r.status} ${JSON.stringify(r.data).slice(0, 160)}`);
  check("Q2c) wrong answer earns zero (score=0)", Number(sub.score) === 0, `score=${sub.score}`);
  check("Q2d) the question is marked incorrect with zero points", mq.isCorrect === false && Number(mq.pointsEarned) === 0, JSON.stringify(mq).slice(0, 160));
})();

// Q3: a submitted exam is locked — it cannot be retaken without a teacher return.
await (async () => {
  const r = await submitExam("1001", "tok-1001", s1.jar, "grade-q-correct", CORRECT);
  check("Q3) resubmitting a locked exam is rejected (409)", r.status === 409 && !!r.data.error, `${r.status} ${JSON.stringify(r.data).slice(0, 160)}`);
})();

done();
