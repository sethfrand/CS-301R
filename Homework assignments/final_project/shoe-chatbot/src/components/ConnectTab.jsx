import { useState } from "react";
import { API_BASE_URL, LOCAL_STORAGE_KEYS } from "../lib/constants";
import { createApiClient } from "../lib/api";
import { loadJson, saveJson } from "../lib/storage";

export default function ConnectTab({
  token,
  stravaTokens,
  setStravaTokens,
  intervalsStatus,
  setIntervalsStatus,
  onRefreshData,
}) {
  const savedCreds = loadJson(LOCAL_STORAGE_KEYS.STRAVA_CREDS, {});
  const [stravaClientId, setStravaClientId] = useState(savedCreds.id || "");
  const [stravaClientSec, setStravaClientSec] = useState(savedCreds.secret || "");
  const [stravaStep, setStravaStep] = useState(stravaTokens ? "connected" : "creds");
  const [stravaErr, setStravaErr] = useState("");
  const [stravaLoading, setStravaLoading] = useState(false);

  const [intervalsAthleteId, setIntervalsAthleteId] = useState(intervalsStatus?.athlete_id || "");
  const [intervalsApiKey, setIntervalsApiKey] = useState("");
  const [intervalsErr, setIntervalsErr] = useState("");
  const [intervalsLoading, setIntervalsLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(null);

  const saveCreds = async (event) => {
    event?.preventDefault();
    setStravaErr("");
    setStravaLoading(true);

    try {
      await createApiClient(token).post("/strava/set-credentials", {
        client_id: stravaClientId,
        client_secret: stravaClientSec,
      });
      saveJson(LOCAL_STORAGE_KEYS.STRAVA_CREDS, { id: stravaClientId, secret: stravaClientSec });
      setStravaStep("oauth");
    } catch (error) {
      setStravaErr(error.response?.data?.detail || "Error");
    } finally {
      setStravaLoading(false);
    }
  };

  const intervalsLogin = async (event) => {
    event?.preventDefault();
    setIntervalsErr("");
    setIntervalsLoading(true);

    try {
      const { data } = await createApiClient(token).post("/intervals/login", {
        athlete_id: intervalsAthleteId,
        api_key: intervalsApiKey,
      });
      setIntervalsStatus({ connected: true, athlete_id: data.athlete_id });
      setIntervalsApiKey("");
      setTimeout(() => onRefreshData(), 200);
    } catch (error) {
      setIntervalsErr(error.response?.data?.detail || "Login failed");
    } finally {
      setIntervalsLoading(false);
    }
  };

  const intervalsLogout = async () => {
    await createApiClient(token).post("/intervals/logout");
    setIntervalsStatus({ connected: false, athlete_id: null });
    setIntervalsAthleteId("");
  };

  const disconnectStrava = () => {
    localStorage.removeItem(LOCAL_STORAGE_KEYS.STRAVA_TOKENS);
    setStravaTokens(null);
    setStravaStep("creds");
    setStravaClientSec("");
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await onRefreshData(true);
    setLastRefresh(new Date());
    setRefreshing(false);
  };

  return (
    <div className="connect-tab">
      <div className="connect-intro">
        <h3>Connect Your Apps</h3>
        <p>Link Strava and Intervals.icu to unlock personalized shoe recommendations, training insights, and the full dashboard.</p>
      </div>
      <div className="provider-cards">
        <div className={`provider-card ${stravaTokens ? "connected" : ""}`}>
          <div className="provider-logo strava-logo">
            <svg viewBox="0 0 24 24" fill="currentColor" width="26" height="26">
              <path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169" />
            </svg>
          </div>
          <div className="provider-info">
            <div className="provider-name">Strava</div>
            <div className="provider-desc">Activities · shoe mileage · weekly stats</div>
          </div>
          {stravaTokens
            ? <button className="disconnect-btn" onClick={disconnectStrava}>Disconnect</button>
            : <span className={`status-pill ${stravaStep === "oauth" ? "ready" : "idle"}`}>{stravaStep === "creds" ? "Setup needed" : "Ready"}</span>}
        </div>

        {!stravaTokens && stravaStep === "creds" && (
          <form className="creds-form" onSubmit={saveCreds}>
            <div className="creds-hint">
              Create a free app at <a href="https://www.strava.com/settings/api" target="_blank" rel="noreferrer">strava.com/settings/api</a> —
              callback URL: <code>http://localhost:8000/strava/callback</code>
            </div>
            <div className="form-row">
              <input className="form-input" placeholder="Client ID" value={stravaClientId} onChange={(event) => setStravaClientId(event.target.value)} required />
              <input className="form-input" placeholder="Client Secret" type="password" value={stravaClientSec} onChange={(event) => setStravaClientSec(event.target.value)} required />
            </div>
            {stravaErr && <p className="form-err">{stravaErr}</p>}
            <button className="form-btn" type="submit" disabled={stravaLoading}>{stravaLoading ? "Saving…" : "Save & Continue →"}</button>
          </form>
        )}

        {!stravaTokens && stravaStep === "oauth" && (
          <div className="oauth-step">
            <p>Credentials saved. Connect your Strava account to continue.</p>
            <button className="oauth-btn" onClick={() => { window.location.href = `${API_BASE_URL}/strava/auth`; }}>
              <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
                <path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169" />
              </svg>
              Connect with Strava
            </button>
          </div>
        )}

        <div className={`provider-card ${intervalsStatus?.connected ? "connected" : ""}`}>
          <div className="provider-logo" style={{ color: "#e8532a" }}>
            <svg viewBox="0 0 24 24" fill="currentColor" width="26" height="26">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z" />
            </svg>
          </div>
          <div className="provider-info">
            <div className="provider-name">Intervals.icu</div>
            <div className="provider-desc">VO2 max · HRV · sleep · training load · fitness &amp; form</div>
            {intervalsStatus?.connected && <div className="provider-email">{intervalsStatus.athlete_id}</div>}
          </div>
          {intervalsStatus?.connected
            ? <button className="disconnect-btn" onClick={intervalsLogout}>Disconnect</button>
            : <span className="status-pill idle">Login required</span>}
        </div>

        {!intervalsStatus?.connected && (
          <form className="creds-form" onSubmit={intervalsLogin}>
            <div className="creds-hint">
              Get your Athlete ID and API key from{" "}
              <a href="https://intervals.icu/settings" target="_blank" rel="noreferrer">intervals.icu/settings</a>{" "}
              under <strong>API Access</strong>. Intervals.icu syncs automatically from Garmin — no Garmin login needed.
            </div>
            <div className="form-row">
              <input
                className="form-input"
                placeholder="Athlete ID (e.g. i12345)"
                value={intervalsAthleteId}
                onChange={(event) => setIntervalsAthleteId(event.target.value)}
                required
              />
              <input
                className="form-input"
                placeholder="API Key"
                type="password"
                value={intervalsApiKey}
                onChange={(event) => setIntervalsApiKey(event.target.value)}
                required
              />
            </div>
            {intervalsErr && <p className="form-err">{intervalsErr}</p>}
            <button className="form-btn" type="submit" disabled={intervalsLoading}>
              {intervalsLoading ? "Connecting…" : "Connect Intervals.icu"}
            </button>
          </form>
        )}
      </div>

      {(stravaTokens || intervalsStatus?.connected) && (
        <div className="refresh-row">
          <button className="refresh-btn" onClick={handleRefresh} disabled={refreshing}>
            {refreshing ? "Refreshing…" : "↻  Refresh Data"}
          </button>
          {lastRefresh && (
            <span className="refresh-time">
              Last updated {lastRefresh.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
            </span>
          )}
          <span className="refresh-note">Auto-refreshes every 30 min</span>
        </div>
      )}

      <div className="security-note">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
          <path d="M12 2L3 7v5c0 5.25 3.75 10.15 9 11.35C17.25 22.15 21 17.25 21 12V7L12 2z" stroke="currentColor" strokeWidth="1.8" />
        </svg>
        <span>Strava tokens live in your browser&apos;s localStorage. Intervals.icu credentials are held in server memory and cleared on restart.</span>
      </div>
    </div>
  );
}
