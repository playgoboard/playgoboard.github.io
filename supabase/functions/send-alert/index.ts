// GoBoard's send-alert function: sends one alert to a player's devices. The database calls it
// (supabase/25-push-alerts.sql). It's pasted into Supabase: Edge Functions -> Deploy a new function
// -> Via Editor, named send-alert, with "Verify JWT" turned OFF, because the x-alert-secret check below
// protects it. It needs three Secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and ALERT_SECRET
// (from tools/make-push-keys.html). No outside libraries: Web Push is written with the built-in crypto.

const PROJECT_URL = "https://iosvimeihfhpxsztqkkv.supabase.co";
const PUBLIC_API_KEY = "sb_publishable_wk2cNeEd2YpQKgq14q7-kA_Tmxf5dr3"; // public, same as js/supabase-config.js
const CONTACT = "https://playgoboard.github.io/";

const TEXT = {
  en: { turn: ["Your turn on GoBoard", "{name} played. It's your move."], challenge: ["New challenge on GoBoard", "{name} challenged you to a daily game."], test: ["GoBoard", "Alerts are working!"] },
  "zh-Hans": { turn: ["GoBoard：轮到你了", "{name} 已落子，轮到你了。"], challenge: ["GoBoard：新的挑战", "{name} 向你发起了每日对局挑战。"], test: ["GoBoard", "提醒功能正常！"] },
  "zh-Hant": { turn: ["GoBoard：輪到你了", "{name} 已落子，輪到你了。"], challenge: ["GoBoard：新的挑戰", "{name} 向你發起了每日對局挑戰。"], test: ["GoBoard", "提醒功能正常！"] },
  fr: { turn: ["À toi de jouer sur GoBoard", "{name} a joué. C'est ton tour."], challenge: ["Nouveau défi sur GoBoard", "{name} te défie à une partie quotidienne."], test: ["GoBoard", "Les alertes fonctionnent !"] },
  es: { turn: ["Tu turno en GoBoard", "{name} ha jugado. Te toca."], challenge: ["Nuevo desafío en GoBoard", "{name} te desafió a una partida diaria."], test: ["GoBoard", "¡Las alertas funcionan!"] },
  de: { turn: ["Du bist dran auf GoBoard", "{name} hat gezogen. Du bist am Zug."], challenge: ["Neue Herausforderung auf GoBoard", "{name} fordert dich zu einer Tagespartie heraus."], test: ["GoBoard", "Benachrichtigungen funktionieren!"] },
  ja: { turn: ["GoBoard：あなたの番です", "{name} さんが打ちました。あなたの番です。"], challenge: ["GoBoard：新しい挑戦", "{name} さんから毎日対局の挑戦が届きました。"], test: ["GoBoard", "通知は正常に動作しています！"] },
  ko: { turn: ["GoBoard: 내 차례입니다", "{name}님이 두었습니다. 내 차례입니다."], challenge: ["GoBoard: 새 도전", "{name}님이 일일 대국을 신청했습니다."], test: ["GoBoard", "알림이 작동합니다!"] },
};

const encoder = new TextEncoder();

function fromBase64Url(text) {
  const plain = atob(text.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(text.length / 4) * 4, "="));
  return Uint8Array.from(plain, (c) => c.charCodeAt(0));
}

function toBase64Url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function join(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

async function hkdf(salt, secret, info, length) {
  const key = await crypto.subtle.importKey("raw", secret, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, length * 8));
}

// Encrypts the message for one device (RFC 8291, aes128gcm).
async function encrypt(message, p256dh, auth) {
  const devicePublic = fromBase64Url(p256dh);
  const deviceKey = await crypto.subtle.importKey("raw", devicePublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const mine = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const myPublic = new Uint8Array(await crypto.subtle.exportKey("raw", mine.publicKey));
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: deviceKey }, mine.privateKey, 256));
  const ikm = await hkdf(fromBase64Url(auth), shared, join(encoder.encode("WebPush: info\0"), devicePublic, myPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const contentKey = await hkdf(salt, ikm, encoder.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, encoder.encode("Content-Encoding: nonce\0"), 12);
  const aes = await crypto.subtle.importKey("raw", contentKey, "AES-GCM", false, ["encrypt"]);
  const sealed = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce }, aes, join(encoder.encode(message), new Uint8Array([2]))));
  // The header: salt, record size 4096, then the length and bytes of our public key.
  return join(salt, new Uint8Array([0, 0, 16, 0, myPublic.length]), myPublic, sealed);
}

// Proves to the push service that this message comes from GoBoard (RFC 8292, VAPID).
async function vapidHeader(endpoint, publicKey, privateKey) {
  const pub = fromBase64Url(publicKey);
  const key = await crypto.subtle.importKey("jwk", {
    kty: "EC", crv: "P-256", d: privateKey, ext: true,
    x: toBase64Url(pub.slice(1, 33)), y: toBase64Url(pub.slice(33, 65)),
  }, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const part = (value) => toBase64Url(encoder.encode(JSON.stringify(value)));
  const body = `${part({ typ: "JWT", alg: "ES256" })}.${part({
    aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: CONTACT,
  })}`;
  const signature = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, encoder.encode(body)));
  return `vapid t=${body}.${toBase64Url(signature)}, k=${publicKey}`;
}

// Returns the push service's answer status.
async function sendOne(device, kind, name, url, keys) {
  const words = (TEXT[device.lang] || TEXT.en)[kind] || TEXT.en[kind];
  const message = JSON.stringify({ title: words[0], body: words[1].replace("{name}", name || ""), url });
  const response = await fetch(device.endpoint, {
    method: "POST",
    headers: {
      Authorization: await vapidHeader(device.endpoint, keys.publicKey, keys.privateKey),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: "86400", // keep trying for a day if the device is off
      Urgency: "high",
    },
    body: await encrypt(message, device.p256dh, device.auth),
  });
  await response.arrayBuffer();
  return response.status;
}

Deno.serve(async (request) => {
  const secret = Deno.env.get("ALERT_SECRET");
  const keys = { publicKey: Deno.env.get("VAPID_PUBLIC_KEY"), privateKey: Deno.env.get("VAPID_PRIVATE_KEY") };
  if (!secret || !keys.publicKey || !keys.privateKey) return new Response("Secrets are missing", { status: 500 });
  if (request.headers.get("x-alert-secret") !== secret) return new Response("No", { status: 401 });

  const { devices, kind, name, url } = await request.json();
  const statuses = await Promise.all((devices || []).map((device) =>
    sendOne(device, kind, name, url, keys).catch((error) => {
      console.error("Couldn't send an alert:", String(error));
      return 0;
    })));

  // 404 and 410 mean the player turned alerts off on that device: forget it.
  const dead = (devices || []).filter((_, k) => statuses[k] === 404 || statuses[k] === 410).map((d) => d.endpoint);
  if (dead.length) {
    await fetch(`${PROJECT_URL}/rest/v1/rpc/push_remove_dead`, {
      method: "POST",
      headers: { apikey: PUBLIC_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ p_secret: secret, p_endpoints: dead }),
    }).catch(() => { /* tried again next time */ });
  }
  const failed = statuses.filter((s) => s < 200 || s >= 300);
  if (failed.length) console.error("Alert answers:", statuses.join(","));
  return Response.json({ statuses });
});
