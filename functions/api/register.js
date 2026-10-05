// Cloudflare Pages Function: POST /api/register
// Accepts a registration from either the conference form (form_type: "conference")
// or the public webinar form (form_type: "webinar") and writes it to D1.
//
// Requires a D1 binding named DB on this Pages project, pointing at the
// "pmos-registrations" database. Set this once in:
//   Cloudflare dashboard → Workers & Pages → pcos-conference → Settings → Functions
//   → D1 database bindings → Add binding → Variable name: DB → Database: pmos-registrations

const REQUIRED_BASE = ["form_type", "full_name", "email", "mobile"];

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

  if (!["conference", "webinar"].includes(data.form_type)) {
    return cors(
      new Response(JSON.stringify({ ok: false, error: "Invalid form_type." }), {
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
        data.email,
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
