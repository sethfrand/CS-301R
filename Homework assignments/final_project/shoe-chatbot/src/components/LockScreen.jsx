import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { API_BASE_URL, LOCAL_STORAGE_KEYS } from "../lib/constants";

export default function LockScreen({ onUnlock }) {
  const [pinSet, setPinSet] = useState(null);
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    axios
      .get(`${API_BASE_URL}/auth/status`)
      .then((response) => setPinSet(response.data.pin_set))
      .catch(() => setPinSet(false));
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
  }, [pinSet]);

  const submit = async (event) => {
    event?.preventDefault();
    setError("");

    if (!pinSet && pin !== confirm) {
      setError("PINs don't match");
      return;
    }

    if (!pinSet && pin.length < 4) {
      setError("PIN must be at least 4 characters");
      return;
    }

    setLoading(true);
    try {
      const endpoint = pinSet ? "/auth/login" : "/auth/setup";
      const { data } = await axios.post(`${API_BASE_URL}${endpoint}`, { pin });
      localStorage.setItem(LOCAL_STORAGE_KEYS.TOKEN, data.token);
      onUnlock(data.token);
    } catch (errorResponse) {
      setError(errorResponse.response?.data?.detail || "Error");
      setPin("");
      setConfirm("");
    } finally {
      setLoading(false);
    }
  };

  if (pinSet === null) {
    return (
      <div className="lock-screen">
        <div className="lock-spinner" />
      </div>
    );
  }

  return (
    <div className="lock-screen">
      <div className="lock-card">
        <div className="lock-logo">
          <svg width="30" height="30" viewBox="0 0 28 28" fill="none">
            <path d="M2 20 Q8 8 14 12 Q20 16 26 4" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" />
            <circle cx="14" cy="14" r="3" fill="var(--accent)" opacity="0.3" />
          </svg>
          RunRec
        </div>
        <div className="lock-icon">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
            <rect x="3" y="11" width="18" height="11" rx="2" stroke="currentColor" strokeWidth="1.8" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </div>
        <h2 className="lock-title">{pinSet ? "Welcome back" : "Set your PIN"}</h2>
        <p className="lock-sub">{pinSet ? "Enter your PIN to continue" : "Choose a PIN to protect your data"}</p>
        <form className="lock-form" onSubmit={submit}>
          <div className="pin-dots">
            {[0, 1, 2, 3].map((index) => (
              <div key={index} className={`pin-dot ${pin.length > index ? "filled" : ""}`} />
            ))}
          </div>
          <input
            ref={inputRef}
            className="pin-input"
            type="password"
            value={pin}
            onChange={(event) => {
              setPin(event.target.value);
              setError("");
            }}
            placeholder={pinSet ? "Enter PIN" : "Choose a PIN"}
            autoComplete="current-password"
          />
          {!pinSet && (
            <input
              className="pin-input"
              type="password"
              value={confirm}
              onChange={(event) => {
                setConfirm(event.target.value);
                setError("");
              }}
              placeholder="Confirm PIN"
            />
          )}
          {error && <p className="lock-error">{error}</p>}
          <button className="lock-btn" type="submit" disabled={loading || !pin}>
            {loading ? "…" : pinSet ? "Unlock" : "Set PIN & Enter"}
          </button>
        </form>
      </div>
    </div>
  );
}
