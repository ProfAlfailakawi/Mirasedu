// A whole class signs in at once from the college network (one public IP).
// Correct logins must never be refused as "too many failures from this network";
// only completed failures count toward the per-network cap.
import { api, makeJar, createReporter } from "./lib.mjs";
const { check, done } = createReporter("FLOWS / LOGIN NETWORK LIMIT");
// The seed gives student 1001 the credential "pass" + id (see tests/seed.cjs).
const student = "1001";
const seededLogin = () => ({ idNumber: student, password: `pass${student}` });

const rush = await Promise.all(Array.from({ length: 160 }, () =>
  api("POST", "/api/auth/login", seededLogin(), { jar: makeJar(), deviceToken: "tok-1001" })));
const refused = rush.filter((r) => r.status === 429);
check("160 simultaneous correct logins from one network are all accepted", rush.every((r) => r.ok), JSON.stringify(rush.find((r) => !r.ok)?.data));
check("none is refused as network abuse", refused.length === 0, `${refused.length} refused`);

// Unknown student ids: each attempt is a completed failure.
const failures = [];
for (let i = 0; i < 100; i += 1) {
  failures.push(await api("POST", "/api/auth/login", { ...seededLogin(), idNumber: `99${String(i).padStart(4, "0")}` }));
}
check("failed attempts are answered normally until the cap", failures.every((r) => r.status !== 429), failures.find((r) => r.status === 429)?.status);
const blocked = await api("POST", "/api/auth/login", seededLogin(), { jar: makeJar(), deviceToken: "tok-1001" });
check("after 100 completed failures the network is paused", blocked.status === 429 && /هذه الشبكة/.test(blocked.data.error || ""), `${blocked.status} ${JSON.stringify(blocked.data)}`);
done();
