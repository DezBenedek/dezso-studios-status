import htmlContent from './index.html';

async function verifyPassword(password, storedHash) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex === storedHash;
}

async function performCheck(env) {
  let data = await env.STATUS_KV.get("uptime_data", { type: "json" }) || {};
  let sites = await env.STATUS_KV.get("monitored_sites", { type: "json" }) || [];
  const now = Date.now();

  for (const target of sites) {
    if (!data[target.id]) {
      data[target.id] = { name: target.name, url: target.url, detailedLogs: [], incidents: [], lastStatus: null };
    }
    const monitor = data[target.id];
    const startTime = Date.now();
    let result = { status: 0, ok: false, responseTime: 0, time: now };

    try {
      const response = await fetch(target.url, { 
        method: 'GET', 
        headers: { 'User-Agent': 'StatusPulse/1.1' },
        cf: { timeout: 8000 }
      });
      result.status = response.status;
      result.ok = response.status >= 200 && response.status < 400;
      result.responseTime = Date.now() - startTime;
    } catch (e) {
      result.status = "Error";
      result.ok = false;
    }

    const wasOk = monitor.lastStatus?.ok ?? true;
    if (wasOk && !result.ok) {
      monitor.incidents.push({ start: now, end: null, code: result.status });
    } else if (!wasOk && result.ok) {
      const lastInc = monitor.incidents[monitor.incidents.length - 1];
      if (lastInc && !lastInc.end) lastInc.end = now;
    }

    monitor.lastStatus = result;
    monitor.detailedLogs.push(result);
    monitor.detailedLogs = monitor.detailedLogs.filter(l => l.time > now - (7 * 24 * 60 * 60 * 1000));
    if (monitor.incidents.length > 50) monitor.incidents.shift();
  }

  await env.STATUS_KV.put("uptime_data", JSON.stringify(data));
  return data;
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(performCheck(env));
  },

  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.searchParams.get("api") === "true") {
      const data = await env.STATUS_KV.get("uptime_data");
      const sites = await env.STATUS_KV.get("monitored_sites");
      return new Response(JSON.stringify({ data: JSON.parse(data || "{}"), sites: JSON.parse(sites || "[]") }), { 
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } 
      });
    }

    if (request.method === "POST") {
      const body = await request.json();
      const isValid = await verifyPassword(body.password, env.ADMIN_PASSWORD_HASH);
      if (!isValid) return new Response("Unauthorized", { status: 401 });

      if (url.pathname === "/run-check") {
        await performCheck(env);
        return new Response(JSON.stringify({ success: true }));
      }

      if (url.pathname === "/update-sites") {
        await env.STATUS_KV.put("monitored_sites", JSON.stringify(body.sites));
        return new Response(JSON.stringify({ success: true }));
      }
    }

    return new Response(htmlContent, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }
};
