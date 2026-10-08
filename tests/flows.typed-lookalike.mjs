// A student types the printed code by hand and reads a letter as a look-alike
// digit (Z as 2, S as 5, B as 8, G as 6) or the reverse. The exact code still
// wins; the look-alike is accepted only when it matches exactly one real code.
import { randomUUID } from 'node:crypto';
import { api, makeJar, createReporter, AA, S_A1 } from './lib.mjs';
const { check, done } = createReporter('FLOWS / TYPED LOOK-ALIKE CODE');
const pw = process.env.TEST_TEACHER_PASSWORD || 'change-me-in-ci';
const A = { jar: makeJar(), deviceToken: 'lookalike-a' };
check('teacher login', (await api('POST', '/api/auth/login', { idNumber: AA, password: pw }, A)).ok);

const LOOKALIKE = { Z: '2', S: '5', B: '8', G: '6', 2: 'Z', 5: 'S', 8: 'B', 6: 'G' };
// Swap one look-alike character in the code body (after "LAB-").
const misread = (code) => {
  const i = [...code].findIndex((ch, idx) => idx > 3 && LOOKALIKE[ch]);
  return i < 0 ? null : code.slice(0, i) + LOOKALIKE[code[i]] + code.slice(i + 1);
};
let code = null, typed = null;
for (let n = 0; n < 30 && !typed; n++) {
  code = (await api('POST', '/api/teacher/join-codes/create', { sectionCode: S_A1, count: 1 }, A)).data.created?.[0]?.code;
  typed = code ? misread(code) : null;
}
check('a code with a look-alike character was issued', !!typed, String(code));

// 1002 is on course A's roster and has no account yet in the seed.
const chosen = `N${randomUUID().replace(/-/g, '')}`;
const r = await api('POST', '/api/auth/verify-otp', { idNumber: '1002', otp: typed, password: chosen, deviceToken: 'tok-lookalike' }, { deviceToken: 'tok-lookalike' });
check(`typed ${typed} for ${code} activates the account`, r.ok && r.data?.success === true, JSON.stringify(r.data).slice(0, 160));
const scan = (await api('POST', '/api/teacher/code-scan', { code }, A)).data;
check('the real code is the one recorded as used by 1002', scan?.activated === true && String(scan?.studentId) === '1002', JSON.stringify(scan).slice(0, 160));
// «تحقق» finds the same real code from the misread spelling.
const scanTyped = (await api('POST', '/api/teacher/code-scan', { code: typed }, A)).data;
check('«تحقق» on the misread spelling shows the real code', scanTyped?.code === code && scanTyped?.activated === true && String(scanTyped?.studentId) === '1002', JSON.stringify(scanTyped).slice(0, 160));
const scanFake = await api('POST', '/api/teacher/code-scan', { code: 'LAB-QQQ2-QQQQ-QQQQ' }, A);
check('«تحقق» on a code that does not exist still says not found', scanFake.status === 404 && scanFake.data?.notFound === true, `${scanFake.status}`);

// A code that does not exist, even with look-alikes, is still rejected.
const fake = await api('POST', '/api/auth/verify-otp', { idNumber: '1002', otp: 'LAB-ZZZZ-ZZZZ-ZZZZ', password: chosen, deviceToken: 'tok-lookalike' }, { deviceToken: 'tok-lookalike' });
check('a code that does not exist is still rejected', !fake.ok && fake.data?.code === 'INVALID_CODE', `${fake.status} ${JSON.stringify(fake.data).slice(0, 120)}`);

// A code the teacher cancelled reads «ملغي» in «تحقق», exact or look-alike spelling.
let cancelled = null, cancelledTyped = null;
for (let n = 0; n < 30 && !cancelledTyped; n++) {
  cancelled = (await api('POST', '/api/teacher/join-codes/create', { sectionCode: S_A1, count: 1 }, A)).data.created?.[0]?.code;
  cancelledTyped = cancelled ? misread(cancelled) : null;
}
check('teacher cancels the code', (await api('POST', '/api/teacher/join-codes/update', { code: cancelled, status: 'revoked' }, A)).ok);
const scanCancelled = (await api('POST', '/api/teacher/code-scan', { code: cancelled }, A)).data;
check('«تحقق» shows a cancelled code as «ملغي»', scanCancelled?.state === 'ملغي', JSON.stringify(scanCancelled).slice(0, 140));
const scanCancelledTyped = (await api('POST', '/api/teacher/code-scan', { code: cancelledTyped }, A)).data;
check('«تحقق» on its look-alike spelling also shows «ملغي»', scanCancelledTyped?.code === cancelled && scanCancelledTyped?.state === 'ملغي', JSON.stringify(scanCancelledTyped).slice(0, 140));

// A code the teacher deleted (kept in the archive) also reads «ملغي», exact or look-alike.
let deleted = null, deletedTyped = null;
for (let n = 0; n < 30 && !deletedTyped; n++) {
  deleted = (await api('POST', '/api/teacher/join-codes/create', { sectionCode: S_A1, count: 1 }, A)).data.created?.[0]?.code;
  deletedTyped = deleted ? misread(deleted) : null;
}
check('teacher deletes the code', (await api('POST', '/api/teacher/join-codes/delete', { code: deleted }, A)).ok);
const scanDeleted = (await api('POST', '/api/teacher/code-scan', { code: deleted }, A)).data;
check('«تحقق» shows a deleted code as «ملغي»', scanDeleted?.state === 'ملغي', JSON.stringify(scanDeleted).slice(0, 140));
const scanDeletedTyped = (await api('POST', '/api/teacher/code-scan', { code: deletedTyped }, A)).data;
check('«تحقق» on its look-alike spelling also shows «ملغي»', scanDeletedTyped?.code === deleted && scanDeletedTyped?.state === 'ملغي', JSON.stringify(scanDeletedTyped).slice(0, 140));

// Look-alike spellings of one code share its attempt limit (8 per code), so
// alternating Z/2 cannot split the attempts into separate buckets.
let limited = false;
for (let n = 0; n < 10 && !limited; n++) {
  const spelling = n % 2 ? 'LAB-QQQ2-QQQQ-QQQQ' : 'LAB-QQQZ-QQQQ-QQQQ';
  const attempt = await api('POST', '/api/auth/verify-otp', { idNumber: String(700000000 + n), otp: spelling, password: chosen, deviceToken: `tok-split-${n}` }, { deviceToken: `tok-split-${n}` });
  limited = attempt.status === 429;
}
check('alternating look-alike spellings hit the same per-code limit', limited);
done();
