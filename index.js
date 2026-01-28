import htmlContent from './index.html';

const URLS_TO_CHECK = [
  { id: "google", name: "Google", url: "https://www.google.com" },
  { id: "github", name: "GitHub", url: "https://github.com" },
  { id: "facebook", name: "Facebook", url: "https://facebook.com" },
  { id: "hibas-oldal", name: "Teszt Hiba", url: "https://ez-biztosan-nem-letezik.hu" },
  { id: "dezso.hu", name: "dezso.hu", url: "https://www.dezso.hu" }
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
          detailedLogs: [], incidents: [], lastStatus: null
        };
      }

      const monitor = data[target.id];
      const startTime = Date.now();
      let result = { status: 0, ok: false, responseTime: 0, time: now };

      try {
        const response = await fetch(target.url, { 
          method: 'GET', 
          headers: { 
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) StatusPulse/1.1 (compatible; DezsoStudiosBot/1.0)',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
          },
          cf: { timeout: 10000 }
        });
        
        result.status = response.status;
        // Csak a 2xx és 3xx válaszokat vesszük OK-nak
        result.ok = response.status >= 200 && response.status < 400;
        result.responseTime = Date.now() - startTime;
      } catch (e) {
        result.status = "Timeout/Error";
        result.ok = false;
        result.responseTime = 0;
      }

      // Incidens naplózás
      const wasOk = monitor.lastStatus?.ok ?? true;
      if (wasOk && !result.ok) {
        monitor.incidents.push({ start: now, end: null, code: result.status });
      } else if (!wasOk && result.ok) {
        const lastInc = monitor.incidents[monitor.incidents.length - 1];
        if (lastInc && !lastInc.end) lastInc.end = now;
      }

      monitor.lastStatus = result;
      monitor.detailedLogs.push(result);

      // Adatpucolás (ne hizzon túl a KV)
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
        headers: { 
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*" 
        }
      });
    }
    return new Response(htmlContent, {
      headers: { "Content-Type": "text/html; charset=utf-8" }
    });
  }
};
