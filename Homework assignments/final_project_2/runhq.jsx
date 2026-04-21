import { useState, useEffect, useRef, useCallback } from "react";

// ─── Shoe Vector Database (embedded fallback) ─────────────────────────────────
const SHOE_DB = [
  { id: 1, name: "Nike Vaporfly 3", brand: "Nike", category: "race", drop: 8, stack: 40, weight: 194, cushion: "max", surface: "road", bestFor: ["5K", "10K", "half marathon", "marathon"], mileageLife: 300, price: 260, embedding: [0.92, 0.1, 0.95, 0.2, 0.8] },
  { id: 2, name: "Adidas Adizero Adios Pro 3", brand: "Adidas", category: "race", drop: 6, stack: 39, weight: 199, cushion: "max", surface: "road", bestFor: ["half marathon", "marathon"], mileageLife: 300, price: 250, embedding: [0.9, 0.12, 0.93, 0.22, 0.78] },
  { id: 3, name: "Brooks Ghost 15", brand: "Brooks", category: "daily trainer", drop: 12, stack: 28, weight: 279, cushion: "medium", surface: "road", bestFor: ["easy runs", "long runs", "beginners"], mileageLife: 500, price: 140, embedding: [0.3, 0.85, 0.4, 0.9, 0.3] },
  { id: 4, name: "Hoka Clifton 9", brand: "Hoka", category: "daily trainer", drop: 5, stack: 36, weight: 248, cushion: "max", surface: "road", bestFor: ["easy runs", "recovery", "long runs"], mileageLife: 500, price: 145, embedding: [0.4, 0.9, 0.35, 0.92, 0.35] },
  { id: 5, name: "Saucony Kinvara 14", brand: "Saucony", category: "tempo", drop: 4, stack: 26, weight: 218, cushion: "light", surface: "road", bestFor: ["tempo", "10K", "half marathon"], mileageLife: 400, price: 110, embedding: [0.75, 0.4, 0.8, 0.45, 0.7] },
  { id: 6, name: "Altra Lone Peak 7", brand: "Altra", category: "trail", drop: 0, stack: 25, weight: 272, cushion: "medium", surface: "trail", bestFor: ["trail", "ultra", "mountain runs"], mileageLife: 400, price: 150, embedding: [0.2, 0.6, 0.15, 0.55, 0.95] },
  { id: 7, name: "Salomon Speedcross 6", brand: "Salomon", category: "trail", drop: 10, stack: 28, weight: 310, cushion: "medium", surface: "trail", bestFor: ["muddy trails", "technical terrain"], mileageLife: 450, price: 140, embedding: [0.15, 0.55, 0.1, 0.5, 0.98] },
  { id: 8, name: "New Balance FuelCell SuperComp Elite v3", brand: "New Balance", category: "race", drop: 4, stack: 40, weight: 199, cushion: "max", surface: "road", bestFor: ["half marathon", "marathon", "PR attempts"], mileageLife: 300, price: 250, embedding: [0.88, 0.11, 0.91, 0.21, 0.79] },
  { id: 9, name: "On Cloudmonster", brand: "On", category: "daily trainer", drop: 6, stack: 37, weight: 269, cushion: "max", surface: "road", bestFor: ["easy runs", "long runs"], mileageLife: 480, price: 170, embedding: [0.38, 0.88, 0.33, 0.9, 0.32] },
  { id: 10, name: "Asics Gel-Nimbus 25", brand: "Asics", category: "daily trainer", drop: 13, stack: 31, weight: 299, cushion: "max", surface: "road", bestFor: ["high mileage", "overpronation", "long runs"], mileageLife: 500, price: 160, embedding: [0.28, 0.92, 0.3, 0.95, 0.28] },
  { id: 11, name: "Puma Deviate Nitro Elite 2", brand: "Puma", category: "race", drop: 8, stack: 39, weight: 196, cushion: "max", surface: "road", bestFor: ["5K", "10K", "half marathon"], mileageLife: 280, price: 225, embedding: [0.85, 0.13, 0.88, 0.23, 0.77] },
  { id: 12, name: "Hoka Speedgoat 5", brand: "Hoka", category: "trail", drop: 4, stack: 32, weight: 291, cushion: "max", surface: "trail", bestFor: ["trail", "ultra", "technical terrain"], mileageLife: 400, price: 155, embedding: [0.18, 0.58, 0.13, 0.52, 0.96] },
];

function cosineSimilarity(a, b) {
  const dot = a.reduce((s, v, i) => s + v * b[i], 0);
  const mA = Math.sqrt(a.reduce((s, v) => s + v * v, 0));
  const mB = Math.sqrt(b.reduce((s, v) => s + v * v, 0));
  return dot / (mA * mB);
}

function searchShoesFallback(query, topK = 4) {
  const q = query.toLowerCase();
  const qv = [
    q.includes("race") || q.includes("fast") || q.includes("pr") ? 0.9 : 0.3,
    q.includes("easy") || q.includes("daily") || q.includes("recover") ? 0.9 : 0.3,
    q.includes("speed") || q.includes("tempo") || q.includes("5k") || q.includes("10k") ? 0.85 : 0.3,
    q.includes("comfort") || q.includes("cushion") || q.includes("long") ? 0.88 : 0.3,
    q.includes("trail") || q.includes("mountain") || q.includes("mud") ? 0.95 : 0.25,
  ];
  return SHOE_DB
    .map(s => ({ ...s, score: cosineSimilarity(qv, s.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

// ─── ChromaDB HTTP client ─────────────────────────────────────────────────────
// Uses ChromaDB's REST API (v1). Your local instance must have CORS enabled.
// To enable CORS in ChromaDB, start with:
//   CHROMA_SERVER_CORS_ALLOW_ORIGINS='["*"]' chroma run --path ./db
// Or set allow_reset=True and cors_allow_origins in chroma.yaml

async function chromaListCollections(baseUrl) {
  const r = await fetch(`${baseUrl}/api/v1/collections`);
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${r.statusText}`);
  return r.json();
}

async function chromaGetCollection(baseUrl, name) {
  const r = await fetch(`${baseUrl}/api/v1/collections/${encodeURIComponent(name)}`);
  if (!r.ok) throw new Error(`Collection "${name}" not found (HTTP ${r.status})`);
  return r.json();
}

// Query by text (ChromaDB embeds server-side if embedding fn configured)
// Falls back gracefully — returns raw results including documents, metadatas, distances
async function chromaQuery(baseUrl, collectionId, queryText, nResults = 5) {
  const body = {
    query_texts: [queryText],
    n_results: nResults,
    include: ["documents", "metadatas", "distances"],
  };
  const r = await fetch(`${baseUrl}/api/v1/collections/${collectionId}/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const msg = await r.text().catch(() => r.statusText);
    throw new Error(`Query failed (HTTP ${r.status}): ${msg}`);
  }
  const data = await r.json();
  // ChromaDB wraps results in arrays-of-arrays (one array per query_text)
  const docs  = data.documents?.[0]  || [];
  const metas = data.metadatas?.[0]  || [];
  const dists = data.distances?.[0]  || [];
  return docs.map((doc, i) => ({
    document: doc,
    metadata: metas[i] || {},
    distance: dists[i] ?? null,
    score: dists[i] != null ? Math.max(0, 1 - dists[i]) : null,
  }));
}

// ─── Athlete mock data ────────────────────────────────────────────────────────
const MOCK_ATHLETE = {
  name: "Alex Rivera",
  weeklyMileage: 42,
  vo2max: 54.2,
  hrv: 68,
  restingHR: 52,
  sleepScore: 81,
  fitnessScore: 74,
  fatigueScore: 38,
  currentShoe: "Nike Vaporfly 3",
  shoeMiles: 187,
  recentRuns: [
    { date: "Mon", type: "Easy",      miles: 6.2,  pace: "8:45", hr: 138 },
    { date: "Tue", type: "Tempo",     miles: 8.1,  pace: "7:12", hr: 162 },
    { date: "Wed", type: "Rest",      miles: 0,    pace: "—",    hr: 0   },
    { date: "Thu", type: "Intervals", miles: 10.4, pace: "6:48", hr: 171 },
    { date: "Fri", type: "Easy",      miles: 5.0,  pace: "9:02", hr: 134 },
    { date: "Sat", type: "Long",      miles: 14.8, pace: "8:28", hr: 149 },
    { date: "Sun", type: "Recovery",  miles: 4.1,  pace: "9:45", hr: 128 },
  ],
  upcomingRace: { name: "Boston Marathon", date: "April 21, 2026", daysOut: 24 },
};

const SERVICES = [
  { id: "strava",    name: "Strava",       color: "#FC4C02", icon: "S", desc: "Activities & segments" },
  { id: "garmin",    name: "Garmin",       color: "#00A3E0", icon: "G", desc: "GPS & biometrics" },
  { id: "apple",     name: "Apple Health", color: "#FF375F", icon: "♥", desc: "Steps & sleep" },
  { id: "whoop",     name: "Whoop",        color: "#00C3FF", icon: "W", desc: "Recovery & strain" },
  { id: "polar",     name: "Polar",        color: "#D72638", icon: "P", desc: "HR & training load" },
  { id: "nutrition", name: "Cronometer",   color: "#F2A65A", icon: "N", desc: "Nutrition & macros" },
];

const AGENTS = {
  coach:    { name: "Coach Agent",    emoji: "🏃", color: "#6C63FF" },
  analyst:  { name: "Load Analyst",   emoji: "📊", color: "#00C896" },
  recovery: { name: "Recovery Agent", emoji: "🩺", color: "#FF6B6B" },
  nutrition:{ name: "Nutrition Agent",emoji: "🥗", color: "#F2A65A" },
  race:     { name: "Race Oracle",    emoji: "🏁", color: "#FFD93D" },
  shoe:     { name: "Gear Agent",     emoji: "👟", color: "#A78BFA" },
};

function buildAgentSystemPrompt(connectedServices, athlete, agentMode) {
  return `You are RunHQ, an elite AI running coach with specialist sub-agents. Deep expertise in endurance coaching, exercise physiology, and performance optimization.

ACTIVE AGENT: ${agentMode.toUpperCase()}
DATA SOURCES: ${connectedServices.join(", ")}

ATHLETE — ${athlete.name}:
Weekly mileage: ${athlete.weeklyMileage}mi | VO2max: ${athlete.vo2max} | HRV: ${athlete.hrv} | RHR: ${athlete.restingHR}bpm
Sleep: ${athlete.sleepScore}/100 | Fitness: ${athlete.fitnessScore} | Fatigue: ${athlete.fatigueScore}
Current shoe: ${athlete.currentShoe} (${athlete.shoeMiles}mi on them) | Race: ${athlete.upcomingRace.name} in ${athlete.upcomingRace.daysOut} days

WEEK: ${athlete.recentRuns.map(r => `${r.date} ${r.type}${r.miles > 0 ? ` ${r.miles}mi@${r.pace} HR${r.hr}` : ""}`).join(" | ")}

Be specific, data-driven, actionable. Reference athlete's actual numbers. Keep responses concise.`;
}

function buildShoeSystemPrompt(athlete) {
  return `You are a specialist running shoe advisor with deep expertise in biomechanics and shoe technology. You receive real-time results from a ChromaDB vector store containing shoe names, specs (drop, stack, weight), user reviews, and best-use categories.

ATHLETE CONTEXT:
- Weekly mileage: ${athlete.weeklyMileage}mi/week | VO2max: ${athlete.vo2max} | RHR: ${athlete.restingHR}bpm
- Current shoe: ${athlete.currentShoe} (${athlete.shoeMiles} miles used — max ~300mi for race shoes)
- Upcoming: ${athlete.upcomingRace.name} in ${athlete.upcomingRace.daysOut} days
- Week mix: ${athlete.recentRuns.filter(r => r.miles > 0).map(r => r.type).join(", ")}

YOUR JOB:
1. Ground every recommendation in the ChromaDB results provided — cite the shoe name and why it fits
2. Reference specs: drop, stack, weight, cushioning, surface, mileage life
3. Mention user reviews and sentiment when the DB includes them
4. Compare options when multiple shoes retrieved
5. Flag if their current shoe mileage warrants replacement (>80% of rated life)
6. Be conversational and specific, not generic

If no ChromaDB results come back, say so clearly and ask them to refine the query.`;
}

// ─── Retrieved docs accordion ─────────────────────────────────────────────────
function RetrievedDocs({ docs, source }) {
  const [open, setOpen] = useState(false);
  if (!docs?.length) return null;
  return (
    <div style={{ marginTop: 6, marginLeft: 44 }}>
      <button onClick={() => setOpen(v => !v)} style={{ background: "none", border: "none", color: "#3A3A4A", fontSize: 11, cursor: "pointer", display: "flex", alignItems: "center", gap: 5, padding: 0 }}>
        <span style={{ display: "inline-block", transform: open ? "rotate(90deg)" : "none", transition: "transform 0.15s", fontSize: 9 }}>▶</span>
        {docs.length} result{docs.length !== 1 ? "s" : ""} from {source === "chromadb" ? "ChromaDB" : "embedded fallback"}
      </button>
      {open && (
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
          {docs.map((d, i) => (
            <div key={i} style={{ background: "#0C0C12", border: "1px solid #1A1A26", borderRadius: 10, padding: "10px 12px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ color: "#A78BFA", fontSize: 11, fontWeight: 600 }}>#{i + 1}</span>
                <span style={{ color: "#3A3A4A", fontSize: 11, fontFamily: "monospace" }}>
                  {d.score != null ? `${(d.score * 100).toFixed(1)}% match` : ""}
                  {d.distance != null ? ` · dist ${d.distance.toFixed(4)}` : ""}
                </span>
              </div>
              <div style={{ color: "#666", fontSize: 12, lineHeight: 1.5, marginBottom: Object.keys(d.metadata).length ? 8 : 0 }}>{d.document}</div>
              {Object.keys(d.metadata).length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {Object.entries(d.metadata).slice(0, 10).map(([k, v]) => (
                    <span key={k} style={{ background: "#13131A", color: "#4A4A5A", fontSize: 10, padding: "2px 6px", borderRadius: 4 }}>{k}: {String(v)}</span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── ChromaDB config panel ────────────────────────────────────────────────────
function ChromaConfigPanel({ config, onSave, onClose }) {
  const [host, setHost] = useState(config.host);
  const [port, setPort] = useState(config.port);
  const [collection, setCollection] = useState(config.collection);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState(null);
  const [discovered, setDiscovered] = useState([]);

  const baseUrl = `${host}:${port}`;

  const test = async () => {
    setTesting(true); setResult(null); setDiscovered([]);
    try {
      const cols = await chromaListCollections(baseUrl);
      setDiscovered(cols || []);
      setResult({ ok: true, msg: `Connected — ${(cols||[]).length} collection(s) found` });
    } catch (e) {
      setResult({ ok: false, msg: e.message });
    }
    setTesting(false);
  };

  return (
    <div style={{ background: "#0D0D14", border: "1px solid #252535", borderRadius: 16, padding: 22 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 18 }}>🗄️</span>
          <div>
            <div style={{ color: "#F0F0F8", fontWeight: 600, fontSize: 14 }}>ChromaDB connection</div>
            <div style={{ color: "#555", fontSize: 12 }}>localhost HTTP API · CORS must be enabled</div>
          </div>
        </div>
        <button onClick={onClose} style={{ background: "none", border: "none", color: "#555", fontSize: 18, cursor: "pointer", lineHeight: 1 }}>×</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 10, marginBottom: 10 }}>
        {[["Host", host, setHost, "http://localhost"], ["Port", port, setPort, "8000"]].map(([label, val, set, ph]) => (
          <div key={label}>
            <label style={{ color: "#666", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 5 }}>{label}</label>
            <input value={val} onChange={e => set(e.target.value)} placeholder={ph}
              style={{ width: "100%", background: "#13131A", border: "1px solid #1E1E2E", borderRadius: 8, padding: "9px 12px", color: "#F0F0F8", fontSize: 13, outline: "none", boxSizing: "border-box" }} />
          </div>
        ))}
      </div>

      <div style={{ marginBottom: 12 }}>
        <label style={{ color: "#666", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 5 }}>
          Collection name {discovered.length > 0 && <span style={{ color: "#A78BFA", textTransform: "none", letterSpacing: 0 }}>— click to select</span>}
        </label>
        <input value={collection} onChange={e => setCollection(e.target.value)} placeholder="e.g. running_shoes"
          style={{ width: "100%", background: "#13131A", border: "1px solid #1E1E2E", borderRadius: 8, padding: "9px 12px", color: "#F0F0F8", fontSize: 13, outline: "none", boxSizing: "border-box" }} />
      </div>

      {discovered.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
          {discovered.map(c => (
            <button key={c.id} onClick={() => setCollection(c.name)}
              style={{ background: collection === c.name ? "#A78BFA22" : "#13131A", border: `1px solid ${collection === c.name ? "#A78BFA66" : "#1E1E2E"}`, borderRadius: 6, padding: "4px 10px", color: collection === c.name ? "#A78BFA" : "#888", fontSize: 12, cursor: "pointer" }}>
              {c.name}
            </button>
          ))}
        </div>
      )}

      {result && (
        <div style={{ background: result.ok ? "#00C89610" : "#FF6B6B10", border: `1px solid ${result.ok ? "#00C89630" : "#FF6B6B30"}`, borderRadius: 8, padding: "8px 12px", marginBottom: 12, color: result.ok ? "#00C896" : "#FF6B6B", fontSize: 13 }}>
          {result.ok ? "✓" : "✗"} {result.msg}
        </div>
      )}

      <div style={{ background: "#0A0A0F", border: "1px solid #1A1A22", borderRadius: 8, padding: "10px 12px", marginBottom: 14 }}>
        <div style={{ color: "#555", fontSize: 11, marginBottom: 4, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>Enable CORS in ChromaDB</div>
        <code style={{ color: "#A78BFA", fontSize: 11, fontFamily: "monospace", lineHeight: 1.6 }}>
          CHROMA_SERVER_CORS_ALLOW_ORIGINS='["*"]' chroma run --path ./db
        </code>
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={test} disabled={testing}
          style={{ flex: 1, background: "#13131A", border: "1px solid #2A2A3A", borderRadius: 8, padding: "9px", color: "#888", fontSize: 13, cursor: "pointer" }}>
          {testing ? "Testing…" : "Test connection"}
        </button>
        <button onClick={() => { onSave({ host, port, collection }); onClose(); }}
          style={{ flex: 1, background: "#A78BFA", border: "none", borderRadius: 8, padding: "9px", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
          Save & connect
        </button>
      </div>
    </div>
  );
}

// ─── Shoe Chat Tab (ChromaDB RAG) ─────────────────────────────────────────────
function ShoeChatTab({ chromaConfig, onChromaConfigChange, athleteData }) {
  const [msgs, setMsgs] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [chromaStatus, setChromaStatus] = useState("unknown"); // ok | error | fallback | unknown
  const chatEnd = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => { chatEnd.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs]);

  const baseUrl = `${chromaConfig.host}:${chromaConfig.port}`;

  // Probe connection on mount / config change
  useEffect(() => {
    chromaListCollections(baseUrl)
      .then(() => setChromaStatus("ok"))
      .catch(() => setChromaStatus("error"));
  }, [chromaConfig]);

  const send = async () => {
    if (!input.trim() || loading) return;
    const text = input.trim();
    setInput("");
    setMsgs(prev => [...prev, { role: "user", content: text }]);
    setLoading(true);

    // ── Step 1: RAG retrieval from ChromaDB ──────────────────────────────────
    let retrieved = [];
    let source = "fallback";

    try {
      const col = await chromaGetCollection(baseUrl, chromaConfig.collection);
      retrieved = await chromaQuery(baseUrl, col.id, text, 5);
      source = "chromadb";
      setChromaStatus("ok");
    } catch (e) {
      // Graceful fallback to embedded cosine DB
      retrieved = searchShoesFallback(text, 4).map(s => ({
        document: `${s.name} by ${s.brand}. Category: ${s.category}. Drop: ${s.drop}mm, stack: ${s.stack}mm, weight: ${s.weight}g. Cushion: ${s.cushion}. Surface: ${s.surface}. Best for: ${s.bestFor.join(", ")}. Mileage life: ~${s.mileageLife}mi. Price: $${s.price}.`,
        metadata: { brand: s.brand, category: s.category, drop: s.drop, weight: s.weight, price: s.price },
        distance: 1 - s.score,
        score: s.score,
      }));
      source = "fallback";
      if (chromaStatus !== "ok") setChromaStatus("fallback");
    }

    // ── Step 2: Build RAG-augmented prompt ───────────────────────────────────
    const ragBlock = retrieved.length > 0
      ? retrieved.map((d, i) =>
          `[Shoe ${i + 1}${d.score != null ? ` — ${(d.score * 100).toFixed(0)}% match` : ""}]\n` +
          `${d.document}` +
          (Object.keys(d.metadata).length ? `\nSpecs: ${JSON.stringify(d.metadata)}` : "")
        ).join("\n\n")
      : "No results returned from the database.";

    const augmented = `${text}

--- CHROMADB RETRIEVAL (source: ${source}, collection: "${chromaConfig.collection}") ---
${ragBlock}
---

Based on these retrieved records, give your shoe recommendation.`;

    // ── Step 3: Claude ───────────────────────────────────────────────────────
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          system: buildShoeSystemPrompt(athleteData),
          messages: [
            ...msgs.map(m => ({ role: m.role, content: m.content })),
            { role: "user", content: augmented },
          ],
        }),
      });
      const data = await res.json();
      const reply = data.content?.[0]?.text || "No response received.";
      setMsgs(prev => [...prev, { role: "assistant", content: reply, retrieved, source }]);
    } catch {
      setMsgs(prev => [...prev, { role: "assistant", content: "API connection error — check your setup.", retrieved: [], source }]);
    }
    setLoading(false);
  };

  const STARTERS = [
    "Best shoe for my Boston Marathon race day",
    "What trail shoe handles technical rocky terrain?",
    "High-cushion daily trainer for 42mi/week",
    "Compare lightweight tempo options with low drop",
    "My Vaporflys have 187 miles — time to replace?",
    "Recovery shoe for post-long-run days",
  ];

  const statusDot = { ok: "#00C896", error: "#FF6B6B", fallback: "#FFD93D", unknown: "#555" }[chromaStatus];
  const statusText = {
    ok: `ChromaDB · "${chromaConfig.collection}"`,
    error: "ChromaDB offline — using embedded fallback",
    fallback: "Using embedded fallback",
    unknown: "Probing ChromaDB…",
  }[chromaStatus];

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

      {/* Status / config bar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 20px", borderBottom: "1px solid #1E1E2E", background: "#0C0C12", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 7, height: 7, borderRadius: "50%", background: statusDot, boxShadow: chromaStatus === "ok" ? "0 0 6px #00C896" : "none" }} />
          <span style={{ color: "#555", fontSize: 12 }}>{statusText}</span>
          {chromaStatus !== "unknown" && <span style={{ color: "#2A2A3A", fontSize: 12 }}>· {baseUrl}</span>}
        </div>
        <button onClick={() => setShowConfig(v => !v)}
          style={{ background: showConfig ? "#A78BFA22" : "none", border: "1px solid " + (showConfig ? "#A78BFA55" : "#1E1E2E"), borderRadius: 6, padding: "4px 10px", color: showConfig ? "#A78BFA" : "#555", fontSize: 12, cursor: "pointer" }}>
          ⚙ {showConfig ? "Close config" : "Configure DB"}
        </button>
      </div>

      {/* Collapsible config */}
      {showConfig && (
        <div style={{ padding: "16px 20px", borderBottom: "1px solid #1E1E2E", background: "#0A0A0F", flexShrink: 0 }}>
          <ChromaConfigPanel config={chromaConfig} onSave={onChromaConfigChange} onClose={() => setShowConfig(false)} />
        </div>
      )}

      {/* Messages */}
      <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px", display: "flex", flexDirection: "column", gap: 20 }}>
        {msgs.length === 0 && (
          <div style={{ textAlign: "center", marginTop: 28 }}>
            <div style={{ fontSize: 42, marginBottom: 12 }}>👟</div>
            <div style={{ color: "#F0F0F8", fontWeight: 600, fontSize: 19, marginBottom: 6 }}>Shoe Advisor</div>
            <div style={{ color: "#666", fontSize: 14, marginBottom: 6 }}>
              Retrieves from your ChromaDB · falls back to embedded DB if offline
            </div>
            <div style={{ color: "#3A3A4A", fontSize: 13, marginBottom: 28 }}>
              Ask naturally — I'll pull the best matches and explain why they fit your training.
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center", maxWidth: 560, margin: "0 auto" }}>
              {STARTERS.map(p => (
                <button key={p} onClick={() => { setInput(p); inputRef.current?.focus(); }}
                  style={{ background: "#13131A", border: "1px solid #1E1E2E", borderRadius: 20, padding: "8px 14px", color: "#777", fontSize: 12, cursor: "pointer", textAlign: "left" }}>
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}

        {msgs.map((m, i) => (
          <div key={i}>
            <div style={{ display: "flex", gap: 12, flexDirection: m.role === "user" ? "row-reverse" : "row", alignItems: "flex-start" }}>
              {m.role === "assistant" && (
                <div style={{ width: 32, height: 32, background: "#A78BFA22", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0, marginTop: 2 }}>👟</div>
              )}
              <div style={{ maxWidth: "78%", background: m.role === "user" ? "#6C63FF" : "#13131A", border: m.role === "user" ? "none" : "1px solid #1E1E2E", borderRadius: m.role === "user" ? "16px 16px 4px 16px" : "16px 16px 16px 4px", padding: "12px 16px" }}>
                {m.role === "assistant" && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                    <span style={{ color: "#A78BFA", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em" }}>Shoe Advisor</span>
                    <span style={{ background: m.source === "chromadb" ? "#00C89618" : "#FFD93D18", color: m.source === "chromadb" ? "#00C896" : "#FFD93D", fontSize: 10, padding: "2px 7px", borderRadius: 4, fontWeight: 500 }}>
                      {m.source === "chromadb" ? "🗄 ChromaDB" : "⚡ Fallback DB"}
                    </span>
                  </div>
                )}
                <div style={{ color: "#F0F0F8", fontSize: 14, lineHeight: 1.65, whiteSpace: "pre-wrap" }}>{m.content}</div>
              </div>
            </div>
            {m.role === "assistant" && <RetrievedDocs docs={m.retrieved} source={m.source} />}
          </div>
        ))}

        {loading && (
          <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
            <div style={{ width: 32, height: 32, background: "#A78BFA22", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}>👟</div>
            <div style={{ background: "#13131A", border: "1px solid #1E1E2E", borderRadius: "16px 16px 16px 4px", padding: "12px 16px" }}>
              <div style={{ color: "#444", fontSize: 12, marginBottom: 8 }}>Querying ChromaDB…</div>
              <div style={{ display: "flex", gap: 4 }}>
                {[0, 1, 2].map(j => <div key={j} style={{ width: 6, height: 6, background: "#A78BFA", borderRadius: "50%", animation: `bounce 1s ease-in-out ${j * 0.15}s infinite` }} />)}
              </div>
            </div>
          </div>
        )}
        <div ref={chatEnd} />
      </div>

      {/* Input */}
      <div style={{ borderTop: "1px solid #1E1E2E", padding: "14px 20px", flexShrink: 0 }}>
        <div style={{ display: "flex", gap: 10, background: "#13131A", border: "1px solid #252535", borderRadius: 14, padding: "10px 14px", alignItems: "center" }}>
          <span style={{ fontSize: 16, flexShrink: 0 }}>👟</span>
          <input ref={inputRef} value={input} onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && !e.shiftKey && send()}
            placeholder="Ask about shoes — e.g. best race day option for a marathon PR…"
            style={{ flex: 1, background: "none", border: "none", color: "#F0F0F8", fontSize: 14, outline: "none" }} />
          <button onClick={send} disabled={loading || !input.trim()}
            style={{ background: "#A78BFA", border: "none", borderRadius: 8, width: 34, height: 34, color: "#fff", fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", opacity: loading || !input.trim() ? 0.35 : 1, flexShrink: 0 }}>
            →
          </button>
        </div>
        <div style={{ color: "#2A2A3A", fontSize: 11, marginTop: 6, textAlign: "center" }}>
          RAG → ChromaDB "{chromaConfig.collection}" → Claude · embedded fallback if offline
        </div>
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function RunHQ() {
  const [screen, setScreen] = useState("login");
  const [connectedServices, setConnectedServices] = useState([]);
  const [connectingService, setConnectingService] = useState(null);
  const [activeAgent, setActiveAgent] = useState("coach");
  const [agentMsgs, setAgentMsgs] = useState([]);
  const [agentInput, setAgentInput] = useState("");
  const [agentLoading, setAgentLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("chat");
  const [shoeQuery, setShoeQuery] = useState("");
  const [shoeResults, setShoeResults] = useState([]);
  const [chromaConfig, setChromaConfig] = useState({ host: "http://localhost", port: "8000", collection: "running_shoes" });
  const chatEnd = useRef(null);
  const agentInput$ = useRef(null);

  useEffect(() => { chatEnd.current?.scrollIntoView({ behavior: "smooth" }); }, [agentMsgs]);

  const handleConnect = useCallback((id) => {
    setConnectingService(id);
    setTimeout(() => { setConnectedServices(p => [...p, id]); setConnectingService(null); }, 1800);
  }, []);

  const handleDisconnect = useCallback((id) => setConnectedServices(p => p.filter(s => s !== id)), []);

  const sendAgentMsg = useCallback(async () => {
    if (!agentInput.trim() || agentLoading) return;
    const text = agentInput.trim();
    setAgentInput("");
    setAgentMsgs(prev => [...prev, { role: "user", content: text }]);
    setAgentLoading(true);
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          system: buildAgentSystemPrompt(connectedServices.length ? connectedServices : ["demo"], MOCK_ATHLETE, activeAgent),
          messages: [...agentMsgs.map(m => ({ role: m.role, content: m.content })), { role: "user", content: text }],
        }),
      });
      const data = await res.json();
      setAgentMsgs(prev => [...prev, { role: "assistant", content: data.content?.[0]?.text || "No response.", agent: activeAgent }]);
    } catch {
      setAgentMsgs(prev => [...prev, { role: "assistant", content: "Connection error.", agent: activeAgent }]);
    }
    setAgentLoading(false);
  }, [agentInput, agentLoading, agentMsgs, activeAgent, connectedServices]);

  const agent = AGENTS[activeAgent];
  const svcLabel = connectedServices.length
    ? connectedServices.map(id => SERVICES.find(s => s.id === id)?.name).join(" · ")
    : "Demo mode";

  const STARTERS_BY_AGENT = {
    coach: ["Design my week plan", "Am I overtraining?", "Adjust for Boston"],
    analyst: ["Training load analysis", "CTL vs ATL", "Flag overtraining risk"],
    recovery: ["My recovery score", "Should I train today?", "Improve my HRV"],
    nutrition: ["Pre-race nutrition", "Fueling during marathon", "Daily protein target"],
    race: ["Predict my Boston time", "Pace strategy", "Taper plan"],
    shoe: ["Best shoe for marathon", "Trail options", "Recommend recovery shoe"],
  };

  // ── Login ──
  if (screen === "login") return (
    <div style={{ minHeight: "100vh", background: "#0A0A0F", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'DM Sans', sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet" />
      <div style={{ width: "100%", maxWidth: 420, padding: "0 24px" }}>
        <div style={{ textAlign: "center", marginBottom: 48 }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
            <div style={{ width: 44, height: 44, background: "linear-gradient(135deg,#6C63FF,#00C896)", borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>🏃</div>
            <span style={{ fontSize: 28, fontWeight: 600, color: "#F0F0F8", letterSpacing: "-0.5px" }}>RunHQ</span>
          </div>
          <p style={{ color: "#555", fontSize: 14, margin: 0 }}>Your AI running command center</p>
        </div>
        <div style={{ background: "#13131A", border: "1px solid #1E1E2E", borderRadius: 20, padding: 32 }}>
          <h2 style={{ color: "#F0F0F8", fontSize: 20, fontWeight: 600, margin: "0 0 6px" }}>Welcome back</h2>
          <p style={{ color: "#555", fontSize: 13, margin: "0 0 28px" }}>Sign in to your athlete profile</p>
          {[["Email", "alex@runhq.ai", "text"], ["Password", "••••••••", "password"]].map(([l, v, t]) => (
            <div key={l} style={{ marginBottom: l === "Password" ? 28 : 16 }}>
              <label style={{ display: "block", color: "#666", fontSize: 12, marginBottom: 6, letterSpacing: "0.05em", textTransform: "uppercase" }}>{l}</label>
              <input type={t} defaultValue={v} style={{ width: "100%", background: "#0A0A0F", border: "1px solid #1E1E2E", borderRadius: 10, padding: "12px 14px", color: "#F0F0F8", fontSize: 14, outline: "none", boxSizing: "border-box" }} />
            </div>
          ))}
          <button onClick={() => setScreen("connect")} style={{ width: "100%", background: "linear-gradient(135deg,#6C63FF,#5B53EE)", border: "none", borderRadius: 12, padding: "14px", color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>Sign in →</button>
        </div>
      </div>
    </div>
  );

  // ── Connect ──
  if (screen === "connect") return (
    <div style={{ minHeight: "100vh", background: "#0A0A0F", fontFamily: "'DM Sans', sans-serif", paddingBottom: 60 }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet" />
      <div style={{ borderBottom: "1px solid #1E1E2E", padding: "20px 32px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 32, height: 32, background: "linear-gradient(135deg,#6C63FF,#00C896)", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>🏃</div>
          <span style={{ color: "#F0F0F8", fontWeight: 600, fontSize: 18 }}>RunHQ</span>
        </div>
        <button onClick={() => setScreen("dashboard")} style={{ background: connectedServices.length ? "#6C63FF" : "#1E1E2E", border: "none", borderRadius: 10, padding: "10px 20px", color: connectedServices.length ? "#fff" : "#555", fontSize: 14, fontWeight: 500, cursor: "pointer" }}>
          {connectedServices.length ? `Continue with ${connectedServices.length} source(s) →` : "Skip →"}
        </button>
      </div>
      <div style={{ maxWidth: 680, margin: "0 auto", padding: "48px 24px 0" }}>
        <h1 style={{ color: "#F0F0F8", fontSize: 28, fontWeight: 600, margin: "0 0 8px" }}>Connect your data sources</h1>
        <p style={{ color: "#666", fontSize: 15, margin: "0 0 32px" }}>The more you connect, the smarter your agents become.</p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          {SERVICES.map(svc => {
            const connected = connectedServices.includes(svc.id);
            const connecting = connectingService === svc.id;
            return (
              <div key={svc.id} style={{ background: "#13131A", border: `1px solid ${connected ? svc.color + "44" : "#1E1E2E"}`, borderRadius: 16, padding: 20 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
                  <div style={{ width: 42, height: 42, background: svc.color + "22", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", color: svc.color, fontWeight: 700, fontSize: 16 }}>{svc.icon}</div>
                  {connected && <div style={{ background: "#00C89620", color: "#00C896", fontSize: 11, fontWeight: 500, padding: "3px 8px", borderRadius: 6, height: "fit-content" }}>✓ Connected</div>}
                </div>
                <div style={{ color: "#F0F0F8", fontWeight: 600, fontSize: 15, marginBottom: 4 }}>{svc.name}</div>
                <div style={{ color: "#555", fontSize: 13, marginBottom: 16 }}>{svc.desc}</div>
                <button onClick={() => connected ? handleDisconnect(svc.id) : handleConnect(svc.id)} disabled={connecting}
                  style={{ width: "100%", background: connected ? "transparent" : svc.color + "22", border: `1px solid ${connected ? "#333" : svc.color + "55"}`, borderRadius: 8, padding: "9px", color: connected ? "#555" : svc.color, fontSize: 13, fontWeight: 500, cursor: "pointer" }}>
                  {connecting ? "Authorizing…" : connected ? "Disconnect" : `Connect ${svc.name}`}
                </button>
              </div>
            );
          })}
        </div>
        <div style={{ background: "#13131A", border: "1px solid #A78BFA44", borderRadius: 16, padding: 20, marginTop: 16, display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ width: 42, height: 42, background: "#A78BFA22", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>🗄️</div>
          <div style={{ flex: 1 }}>
            <div style={{ color: "#F0F0F8", fontWeight: 600, fontSize: 15 }}>ChromaDB Shoe Database</div>
            <div style={{ color: "#555", fontSize: 13 }}>{chromaConfig.host}:{chromaConfig.port} · collection: "{chromaConfig.collection}" · RAG-powered recommendations</div>
          </div>
          <div style={{ background: "#A78BFA22", color: "#A78BFA", fontSize: 11, fontWeight: 500, padding: "3px 10px", borderRadius: 6 }}>RAG ready</div>
        </div>
      </div>
    </div>
  );

  // ── Dashboard ──
  return (
    <div style={{ height: "100vh", background: "#0A0A0F", fontFamily: "'DM Sans', sans-serif", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet" />

      {/* Topbar */}
      <div style={{ borderBottom: "1px solid #1E1E2E", padding: "12px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 30, height: 30, background: "linear-gradient(135deg,#6C63FF,#00C896)", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15 }}>🏃</div>
          <span style={{ color: "#F0F0F8", fontWeight: 600, fontSize: 17 }}>RunHQ</span>
          <span style={{ color: "#2A2A3A", fontSize: 14 }}>/ {MOCK_ATHLETE.upcomingRace.name}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span style={{ color: "#333", fontSize: 12 }}>{svcLabel}</span>
          <button onClick={() => setScreen("connect")} style={{ background: "#1E1E2E", border: "1px solid #2A2A3A", borderRadius: 8, padding: "6px 12px", color: "#666", fontSize: 12, cursor: "pointer" }}>+ Sources</button>
          <div style={{ width: 32, height: 32, background: "#6C63FF", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 600, fontSize: 13 }}>AR</div>
        </div>
      </div>

      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* Sidebar */}
        <div style={{ width: 220, borderRight: "1px solid #1E1E2E", padding: "20px 16px", overflowY: "auto", flexShrink: 0 }}>
          <div style={{ background: "linear-gradient(135deg,#6C63FF22,#00C89622)", border: "1px solid #6C63FF33", borderRadius: 12, padding: 14, marginBottom: 20 }}>
            <div style={{ color: "#555", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>Race day</div>
            <div style={{ color: "#F0F0F8", fontWeight: 600, fontSize: 14, marginBottom: 2 }}>{MOCK_ATHLETE.upcomingRace.name}</div>
            <div style={{ color: "#6C63FF", fontSize: 24, fontWeight: 600 }}>{MOCK_ATHLETE.upcomingRace.daysOut}<span style={{ fontSize: 13, color: "#555", fontWeight: 400 }}> days</span></div>
          </div>
          {[["Weekly miles", MOCK_ATHLETE.weeklyMileage, "mi"], ["VO2max", MOCK_ATHLETE.vo2max, ""], ["HRV", MOCK_ATHLETE.hrv, ""], ["Resting HR", MOCK_ATHLETE.restingHR, "bpm"], ["Sleep", MOCK_ATHLETE.sleepScore, "/100"], ["Fitness", MOCK_ATHLETE.fitnessScore, ""], ["Fatigue", MOCK_ATHLETE.fatigueScore, ""]].map(([l, v, u]) => (
            <div key={l} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #1A1A22" }}>
              <span style={{ color: "#555", fontSize: 12 }}>{l}</span>
              <span style={{ color: "#F0F0F8", fontSize: 14, fontWeight: 500, fontFamily: "'DM Mono', monospace" }}>{v}{u}</span>
            </div>
          ))}
          <div style={{ marginTop: 20 }}>
            <div style={{ color: "#555", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>Current shoe</div>
            <div style={{ background: "#A78BFA15", border: "1px solid #A78BFA33", borderRadius: 10, padding: 12 }}>
              <div style={{ color: "#A78BFA", fontSize: 13, fontWeight: 500 }}>👟 {MOCK_ATHLETE.currentShoe}</div>
              <div style={{ color: "#555", fontSize: 12, marginTop: 4 }}>{MOCK_ATHLETE.shoeMiles} mi used</div>
              <div style={{ background: "#1A1A22", borderRadius: 4, height: 4, marginTop: 8, overflow: "hidden" }}>
                <div style={{ background: "#A78BFA", height: "100%", width: `${(MOCK_ATHLETE.shoeMiles / 300) * 100}%`, borderRadius: 4 }} />
              </div>
              <div style={{ color: "#3A3A4A", fontSize: 11, marginTop: 4 }}>{300 - MOCK_ATHLETE.shoeMiles} mi remaining</div>
            </div>
          </div>
          <div style={{ marginTop: 20 }}>
            <div style={{ color: "#555", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>This week</div>
            {MOCK_ATHLETE.recentRuns.map(r => (
              <div key={r.date} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", borderBottom: "1px solid #12121A" }}>
                <span style={{ color: "#333", fontSize: 11, width: 28 }}>{r.date}</span>
                <span style={{ color: r.miles === 0 ? "#2A2A3A" : "#F0F0F8", fontSize: 12, flex: 1 }}>{r.type}</span>
                <span style={{ color: "#444", fontSize: 11, fontFamily: "'DM Mono', monospace" }}>{r.miles > 0 ? `${r.miles}mi` : "—"}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Main content */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {/* Tabs */}
          <div style={{ display: "flex", padding: "0 20px", borderBottom: "1px solid #1E1E2E", flexShrink: 0, overflowX: "auto" }}>
            {[
              { id: "chat",     label: "💬 Agent Chat" },
              { id: "shoechat", label: "👟 Shoe Advisor" },
              { id: "shoes",    label: "🔍 Gear Search" },
              { id: "week",     label: "📅 Week Plan" },
            ].map(t => (
              <button key={t.id} onClick={() => setActiveTab(t.id)}
                style={{ background: "none", border: "none", borderBottom: `2px solid ${activeTab === t.id ? (t.id === "shoechat" ? "#A78BFA" : "#6C63FF") : "transparent"}`, padding: "14px 18px", color: activeTab === t.id ? "#F0F0F8" : "#444", fontSize: 13, fontWeight: activeTab === t.id ? 600 : 400, cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 }}>
                {t.label}
              </button>
            ))}
          </div>

          {/* ── Agent Chat ── */}
          {activeTab === "chat" && (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
              <div style={{ display: "flex", gap: 8, padding: "12px 20px", borderBottom: "1px solid #1E1E2E", overflowX: "auto", flexShrink: 0 }}>
                {Object.entries(AGENTS).map(([id, a]) => (
                  <button key={id} onClick={() => { setActiveAgent(id); setAgentMsgs([]); }}
                    style={{ background: activeAgent === id ? a.color + "20" : "transparent", border: `1px solid ${activeAgent === id ? a.color + "55" : "#1E1E2E"}`, borderRadius: 20, padding: "6px 14px", color: activeAgent === id ? a.color : "#444", fontSize: 12, fontWeight: activeAgent === id ? 600 : 400, cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 }}>
                    {a.emoji} {a.name}
                  </button>
                ))}
              </div>
              <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
                {agentMsgs.length === 0 && (
                  <div style={{ textAlign: "center", marginTop: 40 }}>
                    <div style={{ fontSize: 36, marginBottom: 12 }}>{agent.emoji}</div>
                    <div style={{ color: "#F0F0F8", fontWeight: 600, fontSize: 18, marginBottom: 6 }}>{agent.name}</div>
                    <div style={{ color: "#555", fontSize: 14, marginBottom: 24 }}>Ask me anything, {MOCK_ATHLETE.name.split(" ")[0]}.</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
                      {(STARTERS_BY_AGENT[activeAgent] || []).map(s => (
                        <button key={s} onClick={() => { setAgentInput(s); agentInput$.current?.focus(); }}
                          style={{ background: "#1E1E2E", border: "1px solid #2A2A3A", borderRadius: 20, padding: "8px 16px", color: "#777", fontSize: 13, cursor: "pointer" }}>{s}</button>
                      ))}
                    </div>
                  </div>
                )}
                {agentMsgs.map((m, i) => (
                  <div key={i} style={{ display: "flex", gap: 12, flexDirection: m.role === "user" ? "row-reverse" : "row", alignItems: "flex-start" }}>
                    {m.role === "assistant" && (
                      <div style={{ width: 32, height: 32, background: AGENTS[m.agent]?.color + "20", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}>{AGENTS[m.agent]?.emoji}</div>
                    )}
                    <div style={{ maxWidth: "75%", background: m.role === "user" ? "#6C63FF" : "#13131A", border: m.role === "user" ? "none" : "1px solid #1E1E2E", borderRadius: m.role === "user" ? "16px 16px 4px 16px" : "16px 16px 16px 4px", padding: "12px 16px" }}>
                      {m.role === "assistant" && <div style={{ color: AGENTS[m.agent]?.color, fontSize: 11, fontWeight: 600, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.08em" }}>{AGENTS[m.agent]?.name}</div>}
                      <div style={{ color: "#F0F0F8", fontSize: 14, lineHeight: 1.65, whiteSpace: "pre-wrap" }}>{m.content}</div>
                    </div>
                  </div>
                ))}
                {agentLoading && (
                  <div style={{ display: "flex", gap: 12 }}>
                    <div style={{ width: 32, height: 32, background: agent.color + "20", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>{agent.emoji}</div>
                    <div style={{ background: "#13131A", border: "1px solid #1E1E2E", borderRadius: "16px 16px 16px 4px", padding: "12px 16px" }}>
                      <div style={{ display: "flex", gap: 4 }}>
                        {[0, 1, 2].map(j => <div key={j} style={{ width: 6, height: 6, background: agent.color, borderRadius: "50%", animation: `bounce 1s ease-in-out ${j * 0.15}s infinite` }} />)}
                      </div>
                    </div>
                  </div>
                )}
                <div ref={chatEnd} />
              </div>
              <div style={{ borderTop: "1px solid #1E1E2E", padding: "16px 20px", flexShrink: 0 }}>
                <div style={{ display: "flex", gap: 10, background: "#13131A", border: "1px solid #1E1E2E", borderRadius: 14, padding: "10px 14px" }}>
                  <input ref={agentInput$} value={agentInput} onChange={e => setAgentInput(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && !e.shiftKey && sendAgentMsg()}
                    placeholder={`Ask ${agent.name}…`}
                    style={{ flex: 1, background: "none", border: "none", color: "#F0F0F8", fontSize: 14, outline: "none" }} />
                  <button onClick={sendAgentMsg} disabled={agentLoading || !agentInput.trim()}
                    style={{ background: "#6C63FF", border: "none", borderRadius: 8, width: 34, height: 34, color: "#fff", fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", opacity: agentLoading || !agentInput.trim() ? 0.35 : 1 }}>→</button>
                </div>
              </div>
            </div>
          )}

          {/* ── Shoe Advisor (ChromaDB RAG) ── */}
          {activeTab === "shoechat" && (
            <ShoeChatTab chromaConfig={chromaConfig} onChromaConfigChange={setChromaConfig} athleteData={MOCK_ATHLETE} />
          )}

          {/* ── Gear Search (embedded) ── */}
          {activeTab === "shoes" && (
            <div style={{ flex: 1, overflowY: "auto", padding: "24px" }}>
              <h2 style={{ color: "#F0F0F8", fontSize: 18, fontWeight: 600, margin: "0 0 6px" }}>Gear Search</h2>
              <p style={{ color: "#555", fontSize: 13, margin: "0 0 16px" }}>{SHOE_DB.length} shoes · embedded cosine search</p>
              <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
                <input value={shoeQuery} onChange={e => setShoeQuery(e.target.value)} onKeyDown={e => e.key === "Enter" && (() => { if (shoeQuery.trim()) setShoeResults(searchShoesFallback(shoeQuery, 4)); })()}
                  placeholder="e.g. marathon race day, trail ultra, daily cushioned…"
                  style={{ flex: 1, background: "#13131A", border: "1px solid #1E1E2E", borderRadius: 10, padding: "11px 14px", color: "#F0F0F8", fontSize: 14, outline: "none" }} />
                <button onClick={() => { if (shoeQuery.trim()) setShoeResults(searchShoesFallback(shoeQuery, 4)); }}
                  style={{ background: "#A78BFA", border: "none", borderRadius: 10, padding: "0 20px", color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Search</button>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
                {["marathon race", "trail running", "easy recovery", "tempo speed", "daily trainer"].map(q => (
                  <button key={q} onClick={() => { setShoeQuery(q); setShoeResults(searchShoesFallback(q, 4)); }}
                    style={{ background: "#1E1E2E", border: "1px solid #2A2A3A", borderRadius: 20, padding: "5px 12px", color: "#777", fontSize: 12, cursor: "pointer" }}>{q}</button>
                ))}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                {(shoeResults.length ? shoeResults : SHOE_DB.map(s => ({ ...s, score: null }))).map((shoe, idx) => (
                  <div key={shoe.id} style={{ background: "#13131A", border: `1px solid ${idx === 0 && shoeResults.length ? "#A78BFA55" : "#1E1E2E"}`, borderRadius: 14, padding: 16 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                      <span style={{ color: "#F0F0F8", fontWeight: 600, fontSize: 14 }}>{shoe.name}</span>
                      <span style={{ color: "#A78BFA", fontSize: 13, fontWeight: 500 }}>${shoe.price}</span>
                    </div>
                    {shoe.score != null && <div style={{ color: "#555", fontSize: 11, marginBottom: 6 }}>Match: {(shoe.score * 100).toFixed(0)}%</div>}
                    <div style={{ color: "#555", fontSize: 12, marginBottom: 10 }}>{shoe.category} · {shoe.surface} · {shoe.weight}g · drop {shoe.drop}mm</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                      {shoe.bestFor.map(b => <span key={b} style={{ background: "#1E1E2E", color: "#777", fontSize: 11, padding: "2px 7px", borderRadius: 4 }}>{b}</span>)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Week Plan ── */}
          {activeTab === "week" && (
            <div style={{ flex: 1, overflowY: "auto", padding: "24px" }}>
              <h2 style={{ color: "#F0F0F8", fontSize: 18, fontWeight: 600, margin: "0 0 6px" }}>This week's training</h2>
              <p style={{ color: "#555", fontSize: 13, margin: "0 0 20px" }}>Boston Marathon prep · Week 20 of 24</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {MOCK_ATHLETE.recentRuns.map(r => {
                  const c = { Easy: "#00C896", Tempo: "#FFD93D", Intervals: "#FF6B6B", Long: "#6C63FF", Recovery: "#00C3FF", Rest: "#333" }[r.type] || "#777";
                  return (
                    <div key={r.date} style={{ background: "#13131A", border: "1px solid #1E1E2E", borderRadius: 12, padding: 16, display: "flex", alignItems: "center", gap: 16 }}>
                      <div style={{ width: 44 }}><span style={{ color: "#444", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em" }}>{r.date}</span></div>
                      <div style={{ width: 8, height: 8, background: c, borderRadius: "50%", flexShrink: 0 }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ color: "#F0F0F8", fontWeight: 500 }}>{r.type}</div>
                        {r.miles > 0 && <div style={{ color: "#555", fontSize: 13 }}>{r.miles} mi · {r.pace}/mi · HR zone {r.hr < 140 ? 2 : r.hr < 155 ? 3 : r.hr < 165 ? 4 : 5}</div>}
                      </div>
                      {r.miles > 0 && (
                        <div style={{ display: "flex", gap: 16 }}>
                          {[["miles", r.miles], ["pace", r.pace], ["bpm", r.hr]].map(([u, v]) => (
                            <div key={u} style={{ textAlign: "center" }}>
                              <div style={{ color: "#F0F0F8", fontWeight: 600, fontFamily: "'DM Mono', monospace" }}>{v}</div>
                              <div style={{ color: "#555", fontSize: 11 }}>{u}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <div style={{ background: "#6C63FF15", border: "1px solid #6C63FF33", borderRadius: 12, padding: 16, marginTop: 16 }}>
                <div style={{ color: "#6C63FF", fontWeight: 600, fontSize: 14, marginBottom: 4 }}>Week summary</div>
                <div style={{ color: "#777", fontSize: 13 }}>Total: {MOCK_ATHLETE.weeklyMileage} miles · Fitness: {MOCK_ATHLETE.fitnessScore} · Fatigue: {MOCK_ATHLETE.fatigueScore} · Form: +{MOCK_ATHLETE.fitnessScore - MOCK_ATHLETE.fatigueScore}</div>
              </div>
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes bounce { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-5px)} }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #252535; border-radius: 4px; }
      `}</style>
    </div>
  );
}