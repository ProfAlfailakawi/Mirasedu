// The code check reports "activated" only from real usage markers: a legacy
// code assigned through studentId but still active and never used is unused.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import ts from 'typescript';

const source = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const match = source.match(/function joinCodeWasActivated\([\s\S]*?\n}\n/);
assert.ok(match, 'joinCodeWasActivated exists in server.ts');
const js = ts.transpileModule(match[0], { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
const joinCodeWasActivated = new Function(`${js}; return joinCodeWasActivated;`)();

const cases = [
  [{ status: 'active' }, false, 'fresh code'],
  [{ status: 'active', studentId: '201912345' }, false, 'legacy assigned, never used'],
  [{ status: 'active', assignedStudentId: '201912345' }, false, 'assigned, never used'],
  [{ status: 'used' }, true, 'used status'],
  [{ status: 'active', activatedAt: '2026-01-01T00:00:00Z', studentId: '201912345' }, true, 'activation time'],
  [{ status: 'active', usedAt: '2026-01-01T00:00:00Z' }, true, 'usage time'],
  [{ status: 'active', usedByStudentId: '201912345' }, true, 'used by a student'],
  [{ status: 'revoked', studentId: '201912345' }, false, 'legacy assignment revoked before use'],
  [{ status: 'revoked', studentId: '201912345', activatedAt: '2026-01-01T00:00:00Z' }, true, 'used then revoked'],
  [{ status: 'revoked' }, false, 'revoked unused'],
];
for (const [code, expected, label] of cases) {
  assert.equal(joinCodeWasActivated(code), expected, label);
}
console.log(`join-code-activated: ${cases.length} cases passed`);
