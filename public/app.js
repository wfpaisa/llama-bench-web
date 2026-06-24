// Frontend en JavaScript puro. Sin frameworks.
// Comunica con el backend mediante fetch. Polling de logs cada 1s.

const $ = (id) => document.getElementById(id)

// ── Definición declarativa de campos (orden = aparición de arriba abajo) ──
// Cada campo tiene: key, label, type, flag (para preview), y opciones según tipo.
const FIELD_DEFS = [
    { key: "binary", label: "Binario llama-server", type: "text", placeholder: "./llama-server", flag: null },
    { key: "model", label: "Modelo HF", type: "text", placeholder: "repo o repo:file", flag: "-hf" },
    { key: "ctxSize", label: "Context Size", type: "number", placeholder: "", flag: "--ctx-size" },
    { key: "batchSize", label: "Batch Size", type: "number", placeholder: "", flag: "--batch-size" },
    { key: "ubatchSize", label: "UBatch Size", type: "number", placeholder: "", flag: "--ubatch-size" },
    { key: "tensorSplit", label: "Tensor Split", type: "text", placeholder: "vacío = auto", flag: "--tensor-split" },
    { key: "device", label: "Device", type: "text", placeholder: "Vulkan0,Vulkan1", flag: "--device" },
    { key: "nGpuLayers", label: "N GPU Layers", type: "number", placeholder: "", flag: "--n-gpu-layers" },
    { key: "cacheTypeK", label: "Cache Type K", type: "select", options: ["f16", "q8_0", "q4_0"], flag: "--cache-type-k" },
    { key: "cacheTypeV", label: "Cache Type V", type: "select", options: ["f16", "q8_0", "q4_0"], flag: "--cache-type-v" },
    { key: "flashAttn", label: "Flash Attn", type: "select", options: ["on", "off"], flag: "--flash-attn" },
    { key: "cacheReuse", label: "Cache Reuse", type: "number", placeholder: "", flag: "--cache-reuse" },
    { key: "host", label: "Host", type: "text", placeholder: "127.0.0.1", flag: "--host" },
    { key: "port", label: "Port", type: "number", placeholder: "", flag: "--port" },
    { key: "specType", label: "Spec Type", type: "text", placeholder: "draft-mtp", flag: "--spec-type" },
    { key: "specDraftNMax", label: "Spec Draft N Max", type: "number", placeholder: "", flag: "--spec-draft-n-max" },
    { key: "temp", label: "Temp", type: "number", placeholder: "", step: "0.05", flag: null },
    { key: "topP", label: "Top-P", type: "number", placeholder: "", step: "0.01", flag: null },
    { key: "topK", label: "Top-K", type: "number", placeholder: "", flag: null },
    { key: "noMmap", label: "No mmap", type: "checkbox", flag: "--no-mmap" },
    { key: "jinja", label: "Jinja", type: "checkbox", flag: "--jinja" },
    { key: "noMmproj", label: "No mmproj", type: "checkbox", flag: "--no-mmproj" },
    { key: "metrics", label: "Metrics", type: "checkbox", flag: "--metrics" },
    { key: "logPrefix", label: "Log prefix", type: "checkbox", flag: "--log-prefix" },
]

const STORAGE_KEY = "llama-bench-cfg"
const STORAGE_ENA = "llama-bench-ena" // checkboxes de habilitación

const allKeys = FIELD_DEFS.map((f) => f.key)

// ── Generar formulario dinámicamente ──
function buildForm() {
    const container = $("cfg-form")
    container.innerHTML = ""
    for (const def of FIELD_DEFS) {
        const row = document.createElement("div")
        row.className = "cfg-row"
        row.dataset.key = def.key

        // Checkbox de habilitación.
        const toggle = document.createElement("input")
        toggle.type = "checkbox"
        toggle.className = "cfg-toggle"
        toggle.checked = isEnabled(def.key)
        toggle.title = "Activar/desactivar este campo"
        toggle.addEventListener("change", () => {
            row.classList.toggle("disabled", !toggle.checked)
            saveEnabled()
            updateArgvPreview()
        })

        // Label clickeable (activa/desactiva el toggle).
        const label = document.createElement("label")
        label.className = "cfg-label"
        label.textContent = def.label
        label.title = def.key
        label.addEventListener("click", (e) => {
            if (e.target === toggle) return // no doble-toggle
            toggle.checked = !toggle.checked
            toggle.dispatchEvent(new Event("change"))
        })

        // Flag badge.
        const flagSpan = document.createElement("span")
        flagSpan.className = "cfg-flag"
        flagSpan.textContent = def.flag || ""

        // Input wrapper.
        const inputWrap = document.createElement("div")
        inputWrap.className = "cfg-input"

        if (def.type === "checkbox") {
            const cb = document.createElement("input")
            cb.type = "checkbox"
            cb.id = `cfg-${def.key}`
            cb.checked = false
            cb.addEventListener("change", () => {
                saveConfig()
                updateArgvPreview()
            })
            inputWrap.appendChild(cb)
        } else if (def.type === "select") {
            const sel = document.createElement("select")
            sel.id = `cfg-${def.key}`
            for (const opt of def.options) {
                const o = document.createElement("option")
                o.value = opt
                o.textContent = opt
                sel.appendChild(o)
            }
            sel.addEventListener("change", () => {
                saveConfig()
                updateArgvPreview()
            })
            inputWrap.appendChild(sel)
        } else {
            const inp = document.createElement("input")
            inp.type = def.type
            inp.id = `cfg-${def.key}`
            if (def.placeholder) inp.placeholder = def.placeholder
            if (def.step) inp.step = def.step
            inp.addEventListener("input", () => {
                saveConfig()
                updateArgvPreview()
            })
            inputWrap.appendChild(inp)
        }

        row.appendChild(toggle)
        row.appendChild(label)
        label.appendChild(flagSpan)
        row.appendChild(inputWrap)
        container.appendChild(row)

        // Aplicar estado inicial de habilitación.
        row.classList.toggle("disabled", !toggle.checked)
    }
}

// ── Leer / escribir configuración desde los campos del DOM ──
function readConfig() {
    const c = {}
    for (const def of FIELD_DEFS) {
        if (def.type === "checkbox") {
            c[def.key] = $(`cfg-${def.key}`).checked
        } else if (def.type === "number") {
            const v = $(`cfg-${def.key}`).value
            c[def.key] = v === "" ? 0 : Number(v)
        } else {
            c[def.key] = $(`cfg-${def.key}`).value
        }
    }
    return c
}

function writeConfig(c) {
    for (const def of FIELD_DEFS) {
        const el = $(`cfg-${def.key}`)
        if (!el) continue
        if (def.type === "checkbox") {
            el.checked = !!c[def.key]
        } else {
            el.value = c[def.key] ?? ""
        }
    }
    updateArgvPreview()
}

// ── Habilitación de campos (checkboxes) ──
function isEnabled(key) {
    try {
        const s = JSON.parse(localStorage.getItem(STORAGE_ENA))
        return s?.[key] !== false // default: habilitado
    } catch {
        return true
    }
}

function saveEnabled() {
    const s = {}
    for (const def of FIELD_DEFS) {
        s[def.key] = $(`cfg-form`).querySelector(`.cfg-row[data-key="${def.key}"] .cfg-toggle`).checked
    }
    localStorage.setItem(STORAGE_ENA, JSON.stringify(s))
}

// ── localStorage: config values ──
function loadConfigFromStorage() {
    try {
        const s = JSON.parse(localStorage.getItem(STORAGE_KEY))
        if (s && Object.keys(s).length) return s
    } catch {
        /* ignore */
    }
    return null
}

function saveConfig() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(readConfig()))
}

function clearConfigStorage() {
    localStorage.removeItem(STORAGE_KEY)
    localStorage.removeItem(STORAGE_ENA)
    toast("Configuración local eliminada.")
}

// ── Generar argv (solo campos habilitados) ──
function buildArgv(c) {
    const a = []
    for (const def of FIELD_DEFS) {
        if (!isEnabled(def.key)) continue
        const v = c[def.key]
        switch (def.key) {
            case "binary":
                break // no es un flag
            case "model":
                if (v) a.push("-hf", v)
                break
            case "nGpuLayers":
                a.push("--n-gpu-layers", String(v))
                break
            case "ctxSize":
                a.push("--ctx-size", String(v))
                break
            case "batchSize":
                a.push("--batch-size", String(v))
                break
            case "ubatchSize":
                a.push("--ubatch-size", String(v))
                break
            case "cacheTypeK":
                if (v) a.push("--cache-type-k", v)
                break
            case "cacheTypeV":
                if (v) a.push("--cache-type-v", v)
                break
            case "cacheReuse":
                if (v > 0) a.push("--cache-reuse", String(v))
                break
            case "flashAttn":
                if (v === "on") a.push("--flash-attn", "on")
                break
            case "noMmap":
                if (v) a.push("--no-mmap")
                break
            case "jinja":
                if (v) a.push("--jinja")
                break
            case "noMmproj":
                if (v) a.push("--no-mmproj")
                break
            case "specType":
                if (v) {
                    a.push("--spec-type", v)
                    a.push("--spec-draft-n-max", String(c.specDraftNMax))
                }
                break
            case "specDraftNMax":
                break // ya se incluye con specType
            case "metrics":
                if (v) a.push("--metrics")
                break
            case "logPrefix":
                if (v) a.push("--log-prefix")
                break
            case "device":
                if (v) a.push("--device", v)
                break
            case "tensorSplit":
                if (v) a.push("--tensor-split", v)
                break
            case "host":
                a.push("--host", v || "127.0.0.1")
                break
            case "port":
                a.push("--port", String(v))
                break
            case "temp":
            case "topP":
            case "topK":
                // No son flags de llama-server, son params de API.
                break
        }
    }
    return a
}

function updateArgvPreview() {
    const c = readConfig()
    const argv = buildArgv(c)
    const lines = []
    for (let i = 0; i < argv.length; i++) {
        const item = argv[i]
        if (item.startsWith("-") && i + 1 < argv.length && !argv[i + 1].startsWith("-")) {
            lines.push(`  ${item} ${argv[++i]}`)
        } else {
            lines.push(`  ${item}`)
        }
    }
    const joined = lines.map((l, i) => l + (i < lines.length - 1 ? " \\" : "")).join("\n")
    $("argv-preview").textContent = `${c.binary} \\\n${joined}`
}

// ── Toast ──
let toastTimer
function toast(msg, isErr = false) {
    let el = $("toast")
    if (!el) {
        el = document.createElement("div")
        el.id = "toast"
        document.body.appendChild(el)
    }
    el.textContent = msg
    el.classList.toggle("err", isErr)
    el.classList.add("show")
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => el.classList.remove("show"), 2600)
}

// ── API helpers ──
async function api(path, opts) {
    const r = await fetch(path, opts)
    let data
    try {
        data = await r.json()
    } catch {
        data = null
    }
    if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`)
    return data
}

// ── Status ──
let lastStatus = null
async function pollStatus() {
    try {
        const s = await api("/status")
        lastStatus = s
        renderStatus(s)
        refreshButtons(s)
    } catch (e) {
        $("status-text").textContent = "error de backend"
        $("status-meta").textContent = e.message
    }
}
function renderStatus(s) {
    const dot = $("status-dot")
    dot.className = "dot " + (s.status || "stopped")
    const labels = { stopped: "detenido", starting: "iniciando…", running: "corriendo", error: "error" }
    $("status-text").textContent = labels[s.status] || s.status
    let meta = ""
    if (s.pid) meta += `pid ${s.pid} · `
    if (s.url) meta += `${s.url} · `
    if (s.error) meta += s.error
    $("status-meta").textContent = meta
}
function refreshButtons(s) {
    const running = s.status === "running" || s.status === "starting"
    $("btn-start").disabled = running
    $("btn-stop").disabled = !running
    $("btn-benchmark").disabled = running || benchRunning
}

// ── Logs (polling cada 1s) ──
let logCursor = 0
const logsEl = $("logs")
async function pollLogs() {
    try {
        const data = await api(`/logs?since=${logCursor}`)
        if (data.entries.length) {
            const frag = document.createDocumentFragment()
            for (const e of data.entries) {
                const div = document.createElement("div")
                div.className = `ln-${e.stream}`
                const ts = document.createElement("span")
                ts.className = "ts"
                ts.textContent = `+${(e.t / 1000).toFixed(1)}s`
                div.appendChild(ts)
                div.appendChild(document.createTextNode(e.msg))
                frag.appendChild(div)
            }
            logsEl.appendChild(frag)
            while (logsEl.childNodes.length > 4000) logsEl.removeChild(logsEl.firstChild)
            if ($("autoscroll").checked) logsEl.scrollTop = logsEl.scrollHeight
            logCursor = data.cursor
        }
    } catch {
        /* backend reiniciándose */
    }
}

// ── Start / Stop ──
$("btn-start").addEventListener("click", async () => {
    try {
        await api("/start", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(readConfig()),
        })
        toast("Servidor iniciando…")
    } catch (e) {
        toast(e.message, true)
    }
})
$("btn-stop").addEventListener("click", async () => {
    try {
        await api("/stop", { method: "POST" })
        toast("Servidor detenido.")
    } catch (e) {
        toast(e.message, true)
    }
})

// ── Restaurar default (del backend) ──
$("btn-apply-default").addEventListener("click", async () => {
    try {
        const c = await api("/config")
        writeConfig(c)
        saveConfig()
        // Re-habilitar todos los campos.
        document.querySelectorAll(".cfg-row").forEach((row) => {
            row.querySelector(".cfg-toggle").checked = true
            row.classList.remove("disabled")
        })
        saveEnabled()
        toast("Configuración por defecto cargada.")
    } catch (e) {
        toast(e.message, true)
    }
})

// ── Reset: limpiar localStorage y restaurar default del backend ──
$("btn-reset-storage").addEventListener("click", async () => {
    if (!confirm("¿Limpiar toda la configuración guardada y restaurar defaults?")) return
    clearConfigStorage()
    // Restaurar defaults del backend.
    try {
        const c = await api("/config")
        writeConfig(c)
    } catch {
        /* ignore */
    }
    // Re-habilitar todos.
    document.querySelectorAll(".cfg-row").forEach((row) => {
        row.querySelector(".cfg-toggle").checked = true
        row.classList.remove("disabled")
    })
    updateArgvPreview()
})

// ── Benchmark ──
let benchRunning = false
$("btn-benchmark").addEventListener("click", async () => {
    if (benchRunning) return
    benchRunning = true
    $("btn-benchmark").disabled = true
    $("bench-state").textContent = "iniciando servidor y midiendo… (puede tardar)"
    try {
        const data = await api("/benchmark", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ config: readConfig(), prompt: $("bench-prompt").value }),
        })
        if (data.ok && data.result) {
            renderLastResult(data.result)
            await loadHistory()
            const r = data.result
            if (r.errors.length) toast(`Benchmark con errores: ${r.errors.join("; ")}`, true)
            else toast("Benchmark completado ✓")
        } else {
            toast(data.error || "Benchmark falló", true)
        }
    } catch (e) {
        toast(e.message, true)
    } finally {
        benchRunning = false
        $("btn-benchmark").disabled = false
        $("bench-state").textContent = ""
        pollStatus()
    }
})

// ── GPU ──
async function loadGpus() {
    try {
        const data = await api("/gpu")
        renderGpus(data.gpus)
    } catch {
        $("gpu-list").textContent = "—"
    }
}
function renderGpus(gpus) {
    const el = $("gpu-list")
    if (!gpus || !gpus.length) {
        el.textContent = "—"
        return
    }
    el.innerHTML = ""
    for (const g of gpus) {
        const pct = g.gpuUtilPct ?? 0
        const used = g.memUsedMiB != null ? Math.round(g.memUsedMiB) : null
        const total = g.memTotalMiB != null ? Math.round(g.memTotalMiB) : null
        const div = document.createElement("div")
        div.className = "gpu"
        div.innerHTML = `
      <div class="name">${g.index} <span class="muted">(${g.vendor})</span></div>
      <div>VRAM: ${used ?? "?"} / ${total ?? "?"} MiB</div>
      <div>Util: ${g.gpuUtilPct ?? "?"}%</div>
      <div class="bar"><span style="width:${Math.min(100, pct)}%"></span></div>`
        el.appendChild(div)
    }
}
$("btn-gpu-refresh").addEventListener("click", loadGpus)

// ── Resultado actual ──
function metric(k, v, unit = "", cls = "") {
    const val = v == null ? "—" : typeof v === "number" ? v.toFixed(2) : v
    return `<div class="metric"><div class="k">${k}</div><div class="v ${cls}">${val}<small style="font-size:12px;color:var(--muted)"> ${unit}</small></div></div>`
}
function renderLastResult(r) {
    $("last-result-card").hidden = false
    const gpuLine = r.gpus.map((g) => `${g.index}: ${Math.round(g.memUsedMiB ?? 0)} MiB`).join(" · ") || "—"
    $("last-result").innerHTML =
        metric("Prompt T/s", r.promptTokensPerSecond, "tok/s", "green") +
        metric("Gen T/s", r.generationTokensPerSecond, "tok/s", "green") +
        metric("Draft acc", r.draftAcceptance, "", "amber") +
        metric("Load time", r.loadTimeSeconds, "s") +
        metric("Latencia req", r.requestLatencyMs, "ms") +
        `<div class="metric" style="grid-column: span 2"><div class="k">VRAM</div><div class="v" style="font-size:13px">${gpuLine}</div></div>`
    if (r.errors.length) {
        $("last-result").innerHTML += `<div class="metric" style="grid-column:1/-1"><div class="k">Errores</div><div class="v" style="font-size:12px;color:var(--red)">${r.errors.join(" · ")}</div></div>`
    }
}

// ── Historial ──
let history = []
const selected = new Set()
async function loadHistory() {
    try {
        const data = await api("/history")
        history = data.results || []
        renderHistory()
    } catch {
        /* ignore */
    }
}
function fmt(n, d = 2) {
    return n == null ? "—" : Number(n).toFixed(d)
}
function shortModel(m) {
    if (!m) return "—"
    const base = m.split(":")[0]
    return base.split("/").pop()?.slice(0, 22) || base
}
function renderHistory() {
    const tbody = $("history-table").querySelector("tbody")
    tbody.innerHTML = ""
    const best = {
        p: Math.max(...history.map((h) => h.promptTokensPerSecond ?? -Infinity), -Infinity),
        g: Math.max(...history.map((h) => h.generationTokensPerSecond ?? -Infinity), -Infinity),
        d: Math.max(...history.map((h) => h.draftAcceptance ?? -Infinity), -Infinity),
        l: Math.min(...history.map((h) => h.loadTimeSeconds ?? Infinity), Infinity),
    }
    for (const r of history) {
        const tr = document.createElement("tr")
        tr.dataset.id = r.id
        if (selected.has(r.id)) tr.classList.add("selected")
        const gpuTxt = r.gpus.map((g) => `${g.index.replace(/^(nvidia|amdgpu-)/i, "")}:${Math.round(g.memUsedMiB ?? 0)}`).join(" ") || "—"
        const date = new Date(r.timestamp)
        const cells = [
            `<input type="checkbox" class="sel" ${selected.has(r.id) ? "checked" : ""}/>`,
            date.toLocaleString(),
            `<span title="${r.config.model}">${shortModel(r.config.model)}</span>`,
            r.config.ctxSize,
            `${r.config.batchSize}/${r.config.ubatchSize}`,
            `${r.config.cacheTypeK}/${r.config.cacheTypeV}`,
            r.config.device || "—",
            r.config.tensorSplit || "—",
            fmt(r.promptTokensPerSecond),
            fmt(r.generationTokensPerSecond),
            fmt(r.draftAcceptance, 3),
            fmt(r.loadTimeSeconds, 2),
            gpuTxt,
            `<button class="ghost tiny apply" title="Cargar config">↗</button>`,
            `<button class="ghost tiny del">✕</button>`,
        ]
        tr.innerHTML = cells
            .map((c, i) => {
                const cls = i >= 8 && i <= 11 ? "num" : ""
                let extra = ""
                if (i === 8 && r.promptTokensPerSecond === best.p && best.p > -Infinity) extra = "best"
                if (i === 9 && r.generationTokensPerSecond === best.g && best.g > -Infinity) extra = "best"
                if (i === 10 && r.draftAcceptance === best.d && best.d > -Infinity) extra = "best"
                if (i === 11 && r.loadTimeSeconds === best.l && best.l < Infinity) extra = "best"
                return `<td class="${cls} ${extra}">${c}</td>`
            })
            .join("")
        tbody.appendChild(tr)
    }
    tbody.querySelectorAll("tr").forEach((tr) => {
        const id = tr.dataset.id
        tr.querySelector(".sel").addEventListener("change", (e) => {
            if (e.target.checked) selected.add(id)
            else selected.delete(id)
            tr.classList.toggle("selected", e.target.checked)
        })
        tr.querySelector(".del").addEventListener("click", async (e) => {
            e.stopPropagation()
            await api(`/history/${encodeURIComponent(id)}`, { method: "DELETE" })
            selected.delete(id)
            await loadHistory()
            toast("Resultado eliminado.")
        })
        tr.querySelector(".apply").addEventListener("click", (e) => {
            e.stopPropagation()
            const item = history.find((h) => h.id === id)
            if (item) {
                writeConfig(item.config)
                saveConfig()
                toast(`Config de ${shortModel(item.config.model)} cargada.`)
            }
        })
    })
}

$("btn-clear-history").addEventListener("click", async () => {
    if (!confirm("¿Borrar todo el historial de benchmarks?")) return
    await api("/history", { method: "DELETE" })
    selected.clear()
    await loadHistory()
    toast("Historial limpiado.")
})

$("btn-clear-logs").addEventListener("click", async () => {
    await api("/logs/clear", { method: "POST" })
    logsEl.innerHTML = ""
    logCursor = 0
})

// ── Comparación ──
$("btn-compare").addEventListener("click", () => {
    const items = history.filter((h) => selected.has(h.id))
    if (items.length < 2) {
        toast("Selecciona 2 o más resultados.", true)
        return
    }
    renderCompare(items)
    $("compare-modal").hidden = false
})
$("btn-compare-close").addEventListener("click", () => ($("compare-modal").hidden = true))

function renderCompare(items) {
    const cols = [
        ["Modelo", (r) => shortModel(r.config.model)],
        ["ctx", (r) => r.config.ctxSize],
        ["batch/ubatch", (r) => `${r.config.batchSize}/${r.config.ubatchSize}`],
        ["cache", (r) => `${r.config.cacheTypeK}/${r.config.cacheTypeV}`],
        ["device", (r) => r.config.device || "—"],
        ["tensor-split", (r) => r.config.tensorSplit || "—"],
        ["Prompt T/s", (r) => fmt(r.promptTokensPerSecond)],
        ["Gen T/s", (r) => fmt(r.generationTokensPerSecond)],
        ["Draft acc", (r) => fmt(r.draftAcceptance, 3)],
        ["Load (s)", (r) => fmt(r.loadTimeSeconds, 2)],
        ["Latencia (ms)", (r) => fmt(r.requestLatencyMs, 0)],
        ["VRAM (MiB)", (r) => r.gpus.map((g) => Math.round(g.memUsedMiB ?? 0)).join(" + ") || "—"],
    ]
    let html = '<div class="table-wrap"><table><thead><tr><th>Métrica</th>'
    for (const r of items) html += `<th>${new Date(r.timestamp).toLocaleString()}</th>`
    html += "</tr></thead><tbody>"
    for (const [label, fn] of cols) {
        html += `<tr><td>${label}</td>`
        for (const r of items) html += `<td class="num">${fn(r)}</td>`
        html += "</tr>"
    }
    html += "</tbody></table></div>"
    $("compare-body").innerHTML = html
}

// ── Bootstrap ──
async function init() {
    // 1) Generar formulario.
    buildForm()

    // 2) Cargar config: localStorage tiene prioridad sobre defaults del backend.
    const stored = loadConfigFromStorage()
    if (stored) {
        writeConfig(stored)
    } else {
        try {
            const c = await api("/config")
            writeConfig(c)
            saveConfig() // guardar defaults como base en localStorage
        } catch {
            updateArgvPreview()
        }
    }

    await pollStatus()
    await loadHistory()
    await loadGpus()

    // Polling.
    setInterval(pollStatus, 1500)
    setInterval(pollLogs, 1000)
    setInterval(loadGpus, 4000)
}
init()
