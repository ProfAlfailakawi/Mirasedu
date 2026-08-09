import crypto from "node:crypto";
import { BASE, createReporter } from "./lib.mjs";

const { check, done } = createReporter("public-device teacher QR login");
const ORIGIN = BASE;
const TEACHER = "aa@test.kw";
const STUDENT_EMAIL = "1001@paaet.edu.kw";
const DEVICE = "public-college-computer-device-0001";
const CREDENTIAL_ID =
  "bWlyYXMtcHVibGljLWRldmljZS10ZXN0LWNyZWRlbnRpYWw";
const PRIVATE_JWK = {
  kty: "EC",
  x: "fyF7FbeTk5mNnOVZYtfUbrF2CFTIbbo1iwYeVrL3mYU",
  y: "41FsUZwJaa4bYfylH8UW29Ge6OtbVjkYZRkeTbTz1Lc",
  crv: "P-256",
  d: "pX3VM8sp9UYOuoEC2lBMGoSZ9_SUPv-Fn9gyUkHxGKc",
};

async function call(path, body, { device = DEVICE, ua } = {}) {
  const headers = {
    "content-type": "application/json",
    origin: ORIGIN,
    "user-agent":
      ua ||
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0",
  };
  if (device !== null) headers["x-miras-device-id"] = device;
  const res = await fetch(BASE + path, {
    method: "POST",
    headers,
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  return { res, data, status: res.status, ok: res.ok };
}

async function protectedTeacherRead(authToken, device) {
  const res = await fetch(BASE + "/api/teacher/activation-attempts", {
    headers: {
      origin: ORIGIN,
      authorization: `Bearer ${authToken}`,
      "x-miras-device-id": device,
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0",
    },
  });
  const data = await res.json().catch(() => ({}));
  return { res, data, status: res.status, ok: res.ok };
}

function b64(value) {
  return Buffer.from(value).toString("base64url");
}

function assertionFor(options) {
  const clientDataJSON = Buffer.from(
    JSON.stringify({
      type: "webauthn.get",
      challenge: options.challenge,
      origin: ORIGIN,
      crossOrigin: false,
    }),
  );
  const rpIdHash = crypto
    .createHash("sha256")
    .update(String(options.rpId || "localhost"))
    .digest();
  const flags = Buffer.from([0x05]); // user present + user verified
  const counter = Buffer.alloc(4);
  counter.writeUInt32BE(1);
  const authenticatorData = Buffer.concat([rpIdHash, flags, counter]);
  const signedData = Buffer.concat([
    authenticatorData,
    crypto.createHash("sha256").update(clientDataJSON).digest(),
  ]);
  const privateKey = crypto.createPrivateKey({
    key: PRIVATE_JWK,
    format: "jwk",
  });
  const signature = crypto.sign("sha256", signedData, privateKey);
  return {
    id: CREDENTIAL_ID,
    rawId: CREDENTIAL_ID,
    type: "public-key",
    authenticatorAttachment: "platform",
    clientExtensionResults: {},
    response: {
      clientDataJSON: b64(clientDataJSON),
      authenticatorData: b64(authenticatorData),
      signature: b64(signature),
      userHandle: b64(Buffer.from(`teacher:${TEACHER}`)),
    },
  };
}

const numericAvailability = await call(
  "/api/auth/public-device/availability",
  { email: "1001" },
);
check(
  "student numeric identity never exposes the QR option",
  numericAvailability.ok && numericAvailability.data.available === false,
  JSON.stringify(numericAvailability.data),
);

const studentAvailability = await call(
  "/api/auth/public-device/availability",
  { email: STUDENT_EMAIL },
);
check(
  "student email never exposes the QR option",
  studentAvailability.ok && studentAvailability.data.available === false,
  JSON.stringify(studentAvailability.data),
);

const noPasskeyTeacher = await call(
  "/api/auth/public-device/availability",
  { email: "bb@test.kw" },
);
check(
  "teacher without an enrolled passkey is not offered QR",
  noPasskeyTeacher.ok && noPasskeyTeacher.data.available === false,
  JSON.stringify(noPasskeyTeacher.data),
);

const availability = await call("/api/auth/public-device/availability", {
  email: TEACHER,
});
check(
  "enrolled teacher is offered QR",
  availability.ok && availability.data.available === true,
  JSON.stringify(availability.data),
);

const noDeviceStart = await call(
  "/api/auth/public-device/start",
  { email: TEACHER },
  { device: null },
);
check(
  "start rejects a browser without a stable device token",
  noDeviceStart.status === 400,
  `${noDeviceStart.status} ${JSON.stringify(noDeviceStart.data)}`,
);

const started = await call("/api/auth/public-device/start", {
  email: TEACHER,
});
check("start succeeds for teacher only", started.ok, JSON.stringify(started.data));
check(
  "QR is rendered locally as an image data URL",
  String(started.data.qrDataUrl || "").startsWith("data:image/png;base64,"),
);
check(
  "pairing code is four digits",
  /^\d{4}$/.test(String(started.data.pairingCode || "")),
  started.data.pairingCode,
);
check(
  "approval URL stays on the official test origin",
  String(started.data.approvalUrl || "").startsWith(
    `${ORIGIN}/#miras-public-login=`,
  ),
  started.data.approvalUrl,
);
check(
  "approval URL contains neither email nor desktop secret",
  !String(started.data.approvalUrl || "").includes(TEACHER) &&
    !String(started.data.approvalUrl || "").includes(
      String(started.data.desktopSecret || ""),
    ),
);
check(
  "desktop label is derived without a machine fingerprint",
  String(started.data.desktopLabel || "").includes("Chrome") &&
    String(started.data.desktopLabel || "").includes("Windows"),
  started.data.desktopLabel,
);

const approvalToken = decodeURIComponent(
  String(started.data.approvalUrl).split("#miras-public-login=")[1] || "",
);
const pending = await call("/api/auth/public-device/status", {
  requestId: started.data.requestId,
  desktopSecret: started.data.desktopSecret,
});
check(
  "desktop sees pending before phone approval",
  pending.ok && pending.data.status === "pending",
  JSON.stringify(pending.data),
);

const badSecret = await call("/api/auth/public-device/status", {
  requestId: started.data.requestId,
  desktopSecret: "wrong-secret-value-that-cannot-match",
});
check("wrong desktop secret is rejected", badSecret.status === 404);

const wrongDevice = await call(
  "/api/auth/public-device/status",
  {
    requestId: started.data.requestId,
    desktopSecret: started.data.desktopSecret,
  },
  { device: "another-public-device-token-0002" },
);
check("request is bound to its originating computer", wrongDevice.status === 403);

const invalidApproval = await call(
  "/api/auth/public-device/approval/start",
  { approvalToken: `${started.data.requestId}.invalid-secret-value-that-will-not-match-123456789` },
  { device: "teacher-phone-device-0001" },
);
check("invalid QR approval secret is rejected", invalidApproval.status === 410);

const approvalStart = await call(
  "/api/auth/public-device/approval/start",
  { approvalToken },
  { device: "teacher-phone-device-0001" },
);
check(
  "phone receives a teacher-only WebAuthn challenge",
  approvalStart.ok && !!approvalStart.data.options?.challenge,
  JSON.stringify(approvalStart.data),
);
check(
  "challenge allows only the requested teacher credential",
  approvalStart.data.options?.allowCredentials?.length === 1 &&
    approvalStart.data.options.allowCredentials[0].id === CREDENTIAL_ID,
  JSON.stringify(approvalStart.data.options?.allowCredentials),
);
check(
  "phone and desktop receive the same pairing code",
  approvalStart.data.pairingCode === started.data.pairingCode,
);

const assertion = assertionFor(approvalStart.data.options);
const approvalFinish = await call(
  "/api/auth/public-device/approval/finish",
  { approvalToken, response: assertion },
  { device: "teacher-phone-device-0001" },
);
check(
  "valid teacher biometric assertion approves the desktop",
  approvalFinish.ok && approvalFinish.data.success === true,
  `${approvalFinish.status} ${JSON.stringify(approvalFinish.data)}`,
);

const replayApproval = await call(
  "/api/auth/public-device/approval/finish",
  { approvalToken, response: assertion },
  { device: "teacher-phone-device-0001" },
);
check("phone approval is one-time", replayApproval.status === 409);

const approved = await call("/api/auth/public-device/status", {
  requestId: started.data.requestId,
  desktopSecret: started.data.desktopSecret,
});
check(
  "approved desktop receives a full teacher payload",
  approved.ok &&
    approved.data.status === "approved" &&
    approved.data.teacher?.email === TEACHER &&
    approved.data.teacher?.publicDeviceSession === true &&
    typeof approved.data.authToken === "string",
  `${approved.status} ${JSON.stringify(approved.data)}`,
);

const [payloadPart] = String(approved.data.authToken || "").split(".");
let sessionPayload = {};
try {
  sessionPayload = JSON.parse(Buffer.from(payloadPart, "base64url").toString());
} catch {}
check(
  "temporary token is teacher-only and device-bound",
  sessionPayload.role === "teacher" &&
    sessionPayload.userId === TEACHER &&
    sessionPayload.publicDeviceSession === true &&
    sessionPayload.deviceTokenHash ===
      crypto.createHash("sha256").update(DEVICE).digest("hex"),
  JSON.stringify(sessionPayload),
);
const protectedFromDesktop = await protectedTeacherRead(
  approved.data.authToken,
  DEVICE,
);
check(
  "temporary session authorizes the originating computer",
  protectedFromDesktop.ok,
  `${protectedFromDesktop.status} ${JSON.stringify(protectedFromDesktop.data)}`,
);
const protectedFromOtherDevice = await protectedTeacherRead(
  approved.data.authToken,
  "stolen-token-on-another-device-0003",
);
check(
  "copied temporary token is rejected on another device",
  protectedFromOtherDevice.status === 401,
  `${protectedFromOtherDevice.status} ${JSON.stringify(protectedFromOtherDevice.data)}`,
);
check(
  "teacher public session has a bounded four-hour maximum",
  Number(sessionPayload.expiresAt) - Number(sessionPayload.issuedAt) ===
    4 * 60 * 60 * 1000,
  JSON.stringify(sessionPayload),
);
const setCookie = approved.res.headers.get("set-cookie") || "";
check(
  "public-computer session cookie is browser-session-only",
  setCookie.includes("HttpOnly") &&
    setCookie.includes("SameSite=Lax") &&
    !/Max-Age=/i.test(setCookie),
  setCookie,
);

const deliveryRetry = await call("/api/auth/public-device/status", {
  requestId: started.data.requestId,
  desktopSecret: started.data.desktopSecret,
});
check(
  "lost desktop response can be retried without issuing a different token",
  deliveryRetry.ok && deliveryRetry.data.authToken === approved.data.authToken,
);

await call("/api/auth/public-device/cancel", {
  requestId: started.data.requestId,
  desktopSecret: started.data.desktopSecret,
});
const afterCancel = await call("/api/auth/public-device/status", {
  requestId: started.data.requestId,
  desktopSecret: started.data.desktopSecret,
});
check("cancel removes the pairing request", afterCancel.status === 404);

const logout = await call("/api/auth/logout", {});
const logoutCookie = logout.res.headers.get("set-cookie") || "";
check(
  "explicit logout clears the temporary cookie",
  logout.ok && /miras_session=/.test(logoutCookie) && /Max-Age=0/.test(logoutCookie),
  logoutCookie,
);

done();
