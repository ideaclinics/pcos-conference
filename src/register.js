// POST /api/register -> writes conference/webinar registrations to D1 (binding: DB)
const REQUIRED_BASE = ["form_type", "full_name", "mobile"];
const FORM_TYPES = ["conference", "webinar", "foot_doctor", "foot_public"];
// Email is mandatory for every form except the public foot webcast.
const EMAIL_OPTIONAL = ["foot_public"];

// Sends the WhatsApp template named in INTERAKT_TEMPLATE via Interakt. Runs only if the
// INTERAKT_API_KEY secret and INTERAKT_TEMPLATE variable are set and the person opted in. Never blocks signup.
// ---------------------------------------------------------------------------
// WhatsApp confirmation (Interakt) and its audit log
//
// After a webinar signup is saved, sendWhatsApp() sends the approved Interakt
// template (name in env.INTERAKT_TEMPLATE, e.g. "pmos_webinar") to the person.
// Every attempt, including skipped ones, is recorded in D1 table `message_log`
// so a missing message can be diagnosed with:
//   SELECT * FROM message_log ORDER BY id DESC LIMIT 10;
//
// Required Worker settings (Cloudflare > pcos-conference > Settings):
//   INTERAKT_API_KEY   (Secret)    base64 API key from Interakt Developer Settings
//   INTERAKT_TEMPLATE  (Variable)  approved template name
// Table: message_log(id, mobile, outcome, http_status, response, created_at)
// WhatsApp failures never block or fail the signup itself.
// ---------------------------------------------------------------------------

// Writes one row to message_log. Errors are swallowed on purpose.
async function logMessage(env, mobile, outcome, status, response) {
  try {
    await env.DB.prepare(
      "INSERT INTO message_log (mobile, outcome, http_status, response) VALUES (?, ?, ?, ?)"
    ).bind(mobile, outcome, status || null, String(response || "").slice(0, 500)).run();
  } catch (e) {}
}

// Sends the WhatsApp template for a webinar signup, or logs why it was skipped.
async function sendWhatsApp(env, data) {
  if (data.form_type !== "webinar") return;
  const mobile = String(data.mobile);
  if (!data.wants_updates) return logMessage(env, mobile, "skipped: WhatsApp box not ticked");
  // Diagnostic: list setting NAMES (never values) so a missing one is easy to spot.
  const seen = Object.keys(env).sort().join(", ");
  if (!env.INTERAKT_API_KEY) return logMessage(env, mobile, "skipped: INTERAKT_API_KEY secret missing", null, "Worker sees: " + seen);
  if (!env.INTERAKT_TEMPLATE) return logMessage(env, mobile, "skipped: INTERAKT_TEMPLATE variable missing", null, "Worker sees: " + seen);
  let digits = mobile.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  if (digits.length !== 10) return logMessage(env, mobile, "skipped: not a 10-digit Indian number");
  const firstName = String(data.full_name).trim().split(/\s+/)[0] || "there";
  try {
    const res = await fetch("https://api.interakt.ai/v1/public/message/", {
      method: "POST",
      headers: {
        Authorization: "Basic " + env.INTERAKT_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        countryCode: "+91",
        phoneNumber: digits,
        callbackData: "pmos_webinar_signup",
        type: "Template",
        template: {
          name: env.INTERAKT_TEMPLATE,
          languageCode: "en",
          bodyValues: [firstName],
        },
      }),
    });
    await logMessage(env, mobile, res.ok ? "sent to Interakt" : "Interakt rejected", res.status, await res.text());
  } catch (e) {
    await logMessage(env, mobile, "network error", null, e && e.message);
  }
}

function cors(resp) {
  resp.headers.set("Access-Control-Allow-Origin", "*");
  resp.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  resp.headers.set("Access-Control-Allow-Headers", "Content-Type");
  return resp;
}

export async function onRequestOptions() {
  return cors(new Response(null, { status: 204 }));
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.DB) {
    return cors(
      new Response(
        JSON.stringify({
          ok: false,
          error: "Database not configured. Add a D1 binding named DB to this Pages project.",
        }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      )
    );
  }

  let data;
  try {
    data = await request.json();
  } catch (e) {
    return cors(
      new Response(JSON.stringify({ ok: false, error: "Invalid JSON body." }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      })
    );
  }

  for (const field of REQUIRED_BASE) {
    if (!data[field] || String(data[field]).trim() === "") {
      return cors(
        new Response(JSON.stringify({ ok: false, error: `Missing required field: ${field}` }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        })
      );
    }
  }

  if (!FORM_TYPES.includes(data.form_type)) {
    return cors(
      new Response(JSON.stringify({ ok: false, error: "Invalid form_type." }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      })
    );
  }

  if (!EMAIL_OPTIONAL.includes(data.form_type) && (!data.email || String(data.email).trim() === "")) {
    return cors(
      new Response(JSON.stringify({ ok: false, error: "Missing required field: email" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      })
    );
  }

  const userAgent = request.headers.get("User-Agent") || "";

  try {
    await env.DB.prepare(
      `INSERT INTO registrations
        (form_type, full_name, email, mobile, city, state, institution,
         professional_category, medical_reg_number, years_of_practice,
         dietary_preference, wants_case_discussion, wants_updates,
         topic_interest, acknowledged, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        data.form_type,
        data.full_name,
        data.email || "",
        data.mobile,
        data.city || null,
        data.state || null,
        data.institution || null,
        data.professional_category || null,
        data.medical_reg_number || null,
        data.years_of_practice || null,
        data.dietary_preference || null,
        data.wants_case_discussion ? 1 : 0,
        data.wants_updates ? 1 : 0,
        data.topic_interest || null,
        data.acknowledged ? 1 : 0,
        userAgent
      )
      .run();

    if (context.ctx && context.ctx.waitUntil) context.ctx.waitUntil(sendWhatsApp(env, data));
    return cors(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
  } catch (err) {
    return cors(
      new Response(JSON.stringify({ ok: false, error: "Database write failed." }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      })
    );
  }
}
