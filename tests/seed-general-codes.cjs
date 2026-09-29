require('./seed.cjs');
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const file = path.join(__dirname, '../data/db.json');
const db = JSON.parse(fs.readFileSync(file, 'utf8'));
const ownerEmail = 'ah.alfailakawi@paaet.edu.kw';
function archived(code, extra = {}) {
  const record = {
    code, ownerEmail, sectionCode: 'all', courseCode: 'all', studentSection: 'all',
    createdAt: '2026-09-14T17:00:00.000Z', status: 'retired',
    retiredReason: 'course_closed_full_reset', retiredAt: '2026-09-23T15:00:00.000Z',
    archivedAt: '2026-09-23T15:00:00.000Z', ...extra,
  };
  record.codeSignature = crypto.createHmac('sha256', 'flow-test-signing-secret')
    .update([code.replace(/-/g, ''), ownerEmail, record.sectionCode, record.createdAt].join('|')).digest('hex');
  return record;
}
db.retiredJoinCodes = [
  archived('LAB-TEST-2345-6789'),
  archived('LAB-TEST-2345-678A', { retiredReason: 'course_closed_custom_reset' }),
  archived('LAB-TEST-2345-678B', { status: 'used', usedByStudentId: '1001' }),
  archived('LAB-TEST-2345-678C', { status: 'revoked' }),
  archived('LAB-TEST-2345-678D', { retiredReason: 'manual_code_delete' }),
  archived('LAB-TEST-2345-678E', { sectionCode: '111-aa@test.kw' }),
  archived('LAB-TEST-2345-678F', { assignedStudentId: '1001' }),
  { ...archived('LAB-TEST-2345-678G'), codeSignature: 'a'.repeat(64) },
  archived('LAB-TEST-2345-678H'),
];
db.joinCodes.push({ ...archived('LAB-TEST-2345-678H'), status: 'revoked' });
fs.writeFileSync(file, JSON.stringify(db));
