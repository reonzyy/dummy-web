// dummy.js — flood test target with a live dashboard
'use strict';

const http = require('http');
const os = require('os');

const PORT = process.env.PORT || 3000;
const startTime = Date.now();

// ─── Metrics store ────────────────────────────────────────────
const stats = {
    total: 0,
    paths: new Map(),
    ips: new Map(),
    uas: new Map(),
    statuses: new Map(),
    rps: [],                       // last 60 seconds
    currentSecond: { t: Math.floor(Date.now() / 1000), count: 0 },
    peakRps: 0,
    bytesOut: 0,
    started: startTime,
};

function bump(map, key, n = 1) { map.set(key, (map.get(key) || 0) + n); }
function topN(map, n = 10) { return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n); }

// per-second rolling window
setInterval(() => {
    const now = Math.floor(Date.now() / 1000);
    if (now !== stats.currentSecond.t) {
        stats.rps.push(stats.currentSecond.count);
        if (stats.rps.length > 60) stats.rps.shift();
        if (stats.currentSecond.count > stats.peakRps) stats.peakRps = stats.currentSecond.count;
        stats.currentSecond = { t: now, count: 0 };
    }
}, 500);

// ─── Dashboard HTML ───────────────────────────────────────────
const DASHBOARD = `<!doctype html>
<html><head>
<meta charset="utf-8">
<title>dummy target — live stats</title>
<style>
  :root { --bg:#0a0e14; --fg:#d4d4d4; --grn:#4ec9b0; --ylw:#dcdcaa; --red:#f48771; --blue:#569cd6; --dim:#666; }
  * { box-sizing: border-box; }
  body { background:var(--bg); color:var(--fg); font-family: ui-monospace, Menlo, Consolas, monospace; margin:0; padding:20px; font-size:14px; }
  h1 { color:var(--grn); font-size:18px; margin:0 0 4px 0; }
  .sub { color:var(--dim); font-size:12px; margin-bottom:20px; }
  .grid { display:grid; grid-template-columns: repeat(auto-fit, minmax(200px,1fr)); gap:16px; margin-bottom:20px; }
  .card { background:#11161f; border:1px solid #1e2633; border-radius:6px; padding:14px; }
  .card h2 { color:var(--blue); font-size:11px; text-transform:uppercase; letter-spacing:1px; margin:0 0 8px 0; font-weight:600; }
  .big { font-size:26px; color:var(--ylw); font-weight:bold; }
  .unit { font-size:12px; color:var(--dim); margin-left:4px; }
  table { width:100%; border-collapse:collapse; font-size:12px; }
  td { padding:3px 0; color:var(--fg); }
  td:last-child { text-align:right; color:var(--ylw); }
  .bar { height:8px; background:#1e2633; border-radius:2px; overflow:hidden; margin-top:6px; }
  .bar > div { height:100%; background:var(--grn); transition:width .2s; }
  .spark { display:flex; gap:1px; align-items:flex-end; height:40px; margin-top:8px; }
  .spark > div { flex:1; background:var(--grn); min-height:1px; }
  .err { color:var(--red); }
  .ok { color:var(--grn); }
</style>
</head><body>
<h1>dummy target</h1>
<div class="sub" id="sub">connecting…</div>

<div class="grid">
  <div class="card">
    <h2>Total requests</h2>
    <div class="big" id="total">0</div>
  </div>
  <div class="card">
    <h2>Current rps</h2>
    <div class="big" id="rps">0<span class="unit">/s</span></div>
    <div class="bar"><div id="rpsbar" style="width:0%"></div></div>
  </div>
  <div class="card">
    <h2>Peak rps</h2>
    <div class="big" id="peak">0<span class="unit">/s</span></div>
  </div>
  <div class="card">
    <h2>Uptime</h2>
    <div class="big" id="uptime">0<span class="unit">s</span></div>
  </div>
  <div class="card">
    <h2>RSS memory</h2>
    <div class="big" id="mem">0<span class="unit">MB</span></div>
  </div>
  <div class="card">
    <h2>Load avg (1m)</h2>
    <div class="big" id="load">0</div>
  </div>
</div>

<div class="grid">
  <div class="card">
    <h2>Last 60 seconds</h2>
    <div class="spark" id="spark"></div>
  </div>
  <div class="card">
    <h2>Status codes</h2>
    <table id="statuses"></table>
  </div>
</div>

<div class="grid">
  <div class="card">
    <h2>Top paths</h2>
    <table id="paths"></table>
  </div>
  <div class="card">
    <h2>Top IPs</h2>
    <table id="ips"></table>
  </div>
  <div class="card">
    <h2>Top user-agents</h2>
    <table id="uas"></table>
  </div>
</div>

<script>
async function refresh() {
  try {
    const r = await fetch('/api/stats');
    const d = await r.json();
    document.getElementById('total').textContent = d.total.toLocaleString();
    document.getElementById('rps').innerHTML = d.currentRps + '<span class="unit">/s</span>';
    document.getElementById('peak').innerHTML = d.peakRps + '<span class="unit">/s</span>';
    document.getElementById('uptime').innerHTML = d.uptime + '<span class="unit">s</span>';
    document.getElementById('mem').innerHTML = d.memory + '<span class="unit">MB</span>';
    document.getElementById('load').textContent = d.load.toFixed(2);
    document.getElementById('sub').textContent = 'target: ' + location.host + ' — live';

    const pct = d.peakRps > 0 ? Math.min(100, (d.currentRps / d.peakRps) * 100) : 0;
    document.getElementById('rpsbar').style.width = pct + '%';

    const max = Math.max(...d.rpsHistory, 1);
    document.getElementById('spark').innerHTML = d.rpsHistory.map(v =>
      '<div style="height:' + Math.max(1, (v/max)*40) + 'px"></div>'
    ).join('');

    document.getElementById('statuses').innerHTML = d.statuses
      .map(([k,v]) => '<tr><td>' + k + '</td><td>' + v.toLocaleString() + '</td></tr>').join('');
    document.getElementById('paths').innerHTML = d.topPaths
      .map(([k,v]) => '<tr><td>' + escapeHtml(k).slice(0,50) + '</td><td>' + v.toLocaleString() + '</td></tr>').join('');
    document.getElementById('ips').innerHTML = d.topIps
      .map(([k,v]) => '<tr><td>' + k + '</td><td>' + v.toLocaleString() + '</td></tr>').join('');
    document.getElementById('uas').innerHTML = d.topUAs
      .map(([k,v]) => '<tr><td>' + escapeHtml(k).slice(0,40) + '</td><td>' + v.toLocaleString() + '</td></tr>').join('');
  } catch(e) {
    document.getElementById('sub').textContent = 'disconnected: ' + e.message;
  }
}
function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
refresh();
setInterval(refresh, 1000);
</script>
</body></html>`;

// ─── HTTP server ──────────────────────────────────────────────
const server = http.createServer((req, res) => {
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
        || req.headers['x-real-ip']
        || req.socket.remoteAddress
        || 'unknown';
    const ua = (req.headers['user-agent'] || 'unknown').slice(0, 60);
    const path = req.url.split('?')[0];

    stats.total++;
    stats.currentSecond.count++;
    bump(stats.paths, path);
    bump(stats.ips, ip);
    bump(stats.uas, ua);

    // ── /api/stats — JSON for the dashboard ──────────────
    if (path === '/api/stats') {
        bump(stats.statuses, '200');
        const avgRps = stats.rps.length
            ? Math.round(stats.rps.reduce((a, b) => a + b, 0) / stats.rps.length)
            : 0;
        const body = JSON.stringify({
            total: stats.total,
            currentRps: stats.currentSecond.count,
            avgRps,
            peakRps: stats.peakRps,
            rpsHistory: stats.rps.slice(-60),
            uptime: Math.round((Date.now() - startTime) / 1000),
            memory: Math.round(process.memoryUsage().rss / 1024 / 1024),
            load: os.loadavg()[0],
            topPaths: topN(stats.paths, 10),
            topIps: topN(stats.ips, 10),
            topUAs: topN(stats.uas, 5),
            statuses: [...stats.statuses.entries()].sort((a, b) => b[1] - a[1]),
        });
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        stats.bytesOut += Buffer.byteLength(body);
        return res.end(body);
    }

    // ── /api/reset — clear counters ──────────────────────
    if (path === '/api/reset' && req.method === 'POST') {
        stats.total = 0;
        stats.paths.clear();
        stats.ips.clear();
        stats.uas.clear();
        stats.statuses.clear();
        stats.rps = [];
        stats.peakRps = 0;
        stats.currentSecond = { t: Math.floor(Date.now() / 1000), count: 0 };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end('{"ok":true}');
    }

    // ── /health — cheap endpoint ─────────────────────────
    if (path === '/health') {
        bump(stats.statuses, '200');
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        return res.end('ok');
    }

    // ── / (dashboard) ────────────────────────────────────
    if (path === '/') {
        bump(stats.statuses, '200');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        stats.bytesOut += Buffer.byteLength(DASHBOARD);
        return res.end(DASHBOARD);
    }

    // ── everything else: 404 (mimics a real site) ────────
    bump(stats.statuses, '404');
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('not found');
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`[dummy] listening on 0.0.0.0:${PORT}`);
    console.log(`[dummy] dashboard: http://localhost:${PORT}/`);
});

// ─── Periodic server-side logging ─────────────────────────────
setInterval(() => {
    const cur = stats.currentSecond.count;
    if (cur > 0) {
        console.log(`[dummy] rps=${cur} total=${stats.total} peak=${stats.peakRps} rss=${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB`);
    }
}, 1000);