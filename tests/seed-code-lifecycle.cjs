require('./seed.cjs');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const file = path.join(__dirname, '../data/db.json');
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const archived = {
  code: 'LAB-TEST-2345-ABCD', ownerEmail: 'aa@test.kw',
  sectionCode: '222-aa@test.kw', courseCode: '222-aa@test.kw', studentSection: '222-aa@test.kw',
  status: 'retired', createdAt: '2026-09-01T00:00:00.000Z',
  retiredAt: '2026-09-02T00:00:00.000Z', retiredReason: 'teacher_deleted_code',
};
archived.codeSignature = crypto.createHmac('sha256', 'flow-test-signing-secret')
  .update([archived.code.replace(/-/g, ''), archived.ownerEmail, archived.sectionCode, archived.createdAt].join('|')).digest('hex');
data.retiredJoinCodes = [archived];
data.joinCodes.push({ ...archived, code: 'LAB-TEST-2345-ABCE', status: 'active', retiredAt: '', retiredReason: '', codeSignature: 'a'.repeat(64) });
fs.writeFileSync(file, JSON.stringify(data));
