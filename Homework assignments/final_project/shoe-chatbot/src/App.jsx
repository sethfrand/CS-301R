import { useCallback, useEffect, useRef, useState } from "react";
import "./App.css";
import ChatView from "./components/ChatView";
import ConnectTab from "./components/ConnectTab";
import Dashboard from "./components/Dashboard";
import LockScreen from "./components/LockScreen";
import TrainingTab from "./components/TrainingTab";
import { createApiClient } from "./lib/api";
import { APP_TABS, DEFAULT_SHOPPING_PREFS, LOCAL_STORAGE_KEYS, TEMP_WORN_TEST_SHOE } from "./lib/constants";
import { loadJson, saveJson } from "./lib/storage";

function useTheme() {
  const [theme, setThemeState] = useState(() => localStorage.getItem(LOCAL_STORAGE_KEYS.THEME) || "dark");

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const setTheme = (nextTheme) => {
    localStorage.setItem(LOCAL_STORAGE_KEYS.THEME, nextTheme);
    setThemeState(nextTheme);
  };

  return [theme, setTheme];
}

function useUnits() {
  const [units] = useState(() => {
    localStorage.setItem(LOCAL_STORAGE_KEYS.UNITS, "mi");
    return "mi";
  });

  return [units];
}

function withTemporaryWornTestShoe(data) {
  if (!data || typeof data !== "object") return data;
  const strava = data.strava;
  if (!strava || typeof strava !== "object") return data;

  const shoes = Array.isArray(strava.shoes) ? strava.shoes : [];
  const alreadyPresent = shoes.some((shoe) => shoe?.id === TEMP_WORN_TEST_SHOE.id || shoe?.name === TEMP_WORN_TEST_SHOE.name);
  if (alreadyPresent) return data;

  return {
    ...data,
    strava: {
      ...strava,
      shoes: [...shoes, TEMP_WORN_TEST_SHOE],
    },
  };
}

function tabIcon(tabId) {
  switch (tabId) {
    case "chat":
      return <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M1 1h12v9H8l-3 3v-3H1V1z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>;
    case "dashboard":
      return <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="1" y="7" width="3" height="6" rx="1" stroke="currentColor" strokeWidth="1.5" /><rect x="5.5" y="4" width="3" height="9" rx="1" stroke="currentColor" strokeWidth="1.5" /><rect x="10" y="1" width="3" height="12" rx="1" stroke="currentColor" strokeWidth="1.5" /></svg>;
    case "training":
      return <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="1" y="1" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.5" /><path d="M4 4h6M4 7h6M4 10h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>;
    case "connect":
      return <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="3" cy="7" r="2" stroke="currentColor" strokeWidth="1.5" /><circle cx="11" cy="3" r="2" stroke="currentColor" strokeWidth="1.5" /><circle cx="11" cy="11" r="2" stroke="currentColor" strokeWidth="1.5" /><path d="M5 6.5L9 4M5 7.5L9 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>;
    default:
      return null;
  }
}

export default function App() {
  const [theme, setTheme] = useTheme();
  const [units] = useUnits();
  const [token, setToken] = useState(null);
  const [tab, setTab] = useState("chat");
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      content: "Hey! I'm your running shoe expert. Connect Strava or Intervals.icu in the Connect tab for personalized recommendations — or just ask me anything.",
      citations: [],
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [athleteData, setAthleteData] = useState(null);
  const [insights, setInsights] = useState(null);
  const [stravaTokens, setStravaTokens] = useState(() => loadJson(LOCAL_STORAGE_KEYS.STRAVA_TOKENS, null));
  const [intervalsStatus, setIntervalsStatus] = useState({ connected: false, athlete_id: null });
  const [shoppingPrefs, setShoppingPrefs] = useState(() => ({
    ...DEFAULT_SHOPPING_PREFS,
    ...(loadJson(LOCAL_STORAGE_KEYS.SHOPPING_PREFS, DEFAULT_SHOPPING_PREFS) || {}),
  }));
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  const toggleTheme = () => setTheme(theme === "dark" ? "light" : "dark");

  useEffect(() => {
    const savedToken = localStorage.getItem(LOCAL_STORAGE_KEYS.TOKEN);
    if (savedToken) setToken(savedToken);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const rawTokens = params.get("strava_tokens");
    if (!rawTokens) return;

    window.history.replaceState({}, "", "/");
    const tokenEntries = Object.fromEntries(new URLSearchParams(decodeURIComponent(rawTokens)));
    const parsedTokens = {
      access_token: tokenEntries.access_token,
      refresh_token: tokenEntries.refresh_token,
      expires_at: Number(tokenEntries.expires_at),
    };
    saveJson(LOCAL_STORAGE_KEYS.STRAVA_TOKENS, parsedTokens);
    setStravaTokens(parsedTokens);
    setTab("dashboard");
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    saveJson(LOCAL_STORAGE_KEYS.SHOPPING_PREFS, shoppingPrefs);
  }, [shoppingPrefs]);

  const refreshAthleteData = useCallback(async (sessionToken, force = false) => {
    const activeToken = sessionToken || token;
    if (!activeToken) return;

    const nextData = {};

    if (stravaTokens) {
      try {
        const { data } = await createApiClient(activeToken).post("/strava/fetch-data", stravaTokens);
        nextData.strava = data;
      } catch (errorResponse) {
        console.error("Strava:", errorResponse);
        if (errorResponse.response?.status === 400) {
          try {
            const creds = loadJson(LOCAL_STORAGE_KEYS.STRAVA_CREDS, {});
            if (creds.id && creds.secret) {
              await createApiClient(activeToken).post("/strava/set-credentials", {
                client_id: creds.id,
                client_secret: creds.secret,
              });
              const { data } = await createApiClient(activeToken).post("/strava/fetch-data", stravaTokens);
              nextData.strava = data;
            }
          } catch (retryError) {
            console.error("Strava retry:", retryError);
          }
        }
      }
    }

    try {
      const intervalStatusResponse = await createApiClient(activeToken).get("/intervals/status");
      setIntervalsStatus(intervalStatusResponse.data);
      if (intervalStatusResponse.data.connected) {
        const path = force ? "/intervals/fetch-data?force=true" : "/intervals/fetch-data";
        const { data } = await createApiClient(activeToken).get(path);
        nextData.garmin = data;
      }
    } catch (errorResponse) {
      console.error("Intervals:", errorResponse);
    }

    const enrichedData = Object.keys(nextData).length ? withTemporaryWornTestShoe(nextData) : null;
    setAthleteData(enrichedData);

    if (!enrichedData) {
      setInsights(null);
      return;
    }

    try {
      const { data } = await createApiClient(activeToken).post("/insights", { athlete_data: enrichedData });
      setInsights(data);
    } catch (errorResponse) {
      console.error("Insights:", errorResponse);
      setInsights(null);
    }
  }, [token, stravaTokens]);

  useEffect(() => {
    if (!token) return undefined;

    const intervalId = setInterval(() => {
      if (stravaTokens || intervalsStatus?.connected) {
        refreshAthleteData(token, false);
      }
    }, 30 * 60 * 1000);

    return () => clearInterval(intervalId);
  }, [token, stravaTokens, intervalsStatus?.connected, refreshAthleteData]);

  useEffect(() => {
    if (token && (stravaTokens || intervalsStatus?.connected)) {
      refreshAthleteData(token);
      return undefined;
    }

    if (token) {
      setAthleteData(null);
      setInsights(null);
    }
  }, [token, stravaTokens, intervalsStatus?.connected, refreshAthleteData]);

  const handleUnlock = (sessionToken) => {
    setToken(sessionToken);
    refreshAthleteData(sessionToken);
  };

  const handleStravaTokens = (nextTokens) => {
    setStravaTokens(nextTokens);
    if (nextTokens) saveJson(LOCAL_STORAGE_KEYS.STRAVA_TOKENS, nextTokens);
    else localStorage.removeItem(LOCAL_STORAGE_KEYS.STRAVA_TOKENS);
  };

  const send = async (text) => {
    const query = (text || input).trim();
    if (!query || loading) return;

    setInput("");
    setError(null);
    setTab("chat");
    setMessages((previous) => [...previous, { role: "user", content: query }]);
    setLoading(true);

    try {
      const history = messages.map((message) => ({ role: message.role, content: message.content }));
      const { data } = await createApiClient(token).post("/chat", {
        message: query,
        history,
        athlete_context: athleteData,
        shopping_preferences: shoppingPrefs,
      });
      setMessages((previous) => [...previous, { role: "assistant", content: data.response, citations: data.citations || [] }]);
    } catch (errorResponse) {
      if (errorResponse.response?.status === 401) {
        localStorage.removeItem(LOCAL_STORAGE_KEYS.TOKEN);
        setToken(null);
      } else {
        setError(errorResponse.response?.data?.detail || "Couldn't reach the server. Is the backend running?");
      }
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  };

  if (!token) {
    return <LockScreen onUnlock={handleUnlock} />;
  }

  return (
    <div className="app">
      <header>
        <div className="logo">
          <svg width="26" height="26" viewBox="0 0 28 28" fill="none">
            <path d="M2 20 Q8 8 14 12 Q20 16 26 4" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
            <circle cx="14" cy="14" r="3" fill="currentColor" opacity="0.3" />
          </svg>
          RunRec
        </div>
        <p className="tagline">AI-powered shoe recommendations</p>
        <nav className="tab-nav">
          {APP_TABS.map((appTab) => (
            <button key={appTab.id} className={`tab-btn ${tab === appTab.id ? "active" : ""}`} onClick={() => setTab(appTab.id)}>
              {tabIcon(appTab.id)}
              {appTab.label}
              {appTab.id === "connect" && (stravaTokens || intervalsStatus?.connected) && <span className="dot-connected" />}
            </button>
          ))}
        </nav>
        <button className="theme-toggle" title="Toggle theme" onClick={toggleTheme}>
          {theme === "dark" ? (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="5" stroke="currentColor" strokeWidth="1.8" />
              <path d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          ) : (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </button>
        <button className="lock-btn-header" title="Lock" onClick={() => { localStorage.removeItem(LOCAL_STORAGE_KEYS.TOKEN); setToken(null); }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
            <rect x="3" y="11" width="18" height="11" rx="2" stroke="currentColor" strokeWidth="1.8" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
      </header>

      {tab === "chat" && (
        <ChatView
          messages={messages}
          loading={loading}
          error={error}
          input={input}
          setInput={setInput}
          send={send}
          inputRef={inputRef}
          bottomRef={bottomRef}
          shoppingPrefs={shoppingPrefs}
          setShoppingPrefs={setShoppingPrefs}
        />
      )}

      {tab === "dashboard" && (
        <main className="tab-content">
          <Dashboard athleteData={athleteData} insights={insights} token={token} onAskAboutData={send} units={units} />
        </main>
      )}

      {tab === "training" && (
        <main className="tab-content">
          <TrainingTab garminData={athleteData?.garmin} insights={insights} units={units} onAskAboutData={send} />
        </main>
      )}

      {tab === "connect" && (
        <main className="tab-content">
          <ConnectTab
            token={token}
            stravaTokens={stravaTokens}
            setStravaTokens={handleStravaTokens}
            intervalsStatus={intervalsStatus}
            setIntervalsStatus={setIntervalsStatus}
            onRefreshData={(force) => refreshAthleteData(token, force)}
          />
        </main>
      )}
    </div>
  );
}
