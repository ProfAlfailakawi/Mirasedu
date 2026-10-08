import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { transform } from 'esbuild';

// The real per-network login limiter, compiled from server.ts on its own.
const source = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('server.ts', source, ts.ScriptTarget.Latest, true);
const names = ['LOGIN_IP_WINDOW_MS', 'LOGIN_IP_MAX_FAILURES', 'loginIpFailures', 'loginIpRateLimit'];
const statements = parsed.statements.filter(ts.isVariableStatement).filter(node =>
  node.declarationList.declarations.some(d => names.includes(d.name.getText(parsed))));
assert.equal(statements.length, names.length, 'limiter declarations exist');
const { code } = await transform(statements.map(node => node.getText(parsed)).join('\n'), { loader: 'ts' });
const limiter = () => new Function('express', `${code}\nreturn loginIpRateLimit;`)({});

function request(limit, ip = '10.0.0.1') {
  const listeners = {};
  const res = {
    statusCode: 200, body: null, headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    once(event, fn) { listeners[event] = fn; },
    finish(status) { this.statusCode = status; listeners.finish?.(); },
  };
  let passed = false;
  limit({ ip }, res, () => { passed = true; });
  return { res, passed };
}

test('a class signing in together from one network is never refused while requests are in flight', () => {
  const limit = limiter();
  const inFlight = Array.from({ length: 250 }, () => request(limit));
  assert.ok(inFlight.every(r => r.passed), 'all 250 concurrent logins reach the handler');
  inFlight.forEach(r => r.res.finish(200));
  assert.ok(request(limit).passed);
});

test('only completed failures count, and the cap still stops password spraying', () => {
  const limit = limiter();
  for (let i = 0; i < 99; i++) request(limit).res.finish(401);
  const pending = Array.from({ length: 50 }, () => request(limit));
  assert.ok(pending.every(r => r.passed), 'in-flight requests are not counted');
  pending.forEach(r => r.res.finish(200));
  request(limit).res.finish(401);
  const blocked = request(limit);
  assert.equal(blocked.passed, false);
  assert.equal(blocked.res.statusCode, 429);
  assert.match(blocked.res.body.error, /هذه الشبكة/);
  assert.ok(Number(blocked.res.headers['Retry-After']) > 0);
  assert.ok(request(limit, '10.0.0.2').passed, 'other networks are unaffected');
});
