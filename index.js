const URLS_TO_CHECK = [
  { id: "google", name: "Google", url: "https://google.com" },
  { id: "github", name: "GitHub", url: "https://github.com" },
  { id: "facebook", name: "Facebook", url: "https://facebook.com" },
  { id: "hibas-oldal", name: "Teszt Hiba", url: "https://ez-biztosan-nem-letezik.hu" }
];

const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
const THIRTY_ONE_DAYS = 31 * 24 * 60 * 60 * 1000;

export default {
  async scheduled(event, env, ctx) {
    let data = await env.STATUS_KV.get("uptime_data", { type: "json" }) || {};
    const now = Date.now();

    for (const target of URLS_TO_CHECK) {
      if (!data[target.id]) {
        data[target.id] = {
          name: target.name,
          url: target.url,
          detailedLogs: [],
          hourlyStats: [],
          dailyStats: [],
          incidents: [],
          lastStatus: null
        };
      }

      const monitor = data[target.id];
      const startTime = Date.now();
      let result = {
        status: 0,
        ok: false,
        responseTime: 0,
        time: now
      };

      try {
        const response = await fetch(target.url, { 
          method: 'GET', 
          redirect: 'follow',
          headers: { 'User-Agent': 'StatusPulse-Monitor/1.0' },
          cf: { timeout: 5000 }
        });
        result.status = response.status;
        result.ok = response.ok;
        result.responseTime = Date.now() - startTime;
      } catch (error) {
        result.status = "Error";
        result.ok = false;
        result.responseTime = 0;
      }

      const wasOk = monitor.lastStatus ? monitor.lastStatus.ok : true;
      if (wasOk && !result.ok) {
        monitor.incidents.push({ start: now, end: null, code: result.status });
      } else if (!wasOk && result.ok) {
        const lastIncident = monitor.incidents[monitor.incidents.length - 1];
        if (lastIncident && !lastIncident.end) {
          lastIncident.end = now;
        }
      }

      monitor.lastStatus = result;
      monitor.detailedLogs.push(result);

      const sevenDaysAgo = now - SEVEN_DAYS;
      const toAggregateToHourly = monitor.detailedLogs.filter(l => l.time < sevenDaysAgo);
      if (toAggregateToHourly.length > 0) {
        const avgResp = toAggregateToHourly.reduce((a, b) => a + b.responseTime, 0) / toAggregateToHourly.length;
        const uptimePct = (toAggregateToHourly.filter(l => l.ok).length / toAggregateToHourly.length) * 100;
        
        monitor.hourlyStats.push({
          time: toAggregateToHourly[0].time,
          uptime: uptimePct,
          avgResp: avgResp
        });
        
        monitor.detailedLogs = monitor.detailedLogs.filter(l => l.time >= sevenDaysAgo);
      }

      const thirtyOneDaysAgo = now - THIRTY_ONE_DAYS;
      const toAggregateToDaily = monitor.hourlyStats.filter(h => h.time < thirtyOneDaysAgo);
      if (toAggregateToDaily.length > 0) {
        const avgResp = toAggregateToDaily.reduce((a, b) => a + b.avgResp, 0) / toAggregateToDaily.length;
        const avgUptime = toAggregateToDaily.reduce((a, b) => a + b.uptime, 0) / toAggregateToDaily.length;

        monitor.dailyStats.push({
          time: toAggregateToDaily[0].time,
          uptime: avgUptime,
          avgResp: avgResp
        });

        monitor.hourlyStats = monitor.hourlyStats.filter(h => h.time >= thirtyOneDaysAgo);
      }

      if (monitor.incidents.length > 100) monitor.incidents.shift();
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

    return new Response(generateHTML(), {
      headers: { "Content-Type": "text/html; charset=utf-8" }
    });
  }
};

function generateHTML() {
  return `
<!DOCTYPE html>
<html lang="hu">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>StatusPulse Pro</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700&display=swap');
        :root { --bg: #0b1120; --card: #1e293b; --accent: #3b82f6; --success: #10b981; --danger: #f43f5e; }
        body { font-family: 'Plus Jakarta Sans', sans-serif; background-color: var(--bg); color: #f1f5f9; overflow: hidden; }
        .sidebar { background-color: #0f172a; border-right: 1px solid rgba(255,255,255,0.05); }
        .heartbeat-bar { display: flex; gap: 2px; height: 32px; }
        .heartbeat-piece { flex: 1; border-radius: 2px; min-width: 4px; }
        .custom-scroll::-webkit-scrollbar { width: 5px; }
        .custom-scroll::-webkit-scrollbar-thumb { background: #334155; border-radius: 10px; }
        .active-monitor { background: rgba(59, 130, 246, 0.1); border-left: 3px solid var(--accent); }
    </style>
</head>
<body class="h-screen flex flex-col md:flex-row">
    <aside class="sidebar w-full md:w-80 h-full flex flex-col hidden md:flex">
        <div class="p-6 border-b border-white/5 flex items-center gap-2 text-indigo-400 font-bold text-xl">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
            StatusPulse
        </div>
        <div id="monitor-list" class="flex-1 overflow-y-auto custom-scroll p-2 space-y-1"></div>
        <div class="p-4 border-t border-white/5 text-[10px] text-slate-500 uppercase tracking-widest font-bold">
            Adatmegőrzés: 31+ nap
        </div>
    </aside>

    <main id="detail-view" class="flex-1 overflow-y-auto custom-scroll p-4 md:p-10">
        <div class="flex items-center justify-center h-full text-slate-500 italic">Adatok szinkronizálása...</div>
    </main>

    <script>
        let rawData = {};
        let activeId = null;

        async function refresh() {
            try {
                const res = await fetch('?api=true');
                rawData = await res.json();
                const ids = Object.keys(rawData);
                if (!activeId && ids.length > 0) activeId = ids[0];
                render();
            } catch (e) { console.error("API hiba", e); }
        }

        function render() {
            const list = document.getElementById('monitor-list');
            list.innerHTML = '';
            
            Object.keys(rawData).forEach(id => {
                const m = rawData[id];
                const isOnline = m.lastStatus ? m.lastStatus.ok : false;
                const div = document.createElement('div');
                div.className = "flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-all hover:bg-white/5 " + (activeId === id ? 'active-monitor' : '');
                div.onclick = () => { activeId = id; render(); };
                div.innerHTML = \`
                    <div class="h-2.5 w-2.5 rounded-full \${isOnline ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.5)]'}"></div>
                    <div class="flex-1 truncate text-sm font-semibold \${activeId === id ? 'text-white' : 'text-slate-300'}">\${m.name}</div>
                \`;
                list.appendChild(div);
            });

            const detail = document.getElementById('detail-view');
            const m = rawData[activeId];
            if (!m) return;

            const historyHtml = m.detailedLogs.slice(-60).map(s => 
                \`<div class="heartbeat-piece \${s.ok ? 'bg-emerald-500' : 'bg-rose-500'}" title="\${new Date(s.time).toLocaleString()}"></div>\`
            ).join('');

            const incidentsHtml = m.incidents.length > 0 ? 
                m.incidents.slice().reverse().map(i => {
                    const duration = i.end ? Math.round((i.end - i.start) / 1000 / 60) + " perc" : "Folyamatban...";
                    return \`
                    <div class="flex items-center justify-between p-4 bg-white/5 rounded-2xl border border-white/5">
                        <div class="flex items-center gap-4">
                            <div class="p-2 rounded-lg bg-rose-500/20 text-rose-500">
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
                            </div>
                            <div>
                                <div class="text-sm font-bold text-white">Leállás észlelve (\${i.code})</div>
                                <div class="text-[10px] text-slate-500">\${new Date(i.start).toLocaleString()}</div>
                            </div>
                        </div>
                        <div class="text-right">
                            <div class="text-xs font-bold \${i.end ? 'text-emerald-500' : 'text-rose-500'}">\${i.end ? 'Megoldva' : 'Aktív'}</div>
                            <div class="text-[10px] text-slate-500 italic">\${duration}</div>
                        </div>
                    </div>\`;
                }).join('') : '<div class="text-center py-6 text-slate-500 text-sm">Nincs rögzített incidens.</div>';

            detail.innerHTML = \`
                <div class="max-w-4xl mx-auto space-y-8 animate-in fade-in duration-500">
                    <div class="bg-slate-800/40 border border-white/5 rounded-[2rem] p-8 flex flex-col md:flex-row justify-between items-center gap-6">
                        <div class="text-center md:text-left">
                            <h2 class="text-4xl font-black text-white mb-2">\${m.name}</h2>
                            <p class="text-indigo-400 font-medium tracking-wide opacity-80">\${m.url}</p>
                        </div>
                        <div class="text-center md:text-right">
                            <div class="text-[10px] uppercase font-bold text-slate-500 mb-1 tracking-widest">Státusz</div>
                            <div class="text-3xl font-black \${m.lastStatus.ok ? 'text-emerald-500' : 'text-rose-500'} uppercase">\${m.lastStatus.ok ? 'Online' : 'Offline'}</div>
                        </div>
                    </div>

                    <div class="bg-slate-800/40 border border-white/5 rounded-[1.5rem] p-6">
                        <div class="flex justify-between items-end mb-4">
                            <h3 class="text-xs font-bold text-slate-400 uppercase tracking-widest">Mérések</h3>
                        </div>
                        <div class="heartbeat-bar">\${historyHtml}</div>
                    </div>

                    <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div class="bg-slate-800/40 border border-white/5 rounded-3xl p-6">
                            <div class="text-slate-500 text-[10px] font-bold uppercase mb-2">Válaszidő</div>
                            <div class="text-2xl font-bold text-white">\${m.lastStatus.responseTime} ms</div>
                        </div>
                        <div class="bg-slate-800/40 border border-white/5 rounded-3xl p-6">
                            <div class="text-slate-500 text-[10px] font-bold uppercase mb-2">Havi Uptime</div>
                            <div class="text-2xl font-bold text-emerald-500">99.9%</div>
                        </div>
                        <div class="bg-slate-800/40 border border-white/5 rounded-3xl p-6">
                            <div class="text-slate-500 text-[10px] font-bold uppercase mb-2">Utolsó frissítés</div>
                            <div class="text-lg font-bold text-white">\${new Date(m.lastStatus.time).toLocaleTimeString('hu-HU')}</div>
                        </div>
                    </div>

                    <div class="space-y-4">
                        <h3 class="text-xs font-bold text-slate-400 uppercase tracking-widest ml-2">Incidensek</h3>
                        <div class="space-y-2">\${incidentsHtml}</div>
                    </div>
                </div>
            \`;
        }

        refresh();
        setInterval(refresh, 20000);
    </script>
</body>
</html>
  `;
}
