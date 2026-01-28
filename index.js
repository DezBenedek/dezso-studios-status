import htmlContent from './index.html';

const URLS_TO_CHECK = [
  { id: "google", name: "Google", url: "https://www.google.com" },
  { id: "github", name: "GitHub", url: "https://github.com" },
  { id: "facebook", name: "Facebook", url: "https://facebook.com" },
  { id: "hibas-oldal", name: "Teszt Hiba", url: "https://ez-biztosan-nem-letezik.hu" },
  { id: "dezso.hu", name: "dezso.hu", url: "https://www.dezso.hu" },
  { id: "dezsocloud", name: "DezsoCloud", url: "https://cloud.dezso.hu" }
];

const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

// Segédfüggvény a jelszó ellenőrzéséhez (SHA-256)
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
  const now = Date.now();

  for (const target of URLS_TO_CHECK) {
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
    monitor.detailedLogs = monitor.detailedLogs.filter(l => l.time > now - SEVEN_DAYS);
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

    // API Adatlekérés
    if (url.searchParams.get("api") === "true") {
      const data = await env.STATUS_KV.get("uptime_data");
      return new Response(data || "{}", { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
    }

    // MANUÁLIS CHECK INDÍTÁSA (POST kéréssel és jelszóval)
    if (url.pathname === "/run-check" && request.method === "POST") {
      const { password } = await request.json();
      const isValid = await verifyPassword(password, env.ADMIN_PASSWORD_HASH);
      
      if (!isValid) return new Response("Helytelen jelszó!", { status: 401 });
      
      const newData = await performCheck(env);
      return new Response(JSON.stringify({ success: true, data: newData }), { headers: { "Content-Type": "application/json" } });
    }

    return new Response(htmlContent, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }
};
