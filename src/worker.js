import { onRequestPost, onRequestOptions } from "./register.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/register") {
      if (request.method === "POST") return onRequestPost({ request, env, ctx });
      if (request.method === "OPTIONS") return onRequestOptions();
      return new Response("Method not allowed", { status: 405 });
    }

    // foot.ideaclinics.com serves the page in /foot/ at its root.
    if (url.hostname.startsWith("foot.") && (url.pathname === "/" || url.pathname === "/index.html")) {
      url.pathname = "/foot/";
      return env.ASSETS.fetch(new Request(url.toString(), request));
    }

    return env.ASSETS.fetch(request);
  },
};
