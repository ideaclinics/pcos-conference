import { onRequestPost, onRequestOptions } from "./register.js";
import { onExport } from "./export.js";
import { handleLive } from "./live.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/register") {
      if (request.method === "POST") return onRequestPost({ request, env, ctx });
      if (request.method === "OPTIONS") return onRequestOptions();
      return new Response("Method not allowed", { status: 405 });
    }

    if (url.pathname === "/api/export" && request.method === "GET") return onExport({ request, env });

    const live = await handleLive(request, env, ctx, url);
    if (live) return live;

    // The old public webinar pages now live on the main page. Temporary redirects (302).
    const LIVE_URL = "https://pmos.ideaclinics.com/#live";
    if (url.hostname.startsWith("foot.")) return Response.redirect(LIVE_URL, 302);
    if (url.pathname === "/webinar.html" || url.pathname === "/webinar") return Response.redirect(LIVE_URL, 302);

    return env.ASSETS.fetch(request);
  },
};
