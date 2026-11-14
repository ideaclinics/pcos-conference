// Live stream support: viewer count, viewer questions, operator and stage screens.
//
// Secrets (Cloudflare > pcos-conference > Settings > Variables and secrets):
//   YT_API_KEY      YouTube Data API key (viewer count). Optional: without it the count is hidden.
//   OPERATOR_TOKEN  password for operator.html (approve, reject, add questions, push suggestions)
//   STAGE_TOKEN     password for stage.html (read approved questions, mark "asked")
// Tables: questions, live_state (see migrations/001_live.sql)

// Keep in step with public/live-data.js
const VIDEOS = { pmos: "O_aTHJc0Wwg", diabetes: "d3XhaS5lajc" };
const HALLS = Object.keys(VIDEOS);

const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...extra },
  });

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function role(request, env) {
  const auth = request.headers.get("Authorization") || "";
  if (env.OPERATOR_TOKEN && safeEqual(auth, "Bearer " + env.OPERATOR_TOKEN)) return "operator";
  if (env.STAGE_TOKEN && safeEqual(auth, "Bearer " + env.STAGE_TOKEN)) return "stage";
  return null;
}

async function ipHash(request) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("pmos-live|" + ip));
  return [...new Uint8Array(buf)].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const clean = (s, max) => String(s || "").replace(/\s+/g, " ").trim().slice(0, max);

// GET /api/live-count?hall=pmos|diabetes -> { count: number | null }, cached 30 seconds
async function liveCount(request, env, ctx) {
  const hall = new URL(request.url).searchParams.get("hall");
  if (!VIDEOS[hall]) return json({ count: null }, 400);
  if (!env.YT_API_KEY) return json({ count: null });
  const cache = caches.default;
  const key = new Request("https://live-count.internal/" + hall);
  const hit = await cache.match(key);
  if (hit) return new Response(hit.body, { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  let count = null;
  try {
    const res = await fetch(
      "https://www.googleapis.com/youtube/v3/videos?part=liveStreamingDetails&id=" +
        VIDEOS[hall] + "&key=" + encodeURIComponent(env.YT_API_KEY)
    );
    if (res.ok) {
      const d = await res.json();
      const n = d.items && d.items[0] && d.items[0].liveStreamingDetails && d.items[0].liveStreamingDetails.concurrentViewers;
      if (n !== undefined) count = parseInt(n, 10);
    }
  } catch (e) {}
  const body = JSON.stringify({ count });
  ctx.waitUntil(cache.put(key, new Response(body, { headers: { "Cache-Control": "max-age=30" } })));
  return new Response(body, { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

// GET /api/live-state?hall= -> { session: key | null }  (moderator override for suggested questions)
async function liveState(request, env) {
  const hall = new URL(request.url).searchParams.get("hall");
  if (!VIDEOS[hall] || !env.DB) return json({ session: null });
  try {
    const row = await env.DB.prepare("SELECT session_key FROM live_state WHERE hall = ?").bind(hall).first();
    return json({ session: row ? row.session_key : null });
  } catch (e) { return json({ session: null }); }
}

// POST /api/questions { hall, name?, question, website? }
async function postQuestion(request, env) {
  if (!env.DB) return json({ ok: false, error: "Not available." }, 503);
  let b; try { b = await request.json(); } catch (e) { return json({ ok: false, error: "Bad request." }, 400); }
  if (b.website) return json({ ok: true });                       // honeypot: bots fill this
  const hall = String(b.hall || "");
  const question = clean(b.question, 300);
  const name = clean(b.name, 60);
  if (!HALLS.includes(hall)) return json({ ok: false, error: "Choose a hall." }, 400);
  if (question.length < 5) return json({ ok: false, error: "Type your question first." }, 400);
  const ip = await ipHash(request);
  const recent = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM questions WHERE ip_hash = ? AND created_at > datetime('now', '-10 minutes')"
  ).bind(ip).first();
  if (recent && recent.n >= 3) return json({ ok: false, error: "You've sent a few already. Try again in a few minutes." }, 429);
  await env.DB.prepare("INSERT INTO questions (hall, name, question, ip_hash) VALUES (?, ?, ?, ?)")
    .bind(hall, name || null, question, ip).run();
  return json({ ok: true });
}

const COLS = "id, hall, name, question, status, source, datetime(created_at, '+5 hours', '+30 minutes') AS at_ist";

// Operator and stage routes (Bearer token)
async function adminRoutes(request, env, url) {
  const who = role(request, env);
  if (!who) return json({ ok: false, error: "Unauthorized." }, 401);
  if (!env.DB) return json({ ok: false, error: "Not available." }, 503);
  const p = url.pathname;
  const body = request.method === "POST" ? await request.json().catch(() => ({})) : {};

  // GET /api/op/questions?status=new|approved|rejected|asked|all  (operator)
  if (p === "/api/op/questions" && request.method === "GET" && who === "operator") {
    const s = url.searchParams.get("status") || "new";
    const q = s === "all"
      ? `SELECT ${COLS} FROM questions ORDER BY id DESC LIMIT 300`
      : `SELECT ${COLS} FROM questions WHERE status = ? ORDER BY id ${s === "approved" ? "ASC" : "DESC"} LIMIT 300`;
    const st = env.DB.prepare(q);
    const { results } = await (s === "all" ? st : st.bind(s)).all();
    return json({ ok: true, rows: results });
  }
  // POST /api/op/set { id, status }
  if (p === "/api/op/set" && request.method === "POST" && who === "operator") {
    if (!["new", "approved", "rejected", "asked"].includes(body.status)) return json({ ok: false }, 400);
    await env.DB.prepare("UPDATE questions SET status = ?, updated_at = datetime('now') WHERE id = ?")
      .bind(body.status, parseInt(body.id, 10)).run();
    return json({ ok: true });
  }
  // POST /api/op/add { hall, question }  (operator's own question, goes straight to the stage screen)
  if (p === "/api/op/add" && request.method === "POST" && who === "operator") {
    const question = clean(body.question, 300);
    if (!HALLS.includes(body.hall) || question.length < 3) return json({ ok: false }, 400);
    await env.DB.prepare("INSERT INTO questions (hall, name, question, status, source) VALUES (?, 'Moderator', ?, 'approved', 'operator')")
      .bind(body.hall, question).run();
    return json({ ok: true });
  }
  // POST /api/op/state { hall, session }  (push suggested questions for a session; null = automatic)
  if (p === "/api/op/state" && request.method === "POST" && who === "operator") {
    if (!HALLS.includes(body.hall)) return json({ ok: false }, 400);
    await env.DB.prepare(
      "INSERT INTO live_state (hall, session_key, updated_at) VALUES (?, ?, datetime('now')) " +
      "ON CONFLICT(hall) DO UPDATE SET session_key = excluded.session_key, updated_at = excluded.updated_at"
    ).bind(body.hall, body.session ? String(body.session).slice(0, 8) : null).run();
    return json({ ok: true });
  }
  // GET /api/stage/questions -> approved, oldest first  (stage or operator)
  if (p === "/api/stage/questions" && request.method === "GET") {
    const { results } = await env.DB.prepare(
      `SELECT ${COLS} FROM questions WHERE status = 'approved' ORDER BY id ASC LIMIT 100`).all();
    return json({ ok: true, rows: results });
  }
  // POST /api/stage/asked { id }
  if (p === "/api/stage/asked" && request.method === "POST") {
    await env.DB.prepare("UPDATE questions SET status = 'asked', updated_at = datetime('now') WHERE id = ? AND status = 'approved'")
      .bind(parseInt(body.id, 10)).run();
    return json({ ok: true });
  }
  return json({ ok: false, error: "Not found." }, 404);
}

export async function handleLive(request, env, ctx, url) {
  const p = url.pathname;
  if (p === "/api/live-count" && request.method === "GET") return liveCount(request, env, ctx);
  if (p === "/api/live-state" && request.method === "GET") return liveState(request, env);
  if (p === "/api/questions" && request.method === "POST") return postQuestion(request, env);
  if (p.startsWith("/api/op/") || p.startsWith("/api/stage/")) return adminRoutes(request, env, url);
  return null;
}
