import { useState, useEffect, useRef, useCallback } from "react";

// ─── ChromaDB config ──────────────────────────────────────────────────────────
const CHROMA_URL = "http://localhost:8000";
const CHROMA_COLLECTION = "shoes";

async function queryChroma(queryText, nResults = 5) {
  const colRes = await fetch(`${CHROMA_URL}/api/v1/collections/${CHROMA_COLLECTION}`);
  if (!colRes.ok) throw new Error(`Collection "${CHROMA_COLLECTION}" not found`);
  const col = await colRes.json();
  const qRes = await fetch(`${CHROMA_URL}/api/v1/collections/${col.id}/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query_texts: [queryText], n_results: nResults, include: ["documents", "metadatas", "distances"] }),
  });
  if (!qRes.ok) throw new Error(`Query failed (${qRes.status})`);
  const data = await qRes.json();
  const docs = data.documents?.[0] || [];
  const metas = data.metadatas?.[0] || [];
  const distances = data.distances?.[0] || [];
  return docs.map((doc, i) => {
    const meta = metas[i] || {};
    let pros = meta.pros;
    if (typeof pros === "string") {
      try { pros = JSON.parse(pros); } catch { pros = pros.split(",").map(s => s.trim()); }
    }
    return { model: meta.model || doc, url: meta.url || "", score: meta.score || "", pros: Array.isArray(pros) ? pros : [], relevance: Math.max(0, Math.round((1 - (distances[i] || 1)) * 100)) };
  });
}

// ─── Local shoe DB ────────────────────────────────────────────────────────────
const SHOE_DB = [
  { id:1,  name:"Nike Vaporfly 3",               brand:"Nike",        category:"race",          drop:8,  stack:40, weight:194, surface:"road",  bestFor:["5K","10K","half marathon","marathon"],      mileageLife:300, price:260, e:[0.92,0.1,0.95,0.2,0.8]  },
  { id:2,  name:"Adidas Adizero Adios Pro 3",    brand:"Adidas",      category:"race",          drop:6,  stack:39, weight:199, surface:"road",  bestFor:["half marathon","marathon"],                 mileageLife:300, price:250, e:[0.9,0.12,0.93,0.22,0.78] },
  { id:3,  name:"Brooks Ghost 15",               brand:"Brooks",      category:"daily trainer", drop:12, stack:28, weight:279, surface:"road",  bestFor:["easy runs","long runs","beginners"],        mileageLife:500, price:140, e:[0.3,0.85,0.4,0.9,0.3]   },
  { id:4,  name:"Hoka Clifton 9",                brand:"Hoka",        category:"daily trainer", drop:5,  stack:36, weight:248, surface:"road",  bestFor:["easy runs","recovery","long runs"],         mileageLife:500, price:145, e:[0.4,0.9,0.35,0.92,0.35] },
  { id:5,  name:"Saucony Kinvara 14",            brand:"Saucony",     category:"tempo",         drop:4,  stack:26, weight:218, surface:"road",  bestFor:["tempo","10K","half marathon"],              mileageLife:400, price:110, e:[0.75,0.4,0.8,0.45,0.7]  },
  { id:6,  name:"Altra Lone Peak 7",             brand:"Altra",       category:"trail",         drop:0,  stack:25, weight:272, surface:"trail", bestFor:["trail","ultra","mountain runs"],            mileageLife:400, price:150, e:[0.2,0.6,0.15,0.55,0.95] },
  { id:7,  name:"Salomon Speedcross 6",          brand:"Salomon",     category:"trail",         drop:10, stack:28, weight:310, surface:"trail", bestFor:["muddy trails","technical terrain"],         mileageLife:450, price:140, e:[0.15,0.55,0.1,0.5,0.98] },
  { id:8,  name:"NB FuelCell SuperComp Elite v3",brand:"New Balance", category:"race",          drop:4,  stack:40, weight:199, surface:"road",  bestFor:["half marathon","marathon","PR attempts"],   mileageLife:300, price:250, e:[0.88,0.11,0.91,0.21,0.79]},
  { id:9,  name:"On Cloudmonster",               brand:"On",          category:"daily trainer", drop:6,  stack:37, weight:269, surface:"road",  bestFor:["easy runs","long runs"],                   mileageLife:480, price:170, e:[0.38,0.88,0.33,0.9,0.32] },
  { id:10, name:"Asics Gel-Nimbus 25",           brand:"Asics",       category:"daily trainer", drop:13, stack:31, weight:299, surface:"road",  bestFor:["high mileage","overpronation","long runs"], mileageLife:500, price:160, e:[0.28,0.92,0.3,0.95,0.28] },
  { id:11, name:"Puma Deviate Nitro Elite 2",    brand:"Puma",        category:"race",          drop:8,  stack:39, weight:196, surface:"road",  bestFor:["5K","10K","half marathon"],                 mileageLife:280, price:225, e:[0.85,0.13,0.88,0.23,0.77]},
  { id:12, name:"Hoka Speedgoat 5",              brand:"Hoka",        category:"trail",         drop:4,  stack:32, weight:291, surface:"trail", bestFor:["trail","ultra","technical terrain"],        mileageLife:400, price:155, e:[0.18,0.58,0.13,0.52,0.96]},
];
function cosSim(a,b){const d=a.reduce((s,v,i)=>s+v*b[i],0);return d/(Math.sqrt(a.reduce((s,v)=>s+v*v,0))*Math.sqrt(b.reduce((s,v)=>s+v*v,0)));}
function localSearch(q,k=4){
  const ql=q.toLowerCase();
  const qv=[ql.includes("race")||ql.includes("fast")||ql.includes("pr")?0.9:0.3,ql.includes("easy")||ql.includes("daily")||ql.includes("recover")?0.9:0.3,ql.includes("speed")||ql.includes("tempo")?0.85:0.3,ql.includes("cushion")||ql.includes("long")?0.88:0.3,ql.includes("trail")||ql.includes("mud")?0.95:0.25];
  return SHOE_DB.map(s=>({...s,sim:cosSim(qv,s.e)})).sort((a,b)=>b.sim-a.sim).slice(0,k);
}

// ─── Service definitions ──────────────────────────────────────────────────────
const SERVICES = [
  {
    id: "strava",
    name: "Strava",
    color: "#FC4C02",
    icon: "S",
    desc: "Activities, segments & social",
    authUrl: "https://www.strava.com/oauth/authorize",
    scope: "read,activity:read_all",
    clientId: "YOUR_STRAVA_CLIENT_ID", // replace in production
  },
  {
    id: "garmin",
    name: "Garmin Connect",
    color: "#00A3E0",
    icon: "G",
    desc: "GPS, biometrics & device data",
    authUrl: "https://connect.garmin.com/oauthConfirm",
    scope: "ACTIVITY_EXPORT",
    clientId: "YOUR_GARMIN_CLIENT_ID",
  },
  {
    id: "apple",
    name: "Apple Health",
    color: "#FF375F",
    icon: "♥",
    desc: "Steps, sleep & health metrics",
    authUrl: null, // iOS HealthKit — handled via native bridge
    note: "Requires iOS app",
  },
  {
    id: "whoop",
    name: "Whoop",
    color: "#00C3FF",
    icon: "W",
    desc: "Recovery, strain & HRV",
    authUrl: "https://api.prod.whoop.com/oauth/oauth2/auth",
    scope: "read:recovery read:sleep read:workout",
    clientId: "YOUR_WHOOP_CLIENT_ID",
  },
  {
    id: "polar",
    name: "Polar Flow",
    color: "#D72638",
    icon: "P",
    desc: "HR, training load & nightly recharge",
    authUrl: "https://flow.polar.com/oauth2/authorization",
    scope: "accesslink.read_all",
    clientId: "YOUR_POLAR_CLIENT_ID",
  },
  {
    id: "cronometer",
    name: "Cronometer",
    color: "#F2A65A",
    icon: "N",
    desc: "Nutrition, macros & micronutrients",
    authUrl: "https://cronometer.com/oauth2/authorize",
    scope: "diary",
    clientId: "YOUR_CRONOMETER_CLIENT_ID",
  },
];

// ─── Mock data per service (simulates what the API would return) ──────────────
const SERVICE_DATA = {
  strava: {
    label: "Strava",
    summary: "7 activities this week · 48.6 mi · 6h 22m · 2,840 ft gain",
    details: {
      weeklyMileage: 48.6,
      activities: [
        { name: "Monday Easy Run", date: "Mon", type: "Easy Run", distance: 6.2, pace: "8:45", hr: 138, elev: 120 },
        { name: "Tuesday Tempo", date: "Tue", type: "Tempo Run", distance: 8.1, pace: "7:12", hr: 162, elev: 85 },
        { name: "Thursday Track", date: "Thu", type: "Workout", distance: 10.4, pace: "6:48", hr: 171, elev: 40 },
        { name: "Friday Easy", date: "Fri", type: "Easy Run", distance: 5.0, pace: "9:02", hr: 134, elev: 65 },
        { name: "Saturday Long", date: "Sat", type: "Long Run", distance: 14.8, pace: "8:28", hr: 149, elev: 980 },
        { name: "Sunday Recovery", date: "Sun", type: "Recovery", distance: 4.1, pace: "9:45", hr: 128, elev: 55 },
      ],
      segments: ["Heartbreak Hill KOM: 4:22", "Boston Common Mile: 5:58"],
      kudos: 47,
    },
  },
  garmin: {
    label: "Garmin Connect",
    summary: "VO2max 54.2 · HRV 68ms · Body Battery 72 · 8,240 avg steps",
    details: {
      vo2max: 54.2,
      hrv: 68,
      bodyBattery: 72,
      restingHR: 52,
      avgSteps: 8240,
      trainingLoad: 482,
      trainingStatus: "Productive",
      lactateThreshold: { pace: "7:08/mi", hr: 168 },
      racePredictor: { marathon: "3:08:22", halfMarathon: "1:27:44", "10K": "41:12" },
      devices: ["Forerunner 965", "HRM-Pro Plus"],
    },
  },
  apple: {
    label: "Apple Health",
    summary: "Sleep 7h 22m · 81/100 · 9,841 steps · Stand hours 13",
    details: {
      sleep: { duration: "7h 22m", score: 81, rem: "1h 48m", deep: "1h 12m", awake: "22m" },
      steps: 9841,
      standHours: 13,
      activeCalories: 892,
      exerciseMinutes: 74,
      mindfulMinutes: 10,
      heartRateVariability: 71,
      respiratoryRate: 14.2,
    },
  },
  whoop: {
    label: "Whoop",
    summary: "Recovery 78% · Strain 14.2 · HRV 71ms · Sleep need 7h 45m",
    details: {
      recovery: 78,
      recoveryLabel: "Green",
      strain: 14.2,
      hrv: 71,
      rhr: 51,
      sleepPerformance: 89,
      sleepNeed: "7h 45m",
      skinTemp: 98.1,
      spo2: 97,
      skinConductance: 0.044,
      dayStrain: 14.2,
      weekStrain: 71.4,
    },
  },
  polar: {
    label: "Polar Flow",
    summary: "Nightly Recharge Good · Training Load 390 · Cardio Load balanced",
    details: {
      nightlyRecharge: "Good",
      ansBharge: "+3%",
      hrv: 65,
      sleepScore: 79,
      trainingLoad: 390,
      cardioLoadStatus: "Balanced",
      muscleLoadStatus: "Strained",
      longTermDevelopment: "+4% VO2max over 8 weeks",
      zones: { z1: 42, z2: 28, z3: 18, z4: 9, z5: 3 },
    },
  },
  cronometer: {
    label: "Cronometer",
    summary: "2,840 kcal · 168g protein · 72% micronutrient targets met",
    details: {
      calories: { consumed: 2840, goal: 3100, burned: 3250 },
      macros: { protein: 168, carbs: 342, fat: 88, fiber: 28 },
      micros: {
        iron: "92%", calcium: "78%", vitD: "61%", vitC: "134%",
        magnesium: "88%", b12: "110%", omega3: "45%",
      },
      hydration: "2.8L",
      topFoods: ["Oatmeal 480kcal", "Chicken breast 320kcal", "Sweet potato 185kcal", "Banana 105kcal"],
      alerts: ["Low Vitamin D — consider supplement", "Low Omega-3 — add fatty fish"],
    },
  },
};

// ─── Athlete base ─────────────────────────────────────────────────────────────
const ATHLETE_BASE = {
  name: "Alex Rivera",
  currentShoe: "Nike Vaporfly 3",
  shoeMiles: 187,
  upcomingRace: { name: "Boston Marathon", daysOut: 24 },
  runs: [
    { date:"Mon", type:"Easy",      miles:6.2,  pace:"8:45", hr:138 },
    { date:"Tue", type:"Tempo",     miles:8.1,  pace:"7:12", hr:162 },
    { date:"Wed", type:"Rest",      miles:0,    pace:"—",    hr:0   },
    { date:"Thu", type:"Intervals", miles:10.4, pace:"6:48", hr:171 },
    { date:"Fri", type:"Easy",      miles:5.0,  pace:"9:02", hr:134 },
    { date:"Sat", type:"Long",      miles:14.8, pace:"8:28", hr:149 },
    { date:"Sun", type:"Recovery",  miles:4.1,  pace:"9:45", hr:128 },
  ],
};

function buildAthleteContext(connected) {
  const base = { ...ATHLETE_BASE, weeklyMileage: 42, vo2max: 54.2, hrv: 68, restingHR: 52, sleepScore: 81, fitnessScore: 74, fatigueScore: 38 };
  if (connected.includes("strava")) {
    const d = SERVICE_DATA.strava.details;
    base.weeklyMileage = d.weeklyMileage;
    base.runs = d.activities.map(a => ({ date: a.date, type: a.type, miles: a.distance, pace: a.pace, hr: a.hr }));
    base.stravaSegments = d.segments;
  }
  if (connected.includes("garmin")) {
    const d = SERVICE_DATA.garmin.details;
    base.vo2max = d.vo2max;
    base.hrv = d.hrv;
    base.restingHR = d.restingHR;
    base.bodyBattery = d.bodyBattery;
    base.trainingStatus = d.trainingStatus;
    base.lactateThreshold = d.lactateThreshold;
    base.racePredictions = d.racePredictor;
  }
  if (connected.includes("apple")) {
    const d = SERVICE_DATA.apple.details;
    base.sleepScore = d.sleep.score;
    base.sleepDuration = d.sleep.duration;
    base.steps = d.steps;
    base.activeCalories = d.activeCalories;
  }
  if (connected.includes("whoop")) {
    const d = SERVICE_DATA.whoop.details;
    base.recovery = d.recovery;
    base.recoveryLabel = d.recoveryLabel;
    base.strain = d.strain;
    base.sleepNeed = d.sleepNeed;
    base.spo2 = d.spo2;
  }
  if (connected.includes("polar")) {
    const d = SERVICE_DATA.polar.details;
    base.nightlyRecharge = d.nightlyRecharge;
    base.cardioLoadStatus = d.cardioLoadStatus;
    base.hrZones = d.zones;
  }
  if (connected.includes("cronometer")) {
    const d = SERVICE_DATA.cronometer.details;
    base.calories = d.calories;
    base.macros = d.macros;
    base.nutritionAlerts = d.alerts;
    base.hydration = d.hydration;
  }
  return base;
}

// ─── Agent system prompt ──────────────────────────────────────────────────────
function agentSysPrompt(connected, agentId) {
  const athlete = buildAthleteContext(connected);
  const sourceList = connected.length
    ? connected.map(id => `${SERVICE_DATA[id]?.label}: ${SERVICE_DATA[id]?.summary}`).join("\n")
    : "Demo mode — no live data connected";

  const athleteStr = `
Name: ${athlete.name}
Weekly Mileage: ${athlete.weeklyMileage} mi
VO2max: ${athlete.vo2max}
HRV: ${athlete.hrv} ms
Resting HR: ${athlete.restingHR} bpm
Sleep Score: ${athlete.sleepScore}/100${athlete.sleepDuration ? ` (${athlete.sleepDuration})` : ""}
Fitness Score: ${athlete.fitnessScore} | Fatigue: ${athlete.fatigueScore}
Current Shoe: ${athlete.currentShoe} (${athlete.shoeMiles} mi used)
Upcoming Race: ${athlete.upcomingRace.name} in ${athlete.upcomingRace.daysOut} days
Runs: ${athlete.runs.map(r => `${r.date} ${r.type} ${r.miles}mi ${r.pace}`).join(" | ")}
${athlete.bodyBattery ? `Body Battery: ${athlete.bodyBattery}` : ""}
${athlete.trainingStatus ? `Training Status: ${athlete.trainingStatus}` : ""}
${athlete.recovery ? `Recovery: ${athlete.recovery}% (${athlete.recoveryLabel})` : ""}
${athlete.strain ? `Strain: ${athlete.strain}` : ""}
${athlete.racePredictions ? `Race Predictions: Marathon ${athlete.racePredictions.marathon} | Half ${athlete.racePredictions.halfMarathon}` : ""}
${athlete.lactateThreshold ? `Lactate Threshold: ${athlete.lactateThreshold.pace} @ HR ${athlete.lactateThreshold.hr}` : ""}
${athlete.macros ? `Nutrition: ${athlete.macros.protein}g protein, ${athlete.macros.carbs}g carbs, ${athlete.macros.fat}g fat` : ""}
${athlete.hydration ? `Hydration: ${athlete.hydration}` : ""}
${athlete.nutritionAlerts ? `Nutrition Alerts: ${athlete.nutritionAlerts.join("; ")}` : ""}
${athlete.stravaSegments ? `Recent Segments: ${athlete.stravaSegments.join(", ")}` : ""}
`.trim();

  return `You are RunHQ AI — active agent: ${agentId.toUpperCase()}.

CONNECTED DATA SOURCES:
${sourceList}

ATHLETE DATA:
${athleteStr}

Be specific, data-driven, and reference the actual numbers from connected sources. Be concise (3-5 sentences or a short list). If asked about data from a service that is not connected, note it and suggest connecting it.`;
}

function shoeChatSysPrompt(results) {
  const ctx = results.length
    ? results.map((s, i) => `[${i+1}] ${s.model} — Score: ${s.score.replace(/\n/g, " ")} — Notes: ${s.pros.slice(0, 6).join(" | ")} — ${s.url}`).join("\n")
    : "No results retrieved from ChromaDB.";
  return `You are a friendly expert running shoe advisor with access to a curated review database.\n\nRETRIEVED FROM CHROMADB:\n${ctx}\n\nInstructions:\n- Base recommendations on the retrieved reviews above\n- Reference specific pros/cons from the data by name\n- If no results, say so and ask for clarification\n- Keep answers to 3-6 sentences or a short list\n- Always cite the shoe by name`;
}

const AGENTS = {
  coach:    { name:"Coach Agent",    emoji:"🏃", color:"#6C63FF" },
  analyst:  { name:"Load Analyst",   emoji:"📊", color:"#00C896" },
  recovery: { name:"Recovery Agent", emoji:"🩺", color:"#FF6B6B" },
  nutrition:{ name:"Nutrition Agent",emoji:"🥗", color:"#F2A65A" },
  race:     { name:"Race Oracle",    emoji:"🏁", color:"#FFD93D" },
  shoe:     { name:"Gear Agent",     emoji:"👟", color:"#A78BFA" },
};

const AGENT_HINTS = {
  coach:    ["Design my week plan","Am I overtraining?","Adjust for Boston"],
  analyst:  ["Training load analysis","CTL vs ATL","Overtraining risk"],
  recovery: ["Should I train today?","Improve my HRV","Recovery score"],
  nutrition:["Pre-race nutrition","Marathon fueling","Daily protein"],
  race:     ["Predict my Boston time","Pace strategy","Taper plan"],
  shoe:     ["Best shoe for marathon","Trail running options","Recovery shoe"],
};

// ─── OAuth helper ─────────────────────────────────────────────────────────────
function buildOAuthUrl(svc, redirectUri) {
  if (!svc.authUrl) return null;
  const params = new URLSearchParams({
    client_id: svc.clientId,
    redirect_uri: redirectUri || window.location.href,
    response_type: "code",
    scope: svc.scope,
    state: svc.id,
  });
  return `${svc.authUrl}?${params.toString()}`;
}

// ─── OAuth Popup ──────────────────────────────────────────────────────────────
function OAuthModal({ svc, onSuccess, onClose }) {
  const [phase, setPhase] = useState("confirm"); // confirm | loading | success | error
  const [countdown, setCountdown] = useState(3);

  function handleConnect() {
    setPhase("loading");
    // In production: open OAuth popup window and listen for redirect
    // For demo: simulate the OAuth flow
    setTimeout(() => {
      setPhase("success");
    }, 2200);
  }

  useEffect(() => {
    if (phase === "success") {
      const t = setInterval(() => setCountdown(c => {
        if (c <= 1) { clearInterval(t); onSuccess(svc.id); }
        return c - 1;
      }), 900);
      return () => clearInterval(t);
    }
  }, [phase]);

  const oauthUrl = buildOAuthUrl(svc, window.location.href);

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.75)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:1000, fontFamily:"'DM Sans',sans-serif" }}>
      <div style={{ background:"#13131A", border:"1px solid #2A2A3A", borderRadius:20, padding:32, width:"100%", maxWidth:420, position:"relative" }}>
        <button onClick={onClose} style={{ position:"absolute", top:16, right:16, background:"none", border:"none", color:"#555", fontSize:18, cursor:"pointer" }}>✕</button>

        {phase === "confirm" && (
          <>
            <div style={{ display:"flex", alignItems:"center", gap:14, marginBottom:24 }}>
              <div style={{ width:52, height:52, background:svc.color+"22", borderRadius:14, display:"flex", alignItems:"center", justifyContent:"center", color:svc.color, fontWeight:700, fontSize:22 }}>{svc.icon}</div>
              <div>
                <div style={{ color:"#F0F0F8", fontWeight:600, fontSize:18 }}>Connect {svc.name}</div>
                <div style={{ color:"#666", fontSize:13 }}>{svc.desc}</div>
              </div>
            </div>

            {svc.authUrl ? (
              <>
                <div style={{ background:"#0A0A0F", border:"1px solid #1E1E2E", borderRadius:10, padding:14, marginBottom:20 }}>
                  <div style={{ color:"#888", fontSize:11, marginBottom:8, textTransform:"uppercase", letterSpacing:"0.05em" }}>RunHQ will access</div>
                  {svc.scope.split(" ").map(s => (
                    <div key={s} style={{ display:"flex", alignItems:"center", gap:8, padding:"5px 0" }}>
                      <div style={{ width:5, height:5, borderRadius:"50%", background:svc.color, flexShrink:0 }}/>
                      <span style={{ color:"#888", fontSize:13 }}>{s.replace(/[_:]/g," ").replace(/\b\w/g,c=>c.toUpperCase())}</span>
                    </div>
                  ))}
                </div>
                <div style={{ color:"#555", fontSize:12, marginBottom:20, lineHeight:1.6 }}>
                  You'll be redirected to {svc.name} to authorize access. RunHQ never stores your {svc.name} password.
                </div>
                <div style={{ display:"flex", gap:10 }}>
                  <button onClick={onClose} style={{ flex:1, background:"transparent", border:"1px solid #2A2A3A", borderRadius:10, padding:12, color:"#666", fontSize:14, cursor:"pointer" }}>Cancel</button>
                  <button
                    onClick={handleConnect}
                    style={{ flex:2, background:svc.color, border:"none", borderRadius:10, padding:12, color:"#fff", fontSize:14, fontWeight:600, cursor:"pointer" }}
                  >
                    Authorize with {svc.name} →
                  </button>
                </div>
                {oauthUrl && (
                  <div style={{ marginTop:12, textAlign:"center" }}>
                    <a href={oauthUrl} target="_blank" rel="noreferrer" style={{ color:"#555", fontSize:11 }}>
                      Open OAuth URL manually ↗
                    </a>
                  </div>
                )}
              </>
            ) : (
              <>
                <div style={{ background:"#FF375F12", border:"1px solid #FF375F33", borderRadius:10, padding:14, marginBottom:20 }}>
                  <div style={{ color:"#FF375F", fontWeight:500, fontSize:13, marginBottom:4 }}>iOS / macOS Required</div>
                  <div style={{ color:"#888", fontSize:13, lineHeight:1.6 }}>Apple Health connects via the RunHQ iOS app using HealthKit. Install the app and grant permissions there.</div>
                </div>
                <div style={{ display:"flex", gap:10 }}>
                  <button onClick={onClose} style={{ flex:1, background:"transparent", border:"1px solid #2A2A3A", borderRadius:10, padding:12, color:"#666", fontSize:14, cursor:"pointer" }}>Cancel</button>
                  <button onClick={handleConnect} style={{ flex:2, background:"#FF375F", border:"none", borderRadius:10, padding:12, color:"#fff", fontSize:14, fontWeight:600, cursor:"pointer" }}>
                    Simulate Apple Health →
                  </button>
                </div>
              </>
            )}
          </>
        )}

        {phase === "loading" && (
          <div style={{ textAlign:"center", padding:"20px 0" }}>
            <div style={{ fontSize:40, marginBottom:16 }}>{svc.icon}</div>
            <div style={{ color:"#F0F0F8", fontWeight:600, fontSize:16, marginBottom:8 }}>Authorizing with {svc.name}…</div>
            <div style={{ color:"#555", fontSize:13, marginBottom:24 }}>Exchanging OAuth tokens</div>
            <div style={{ display:"flex", gap:6, justifyContent:"center" }}>
              {[0,1,2].map(i => (
                <div key={i} style={{ width:8, height:8, background:svc.color, borderRadius:"50%", animation:`bounce 1s ${i*0.18}s infinite` }}/>
              ))}
            </div>
          </div>
        )}

        {phase === "success" && (
          <div style={{ textAlign:"center", padding:"20px 0" }}>
            <div style={{ width:56, height:56, background:"#00C89620", border:"2px solid #00C896", borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center", fontSize:24, margin:"0 auto 16px" }}>✓</div>
            <div style={{ color:"#00C896", fontWeight:600, fontSize:16, marginBottom:6 }}>{svc.name} Connected!</div>
            <div style={{ color:"#555", fontSize:13, marginBottom:16 }}>{SERVICE_DATA[svc.id]?.summary}</div>
            <div style={{ color:"#444", fontSize:12 }}>Closing in {countdown}…</div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Data Panel ───────────────────────────────────────────────────────────────
function ServiceDataPanel({ serviceId }) {
  const svc = SERVICES.find(s => s.id === serviceId);
  const data = SERVICE_DATA[serviceId];
  if (!svc || !data) return null;

  const details = data.details;

  return (
    <div style={{ background:"#13131A", border:`1px solid ${svc.color}33`, borderRadius:16, padding:20, marginBottom:12 }}>
      <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:16 }}>
        <div style={{ width:36, height:36, background:svc.color+"22", borderRadius:9, display:"flex", alignItems:"center", justifyContent:"center", color:svc.color, fontWeight:700, fontSize:16 }}>{svc.icon}</div>
        <div>
          <div style={{ color:"#F0F0F8", fontWeight:600, fontSize:14 }}>{svc.name}</div>
          <div style={{ color:"#555", fontSize:11 }}>{data.summary}</div>
        </div>
        <div style={{ marginLeft:"auto", background:"#00C89620", color:"#00C896", fontSize:10, fontWeight:600, padding:"3px 8px", borderRadius:6 }}>● Live</div>
      </div>

      {serviceId === "strava" && (
        <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
          {details.activities.map((a, i) => (
            <div key={i} style={{ display:"flex", gap:10, padding:"7px 0", borderBottom:"1px solid #1A1A22", alignItems:"center" }}>
              <span style={{ color:"#555", fontSize:11, width:28, flexShrink:0 }}>{a.date}</span>
              <span style={{ color:"#F0F0F8", fontSize:12, flex:1 }}>{a.type}</span>
              <span style={{ color:"#888", fontSize:11, fontFamily:"'DM Mono',monospace" }}>{a.distance}mi</span>
              <span style={{ color:"#555", fontSize:11, fontFamily:"'DM Mono',monospace" }}>{a.pace}/mi</span>
              <span style={{ color:"#555", fontSize:11, fontFamily:"'DM Mono',monospace" }}>{a.hr}bpm</span>
            </div>
          ))}
        </div>
      )}

      {serviceId === "garmin" && (
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10 }}>
          {[["VO2max", details.vo2max], ["HRV", `${details.hrv}ms`], ["Body Battery", details.bodyBattery], ["Resting HR", `${details.restingHR}bpm`], ["Training Status", details.trainingStatus], ["LT Pace", details.lactateThreshold.pace]].map(([l,v]) => (
            <div key={l} style={{ background:"#0A0A0F", borderRadius:8, padding:"10px 12px" }}>
              <div style={{ color:"#555", fontSize:10, marginBottom:3 }}>{l}</div>
              <div style={{ color:"#F0F0F8", fontWeight:600, fontSize:13, fontFamily:"'DM Mono',monospace" }}>{v}</div>
            </div>
          ))}
        </div>
      )}

      {serviceId === "apple" && (
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
          {[["Sleep", details.sleep.duration], ["Sleep Score", `${details.sleep.score}/100`], ["Steps", details.steps.toLocaleString()], ["Active Cal", `${details.activeCalories} kcal`], ["Exercise", `${details.exerciseMinutes}min`], ["HRV", `${details.heartRateVariability}ms`]].map(([l,v]) => (
            <div key={l} style={{ background:"#0A0A0F", borderRadius:8, padding:"10px 12px" }}>
              <div style={{ color:"#555", fontSize:10, marginBottom:3 }}>{l}</div>
              <div style={{ color:"#F0F0F8", fontWeight:600, fontSize:13 }}>{v}</div>
            </div>
          ))}
        </div>
      )}

      {serviceId === "whoop" && (
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10 }}>
          {[["Recovery", `${details.recovery}%`], ["Label", details.recoveryLabel], ["Strain", details.strain], ["HRV", `${details.hrv}ms`], ["SpO2", `${details.spo2}%`], ["Sleep Need", details.sleepNeed]].map(([l,v]) => (
            <div key={l} style={{ background:"#0A0A0F", borderRadius:8, padding:"10px 12px" }}>
              <div style={{ color:"#555", fontSize:10, marginBottom:3 }}>{l}</div>
              <div style={{ color:l==="Recovery"?`hsl(${details.recovery},70%,55%)`:"#F0F0F8", fontWeight:600, fontSize:13 }}>{v}</div>
            </div>
          ))}
        </div>
      )}

      {serviceId === "polar" && (
        <div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:10 }}>
            {[["Nightly Recharge", details.nightlyRecharge], ["Cardio Load", details.cardioLoadStatus], ["Muscle Load", details.muscleLoadStatus], ["Training Load", details.trainingLoad]].map(([l,v]) => (
              <div key={l} style={{ background:"#0A0A0F", borderRadius:8, padding:"10px 12px" }}>
                <div style={{ color:"#555", fontSize:10, marginBottom:3 }}>{l}</div>
                <div style={{ color:"#F0F0F8", fontWeight:600, fontSize:13 }}>{v}</div>
              </div>
            ))}
          </div>
          <div style={{ background:"#0A0A0F", borderRadius:8, padding:"10px 12px" }}>
            <div style={{ color:"#555", fontSize:10, marginBottom:6 }}>HR Zone Distribution</div>
            <div style={{ display:"flex", gap:4, height:24, borderRadius:4, overflow:"hidden" }}>
              {Object.entries(details.zones).map(([z, pct], i) => (
                <div key={z} title={`Z${i+1}: ${pct}%`} style={{ flex:pct, background:["#00C896","#6C63FF","#FFD93D","#F2A65A","#FF6B6B"][i], borderRadius:2 }}/>
              ))}
            </div>
            <div style={{ display:"flex", gap:10, marginTop:5 }}>
              {Object.entries(details.zones).map(([z, pct], i) => (
                <span key={z} style={{ color:"#555", fontSize:10 }}>Z{i+1} {pct}%</span>
              ))}
            </div>
          </div>
        </div>
      )}

      {serviceId === "cronometer" && (
        <div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10, marginBottom:10 }}>
            {[["Calories", `${details.calories.consumed} kcal`], ["Protein", `${details.macros.protein}g`], ["Carbs", `${details.macros.carbs}g`], ["Fat", `${details.macros.fat}g`], ["Fiber", `${details.macros.fiber}g`], ["Hydration", details.hydration]].map(([l,v]) => (
              <div key={l} style={{ background:"#0A0A0F", borderRadius:8, padding:"10px 12px" }}>
                <div style={{ color:"#555", fontSize:10, marginBottom:3 }}>{l}</div>
                <div style={{ color:"#F0F0F8", fontWeight:600, fontSize:13 }}>{v}</div>
              </div>
            ))}
          </div>
          {details.alerts.map((a, i) => (
            <div key={i} style={{ background:"#F2A65A12", border:"1px solid #F2A65A33", borderRadius:8, padding:"8px 12px", marginBottom:6, color:"#F2A65A", fontSize:12 }}>
              ⚠ {a}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function RunHQ() {
  const [screen, setScreen] = useState("login");
  const [connected, setConnected] = useState([]);
  const [oauthTarget, setOauthTarget] = useState(null); // svc being authorized
  const [activeAgent, setActiveAgent] = useState("coach");
  const [msgs, setMsgs] = useState([]);
  const [inp, setInp] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState("chat");
  const [sMsgs, setSMsgs] = useState([]);
  const [sInp, setSInp] = useState("");
  const [sBusy, setSBusy] = useState(false);
  const [chromaOk, setChromaOk] = useState(null);
  const [chromaErr, setChromaErr] = useState("");
  const [lq, setLq] = useState("");
  const [lr, setLr] = useState([]);
  const [dataTab, setDataTab] = useState(null); // which service to view data for

  const chatEnd = useRef(null);
  const sChatEnd = useRef(null);
  const inpRef = useRef(null);
  const sInpRef = useRef(null);

  useEffect(() => { chatEnd.current?.scrollIntoView({ behavior:"smooth" }); }, [msgs]);
  useEffect(() => { sChatEnd.current?.scrollIntoView({ behavior:"smooth" }); }, [sMsgs]);

  useEffect(() => {
    fetch(`${CHROMA_URL}/api/v1/heartbeat`)
      .then(r => { setChromaOk(r.ok); if (!r.ok) setChromaErr(`HTTP ${r.status}`); })
      .catch(e => { setChromaOk(false); setChromaErr(e.message); });
  }, []);

  const handleOAuthSuccess = useCallback((id) => {
    setConnected(p => [...new Set([...p, id])]);
    setOauthTarget(null);
  }, []);

  const handleDisconnect = useCallback((id) => {
    setConnected(p => p.filter(s => s !== id));
  }, []);

  const sendAgent = useCallback(async () => {
    if (!inp.trim() || busy) return;
    const txt = inp.trim(); setInp(""); setBusy(true);
    setMsgs(p => [...p, { role:"user", content:txt }]);
    let aug = txt;
    if (["shoe","sneaker","footwear","gear"].some(k => txt.toLowerCase().includes(k))) {
      const r = localSearch(txt, 3);
      aug += `\n\n[Local shoe RAG]\n${r.map(s => `${s.name}: ${s.category}, $${s.price}, best for ${s.bestFor.join(", ")}`).join("\n")}`;
    }
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ model:"claude-sonnet-4-20250514", max_tokens:1000, system:agentSysPrompt(connected, activeAgent), messages:[...msgs.map(m=>({role:m.role,content:m.content})),{role:"user",content:aug}] }) });
      const d = await r.json();
      setMsgs(p => [...p, { role:"assistant", content:d.content?.[0]?.text||"No response.", agent:activeAgent }]);
    } catch { setMsgs(p => [...p, { role:"assistant", content:"Connection error.", agent:activeAgent }]); }
    setBusy(false);
  }, [inp, busy, msgs, activeAgent, connected]);

  const sendShoe = useCallback(async () => {
    if (!sInp.trim() || sBusy) return;
    const txt = sInp.trim(); setSInp(""); setSBusy(true);
    setSMsgs(p => [...p, { role:"user", content:txt }]);
    let results = []; let note = "";
    try {
      results = await queryChroma(txt, 5); setChromaOk(true);
      note = `✓ ${results.length} results from ChromaDB`;
    } catch (e) {
      setChromaOk(false); setChromaErr(e.message);
      note = `⚠ ChromaDB error: ${e.message}`;
    }
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ model:"claude-sonnet-4-20250514", max_tokens:1000, system:shoeChatSysPrompt(results), messages:[...sMsgs.map(m=>({role:m.role,content:m.content})),{role:"user",content:txt}] }) });
      const d = await r.json();
      setSMsgs(p => [...p, { role:"assistant", content:d.content?.[0]?.text||"No response.", results, note }]);
    } catch {
      setSMsgs(p => [...p, { role:"assistant", content:"AI connection error.", results:[], note }]);
    }
    setSBusy(false);
  }, [sInp, sBusy, sMsgs]);

  const agent = AGENTS[activeAgent];

  // ─── LOGIN ────────────────────────────────────────────────────────────────
  if (screen === "login") return (
    <div style={{ minHeight:"100vh", background:"#0A0A0F", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"'DM Sans',sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet"/>
      <div style={{ width:"100%", maxWidth:420, padding:"0 24px" }}>
        <div style={{ textAlign:"center", marginBottom:48 }}>
          <div style={{ display:"inline-flex", alignItems:"center", gap:12, marginBottom:8 }}>
            <div style={{ width:44, height:44, background:"linear-gradient(135deg,#6C63FF,#00C896)", borderRadius:12, display:"flex", alignItems:"center", justifyContent:"center", fontSize:22 }}>🏃</div>
            <span style={{ color:"#F0F0F8", fontSize:28, fontWeight:600, letterSpacing:"-0.02em" }}>RunHQ</span>
          </div>
          <p style={{ color:"#555", fontSize:14 }}>Your AI training intelligence platform</p>
        </div>
        <div style={{ background:"#13131A", border:"1px solid #1E1E2E", borderRadius:20, padding:32 }}>
          <h2 style={{ color:"#F0F0F8", fontSize:20, fontWeight:600, margin:"0 0 24px" }}>Welcome back</h2>
          {[["Email","alex@runhq.ai","text"],["Password","••••••••","password"]].map(([l,v,t]) => (
            <div key={l} style={{ marginBottom:16 }}>
              <label style={{ display:"block", color:"#888", fontSize:12, marginBottom:6, textTransform:"uppercase", letterSpacing:"0.05em" }}>{l}</label>
              <input type={t} defaultValue={v} style={{ width:"100%", background:"#0A0A0F", border:"1px solid #1E1E2E", borderRadius:10, padding:"12px 14px", color:"#F0F0F8", fontSize:14, outline:"none", boxSizing:"border-box" }}/>
            </div>
          ))}
          <button onClick={() => setScreen("connect")} style={{ width:"100%", background:"linear-gradient(135deg,#6C63FF,#5B53EE)", border:"none", borderRadius:12, padding:14, color:"#fff", fontSize:15, fontWeight:600, cursor:"pointer", marginTop:12 }}>Sign in →</button>
          <p style={{ textAlign:"center", color:"#444", fontSize:13, marginTop:20, marginBottom:0 }}>No account? <span onClick={() => setScreen("connect")} style={{ color:"#6C63FF", cursor:"pointer" }}>Start free →</span></p>
        </div>
      </div>
    </div>
  );

  // ─── CONNECT ──────────────────────────────────────────────────────────────
  if (screen === "connect") return (
    <div style={{ minHeight:"100vh", background:"#0A0A0F", fontFamily:"'DM Sans',sans-serif", paddingBottom:60 }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet"/>
      <style>{`@keyframes bounce{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}*{box-sizing:border-box}`}</style>

      {oauthTarget && (
        <OAuthModal svc={SERVICES.find(s => s.id === oauthTarget)} onSuccess={handleOAuthSuccess} onClose={() => setOauthTarget(null)} />
      )}

      <div style={{ borderBottom:"1px solid #1E1E2E", padding:"20px 32px", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <span style={{ color:"#F0F0F8", fontWeight:600, fontSize:18 }}>🏃 RunHQ</span>
        <button onClick={() => setScreen("dashboard")} style={{ background:connected.length?"#6C63FF":"#1E1E2E", border:"none", borderRadius:10, padding:"10px 20px", color:connected.length?"#fff":"#555", fontSize:14, cursor:"pointer" }}>
          {connected.length ? `Continue with ${connected.length} source${connected.length>1?"s":""} →` : "Skip →"}
        </button>
      </div>

      <div style={{ maxWidth:700, margin:"0 auto", padding:"48px 24px 0" }}>
        <h1 style={{ color:"#F0F0F8", fontSize:26, fontWeight:600, margin:"0 0 8px" }}>Connect your data sources</h1>
        <p style={{ color:"#666", fontSize:14, margin:"0 0 32px" }}>The more you connect, the smarter your agents become.</p>

        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
          {SERVICES.map(svc => {
            const isCon = connected.includes(svc.id);
            return (
              <div key={svc.id} style={{ background:"#13131A", border:`1px solid ${isCon ? svc.color+"44" : "#1E1E2E"}`, borderRadius:16, padding:20 }}>
                <div style={{ display:"flex", justifyContent:"space-between", marginBottom:12 }}>
                  <div style={{ width:40, height:40, background:svc.color+"22", borderRadius:10, display:"flex", alignItems:"center", justifyContent:"center", color:svc.color, fontWeight:700 }}>{svc.icon}</div>
                  {isCon && <div style={{ background:"#00C89622", color:"#00C896", fontSize:11, fontWeight:500, padding:"3px 8px", borderRadius:6, alignSelf:"flex-start" }}>✓ Connected</div>}
                </div>
                <div style={{ color:"#F0F0F8", fontWeight:600, marginBottom:4 }}>{svc.name}</div>
                <div style={{ color:"#555", fontSize:13, marginBottom:4 }}>{svc.desc}</div>
                {isCon && (
                  <div style={{ color:"#666", fontSize:11, marginBottom:12, fontStyle:"italic" }}>{SERVICE_DATA[svc.id]?.summary}</div>
                )}
                {!isCon && <div style={{ marginBottom:12 }}/>}
                <div style={{ display:"flex", gap:8 }}>
                  <button
                    onClick={() => isCon ? handleDisconnect(svc.id) : setOauthTarget(svc.id)}
                    style={{ flex:1, background:isCon?"transparent":svc.color+"22", border:`1px solid ${isCon?"#333":svc.color+"55"}`, borderRadius:8, padding:9, color:isCon?"#555":svc.color, fontSize:13, cursor:"pointer" }}
                  >
                    {isCon ? "Disconnect" : `Connect ${svc.name}`}
                  </button>
                  {isCon && (
                    <button
                      onClick={() => setDataTab(svc.id)}
                      style={{ background:"#1E1E2E", border:"1px solid #2A2A3A", borderRadius:8, padding:"9px 12px", color:"#888", fontSize:12, cursor:"pointer" }}
                    >
                      View data
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Data preview modal */}
        {dataTab && connected.includes(dataTab) && (
          <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.75)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:1000 }}>
            <div style={{ background:"#13131A", border:"1px solid #2A2A3A", borderRadius:20, padding:28, width:"100%", maxWidth:520, maxHeight:"80vh", overflowY:"auto" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
                <span style={{ color:"#F0F0F8", fontWeight:600, fontSize:16 }}>Live Data Preview</span>
                <button onClick={() => setDataTab(null)} style={{ background:"none", border:"none", color:"#555", fontSize:18, cursor:"pointer" }}>✕</button>
              </div>
              <ServiceDataPanel serviceId={dataTab} />
            </div>
          </div>
        )}

        {/* Status row */}
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14, marginTop:14 }}>
          <div style={{ background:"#13131A", border:`1px solid ${chromaOk===true?"#00C89644":chromaOk===false?"#FF6B6B33":"#1E1E2E"}`, borderRadius:16, padding:18, display:"flex", alignItems:"center", gap:14 }}>
            <div style={{ width:40, height:40, background:"#00C89615", borderRadius:10, display:"flex", alignItems:"center", justifyContent:"center", fontSize:20 }}>🔍</div>
            <div style={{ flex:1 }}>
              <div style={{ color:"#F0F0F8", fontWeight:600, fontSize:14 }}>ChromaDB</div>
              <div style={{ color:"#555", fontSize:12 }}>{CHROMA_URL} · {CHROMA_COLLECTION}</div>
            </div>
            <div style={{ fontSize:11, fontWeight:500, padding:"3px 8px", borderRadius:6, background:chromaOk===true?"#00C89622":chromaOk===false?"#FF6B6B22":"#1E1E2E", color:chromaOk===true?"#00C896":chromaOk===false?"#FF6B6B":"#555" }}>
              {chromaOk===null?"…":chromaOk?"✓ Online":"✗ Offline"}
            </div>
          </div>
          <div style={{ background:"#13131A", border:"1px solid #A78BFA33", borderRadius:16, padding:18, display:"flex", alignItems:"center", gap:14 }}>
            <div style={{ width:40, height:40, background:"#A78BFA22", borderRadius:10, display:"flex", alignItems:"center", justifyContent:"center", fontSize:20 }}>👟</div>
            <div style={{ flex:1 }}>
              <div style={{ color:"#F0F0F8", fontWeight:600, fontSize:14 }}>Local Shoe DB</div>
              <div style={{ color:"#555", fontSize:12 }}>{SHOE_DB.length} shoes · cosine similarity</div>
            </div>
            <div style={{ background:"#A78BFA22", color:"#A78BFA", fontSize:11, fontWeight:500, padding:"3px 8px", borderRadius:6 }}>✓ Active</div>
          </div>
        </div>
      </div>
    </div>
  );

  // ─── DASHBOARD ────────────────────────────────────────────────────────────
  const athlete = buildAthleteContext(connected);

  return (
    <div style={{ height:"100vh", background:"#0A0A0F", fontFamily:"'DM Sans',sans-serif", display:"flex", flexDirection:"column", overflow:"hidden" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet"/>
      <style>{`@keyframes bounce{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}*{box-sizing:border-box}::-webkit-scrollbar{width:4px}::-webkit-scrollbar-thumb{background:#2A2A3A;border-radius:4px}`}</style>

      {oauthTarget && (
        <OAuthModal svc={SERVICES.find(s => s.id === oauthTarget)} onSuccess={handleOAuthSuccess} onClose={() => setOauthTarget(null)} />
      )}

      {/* Topbar */}
      <div style={{ borderBottom:"1px solid #1E1E2E", padding:"12px 24px", display:"flex", alignItems:"center", justifyContent:"space-between", flexShrink:0 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <div style={{ width:30, height:30, background:"linear-gradient(135deg,#6C63FF,#00C896)", borderRadius:8, display:"flex", alignItems:"center", justifyContent:"center", fontSize:15 }}>🏃</div>
          <span style={{ color:"#F0F0F8", fontWeight:600, fontSize:17 }}>RunHQ</span>
          <span style={{ color:"#333", fontSize:14, marginLeft:4 }}>/ {athlete.upcomingRace.name}</span>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          {/* Connected service pills */}
          {connected.map(id => {
            const svc = SERVICES.find(s => s.id === id);
            return (
              <div key={id} style={{ display:"flex", alignItems:"center", gap:4, background:"#13131A", border:`1px solid ${svc.color}33`, borderRadius:7, padding:"3px 8px" }}>
                <div style={{ width:5, height:5, borderRadius:"50%", background:svc.color }}/>
                <span style={{ color:svc.color, fontSize:10, fontWeight:500 }}>{svc.name}</span>
              </div>
            );
          })}
          <div style={{ display:"flex", alignItems:"center", gap:5, background:"#13131A", border:`1px solid ${chromaOk?"#00C89633":"#1E1E2E"}`, borderRadius:8, padding:"4px 10px" }}>
            <div style={{ width:6, height:6, borderRadius:"50%", background:chromaOk===true?"#00C896":chromaOk===false?"#FF6B6B":"#555" }}/>
            <span style={{ color:chromaOk?"#00C896":"#555", fontSize:11 }}>ChromaDB</span>
          </div>
          <button onClick={() => setScreen("connect")} style={{ background:"#1E1E2E", border:"1px solid #2A2A3A", borderRadius:8, padding:"6px 12px", color:"#888", fontSize:12, cursor:"pointer" }}>+ Sources</button>
          <div style={{ width:32, height:32, background:"#6C63FF", borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center", color:"#fff", fontWeight:600, fontSize:13 }}>AR</div>
        </div>
      </div>

      <div style={{ display:"flex", flex:1, overflow:"hidden" }}>
        {/* Sidebar */}
        <div style={{ width:215, borderRight:"1px solid #1E1E2E", padding:"18px 14px", overflowY:"auto", flexShrink:0 }}>
          <div style={{ background:"linear-gradient(135deg,#6C63FF22,#00C89622)", border:"1px solid #6C63FF33", borderRadius:12, padding:14, marginBottom:18 }}>
            <div style={{ color:"#888", fontSize:11, textTransform:"uppercase", letterSpacing:"0.05em", marginBottom:4 }}>Race day</div>
            <div style={{ color:"#F0F0F8", fontWeight:600, fontSize:13, marginBottom:2 }}>{athlete.upcomingRace.name}</div>
            <div style={{ color:"#6C63FF", fontSize:22, fontWeight:600 }}>{athlete.upcomingRace.daysOut}<span style={{ fontSize:12, color:"#888", fontWeight:400 }}> days</span></div>
          </div>

          {[
            ["Weekly miles", athlete.weeklyMileage, "mi"],
            ["VO2max", athlete.vo2max, ""],
            ["HRV", athlete.hrv, "ms"],
            ["Resting HR", athlete.restingHR, "bpm"],
            ["Sleep", athlete.sleepScore, "/100"],
            ...(athlete.bodyBattery ? [["Body Battery", athlete.bodyBattery, ""]] : []),
            ...(athlete.recovery ? [["Recovery", athlete.recovery, "%"]] : []),
            ...(athlete.strain ? [["Strain", athlete.strain, ""]] : []),
          ].map(([l, v, u]) => (
            <div key={l} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"7px 0", borderBottom:"1px solid #1A1A22" }}>
              <span style={{ color:"#666", fontSize:12 }}>{l}</span>
              <span style={{ color:"#F0F0F8", fontSize:13, fontWeight:500, fontFamily:"'DM Mono',monospace" }}>{v}{u}</span>
            </div>
          ))}

          <div style={{ marginTop:18 }}>
            <div style={{ color:"#888", fontSize:11, textTransform:"uppercase", letterSpacing:"0.05em", marginBottom:8 }}>Current shoe</div>
            <div style={{ background:"#A78BFA15", border:"1px solid #A78BFA33", borderRadius:10, padding:12 }}>
              <div style={{ color:"#A78BFA", fontSize:13, fontWeight:500 }}>👟 {athlete.currentShoe}</div>
              <div style={{ color:"#555", fontSize:12, marginTop:4 }}>{athlete.shoeMiles} mi used</div>
              <div style={{ background:"#1A1A22", borderRadius:4, height:4, marginTop:8, overflow:"hidden" }}>
                <div style={{ background:"#A78BFA", height:"100%", width:`${(athlete.shoeMiles/300)*100}%`, borderRadius:4 }}/>
              </div>
              <div style={{ color:"#444", fontSize:11, marginTop:4 }}>{300-athlete.shoeMiles} mi remaining</div>
            </div>
          </div>

          <div style={{ marginTop:18 }}>
            <div style={{ color:"#888", fontSize:11, textTransform:"uppercase", letterSpacing:"0.05em", marginBottom:8 }}>This week</div>
            {athlete.runs.map(r => (
              <div key={r.date} style={{ display:"flex", alignItems:"center", gap:8, padding:"5px 0", borderBottom:"1px solid #12121A" }}>
                <span style={{ color:"#444", fontSize:11, width:26, flexShrink:0 }}>{r.date}</span>
                <span style={{ color:r.miles===0?"#333":"#F0F0F8", fontSize:12, flex:1 }}>{r.type}</span>
                <span style={{ color:"#555", fontSize:11, fontFamily:"'DM Mono',monospace" }}>{r.miles>0?`${r.miles}mi`:"—"}</span>
              </div>
            ))}
          </div>

          {/* Connected sources mini list */}
          {connected.length > 0 && (
            <div style={{ marginTop:18 }}>
              <div style={{ color:"#888", fontSize:11, textTransform:"uppercase", letterSpacing:"0.05em", marginBottom:8 }}>Live sources</div>
              {connected.map(id => {
                const svc = SERVICES.find(s => s.id === id);
                return (
                  <div key={id} style={{ display:"flex", alignItems:"center", gap:6, padding:"4px 0", borderBottom:"1px solid #12121A" }}>
                    <div style={{ width:5, height:5, borderRadius:"50%", background:svc.color }}/>
                    <span style={{ color:"#666", fontSize:12, flex:1 }}>{svc.name}</span>
                    <span style={{ color:"#333", fontSize:10 }}>●</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Main panel */}
        <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden" }}>
          {/* Tab bar */}
          <div style={{ display:"flex", padding:"0 20px", borderBottom:"1px solid #1E1E2E", flexShrink:0, overflowX:"auto" }}>
            {[["chat","💬 Agent Chat"],["data","📡 Live Data"],["shoechat","👟 Shoe Advisor"],["localsearch","🔍 Gear Search"],["week","📅 Week Plan"]].map(([id,lbl]) => (
              <button key={id} onClick={() => setTab(id)} style={{ background:"none", border:"none", borderBottom:`2px solid ${tab===id?"#6C63FF":"transparent"}`, padding:"13px 18px", color:tab===id?"#F0F0F8":"#555", fontSize:13, fontWeight:tab===id?600:400, cursor:"pointer", whiteSpace:"nowrap" }}>
                {lbl}
                {id==="shoechat" && <span style={{ marginLeft:6, background:chromaOk===true?"#00C89622":chromaOk===false?"#FF6B6B22":"#1E1E2E", color:chromaOk===true?"#00C896":chromaOk===false?"#FF6B6B":"#555", fontSize:10, padding:"1px 5px", borderRadius:4 }}>{chromaOk===true?"live":chromaOk===false?"offline":"…"}</span>}
                {id==="data" && connected.length>0 && <span style={{ marginLeft:6, background:"#00C89622", color:"#00C896", fontSize:10, padding:"1px 5px", borderRadius:4 }}>{connected.length}</span>}
              </button>
            ))}
          </div>

          {/* ── Agent Chat ── */}
          {tab==="chat" && (
            <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden" }}>
              <div style={{ display:"flex", gap:8, padding:"10px 18px", borderBottom:"1px solid #1E1E2E", overflowX:"auto", flexShrink:0 }}>
                {Object.entries(AGENTS).map(([id,a]) => (
                  <button key={id} onClick={() => { setActiveAgent(id); setMsgs([]); }} style={{ background:activeAgent===id?a.color+"22":"transparent", border:`1px solid ${activeAgent===id?a.color+"55":"#1E1E2E"}`, borderRadius:20, padding:"6px 14px", color:activeAgent===id?a.color:"#555", fontSize:12, fontWeight:activeAgent===id?600:400, cursor:"pointer", whiteSpace:"nowrap", flexShrink:0 }}>
                    {a.emoji} {a.name}
                  </button>
                ))}
              </div>

              {connected.length === 0 && (
                <div style={{ background:"#6C63FF10", borderBottom:"1px solid #6C63FF22", padding:"10px 20px", display:"flex", alignItems:"center", gap:10 }}>
                  <span style={{ fontSize:14 }}>💡</span>
                  <span style={{ color:"#6C63FF88", fontSize:13 }}>Connect data sources for personalized AI advice. </span>
                  <button onClick={() => setScreen("connect")} style={{ background:"none", border:"1px solid #6C63FF44", borderRadius:6, padding:"3px 10px", color:"#6C63FF", fontSize:12, cursor:"pointer" }}>Connect now →</button>
                </div>
              )}

              <div style={{ flex:1, overflowY:"auto", padding:"20px 22px", display:"flex", flexDirection:"column", gap:14 }}>
                {msgs.length===0 && (
                  <div style={{ textAlign:"center", marginTop:40 }}>
                    <div style={{ fontSize:34, marginBottom:10 }}>{agent.emoji}</div>
                    <div style={{ color:"#F0F0F8", fontWeight:600, fontSize:17, marginBottom:6 }}>{agent.name}</div>
                    <div style={{ color:"#555", fontSize:13, marginBottom:4 }}>
                      {connected.length > 0 ? `Using live data from: ${connected.map(id => SERVICES.find(s=>s.id===id)?.name).join(", ")}` : "Ask me anything about your training."}
                    </div>
                    <div style={{ display:"flex", flexWrap:"wrap", gap:8, justifyContent:"center", marginTop:18 }}>
                      {(AGENT_HINTS[activeAgent]||[]).map(s => (
                        <button key={s} onClick={() => { setInp(s); inpRef.current?.focus(); }} style={{ background:"#1E1E2E", border:"1px solid #2A2A3A", borderRadius:20, padding:"7px 14px", color:"#888", fontSize:12, cursor:"pointer" }}>{s}</button>
                      ))}
                    </div>
                  </div>
                )}
                {msgs.map((m,i) => (
                  <div key={i} style={{ display:"flex", gap:10, flexDirection:m.role==="user"?"row-reverse":"row" }}>
                    {m.role==="assistant" && <div style={{ width:30, height:30, background:AGENTS[m.agent]?.color+"22", borderRadius:8, display:"flex", alignItems:"center", justifyContent:"center", fontSize:15, flexShrink:0 }}>{AGENTS[m.agent]?.emoji}</div>}
                    <div style={{ maxWidth:"76%", background:m.role==="user"?"#6C63FF":"#13131A", border:m.role==="user"?"none":"1px solid #1E1E2E", borderRadius:m.role==="user"?"14px 14px 4px 14px":"14px 14px 14px 4px", padding:"11px 14px" }}>
                      {m.role==="assistant" && <div style={{ color:AGENTS[m.agent]?.color, fontSize:10, fontWeight:600, marginBottom:5, textTransform:"uppercase", letterSpacing:"0.08em" }}>{AGENTS[m.agent]?.name}</div>}
                      <div style={{ color:"#F0F0F8", fontSize:14, lineHeight:1.65, whiteSpace:"pre-wrap" }}>{m.content}</div>
                    </div>
                  </div>
                ))}
                {busy && <div style={{ display:"flex", gap:10 }}><div style={{ width:30, height:30, background:agent.color+"22", borderRadius:8, display:"flex", alignItems:"center", justifyContent:"center", fontSize:15 }}>{agent.emoji}</div><div style={{ background:"#13131A", border:"1px solid #1E1E2E", borderRadius:"14px 14px 14px 4px", padding:"11px 14px" }}><div style={{ display:"flex", gap:4 }}>{[0,1,2].map(i=><div key={i} style={{ width:6, height:6, background:agent.color, borderRadius:"50%", animation:`bounce 1s ${i*0.15}s infinite` }}/>)}</div></div></div>}
                <div ref={chatEnd}/>
              </div>
              <div style={{ borderTop:"1px solid #1E1E2E", padding:"14px 18px", flexShrink:0 }}>
                <div style={{ display:"flex", gap:10, background:"#13131A", border:"1px solid #1E1E2E", borderRadius:12, padding:"9px 13px" }}>
                  <input ref={inpRef} value={inp} onChange={e=>setInp(e.target.value)} onKeyDown={e=>e.key==="Enter"&&!e.shiftKey&&sendAgent()} placeholder={`Ask ${agent.name}…`} style={{ flex:1, background:"none", border:"none", color:"#F0F0F8", fontSize:14, outline:"none" }}/>
                  <button onClick={sendAgent} disabled={busy||!inp.trim()} style={{ background:"#6C63FF", border:"none", borderRadius:7, width:32, height:32, color:"#fff", fontSize:15, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", opacity:busy||!inp.trim()?0.4:1 }}>→</button>
                </div>
              </div>
            </div>
          )}

          {/* ── Live Data Tab ── */}
          {tab==="data" && (
            <div style={{ flex:1, overflowY:"auto", padding:22 }}>
              <h2 style={{ color:"#F0F0F8", fontSize:17, fontWeight:600, margin:"0 0 4px" }}>Live Data</h2>
              <p style={{ color:"#555", fontSize:13, margin:"0 0 18px" }}>
                {connected.length > 0 ? `${connected.length} source${connected.length>1?"s":""} connected — data updates every sync` : "No sources connected yet"}
              </p>
              {connected.length === 0 ? (
                <div style={{ textAlign:"center", padding:"60px 20px" }}>
                  <div style={{ fontSize:40, marginBottom:16 }}>📡</div>
                  <div style={{ color:"#F0F0F8", fontWeight:600, fontSize:16, marginBottom:8 }}>No data sources connected</div>
                  <div style={{ color:"#555", fontSize:14, marginBottom:24 }}>Connect Strava, Garmin, Whoop, and more to see live athlete data here.</div>
                  <button onClick={() => setScreen("connect")} style={{ background:"#6C63FF", border:"none", borderRadius:10, padding:"12px 24px", color:"#fff", fontSize:14, fontWeight:600, cursor:"pointer" }}>Connect Sources →</button>
                </div>
              ) : (
                connected.map(id => <ServiceDataPanel key={id} serviceId={id} />)
              )}
            </div>
          )}

          {/* ── Shoe Advisor (ChromaDB) ── */}
          {tab==="shoechat" && (
            <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden" }}>
              {chromaOk===false && (
                <div style={{ background:"#FF6B6B12", borderBottom:"1px solid #FF6B6B33", padding:"10px 20px", display:"flex", alignItems:"center", gap:10, flexShrink:0 }}>
                  <span>⚠️</span>
                  <div>
                    <span style={{ color:"#FF6B6B", fontSize:13, fontWeight:500 }}>ChromaDB offline</span>
                    <span style={{ color:"#FF6B6B88", fontSize:12 }}> — {chromaErr || "cannot connect to "+CHROMA_URL}</span>
                  </div>
                  <code style={{ background:"#FF6B6B15", color:"#FF6B6B", fontSize:11, padding:"2px 8px", borderRadius:5, fontFamily:"'DM Mono',monospace", marginLeft:"auto" }}>chroma run --host localhost --port 8000</code>
                </div>
              )}
              {chromaOk===true && (
                <div style={{ background:"#00C89610", borderBottom:"1px solid #00C89622", padding:"7px 20px", display:"flex", alignItems:"center", gap:8, flexShrink:0 }}>
                  <div style={{ width:6, height:6, borderRadius:"50%", background:"#00C896" }}/>
                  <span style={{ color:"#00C896", fontSize:12 }}>ChromaDB live · <code style={{ fontFamily:"'DM Mono',monospace" }}>{CHROMA_URL}</code></span>
                </div>
              )}
              <div style={{ flex:1, overflowY:"auto", padding:"20px 22px", display:"flex", flexDirection:"column", gap:16 }}>
                {sMsgs.length===0 && (
                  <div style={{ textAlign:"center", marginTop:40 }}>
                    <div style={{ fontSize:34, marginBottom:10 }}>👟</div>
                    <div style={{ color:"#F0F0F8", fontWeight:600, fontSize:17, marginBottom:6 }}>Shoe Advisor</div>
                    <div style={{ color:"#555", fontSize:13, marginBottom:4 }}>Searches ChromaDB, then asks Claude to recommend.</div>
                    <div style={{ display:"flex", flexWrap:"wrap", gap:8, justifyContent:"center", marginTop:16 }}>
                      {["Best shoe for a marathon","Stability for overpronation","Lightweight trail shoe","Most cushioned daily trainer","Good for wide feet","Best carbon plated racer"].map(s => (
                        <button key={s} onClick={() => { setSInp(s); sInpRef.current?.focus(); }} style={{ background:"#1E1E2E", border:"1px solid #2A2A3A", borderRadius:20, padding:"7px 14px", color:"#888", fontSize:12, cursor:"pointer" }}>{s}</button>
                      ))}
                    </div>
                  </div>
                )}
                {sMsgs.map((m,i) => (
                  <div key={i}>
                    <div style={{ display:"flex", gap:10, flexDirection:m.role==="user"?"row-reverse":"row" }}>
                      {m.role==="assistant" && <div style={{ width:30, height:30, background:"#A78BFA22", borderRadius:8, display:"flex", alignItems:"center", justifyContent:"center", fontSize:15, flexShrink:0 }}>👟</div>}
                      <div style={{ maxWidth:"80%", display:"flex", flexDirection:"column", gap:8 }}>
                        <div style={{ background:m.role==="user"?"#6C63FF":"#13131A", border:m.role==="user"?"none":"1px solid #1E1E2E", borderRadius:m.role==="user"?"14px 14px 4px 14px":"14px 14px 14px 4px", padding:"11px 14px" }}>
                          {m.role==="assistant" && <div style={{ color:"#A78BFA", fontSize:10, fontWeight:600, marginBottom:5, textTransform:"uppercase", letterSpacing:"0.08em" }}>Shoe Advisor · ChromaDB</div>}
                          <div style={{ color:"#F0F0F8", fontSize:14, lineHeight:1.65, whiteSpace:"pre-wrap" }}>{m.content}</div>
                        </div>
                        {m.role==="assistant" && m.results?.length>0 && (
                          <div>
                            <div style={{ color:"#2A2A3A", fontSize:11, marginBottom:6, paddingLeft:2 }}>📦 {m.results.length} sources from ChromaDB</div>
                            <div style={{ display:"flex", gap:8, overflowX:"auto", paddingBottom:6 }}>
                              {m.results.map((shoe,j) => (
                                <div key={j} style={{ background:"#0C0C12", border:"1px solid #1A1A28", borderRadius:10, padding:"10px 12px", minWidth:190, maxWidth:220, flexShrink:0 }}>
                                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:6, gap:6 }}>
                                    <div style={{ color:"#E0E0F0", fontSize:12, fontWeight:600, lineHeight:1.3, flex:1 }}>{shoe.model}</div>
                                    <div style={{ background:"#A78BFA22", color:"#A78BFA", fontSize:10, fontWeight:600, padding:"2px 5px", borderRadius:4, flexShrink:0 }}>{shoe.relevance}%</div>
                                  </div>
                                  {shoe.score && <div style={{ color:"#00C896", fontSize:11, marginBottom:6, fontWeight:500 }}>{shoe.score.replace(/\n/g," · ")}</div>}
                                  <div style={{ display:"flex", flexDirection:"column", gap:2, marginBottom:6 }}>
                                    {shoe.pros.slice(0,4).map((p,k) => <div key={k} style={{ color:"#555", fontSize:11 }}>· {p}</div>)}
                                  </div>
                                  {shoe.url && <a href={shoe.url} target="_blank" rel="noreferrer" style={{ color:"#6C63FF", fontSize:11, textDecoration:"none", display:"block" }}>Full review →</a>}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {m.role==="assistant" && m.results?.length===0 && m.note && (
                          <div style={{ color:"#333", fontSize:11, paddingLeft:2 }}>{m.note}</div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
                {sBusy && (
                  <div style={{ display:"flex", gap:10 }}>
                    <div style={{ width:30, height:30, background:"#A78BFA22", borderRadius:8, display:"flex", alignItems:"center", justifyContent:"center", fontSize:15 }}>👟</div>
                    <div style={{ background:"#13131A", border:"1px solid #1E1E2E", borderRadius:"14px 14px 14px 4px", padding:"11px 14px" }}>
                      <div style={{ color:"#555", fontSize:12, marginBottom:6 }}>Querying ChromaDB…</div>
                      <div style={{ display:"flex", gap:4 }}>{[0,1,2].map(i=><div key={i} style={{ width:6, height:6, background:"#A78BFA", borderRadius:"50%", animation:`bounce 1s ${i*0.15}s infinite` }}/>)}</div>
                    </div>
                  </div>
                )}
                <div ref={sChatEnd}/>
              </div>
              <div style={{ borderTop:"1px solid #1E1E2E", padding:"14px 18px", flexShrink:0 }}>
                <div style={{ display:"flex", gap:10, background:"#13131A", border:"1px solid #1E1E2E", borderRadius:12, padding:"9px 13px" }}>
                  <input ref={sInpRef} value={sInp} onChange={e=>setSInp(e.target.value)} onKeyDown={e=>e.key==="Enter"&&!e.shiftKey&&sendShoe()} placeholder="Ask about any shoe — searches ChromaDB first…" style={{ flex:1, background:"none", border:"none", color:"#F0F0F8", fontSize:14, outline:"none" }}/>
                  <button onClick={sendShoe} disabled={sBusy||!sInp.trim()} style={{ background:"#A78BFA", border:"none", borderRadius:7, width:32, height:32, color:"#fff", fontSize:15, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", opacity:sBusy||!sInp.trim()?0.4:1 }}>→</button>
                </div>
              </div>
            </div>
          )}

          {/* ── Local Gear Search ── */}
          {tab==="localsearch" && (
            <div style={{ flex:1, overflowY:"auto", padding:22 }}>
              <h2 style={{ color:"#F0F0F8", fontSize:17, fontWeight:600, margin:"0 0 4px" }}>Local Gear Search</h2>
              <p style={{ color:"#555", fontSize:13, margin:"0 0 14px" }}>{SHOE_DB.length} shoes · embedded cosine-similarity vector DB</p>
              <div style={{ display:"flex", gap:10, marginBottom:10 }}>
                <input value={lq} onChange={e=>setLq(e.target.value)} onKeyDown={e=>e.key==="Enter"&&setLr(localSearch(lq,4))} placeholder="e.g. marathon race day, cushioned trail…" style={{ flex:1, background:"#13131A", border:"1px solid #1E1E2E", borderRadius:10, padding:"10px 13px", color:"#F0F0F8", fontSize:14, outline:"none" }}/>
                <button onClick={() => setLr(localSearch(lq,4))} style={{ background:"#A78BFA", border:"none", borderRadius:10, padding:"0 18px", color:"#fff", fontSize:14, fontWeight:600, cursor:"pointer" }}>Search</button>
              </div>
              <div style={{ display:"flex", gap:8, marginBottom:16, flexWrap:"wrap" }}>
                {["marathon race","trail running","easy recovery","tempo","daily trainer"].map(q => (
                  <button key={q} onClick={() => { setLq(q); setLr(localSearch(q,4)); }} style={{ background:"#1E1E2E", border:"1px solid #2A2A3A", borderRadius:20, padding:"4px 12px", color:"#888", fontSize:12, cursor:"pointer" }}>{q}</button>
                ))}
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
                {(lr.length?lr:SHOE_DB).map((shoe,idx) => (
                  <div key={shoe.id} style={{ background:"#13131A", border:`1px solid ${lr.length&&idx===0?"#A78BFA55":"#1E1E2E"}`, borderRadius:13, padding:15 }}>
                    {lr.length&&idx===0 && <div style={{ color:"#A78BFA", fontSize:10, fontWeight:600, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:4 }}>Best match</div>}
                    <div style={{ display:"flex", justifyContent:"space-between", marginBottom:5 }}>
                      <span style={{ color:"#F0F0F8", fontWeight:600, fontSize:13 }}>{shoe.name}</span>
                      <span style={{ color:"#A78BFA", fontSize:13, fontWeight:500 }}>${shoe.price}</span>
                    </div>
                    <div style={{ color:"#555", fontSize:12, marginBottom:7 }}>{shoe.category} · {shoe.surface} · {shoe.weight}g · drop {shoe.drop}mm</div>
                    {lr.length && shoe.sim && <div style={{ color:"#333", fontSize:11, marginBottom:6 }}>Similarity: {(shoe.sim*100).toFixed(0)}%</div>}
                    <div style={{ display:"flex", flexWrap:"wrap", gap:4 }}>
                      {shoe.bestFor.map(b => <span key={b} style={{ background:"#1E1E2E", color:"#888", fontSize:11, padding:"2px 7px", borderRadius:4 }}>{b}</span>)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Week Plan ── */}
          {tab==="week" && (
            <div style={{ flex:1, overflowY:"auto", padding:22 }}>
              <h2 style={{ color:"#F0F0F8", fontSize:17, fontWeight:600, margin:"0 0 4px" }}>This week's training</h2>
              <p style={{ color:"#555", fontSize:13, margin:"0 0 18px" }}>
                Boston Marathon prep · {connected.includes("strava") ? "Live from Strava" : "Week 20 of 24"}
              </p>
              <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                {athlete.runs.map(r => {
                  const c = {Easy:"#00C896","Easy Run":"#00C896",Tempo:"#FFD93D","Tempo Run":"#FFD93D",Intervals:"#FF6B6B",Workout:"#FF6B6B",Long:"#6C63FF","Long Run":"#6C63FF",Recovery:"#00C3FF",Rest:"#333"}[r.type] || "#888";
                  return (
                    <div key={r.date} style={{ background:"#13131A", border:"1px solid #1E1E2E", borderRadius:12, padding:14, display:"flex", alignItems:"center", gap:14 }}>
                      <div style={{ width:36, textAlign:"center", color:"#555", fontSize:11, textTransform:"uppercase", letterSpacing:"0.05em" }}>{r.date}</div>
                      <div style={{ width:7, height:7, background:c, borderRadius:"50%", flexShrink:0 }}/>
                      <div style={{ flex:1 }}>
                        <div style={{ color:"#F0F0F8", fontWeight:500, fontSize:14 }}>{r.type}</div>
                        {r.miles>0 && <div style={{ color:"#555", fontSize:12 }}>{r.miles} mi · {r.pace}/mi · HR {r.hr}</div>}
                      </div>
                      {r.miles>0 && (
                        <div style={{ display:"flex", gap:14 }}>
                          {[[r.miles,"mi"],[r.pace,"pace"],[r.hr,"bpm"]].map(([v,u]) => (
                            <div key={u} style={{ textAlign:"center" }}>
                              <div style={{ color:"#F0F0F8", fontWeight:600, fontSize:13, fontFamily:"'DM Mono',monospace" }}>{v}</div>
                              <div style={{ color:"#555", fontSize:11 }}>{u}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <div style={{ background:"#6C63FF15", border:"1px solid #6C63FF33", borderRadius:12, padding:14, marginTop:14 }}>
                <div style={{ color:"#6C63FF", fontWeight:600, fontSize:14, marginBottom:4 }}>
                  Week summary {connected.includes("strava") && <span style={{ fontSize:11, fontWeight:400, color:"#6C63FF88" }}>· via Strava</span>}
                </div>
                <div style={{ color:"#888", fontSize:13 }}>
                  Total: {athlete.weeklyMileage} mi
                  {athlete.fitnessScore && ` · Fitness: ${athlete.fitnessScore}`}
                  {athlete.fatigueScore && ` · Fatigue: ${athlete.fatigueScore}`}
                  {athlete.fitnessScore && athlete.fatigueScore && ` · Form: +${athlete.fitnessScore - athlete.fatigueScore}`}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}