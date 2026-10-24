// GET /api/export  (Authorization: Bearer <EXPORT_TOKEN>)
// Returns all registrations as JSON for the hourly Google Sheets sync.
// Disabled unless the EXPORT_TOKEN secret is set on the Worker.

const COLUMNS = [
  "id", "created_at_ist", "form_type", "full_name", "mobile", "email", "city", "state",
  "institution", "professional_category", "medical_reg_number", "years_of_practice",
  "dietary_preference", "topic_interest", "wants_case_discussion", "wants_updates", "acknowledged",
];

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export async function onExport({ request, env }) {
  if (!env.EXPORT_TOKEN || !env.DB) return json({ ok: false, error: "Export not configured." }, 404);
  const auth = request.headers.get("Authorization") || "";
  if (!safeEqual(auth, "Bearer " + env.EXPORT_TOKEN)) return json({ ok: false, error: "Unauthorized." }, 401);

  const { results } = await env.DB.prepare(
    `SELECT id, datetime(created_at, '+5 hours', '+30 minutes') AS created_at_ist, form_type, full_name,
            mobile, email, city, state, institution, professional_category, medical_reg_number,
            years_of_practice, dietary_preference, topic_interest, wants_case_discussion,
            wants_updates, acknowledged
       FROM registrations ORDER BY id ASC`
  ).all();
  return json({ ok: true, columns: COLUMNS, rows: results }, 200);
}
