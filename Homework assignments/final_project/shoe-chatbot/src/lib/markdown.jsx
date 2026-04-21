import React from "react";

const INLINE_PATTERN = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\((?:https?:\/\/[^\s)]+)\))/g;

function renderInline(text) {
  const input = String(text || "");
  const parts = input.split(INLINE_PATTERN).filter(Boolean);

  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("*") && part.endsWith("*")) {
      return <em key={index}>{part.slice(1, -1)}</em>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={index}>{part.slice(1, -1)}</code>;
    }
    const linkMatch = part.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);
    if (linkMatch) {
      return (
        <a key={index} href={linkMatch[2]} target="_blank" rel="noreferrer">
          {linkMatch[1]}
        </a>
      );
    }
    return <React.Fragment key={index}>{part}</React.Fragment>;
  });
}

function renderList(lines, ordered, keyPrefix) {
  const Tag = ordered ? "ol" : "ul";
  const pattern = ordered ? /^\d+\.\s+/ : /^[-*]\s+/;

  return (
    <Tag key={keyPrefix}>
      {lines.map((line, index) => (
        <li key={`${keyPrefix}-${index}`}>{renderInline(line.replace(pattern, "").trim())}</li>
      ))}
    </Tag>
  );
}

export function renderMarkdown(text) {
  const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  let paragraph = [];
  let list = null;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push({ type: "paragraph", lines: paragraph });
    paragraph = [];
  };

  const flushList = () => {
    if (!list?.items.length) return;
    blocks.push(list);
    list = null;
  };

  lines.forEach((rawLine) => {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    if (!trimmed) {
      flushParagraph();
      flushList();
      return;
    }

    if (trimmed.startsWith("### ")) {
      flushParagraph();
      flushList();
      blocks.push({ type: "heading", level: 3, text: trimmed.slice(4) });
      return;
    }

    if (trimmed.startsWith("## ")) {
      flushParagraph();
      flushList();
      blocks.push({ type: "heading", level: 2, text: trimmed.slice(3) });
      return;
    }

    if (trimmed.startsWith("# ")) {
      flushParagraph();
      flushList();
      blocks.push({ type: "heading", level: 1, text: trimmed.slice(2) });
      return;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      flushParagraph();
      if (!list || list.type !== "ul") {
        flushList();
        list = { type: "ul", items: [] };
      }
      list.items.push(trimmed);
      return;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      flushParagraph();
      if (!list || list.type !== "ol") {
        flushList();
        list = { type: "ol", items: [] };
      }
      list.items.push(trimmed);
      return;
    }

    if (list) {
      flushList();
    }
    paragraph.push(trimmed);
  });

  flushParagraph();
  flushList();

  return blocks.map((block, index) => {
    if (block.type === "heading") {
      const key = `heading-${index}`;
      if (block.level === 1) return <h1 key={key}>{renderInline(block.text)}</h1>;
      if (block.level === 2) return <h2 key={key}>{renderInline(block.text)}</h2>;
      return <h3 key={key}>{renderInline(block.text)}</h3>;
    }

    if (block.type === "ul") return renderList(block.items, false, `ul-${index}`);
    if (block.type === "ol") return renderList(block.items, true, `ol-${index}`);

    return <p key={`p-${index}`}>{renderInline(block.lines.join(" "))}</p>;
  });
}
