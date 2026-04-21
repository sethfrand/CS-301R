import { SUGGESTIONS } from "../lib/constants";
import { renderMarkdown } from "../lib/markdown.jsx";

function TypingIndicator() {
  return (
    <div className="message assistant">
      <div className="avatar">AI</div>
      <div className="bubble typing"><span /><span /><span /></div>
    </div>
  );
}

function Message({ msg }) {
  const buyCitations = (msg.citations || []).filter((citation) => citation.kind === "buy_link");
  const sourceCitations = (msg.citations || []).filter((citation) => citation.kind !== "buy_link");
  const buyGroups = {};

  buyCitations.forEach((citation) => {
    const model = citation.model || (citation.label?.startsWith("Buy: ") ? citation.label.slice(5) : citation.label);
    if (!buyGroups[model]) buyGroups[model] = [];
    buyGroups[model].push(citation);
  });

  return (
    <div className={`message ${msg.role}`}>
      {msg.role === "assistant" && <div className="avatar">AI</div>}
      <div className="message-body">
        <div className={`bubble ${msg.role === "assistant" ? "markdown-bubble" : ""}`}>
          {msg.role === "assistant"
            ? renderMarkdown(msg.content)
            : msg.content.split("\n").map((line, index) => <p key={index}>{line}</p>)}
        </div>

        {Object.keys(buyGroups).length > 0 && (
          <div className="buy-links-block">
            {Object.entries(buyGroups).map(([model, links]) => (
              <div key={model} className="buy-shoe-group">
                <div className="buy-shoe-name">{model}</div>
                <div className="buy-shoe-links">
                  {links.map((citation, index) => (
                    <a key={`${citation.url || model}-${index}`} href={citation.url} target="_blank" rel="noreferrer" className="buy-link-chip">
                      {index === 0 ? (
                        <>
                          <span className="buy-chip-retailer">{citation.detail?.split(" at ")[1] || citation.label || "Retailer"}</span>
                          <span className="buy-chip-price">{citation.detail?.split(" at ")[0]?.replace("Best price found: ", "") || "View"}</span>
                        </>
                      ) : (
                        <>
                          <span className="buy-chip-retailer">{citation.label}</span>
                          <span className="buy-chip-price">{citation.detail || "View"}</span>
                        </>
                      )}
                    </a>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {msg.role === "assistant" && sourceCitations.length > 0 && (
          <div className="message-citations">
            {sourceCitations.map((citation, index) => (
              <div key={`${citation.label || "source"}-${index}`} className="message-citation">
                <strong>{citation.label || "Source"}</strong>
                {citation.detail ? <span>{citation.detail}</span> : null}
                {citation.url && <a href={citation.url} target="_blank" rel="noreferrer">Open</a>}
              </div>
            ))}
          </div>
        )}
      </div>
      {msg.role === "user" && <div className="avatar user-avatar">You</div>}
    </div>
  );
}

export default function ChatView({
  messages,
  loading,
  error,
  input,
  setInput,
  send,
  inputRef,
  bottomRef,
  shoppingPrefs,
  setShoppingPrefs,
}) {
  return (
    <>
      <main>
        <div className="chat-stage">
          <div className="messages">
            {messages.map((message, index) => <Message key={index} msg={message} />)}
            {loading && <TypingIndicator />}
            {error && <div className="error-banner">{error}</div>}
            <div ref={bottomRef} />
          </div>
        </div>
        {messages.length === 1 && (
          <div className="suggestions">
            {SUGGESTIONS.map((suggestion) => (
              <button key={suggestion} className="suggestion" onClick={() => send(suggestion)}>
                {suggestion}
              </button>
            ))}
          </div>
        )}
      </main>
      <footer>
        <div className="shopping-prefs">
          <label className="shopping-field">
            <span>Size</span>
            <input
              value={shoppingPrefs.shoe_size}
              onChange={(event) => setShoppingPrefs((current) => ({ ...current, shoe_size: event.target.value }))}
              placeholder="10.5"
            />
          </label>
          <label className="shopping-field">
            <span>Category</span>
            <select
              value={shoppingPrefs.shoe_gender}
              onChange={(event) => setShoppingPrefs((current) => ({ ...current, shoe_gender: event.target.value }))}
            >
              <option value="mens">Men&apos;s</option>
              <option value="womens">Women&apos;s</option>
            </select>
          </label>
        </div>
        <div className="input-row">
          <input
            ref={inputRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && !event.shiftKey && send()}
            placeholder="Ask about shoes, terrain, fit, weight…"
            disabled={loading}
            autoFocus
          />
          <button className="send-btn" onClick={() => send()} disabled={loading || !input.trim()}>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M3 10L17 10M17 10L11 4M17 10L11 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
        <div className="composer-hint">Retailer links use the size and category above and are ranked in descending price order.</div>
      </footer>
    </>
  );
}
