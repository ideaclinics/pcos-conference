import { onRequestPost, onRequestOptions } from "./register.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/register") {
      if (request.method === "POST") return onRequestPost({ request, env, ctx });
      if (request.method === "OPTIONS") return onRequestOptions();
      return new Response("Method not allowed", { status: 405 });
    }
    return env.ASSETS.fetch(request);
  },
};
