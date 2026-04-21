const M_PER_MI = 1609.34;

export function formatDistance(meters, units = "mi", decimals = 2) {
  if (meters == null || Number.isNaN(Number(meters))) return "—";
  const value = Number(meters);
  return units === "mi" ? (value / M_PER_MI).toFixed(decimals) : (value / 1000).toFixed(decimals);
}

export function formatPace(distanceMeters, durationSeconds, units = "mi") {
  const distance = Number(distanceMeters);
  const duration = Number(durationSeconds);
  if (!distance || !duration) return "—";
  const secondsPerUnit = units === "mi" ? duration / (distance / M_PER_MI) : duration / (distance / 1000);
  const minutes = Math.floor(secondsPerUnit / 60);
  const seconds = Math.round(secondsPerUnit % 60);
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function distanceLabel(units = "mi") {
  return units === "mi" ? "mi" : "km";
}

export function paceLabel(units = "mi") {
  return units === "mi" ? "/mi" : "/km";
}

export function formatSleep(seconds) {
  if (!seconds) return "—";
  return `${(seconds / 3600).toFixed(1)}h`;
}
