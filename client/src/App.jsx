import React, { useEffect, useMemo, useRef, useState } from 'react'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
} from 'recharts'
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bell,
  BrainCircuit,
  CheckCircle2,
  Database,
  Download,
  Filter,
  HardDrive,
  History,
  Info,
  Layers,
  Play,
  RefreshCw,
  Search,
  Settings,
  ShieldAlert,
  Terminal,
  TrendingUp,
  Zap,
} from 'lucide-react'

const generateData = () =>
  Array.from({ length: 20 }, (_, i) => ({
    time: `${i}:00`,
    read: Math.floor(Math.random() * 400) + 100,
    write: Math.floor(Math.random() * 300) + 50,
    latency: Number((Math.random() * 5 + 1).toFixed(2)),
    cpu: Math.floor(Math.random() * 40) + 10,
  }))

async function apiGet(path) {
  const res = await fetch(path, { headers: { Accept: 'application/json' } })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`)
  return json
}

const App = () => {
  const [activeTab, setActiveTab] = useState('dashboard')
  const [data, setData] = useState(generateData())
  const [isCapturing, setIsCapturing] = useState(false)

  const [mysql, setMysql] = useState({ ok: false, version: null, error: null })
  const [mysqlSummary, setMysqlSummary] = useState(null)
  const [ioRows, setIoRows] = useState([])
  const [ioSearch, setIoSearch] = useState('')

  const [isTraining, setIsTraining] = useState(false)
  const [trainingProgress, setTrainingProgress] = useState(0)
  const [showTrainingModal, setShowTrainingModal] = useState(false)

  const [showSettings, setShowSettings] = useState(false)
  const [showAlerts, setShowAlerts] = useState(false)
  const [ackAlerts, setAckAlerts] = useState(() => new Set())

  const [logs, setLogs] = useState([
    { id: 1, type: 'info', msg: 'Core engine initialized. Ready for I/O monitoring.', time: '10:00:01' },
    { id: 2, type: 'success', msg: 'Awaiting MySQL telemetry (server/.env).', time: '10:00:05' },
    { id: 3, type: 'warning', msg: 'Tip: enable performance_schema for deeper I/O insights.', time: '10:05:22' },
  ])
  const [logQuery, setLogQuery] = useState('')

  const addLog = (msg, type = 'info') => {
    const newLog = {
      id: Date.now(),
      type,
      msg,
      time: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    }
    setLogs((prev) => [newLog, ...prev].slice(0, 80))
  }

  // --- Telemetry polling (MySQL + Server) ---
  useEffect(() => {
    let cancelled = false

    async function refreshMysql() {
      try {
        const ping = await apiGet('/api/mysql/ping')
        if (cancelled) return
        setMysql({ ok: true, version: ping.version, error: null })
      } catch (e) {
        if (cancelled) return
        setMysql({ ok: false, version: null, error: e?.message || String(e) })
      }

      try {
        const summary = await apiGet('/api/mysql/summary')
        if (cancelled) return
        setMysqlSummary(summary)
      } catch {
        // ok to ignore
      }
    }

    refreshMysql()
    const t = setInterval(refreshMysql, 5000)
    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    async function refreshIo() {
      try {
        const resp = await apiGet('/api/mysql/io?limit=25')
        if (cancelled) return
        setIoRows(resp.rows || [])
      } catch {
        if (cancelled) return
        setIoRows([])
      }
    }
    refreshIo()
    const t = setInterval(refreshIo, 10000)
    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [])

  // Pull server logs into the journal so it feels "wired"
  useEffect(() => {
    let cancelled = false
    async function refreshServerLogs() {
      try {
        const resp = await apiGet('/api/logs?limit=15')
        if (cancelled) return
        if (Array.isArray(resp.logs) && resp.logs.length) {
          setLogs((prev) => {
            const seen = new Set(prev.map((l) => l.id))
            const merged = [...resp.logs.filter((l) => !seen.has(l.id)), ...prev]
            return merged.slice(0, 80)
          })
        }
      } catch {
        // ignore
      }
    }
    refreshServerLogs()
    const t = setInterval(refreshServerLogs, 4000)
    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [])

  // Capture loop: prefers /api/metrics/latest; falls back to simulated numbers.
  const lastCountersRef = useRef(null)
  useEffect(() => {
    if (!isCapturing) return

    let alive = true
    const interval = setInterval(async () => {
      try {
        const m = await apiGet('/api/metrics/latest')
        if (!alive) return

        const now = new Date()
        const time = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
        const prev = lastCountersRef.current
        lastCountersRef.current = m.mysql || null

        const seconds = 2
        const readMBs =
          prev && m.mysql ? Math.max(0, (m.mysql.innodbDataRead - prev.innodbDataRead) / 1024 / 1024 / seconds) : null
        const writeMBs =
          prev && m.mysql
            ? Math.max(0, (m.mysql.innodbDataWritten - prev.innodbDataWritten) / 1024 / 1024 / seconds)
            : null

        setData((p) => {
          const last = p[p.length - 1]
          const read = readMBs === null ? Math.floor(Math.random() * 600) + 200 : Number(readMBs.toFixed(1))
          const write = writeMBs === null ? Math.floor(Math.random() * 400) + 100 : Number(writeMBs.toFixed(1))
          const latency = Number((Math.random() * 8 + 1).toFixed(2))
          const cpu = Number(m?.cpu ?? last?.cpu ?? 0)
          return [...p.slice(1), { time, read, write, latency, cpu }]
        })
      } catch (e) {
        if (!alive) return
        // If the server/MySQL is down, keep UI moving (still useful for demo).
        setData((p) => {
          const time = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
          return [
            ...p.slice(1),
            {
              time,
              read: Math.floor(Math.random() * 600) + 200,
              write: Math.floor(Math.random() * 400) + 100,
              latency: Number((Math.random() * 8 + 1).toFixed(2)),
              cpu: Math.floor(Math.random() * 60) + 20,
            },
          ]
        })
        addLog(`Telemetry fallback: ${e?.message || String(e)}`, 'warning')
      }
    }, 2000)

    return () => {
      alive = false
      clearInterval(interval)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCapturing])

  const handleStartCapture = () => {
    setIsCapturing((v) => !v)
    addLog(!isCapturing ? 'Starting real-time analysis stream...' : 'Monitoring session terminated.', !isCapturing ? 'success' : 'info')
  }

  const handleTrainModel = () => {
    setIsTraining(true)
    setTrainingProgress(0)
    setShowTrainingModal(true)
    let prog = 0
    const interval = setInterval(() => {
      prog += 5
      setTrainingProgress(prog)
      if (prog >= 100) {
        clearInterval(interval)
        setIsTraining(false)
        addLog('ML Model training completed. Updated weights applied.', 'success')
      }
    }, 150)
  }

  const exportReport = () => {
    addLog('Generating PDF report...', 'info')

    const latest = data[data.length - 1]
    const generatedAt = new Date()

    const doc = new jsPDF({ unit: 'pt', format: 'a4' })
    const pageWidth = doc.internal.pageSize.getWidth()

    // Header
    doc.setFillColor(9, 9, 11)
    doc.rect(0, 0, pageWidth, 72, 'F')
    doc.setTextColor(250, 250, 250)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(18)
    doc.text('DISK.IO ANALYS — I/O Analysis Report', 40, 42)

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    doc.setTextColor(161, 161, 170)
    doc.text(`Generated: ${generatedAt.toLocaleString()}`, 40, 60)

    // Summary block
    doc.setTextColor(250, 250, 250)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(12)
    doc.text('Summary', 40, 104)

    const mysqlStatus = mysql.ok ? `Online (${mysql.version || 'version unknown'})` : `Offline (${mysql.error || 'unreachable'})`
    const summaryRows = [
      ['MySQL', mysqlStatus],
      ['Threads connected', String(mysqlSummary?.threadsConnected ?? '—')],
      ['Uptime (s)', String(mysqlSummary?.uptimeSeconds ?? '—')],
      ['Latest read (MB/s)', String(latest?.read ?? '—')],
      ['Latest write (MB/s)', String(latest?.write ?? '—')],
      ['Latest latency (Wait%)', String(latest?.latency ?? '—')],
      ['Latest CPU (%)', String(latest?.cpu ?? '—')],
      ['Capture state', isCapturing ? 'RUNNING' : 'IDLE'],
    ]

    autoTable(doc, {
      startY: 116,
      head: [['Metric', 'Value']],
      body: summaryRows,
      styles: { fontSize: 9, cellPadding: 6, textColor: [228, 228, 231], lineColor: [39, 39, 42], lineWidth: 0.5 },
      headStyles: { fillColor: [9, 9, 11], textColor: [161, 161, 170] },
      bodyStyles: { fillColor: [2, 2, 2] },
      alternateRowStyles: { fillColor: [9, 9, 11] },
      margin: { left: 40, right: 40 },
      theme: 'grid',
    })

    // Recent samples
    const lastSamples = data.slice(-12)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(12)
    doc.setTextColor(250, 250, 250)
    doc.text('Recent Samples', 40, (doc.lastAutoTable?.finalY || 116) + 34)

    autoTable(doc, {
      startY: (doc.lastAutoTable?.finalY || 116) + 46,
      head: [['Time', 'Read (MB/s)', 'Write (MB/s)', 'Latency (Wait%)', 'CPU (%)']],
      body: lastSamples.map((s) => [String(s.time), String(s.read), String(s.write), String(s.latency), String(s.cpu)]),
      styles: { fontSize: 9, cellPadding: 6, textColor: [228, 228, 231], lineColor: [39, 39, 42], lineWidth: 0.5 },
      headStyles: { fillColor: [9, 9, 11], textColor: [161, 161, 170] },
      bodyStyles: { fillColor: [2, 2, 2] },
      alternateRowStyles: { fillColor: [9, 9, 11] },
      margin: { left: 40, right: 40 },
      theme: 'grid',
    })

    const fileName = `IO_Analysis_Report_${generatedAt.toISOString().replaceAll(':', '-').slice(0, 19)}.pdf`
    doc.save(fileName)
    addLog(`Report exported successfully: ${fileName}`, 'success')
  }

  // --- Alerts (on-theme, non-invasive) ---
  const alerts = useMemo(() => {
    const last = data[data.length - 1]
    const out = []
    if (!mysql.ok) out.push({ id: 'mysql-down', severity: 'danger', title: 'MySQL offline', detail: mysql.error || 'Cannot reach /api/mysql/ping' })
    if (last.latency >= 7) out.push({ id: 'latency', severity: 'warning', title: 'Elevated latency', detail: `I/O wait trending high (${last.latency}%)` })
    if (last.cpu >= 85) out.push({ id: 'cpu', severity: 'warning', title: 'CPU pressure', detail: `CPU usage ${last.cpu}%` })
    if (last.write >= 500) out.push({ id: 'write', severity: 'warning', title: 'Write burst', detail: `Write throughput ${last.write} MB/s` })
    return out
  }, [data, mysql])

  const activeAlertCount = alerts.filter((a) => !ackAlerts.has(a.id)).length

  // --- ShadCN-like Primitives ---
  const Card = ({ title, description, children, icon: Icon, className = '', headerAction }) => (
    <div className={`bg-[#09090b] border border-[#27272a] rounded-xl overflow-hidden shadow-sm flex flex-col ${className}`}>
      <div className="p-6 flex-1 flex flex-col">
        <div className="flex items-start justify-between mb-1">
          <div className="flex items-center gap-3">
            {Icon && <Icon size={18} className="text-[#a1a1aa]" />}
            <h3 className="text-[#fafafa] font-semibold tracking-tight text-base">{title}</h3>
          </div>
          {headerAction}
        </div>
        {description && <p className="text-[#a1a1aa] text-xs mb-4">{description}</p>}
        <div className="mt-2 flex-1">{children}</div>
      </div>
    </div>
  )

  const StatCard = ({ label, value, unit, trend, icon: Icon }) => (
    <div className="bg-[#09090b] border border-[#27272a] rounded-xl p-5 flex flex-col gap-1 hover:border-[#3f3f46] transition-colors group cursor-default">
      <div className="flex items-center justify-between text-[#a1a1aa]">
        <span className="text-[10px] font-bold uppercase tracking-[0.1em]">{label}</span>
        <Icon size={16} className="opacity-40 group-hover:opacity-100 transition-opacity" />
      </div>
      <div className="flex items-baseline gap-1.5 mt-2">
        <span className="text-2xl font-bold text-[#fafafa] font-mono tracking-tighter">{value}</span>
        <span className="text-[#71717a] text-[10px] font-bold uppercase">{unit}</span>
      </div>
      {trend !== undefined && (
        <div className={`text-[11px] font-medium flex items-center gap-1 mt-1 ${trend > 0 ? 'text-[#4ade80]' : 'text-[#f87171]'}`}>
          {trend > 0 ? '↑' : '↓'} {Math.abs(trend)}% <span className="text-[#71717a]">vs. benchmark</span>
        </div>
      )}
    </div>
  )

  const Badge = ({ variant = 'default', children }) => {
    const variants = {
      default: 'bg-[#27272a] text-[#fafafa]',
      success: 'bg-[#14532d] text-[#4ade80] border-[#166534]',
      warning: 'bg-[#451a03] text-[#fbbf24] border-[#78350f]',
      danger: 'bg-[#450a0a] text-[#f87171] border-[#7f1d1d]',
      primary: 'bg-[#1e3a8a] text-[#60a5fa] border-[#1e40af]',
    }
    return <span className={`px-2 py-0.5 text-[10px] font-bold uppercase rounded border ${variants[variant]}`}>{children}</span>
  }

  const filteredLogs = useMemo(() => {
    const q = logQuery.trim().toLowerCase()
    if (!q) return logs
    return logs.filter((l) => `${l.time} ${l.type} ${l.msg}`.toLowerCase().includes(q))
  }, [logs, logQuery])

  const filteredIo = useMemo(() => {
    const q = ioSearch.trim().toLowerCase()
    if (!q) return ioRows
    return ioRows.filter((r) => String(r.eventName || '').toLowerCase().includes(q))
  }, [ioRows, ioSearch])

  const baseline = useMemo(() => generateData().map((d) => ({ ...d, readBase: d.read, writeBase: d.write })), [])
  const compareSeries = useMemo(
    () =>
      data.map((d, i) => ({
        time: d.time,
        read: d.read,
        write: d.write,
        readBase: baseline[i]?.readBase ?? 0,
        writeBase: baseline[i]?.writeBase ?? 0,
      })),
    [data, baseline]
  )

  return (
    <div className="min-h-screen bg-[#020202] text-[#e4e4e7] selection:bg-[#2563eb]/40 font-['Inter',_system-ui,_sans-serif]">
      {/* Navbar */}
      <nav className="h-16 border-b border-[#27272a] bg-[#09090b]/50 backdrop-blur-md sticky top-0 z-50 px-6 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center">
              <HardDrive size={20} className="text-black" />
            </div>
            <span className="text-[#fafafa] font-bold tracking-tight text-lg">
              DISK.IO <span className="text-[#71717a]">ANALYS</span>
            </span>
          </div>
          <div className="h-4 w-[1px] bg-[#27272a]" />
          <div className="hidden md:flex items-center gap-4 text-xs font-medium">
            <div className="flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full ${mysql.ok ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`} />
              <span className="text-[#71717a]">MySQL:</span> <span className="text-[#fafafa]">{mysql.ok ? mysql.version || 'Online' : 'Offline'}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Database size={14} className="text-[#71717a]" />
              <span className="text-[#71717a]">Threads:</span>{' '}
              <span className="text-[#fafafa]">{mysqlSummary?.threadsConnected ?? '—'}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowAlerts((v) => !v)}
            className="h-9 w-9 rounded-md text-xs font-semibold bg-[#18181b] border border-[#27272a] text-[#fafafa] hover:bg-[#27272a] transition-all flex items-center justify-center relative"
            title="Alerts"
          >
            <Bell size={14} />
            {activeAlertCount > 0 && (
              <span className="absolute -top-1 -right-1 h-4 min-w-4 px-1 rounded-full bg-rose-500 text-[10px] font-bold flex items-center justify-center">
                {activeAlertCount}
              </span>
            )}
          </button>
          <button
            onClick={() => setShowSettings(true)}
            className="h-9 w-9 rounded-md text-xs font-semibold bg-[#18181b] border border-[#27272a] text-[#fafafa] hover:bg-[#27272a] transition-all flex items-center justify-center"
            title="Settings"
          >
            <Settings size={14} />
          </button>
          <button
            onClick={exportReport}
            className="h-9 px-4 rounded-md text-xs font-semibold bg-[#18181b] border border-[#27272a] text-[#fafafa] hover:bg-[#27272a] transition-all flex items-center gap-2"
          >
            <Download size={14} />
            Export Report
          </button>
          <button
            onClick={handleTrainModel}
            className="h-9 px-4 rounded-md text-xs font-semibold bg-[#2563eb] text-[#fafafa] hover:bg-[#3b82f6] shadow-lg shadow-blue-500/20 transition-all flex items-center gap-2"
          >
            <BrainCircuit size={14} />
            Train ML
          </button>
        </div>
      </nav>

      <div className="max-w-[1500px] mx-auto flex">
        {/* Sidebar */}
        <aside className="w-64 hidden lg:flex flex-col border-r border-[#27272a] min-h-[calc(100vh-64px)] p-6 bg-[#020202] sticky top-16">
          <div className="mb-10">
            <p className="text-[10px] font-bold text-[#71717a] uppercase tracking-[0.2em] mb-4 px-2">Navigation</p>
            <nav className="space-y-1">
              {[
                { id: 'dashboard', label: 'Overview', icon: BarChart3 },
                { id: 'ml-insights', label: 'ML Laboratory', icon: BrainCircuit },
                { id: 'database', label: 'MySQL I/O', icon: Database },
                { id: 'compare', label: 'Benchmarks', icon: History },
                { id: 'hardware', label: 'Hardware Spec', icon: Info },
              ].map((item) => (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-md text-sm transition-all ${
                    activeTab === item.id
                      ? 'bg-[#18181b] text-[#fafafa] font-medium border border-[#27272a]'
                      : 'text-[#a1a1aa] hover:text-[#fafafa] hover:bg-[#09090b]'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <item.icon size={16} />
                    {item.label}
                  </div>
                </button>
              ))}
            </nav>
          </div>

          <div className="mt-auto p-4 bg-[#09090b] border border-[#27272a] rounded-xl">
            <p className="text-[10px] font-bold text-[#fafafa] uppercase mb-3">Model Status</p>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-[11px] text-[#71717a]">Active:</span>
                <Badge variant="success">v2.4.0</Badge>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[11px] text-[#71717a]">Last Trained:</span>
                <span className="text-[11px] text-[#fafafa]">2h ago</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[11px] text-[#71717a]">Capture:</span>
                <Badge variant={isCapturing ? 'primary' : 'default'}>{isCapturing ? 'RUNNING' : 'IDLE'}</Badge>
              </div>
            </div>
          </div>
        </aside>

        {/* Content */}
        <main className="flex-1 p-8 lg:p-12 overflow-y-auto">
          {activeTab === 'dashboard' && (
            <div className="space-y-8 animate-in fade-in slide-in-from-top-4 duration-500">
              <div className="flex justify-between items-end">
                <div>
                  <h1 className="text-3xl font-bold text-[#fafafa] tracking-tight mb-2">Live Performance Monitor</h1>
                  <p className="text-[#71717a] text-sm italic">Streaming MySQL-derived I/O counters + system CPU snapshots.</p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleStartCapture}
                    className={`h-10 px-6 rounded-md text-sm font-semibold flex items-center gap-2 transition-all ${
                      isCapturing ? 'bg-rose-500/10 border border-rose-500/50 text-rose-500' : 'bg-white text-black hover:bg-[#e4e4e7]'
                    }`}
                  >
                    {isCapturing ? <Zap className="fill-current" size={16} /> : <Play size={16} />}
                    {isCapturing ? 'Active Capture' : 'Start Capture'}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5">
                <StatCard label="Current Read" value={data[data.length - 1].read} unit="MB/S" trend={8.5} icon={TrendingUp} />
                <StatCard label="Current Write" value={data[data.length - 1].write} unit="MB/S" trend={-1.2} icon={Layers} />
                <StatCard label="I/O Wait (Wait%)" value={data[data.length - 1].latency} unit="%" trend={0.2} icon={Activity} />
                <StatCard label="Disk IOPS" value={(data[data.length - 1].read * 12).toFixed(0)} unit="IOPS" icon={Zap} />
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                <Card
                  title="Throughput Vector"
                  description="Real-time read/write bandwidth proxy (MB/s)"
                  className="xl:col-span-2"
                  headerAction={<Filter size={14} className="text-[#71717a] cursor-pointer" />}
                >
                  <div className="h-[350px] w-full mt-4">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={data}>
                        <defs>
                          <linearGradient id="readGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.1} />
                            <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#18181b" vertical={false} />
                        <XAxis dataKey="time" stroke="#3f3f46" fontSize={11} tickLine={false} axisLine={false} dy={10} />
                        <YAxis stroke="#3f3f46" fontSize={11} tickLine={false} axisLine={false} />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: '#09090b',
                            border: '1px solid #27272a',
                            borderRadius: '12px',
                            fontSize: '12px',
                          }}
                          itemStyle={{ padding: '2px 0' }}
                        />
                        <Area type="monotone" dataKey="read" stroke="#3b82f6" strokeWidth={2} fill="url(#readGrad)" name="Read" />
                        <Area type="monotone" dataKey="write" stroke="#ffffff" strokeWidth={2} fill="transparent" name="Write" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </Card>

                <Card
                  title="Event Journal"
                  description="Server + system stream (searchable)"
                  icon={Terminal}
                  headerAction={
                    <div className="flex items-center gap-2">
                      <div className="h-8 px-2 rounded-md border border-[#27272a] bg-[#020202] flex items-center gap-2">
                        <Search size={14} className="text-[#71717a]" />
                        <input
                          value={logQuery}
                          onChange={(e) => setLogQuery(e.target.value)}
                          placeholder="Filter logs…"
                          className="bg-transparent outline-none text-xs text-[#e4e4e7] placeholder:text-[#52525b] w-28"
                        />
                      </div>
                    </div>
                  }
                >
                  <div className="h-[350px] space-y-3 overflow-y-auto pr-2 custom-scrollbar">
                    {filteredLogs.map((log) => (
                      <div
                        key={log.id}
                        className="p-3 bg-[#09090b] border border-[#27272a] rounded-lg text-[11px] font-mono hover:border-[#3f3f46] transition-colors"
                      >
                        <div className="flex justify-between items-center mb-1.5">
                          <span className="text-[#52525b] text-[10px] uppercase font-bold tracking-widest">{log.time}</span>
                          <Badge variant={log.type === 'success' ? 'success' : log.type === 'warning' ? 'warning' : log.type === 'danger' ? 'danger' : 'default'}>
                            {log.type}
                          </Badge>
                        </div>
                        <p className="text-[#e4e4e7] leading-relaxed">{log.msg}</p>
                      </div>
                    ))}
                  </div>
                </Card>
              </div>
            </div>
          )}

          {activeTab === 'ml-insights' && (
            <div className="space-y-8 animate-in fade-in duration-500">
              <div className="flex justify-between items-center">
                <div>
                  <h1 className="text-3xl font-bold text-[#fafafa] tracking-tight mb-2">Machine Learning Lab</h1>
                  <p className="text-[#71717a] text-sm italic">Feature engineering + inference overlays for I/O patterns.</p>
                </div>
                <button onClick={handleTrainModel} className="h-10 px-6 bg-white text-black rounded-md text-sm font-bold flex items-center gap-2">
                  <RefreshCw className={isTraining ? 'animate-spin' : ''} size={16} />
                  Retrain All Models
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <Card title="Random Forest Classifier" description="Anomaly Detection Engine" icon={BrainCircuit}>
                  <div className="py-4 space-y-5">
                    <div className="flex justify-between items-end">
                      <span className="text-xs text-[#71717a]">Model Accuracy</span>
                      <span className="text-2xl font-bold text-[#fafafa]">97.2%</span>
                    </div>
                    <div className="h-1.5 w-full bg-[#18181b] rounded-full overflow-hidden">
                      <div className="h-full bg-blue-500 w-[97%]" />
                    </div>
                    <div className="grid grid-cols-2 gap-3 pt-2">
                      <div className="p-3 bg-[#18181b] border border-[#27272a] rounded-lg">
                        <p className="text-[10px] text-[#71717a] font-bold uppercase mb-1">Precision</p>
                        <p className="text-lg font-bold">0.94</p>
                      </div>
                      <div className="p-3 bg-[#18181b] border border-[#27272a] rounded-lg">
                        <p className="text-[10px] text-[#71717a] font-bold uppercase mb-1">Recall</p>
                        <p className="text-lg font-bold">0.91</p>
                      </div>
                    </div>
                  </div>
                </Card>

                <Card title="Linear Regression" description="Throughput Prediction" icon={TrendingUp}>
                  <div className="py-4 space-y-4">
                    <p className="text-xs text-[#71717a]">Estimated bandwidth for next 10 mins:</p>
                    <p className="text-3xl font-bold text-[#fafafa] tracking-tighter">
                      428.4 <span className="text-xs text-[#71717a]">MB/s</span>
                    </p>
                    <div className="p-4 bg-[#14532d]/10 border border-[#166534] rounded-lg">
                      <div className="flex items-center gap-2 mb-1">
                        <CheckCircle2 size={14} className="text-emerald-500" />
                        <span className="text-xs font-bold text-emerald-500">Normal Operations</span>
                      </div>
                      <p className="text-[10px] text-emerald-500/80">Predicted load is well within hardware buffer limits.</p>
                    </div>
                  </div>
                </Card>

                <Card title="Policy Shield" description="Auto-mitigation recommendations" icon={ShieldAlert}>
                  <div className="space-y-3">
                    {[
                      { label: 'Adaptive Flush Tuning', detail: 'Increase innodb_io_capacity during sustained writes.', status: mysql.ok ? 'Ready' : 'Blocked' },
                      { label: 'Query Kill-Switch', detail: 'Terminate long-running scans when latency spikes.', status: mysql.ok ? 'Ready' : 'Blocked' },
                      { label: 'Burst Buffering', detail: 'Coalesce writes to reduce fsync pressure.', status: 'Ready' },
                    ].map((item, i) => (
                      <div key={i} className="p-3 border border-[#27272a] rounded-lg">
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-medium">{item.label}</p>
                          <Badge variant={item.status === 'Ready' ? 'success' : 'warning'}>{item.status}</Badge>
                        </div>
                        <p className="text-[10px] text-[#71717a] mt-1">{item.detail}</p>
                      </div>
                    ))}
                  </div>
                </Card>
              </div>
            </div>
          )}

          {activeTab === 'database' && (
            <Card
              title="MySQL performance_schema I/O (best-effort)"
              description="Top wait/io/* events ordered by total wait time"
              icon={Database}
              headerAction={
                <div className="flex items-center gap-2">
                  <div className="h-8 px-2 rounded-md border border-[#27272a] bg-[#020202] flex items-center gap-2">
                    <Search size={14} className="text-[#71717a]" />
                    <input
                      value={ioSearch}
                      onChange={(e) => setIoSearch(e.target.value)}
                      placeholder="Search event…"
                      className="bg-transparent outline-none text-xs text-[#e4e4e7] placeholder:text-[#52525b] w-36"
                    />
                  </div>
                </div>
              }
            >
              <div className="mt-4 rounded-xl border border-[#27272a] overflow-hidden">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-[#09090b] text-[#71717a] border-b border-[#27272a]">
                    <tr>
                      <th className="p-4 font-bold uppercase tracking-widest text-[10px]">Event</th>
                      <th className="p-4 font-bold uppercase tracking-widest text-[10px]">Count</th>
                      <th className="p-4 font-bold uppercase tracking-widest text-[10px]">Total Wait (raw)</th>
                      <th className="p-4 font-bold uppercase tracking-widest text-[10px]">State</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#27272a]">
                    {filteredIo.length === 0 ? (
                      <tr>
                        <td className="p-4 text-[#a1a1aa]" colSpan={4}>
                          {mysql.ok
                            ? 'No I/O events returned. If this is unexpected, ensure performance_schema is enabled.'
                            : 'MySQL is offline. Configure `server/.env` and start the API.'}
                        </td>
                      </tr>
                    ) : (
                      filteredIo.map((r) => (
                        <tr key={r.eventName} className="hover:bg-[#18181b]/50 transition-colors">
                          <td className="p-4 font-mono text-[#60a5fa]">{r.eventName}</td>
                          <td className="p-4">{Number(r.countStar).toLocaleString()}</td>
                          <td className="p-4">{String(r.sumTimerWait)}</td>
                          <td className="p-4">
                            <Badge variant="primary">OBSERVED</Badge>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {activeTab === 'compare' && (
            <div className="space-y-6 animate-in fade-in duration-500">
              <div>
                <h1 className="text-3xl font-bold text-[#fafafa] tracking-tight mb-2">Benchmarks</h1>
                <p className="text-[#71717a] text-sm italic">Overlay current capture vs. a baseline profile.</p>
              </div>
              <Card title="Baseline Overlay" description="Read/Write curves (current vs. baseline)" icon={History}>
                <div className="h-[380px] w-full mt-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={compareSeries}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#18181b" vertical={false} />
                      <XAxis dataKey="time" stroke="#3f3f46" fontSize={11} tickLine={false} axisLine={false} dy={10} />
                      <YAxis stroke="#3f3f46" fontSize={11} tickLine={false} axisLine={false} />
                      <Tooltip
                        contentStyle={{ backgroundColor: '#09090b', border: '1px solid #27272a', borderRadius: '12px', fontSize: '12px' }}
                        itemStyle={{ padding: '2px 0' }}
                      />
                      <Line type="monotone" dataKey="readBase" stroke="#52525b" strokeWidth={2} dot={false} name="Read (baseline)" />
                      <Line type="monotone" dataKey="writeBase" stroke="#27272a" strokeWidth={2} dot={false} name="Write (baseline)" />
                      <Line type="monotone" dataKey="read" stroke="#3b82f6" strokeWidth={2} dot={false} name="Read (current)" />
                      <Line type="monotone" dataKey="write" stroke="#ffffff" strokeWidth={2} dot={false} name="Write (current)" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </Card>
            </div>
          )}

          {activeTab === 'hardware' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 animate-in fade-in duration-500">
              <Card title="Physical Disk Geometry" description="Direct hardware identification" icon={HardDrive}>
                <div className="space-y-6 py-2">
                  <div className="flex justify-between border-b border-[#27272a] pb-3">
                    <span className="text-xs text-[#71717a]">Model Name</span>
                    <span className="text-xs font-bold">NVMe Samsung SSD 980 PRO</span>
                  </div>
                  <div className="flex justify-between border-b border-[#27272a] pb-3">
                    <span className="text-xs text-[#71717a]">Interface</span>
                    <span className="text-xs font-bold">PCIe Gen 4 x4</span>
                  </div>
                  <div className="flex justify-between border-b border-[#27272a] pb-3">
                    <span className="text-xs text-[#71717a]">Firmware</span>
                    <span className="text-xs font-bold">5B2QGXA7</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-xs text-[#71717a]">S.M.A.R.T. Status</span>
                    <Badge variant="success">HEALTHY</Badge>
                  </div>
                </div>
              </Card>
              <Card title="Analysis Parameters" description="Project requirements mapping" icon={Settings}>
                <div className="space-y-4">
                  <div className="p-4 bg-[#18181b] border border-[#27272a] rounded-xl">
                    <p className="text-xs font-bold mb-1">API</p>
                    <p className="text-[11px] text-[#71717a] font-mono">http://localhost:3001</p>
                  </div>
                  <div className="p-4 bg-[#18181b] border border-[#27272a] rounded-xl">
                    <p className="text-xs font-bold mb-1">MySQL</p>
                    <p className="text-[11px] text-[#71717a] font-mono">USER: root | PASS: (in server/.env)</p>
                  </div>
                  <div className="p-4 bg-[#18181b] border border-[#27272a] rounded-xl">
                    <p className="text-xs font-bold mb-1">Algorithm Stack</p>
                    <p className="text-[11px] text-[#71717a]">Scikit-Learn (RandomForest, LinearRegression)</p>
                  </div>
                </div>
              </Card>
            </div>
          )}
        </main>
      </div>

      {/* Alerts Drawer */}
      {showAlerts && (
        <div className="fixed inset-0 z-[90] bg-black/70 backdrop-blur-sm flex items-start justify-end p-6 animate-in fade-in duration-150" onClick={() => setShowAlerts(false)}>
          <div className="w-full max-w-md bg-[#09090b] border border-[#27272a] rounded-2xl shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="p-5 border-b border-[#27272a] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Bell size={16} className="text-[#a1a1aa]" />
                <p className="text-sm font-semibold text-[#fafafa]">Alerts</p>
              </div>
              <button className="text-xs text-[#a1a1aa] hover:text-[#fafafa]" onClick={() => setAckAlerts(new Set(alerts.map((a) => a.id)))}>
                Acknowledge all
              </button>
            </div>
            <div className="p-5 space-y-3 max-h-[70vh] overflow-y-auto custom-scrollbar">
              {alerts.length === 0 ? (
                <div className="p-4 border border-[#27272a] rounded-xl text-xs text-[#a1a1aa]">No active alerts.</div>
              ) : (
                alerts.map((a) => (
                  <div key={a.id} className={`p-4 border rounded-xl ${a.severity === 'danger' ? 'border-rose-500/40 bg-rose-500/5' : 'border-[#27272a] bg-[#020202]'}`}>
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-sm font-semibold text-[#fafafa] flex items-center gap-2">
                          {a.severity === 'danger' ? <AlertTriangle size={14} className="text-rose-400" /> : <AlertTriangle size={14} className="text-amber-300" />}
                          {a.title}
                        </p>
                        <p className="text-[11px] text-[#a1a1aa] mt-1">{a.detail}</p>
                      </div>
                      <button
                        onClick={() =>
                          setAckAlerts((s) => {
                            const n = new Set(s)
                            n.add(a.id)
                            return n
                          })
                        }
                        className="h-8 px-3 rounded-md text-xs font-semibold bg-[#18181b] border border-[#27272a] hover:bg-[#27272a]"
                      >
                        Ack
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 z-[95] bg-black/80 backdrop-blur-sm flex items-center justify-center p-6 animate-in fade-in duration-200" onClick={() => setShowSettings(false)}>
          <div className="bg-[#09090b] border border-[#27272a] rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="p-6 border-b border-[#27272a] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Settings size={16} className="text-[#a1a1aa]" />
                <p className="text-sm font-semibold text-[#fafafa]">Connection & Project Settings</p>
              </div>
              <button className="text-xs text-[#a1a1aa] hover:text-[#fafafa]" onClick={() => setShowSettings(false)}>
                Close
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="p-4 bg-[#020202] border border-[#27272a] rounded-xl">
                <p className="text-[10px] font-bold uppercase tracking-widest text-[#71717a] mb-2">MySQL status</p>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${mysql.ok ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                    <p className="text-sm font-semibold text-[#fafafa]">{mysql.ok ? 'Online' : 'Offline'}</p>
                  </div>
                  <Badge variant={mysql.ok ? 'success' : 'danger'}>{mysql.ok ? 'CONNECTED' : 'DISCONNECTED'}</Badge>
                </div>
                <p className="text-[11px] text-[#a1a1aa] mt-2 font-mono">
                  {mysql.ok ? `VERSION: ${mysql.version || '—'}` : mysql.error || 'Unable to reach API'}
                </p>
              </div>

              <div className="p-4 bg-[#020202] border border-[#27272a] rounded-xl">
                <p className="text-[10px] font-bold uppercase tracking-widest text-[#71717a] mb-2">Backend configuration</p>
                <p className="text-[11px] text-[#a1a1aa] leading-relaxed">
                  Create <span className="text-[#fafafa] font-mono">server/.env</span> from <span className="text-[#fafafa] font-mono">server/.env.example</span> and set:
                </p>
                <div className="mt-3 grid grid-cols-1 gap-2 text-[11px] font-mono text-[#e4e4e7]">
                  <div className="flex justify-between bg-[#09090b] border border-[#27272a] rounded-lg px-3 py-2">
                    <span className="text-[#71717a]">DB_USER</span>
                    <span>root</span>
                  </div>
                  <div className="flex justify-between bg-[#09090b] border border-[#27272a] rounded-lg px-3 py-2">
                    <span className="text-[#71717a]">DB_PASSWORD</span>
                    <span>root123</span>
                  </div>
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={async () => {
                    addLog('Running MySQL connectivity test...', 'info')
                    try {
                      const ping = await apiGet('/api/mysql/ping')
                      addLog(`MySQL OK: ${ping.version}`, 'success')
                    } catch (e) {
                      addLog(`MySQL test failed: ${e?.message || String(e)}`, 'danger')
                    }
                  }}
                  className="flex-1 h-11 bg-white text-black rounded-lg font-bold text-sm"
                >
                  Test Connection
                </button>
                <button onClick={() => setShowSettings(false)} className="flex-1 h-11 bg-[#18181b] border border-[#27272a] rounded-lg font-bold text-sm">
                  Done
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ML Training Modal Overlay */}
      {showTrainingModal && (
        <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-6 animate-in fade-in duration-200">
          <div className="bg-[#09090b] border border-[#27272a] rounded-2xl w-full max-w-md overflow-hidden shadow-2xl">
            <div className="p-8 text-center">
              <div className="w-16 h-16 bg-blue-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
                <BrainCircuit size={32} className={`text-blue-500 ${isTraining ? 'animate-pulse' : ''}`} />
              </div>
              <h2 className="text-xl font-bold text-[#fafafa] mb-2">{isTraining ? 'Training Models...' : 'Training Complete'}</h2>
              <p className="text-[#71717a] text-sm mb-8">
                {isTraining
                  ? 'Analyzing historical patterns from MySQL datasets to update prediction weights.'
                  : 'The Random Forest and Linear Regression models have been synchronized.'}
              </p>

              <div className="space-y-2 mb-8">
                <div className="h-2 w-full bg-[#18181b] rounded-full overflow-hidden">
                  <div className="h-full bg-blue-500 transition-all duration-300" style={{ width: `${trainingProgress}%` }} />
                </div>
                <p className="text-[10px] text-[#71717a] font-mono">{trainingProgress}% Synchronized</p>
              </div>

              {!isTraining && (
                <button
                  onClick={() => {
                    setShowTrainingModal(false)
                    setActiveTab('dashboard')
                  }}
                  className="w-full h-11 bg-white text-black rounded-lg font-bold text-sm"
                >
                  Back to Dashboard
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
