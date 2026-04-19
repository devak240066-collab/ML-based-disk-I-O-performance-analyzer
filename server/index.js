const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const dotenv = require('dotenv');
const os = require('os');

dotenv.config();

const PORT = Number(process.env.PORT || 3001);

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || undefined,
  waitForConnections: true,
  connectionLimit: 10,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
});

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

const serverLogs = [];
function log(msg, type = 'info') {
  const entry = {
    id: Date.now() + Math.floor(Math.random() * 1000),
    type,
    msg,
    time: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
  };
  serverLogs.unshift(entry);
  if (serverLogs.length > 200) serverLogs.pop();
  // eslint-disable-next-line no-console
  console.log(`[${entry.time}] [${type}] ${msg}`);
  return entry;
}

async function safeQuery(sql, params = []) {
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.query(sql, params);
    return rows;
  } finally {
    conn.release();
  }
}

// A small CPU snapshot approximation (Windows-friendly)
let lastCpu = null;
function cpuPercent() {
  const cpus = os.cpus();
  const totals = cpus.reduce(
    (acc, c) => {
      const t = c.times;
      const idle = t.idle;
      const total = t.user + t.nice + t.sys + t.irq + t.idle;
      acc.idle += idle;
      acc.total += total;
      return acc;
    },
    { idle: 0, total: 0 }
  );

  if (!lastCpu) {
    lastCpu = totals;
    return 0;
  }
  const idleDelta = totals.idle - lastCpu.idle;
  const totalDelta = totals.total - lastCpu.total;
  lastCpu = totals;
  if (totalDelta <= 0) return 0;
  const usage = 100 * (1 - idleDelta / totalDelta);
  return Math.max(0, Math.min(100, usage));
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, serverTime: new Date().toISOString() });
});

app.get('/api/logs', (req, res) => {
  const limit = Math.max(1, Math.min(200, Number(req.query.limit || 50)));
  res.json({ logs: serverLogs.slice(0, limit) });
});

app.get('/api/mysql/ping', async (_req, res) => {
  try {
    const rows = await safeQuery('SELECT VERSION() AS version');
    res.json({ ok: true, version: rows?.[0]?.version ?? null });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

app.get('/api/mysql/summary', async (_req, res) => {
  try {
    const version = await safeQuery('SELECT VERSION() AS version');
    const status = await safeQuery("SHOW GLOBAL STATUS WHERE Variable_name IN ('Uptime','Threads_connected','Questions','Queries')");
    const vars = Object.fromEntries(status.map((r) => [r.Variable_name, r.Value]));
    res.json({
      ok: true,
      version: version?.[0]?.version ?? null,
      uptimeSeconds: Number(vars.Uptime || 0),
      threadsConnected: Number(vars.Threads_connected || 0),
      questions: Number(vars.Questions || 0),
      queries: Number(vars.Queries || 0),
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// Best-effort I/O summary from performance_schema. If disabled, return an empty list.
app.get('/api/mysql/io', async (req, res) => {
  const limit = Math.max(1, Math.min(50, Number(req.query.limit || 15)));
  try {
    const rows = await safeQuery(
      `
      SELECT
        EVENT_NAME AS eventName,
        COUNT_STAR AS countStar,
        SUM_TIMER_WAIT AS sumTimerWait
      FROM performance_schema.events_waits_summary_global_by_event_name
      WHERE EVENT_NAME LIKE 'wait/io/%'
      ORDER BY SUM_TIMER_WAIT DESC
      LIMIT ?
      `,
      [limit]
    );
    res.json({ ok: true, rows });
  } catch (e) {
    res.json({ ok: true, rows: [], warning: 'performance_schema not available', error: e?.message || String(e) });
  }
});

app.get('/api/metrics/latest', async (_req, res) => {
  // "Disk" metrics are approximations: we use MySQL status deltas as a proxy + CPU usage.
  // If MySQL is down, we still return a payload so the UI can degrade gracefully.
  try {
    const status = await safeQuery(
      "SHOW GLOBAL STATUS WHERE Variable_name IN ('Bytes_received','Bytes_sent','Innodb_data_read','Innodb_data_written','Innodb_rows_read')"
    );
    const m = Object.fromEntries(status.map((r) => [r.Variable_name, Number(r.Value || 0)]));
    res.json({
      ok: true,
      time: new Date().toISOString(),
      cpu: Number(cpuPercent().toFixed(1)),
      // Raw counters (frontend computes deltas)
      mysql: {
        bytesReceived: m.Bytes_received || 0,
        bytesSent: m.Bytes_sent || 0,
        innodbDataRead: m.Innodb_data_read || 0,
        innodbDataWritten: m.Innodb_data_written || 0,
        innodbRowsRead: m.Innodb_rows_read || 0,
      },
    });
  } catch (e) {
    res.status(500).json({
      ok: false,
      time: new Date().toISOString(),
      cpu: Number(cpuPercent().toFixed(1)),
      error: e?.message || String(e),
    });
  }
});

app.listen(PORT, () => {
  log(`API listening on http://localhost:${PORT}`, 'success');
  log('Ready for MySQL telemetry (set server/.env).', 'info');
});

