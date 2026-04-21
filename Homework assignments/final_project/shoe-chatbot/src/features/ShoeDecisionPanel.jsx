import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import "./shoe-decision.css";

const API = "http://localhost:8000";
const SHORTLIST_KEY = "runrec_shoe_shortlist";

function uniqModels(models) {
  return [...new Set((models || []).map((model) => String(model || "").trim()).filter(Boolean))];
}

function loadShortlist() {
  try {
    const raw = JSON.parse(localStorage.getItem(SHORTLIST_KEY) || "[]");
    return Array.isArray(raw) ? uniqModels(raw) : [];
  } catch {
    return [];
  }
}

function formatWeightDrop(shoe) {
  const parts = [];
  if (shoe?.weight_oz) parts.push(`${Number(shoe.weight_oz).toFixed(1)} oz`);
  if (shoe?.drop_mm) parts.push(`${Number(shoe.drop_mm).toFixed(1)} mm drop`);
  return parts.join(" | ") || "No lab weight/drop";
}

function catalogClient(token) {
  return axios.create({ baseURL: API, headers: token ? { "x-session-token": token } : {} });
}

export default function ShoeDecisionPanel({ token, athleteData, trainingData, insights, onAskAboutData }) {
  const seededModels = useMemo(() => {
    const stravaShoes = Array.isArray(athleteData?.strava?.shoes) ? athleteData.strava.shoes.map((shoe) => shoe?.name) : [];
    const replacementOptions = Array.isArray(insights?.shoe_rotation?.replacement_plan)
      ? (insights.shoe_rotation.replacement_plan[0]?.replacement_options || []).map((shoe) => shoe?.model)
      : [];
    return uniqModels([...stravaShoes, ...replacementOptions]).slice(0, 8);
  }, [athleteData, insights]);

  const [shortlist, setShortlist] = useState(() => loadShortlist());
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [leftModel, setLeftModel] = useState("");
  const [rightModel, setRightModel] = useState("");
  const [comparison, setComparison] = useState(null);
  const [comparing, setComparing] = useState(false);
  const [compareError, setCompareError] = useState("");

  useEffect(() => {
    if (shortlist.length === 0 && seededModels.length > 0) {
      setShortlist(seededModels);
    }
  }, [seededModels, shortlist.length]);

  useEffect(() => {
    localStorage.setItem(SHORTLIST_KEY, JSON.stringify(shortlist));
  }, [shortlist]);

  useEffect(() => {
    if (shortlist.length === 0) {
      setLeftModel("");
      setRightModel("");
      return;
    }
    if (!shortlist.includes(leftModel)) {
      setLeftModel(shortlist[0] || "");
    }
    if (!shortlist.includes(rightModel) || rightModel === leftModel) {
      const nextRight = shortlist.find((model) => model !== (shortlist.includes(leftModel) ? leftModel : shortlist[0])) || shortlist[1] || "";
      setRightModel(nextRight);
    }
  }, [shortlist, leftModel, rightModel]);

  const addToShortlist = (model) => {
    setShortlist((prev) => uniqModels([...prev, model]).slice(0, 12));
  };

  const removeFromShortlist = (model) => {
    setShortlist((prev) => prev.filter((item) => item !== model));
  };

  const searchCatalog = async () => {
    const nextQuery = query.trim();
    if (!nextQuery) return;
    setSearching(true);
    setSearchError("");
    try {
      const { data } = await catalogClient(token).get("/shoe-catalog/search", { params: { q: nextQuery, limit: 6 } });
      setResults(Array.isArray(data?.results) ? data.results : []);
    } catch (err) {
      setSearchError(err.response?.data?.detail || "Could not search the shoe catalog.");
      setResults([]);
    } finally {
      setSearching(false);
    }
  };

  const compareShoes = async () => {
    if (!leftModel || !rightModel || leftModel === rightModel) {
      setCompareError("Pick two different shoes to compare.");
      return;
    }
    setComparing(true);
    setCompareError("");
    try {
      const { data } = await catalogClient(token).post("/shoe-catalog/compare", {
        models: [leftModel, rightModel],
        athlete_data: athleteData,
        training_data: trainingData,
      });
      setComparison(data);
    } catch (err) {
      setCompareError(err.response?.data?.detail || "Could not compare those shoes.");
      setComparison(null);
    } finally {
      setComparing(false);
    }
  };

  return (
    <section className="decision-panel">
      <div className="section-header">
        <h3 className="section-title">Compare & Shortlist</h3>
        {onAskAboutData && (
          <button
            className="ask-btn"
            onClick={() => onAskAboutData("Compare the best shoe options in my shortlist and tell me which one fits my current training best.")}
          >
            Ask AI ↗
          </button>
        )}
      </div>

      <div className="decision-grid">
        <div className="decision-card">
          <div className="decision-card-head">
            <h4>Catalog Search</h4>
            <span className="decision-note">Add shoes to a saved shortlist.</span>
          </div>
          <div className="decision-search-row">
            <input
              className="decision-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && searchCatalog()}
              placeholder="Search a model, brand, or use case"
            />
            <button className="decision-btn" type="button" onClick={searchCatalog} disabled={searching}>
              {searching ? "Searching…" : "Search"}
            </button>
          </div>
          {searchError && <div className="decision-error">{searchError}</div>}
          <div className="decision-list">
            {results.length === 0 && <div className="decision-empty">Search the catalog to add shoes.</div>}
            {results.map((shoe) => (
              <article key={shoe.model} className="decision-item">
                <div className="decision-item-top">
                  <strong>{shoe.model}</strong>
                  <button className="decision-link-btn" type="button" onClick={() => addToShortlist(shoe.model)}>
                    Add
                  </button>
                </div>
                <div className="decision-item-meta">{formatWeightDrop(shoe)}</div>
                <div className="decision-item-meta">
                  {shoe.support ? `Support: ${shoe.support}` : "Support: n/a"}
                  {Array.isArray(shoe.usage_tags) && shoe.usage_tags.length > 0 ? ` | Use: ${shoe.usage_tags.join(", ")}` : ""}
                </div>
                {shoe.url && (
                  <a className="catalog-link" href={shoe.url} target="_blank" rel="noreferrer">
                    View in catalog
                  </a>
                )}
              </article>
            ))}
          </div>
        </div>

        <div className="decision-card">
          <div className="decision-card-head">
            <h4>Saved Shortlist</h4>
            <span className="decision-note">{shortlist.length} saved</span>
          </div>
          <div className="shortlist-wrap">
            {shortlist.length === 0 && <div className="decision-empty">No shortlisted shoes yet.</div>}
            {shortlist.map((model) => (
              <div key={model} className="shortlist-chip">
                <span>{model}</span>
                <button type="button" onClick={() => removeFromShortlist(model)}>Remove</button>
              </div>
            ))}
          </div>

          <div className="compare-controls">
            <select className="decision-select" value={leftModel} onChange={(e) => setLeftModel(e.target.value)}>
              {shortlist.map((model) => <option key={`left-${model}`} value={model}>{model}</option>)}
            </select>
            <select className="decision-select" value={rightModel} onChange={(e) => setRightModel(e.target.value)}>
              {shortlist.map((model) => <option key={`right-${model}`} value={model}>{model}</option>)}
            </select>
            <button className="decision-btn" type="button" onClick={compareShoes} disabled={comparing || shortlist.length < 2}>
              {comparing ? "Comparing…" : "Compare"}
            </button>
          </div>
          {compareError && <div className="decision-error">{compareError}</div>}
        </div>
      </div>

      {comparison && (
        <div className="decision-card comparison-card">
          <div className="decision-card-head">
            <h4>Side-by-Side Comparison</h4>
            <span className="decision-note">
              {Array.isArray(comparison.comparison?.demand_tags) && comparison.comparison.demand_tags.length > 0
                ? `Training demand: ${comparison.comparison.demand_tags.slice(0, 3).join(", ")}`
                : "Training demand unavailable"}
            </span>
          </div>

          <div className="comparison-grid">
            {(comparison.shoes || []).map((shoe) => {
              const fit = (comparison.comparison?.fit_notes || []).find((note) => note.model === shoe.model);
              return (
                <article key={shoe.model} className="comparison-shoe">
                  <div className="comparison-model">{shoe.model}</div>
                  <div className="comparison-meta">{formatWeightDrop(shoe)}</div>
                  <div className="comparison-meta">
                    {shoe.support ? `Support: ${shoe.support}` : "Support: n/a"}
                    {Array.isArray(shoe.usage_tags) && shoe.usage_tags.length > 0 ? ` | Use: ${shoe.usage_tags.join(", ")}` : ""}
                  </div>
                  {shoe.score ? <div className="comparison-score">Score {Math.round(Number(shoe.score))}</div> : null}
                  {fit?.fit_summary && <div className="comparison-fit">{fit.fit_summary}</div>}
                  {Array.isArray(shoe.pros) && shoe.pros.length > 0 && (
                    <div className="comparison-pros">Pros: {shoe.pros.join("; ")}</div>
                  )}
                  {shoe.url && (
                    <a className="catalog-link" href={shoe.url} target="_blank" rel="noreferrer">
                      View in catalog
                    </a>
                  )}
                </article>
              );
            })}
          </div>

          <div className="decision-points">
            {(comparison.comparison?.points || []).map((point, idx) => (
              <div key={idx} className="decision-point">{point}</div>
            ))}
          </div>

          <div className="decision-sources">
            {(comparison.comparison?.sources || []).map((source, idx) => (
              <div key={`${source.label}-${idx}`} className="decision-source">
                <strong>{source.label}</strong>
                {source.detail ? <span>{source.detail}</span> : null}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
