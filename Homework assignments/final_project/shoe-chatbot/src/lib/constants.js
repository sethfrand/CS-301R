export const API_BASE_URL = "http://localhost:8000";

export const LOCAL_STORAGE_KEYS = {
  TOKEN: "runrec_session",
  STRAVA_TOKENS: "runrec_strava_tokens",
  STRAVA_CREDS: "runrec_strava_creds",
  UNITS: "runrec_units",
  THEME: "runrec_theme",
  SHOPPING_PREFS: "runrec_shopping_prefs",
};

export const DEFAULT_SHOPPING_PREFS = {
  shoe_size: "",
  shoe_gender: "mens",
};

export const SUGGESTIONS = [
  "Best shoe for marathon racing?",
  "Daily trainer with max cushion",
  "Lightweight trail shoe for ultras",
  "Stability shoe for overpronators",
  "Carbon plate racer under 200g",
  "What shoes would complement my current rotation?",
];

export const TEMP_WORN_TEST_SHOE = {
  id: "temp-worn-test-shoe",
  name: "Temp Test Shoe - Near Retirement",
  distance: 790000,
  retire_distance: 800000,
  primary: false,
};

export const APP_TABS = [
  { id: "chat", label: "Chat" },
  { id: "dashboard", label: "Dashboard" },
  { id: "training", label: "Training" },
  { id: "connect", label: "Connect" },
];
