// Importáljuk a HTML-t szövegként a Wrangler segítségével
import htmlContent from './index.html';

const URLS_TO_CHECK = [
  { id: "google", name: "Google", url: "https://google.com" },
  { id: "github", name: "GitHub", url: "https://github.com" },
  { id: "facebook", name: "Facebook", url: "https://facebook.com" },
  { id: "hibas-oldal", name: "Teszt Hiba", url: "https://ez-biztosan-nem-letezik.hu" }
];

const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

export default {
  async scheduled(event, env, ctx) {
    let data = await env.STATUS_KV.get("uptime_data", { type: "json" }) || {};
    const now = Date.now();

    for (const target of URLS_TO_CHECK) {
      if (!data[target.id]) {
        data[target.id] = {
          name: target.name, url: target.url,
          detailedLogs: [], hourlyStats: [], incidents: [], lastStatus: null
        };
      }

      const monitor = data[target.id];
      const startTime = Date.now();
      let result = { status: 0, ok: false, responseTime: 0, time: now };

      try {
        const response = await fetch(target.url, { 
          method: 'GET', 
          headers: { 'User-Agent': 'StatusPulse/1.0' },
          cf: { timeout: 5000 }
        });
        result.status = response.status;
        result.ok = response.ok;
        result.responseTime = Date.now() - startTime;
      } catch (e) {
        result.status = "Error";
        result.ok = false;
      }

      // Incidens kezelés
      const wasOk = monitor.lastStatus?.ok ?? true;
      if (wasOk && !result.ok) {
        monitor.incidents.push({ start: now, end: null, code: result.status });
      } else if (!wasOk && result.ok) {
        const lastInc = monitor.incidents[monitor.incidents.length - 1];
        if (lastInc && !lastInc.end) lastInc.end = now;
      }

      monitor.lastStatus = result;
      monitor.detailedLogs.push(result);

      // Tisztítás: csak az utolsó 7 nap adatait tartsuk meg a KV-ben a méretlimit miatt
      const limit = now - SEVEN_DAYS;
      monitor.detailedLogs = monitor.detailedLogs.filter(l => l.time > limit);
      if (monitor.incidents.length > 50) monitor.incidents.shift();
    }

    await env.STATUS_KV.put("uptime_data", JSON.stringify(data));
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.searchParams.get("api") === "true") {
      const data = await env.STATUS_KV.get("uptime_data");
      return new Response(data || "{}", {
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });
    }
    // Kiszolgáljuk az importált HTML-t
    return new Response(htmlContent, {
      headers: { "Content-Type": "text/html; charset=utf-8" }
    });
  }
};
