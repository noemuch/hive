"use client";

import { cn } from "@/lib/utils";

// Minimal markdown renderer — supports headings, bold, italic,
// inline code, fenced code blocks, blockquotes, and unordered/ordered lists.
// No external library dependency required.

interface ArtifactContentProps {
  content: string;
  className?: string;
}

type Block =
  | { kind: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; text: string }
  | { kind: "codeblock"; lang: string; code: string }
  | { kind: "blockquote"; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] }
  | { kind: "hr" }
  | { kind: "paragraph"; text: string };

function parseInline(text: string): React.ReactNode {
  // Bold **text**, italic *text*, inline `code`
  const parts: React.ReactNode[] = [];
  const re = /(\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+)`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;

  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      parts.push(text.slice(last, m.index));
    }
    if (m[2] !== undefined) {
      parts.push(<strong key={key++}>{m[2]}</strong>);
    } else if (m[3] !== undefined) {
      parts.push(<em key={key++}>{m[3]}</em>);
    } else if (m[4] !== undefined) {
      parts.push(
        <code
          key={key++}
          className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em] text-foreground"
        >
          {m[4]}
        </code>
      );
    }
    last = m.index + m[0].length;
  }

  if (last < text.length) {
    parts.push(text.slice(last));
  }

  return parts.length === 1 ? parts[0] : <>{parts}</>;
}

function parseBlocks(markdown: string): Block[] {
  const lines = markdown.split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    const fenceMatch = line.match(/^```(\w*)$/);
    if (fenceMatch) {
      const lang = fenceMatch[1] ?? "";
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      blocks.push({ kind: "codeblock", lang, code: codeLines.join("\n") });
      continue;
    }

    // Horizontal rule
    if (/^---+$/.test(line.trim())) {
      blocks.push({ kind: "hr" });
      i++;
      continue;
    }

    // Headings
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      blocks.push({
        kind: "heading",
        level: headingMatch[1].length as 1 | 2 | 3 | 4 | 5 | 6,
        text: headingMatch[2],
      });
      i++;
      continue;
    }

    // Blockquote
    if (line.startsWith("> ")) {
      const bqLines: string[] = [line.slice(2)];
      i++;
      while (i < lines.length && lines[i].startsWith("> ")) {
        bqLines.push(lines[i].slice(2));
        i++;
      }
      blocks.push({ kind: "blockquote", text: bqLines.join("\n") });
      continue;
    }

    // Unordered list
    if (/^[-*]\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s/.test(lines[i])) {
        items.push(lines[i].replace(/^[-*]\s/, ""));
        i++;
      }
      blocks.push({ kind: "ul", items });
      continue;
    }

    // Ordered list
    if (/^\d+\.\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s/, ""));
        i++;
      }
      blocks.push({ kind: "ol", items });
      continue;
    }

    // Empty line — skip
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Paragraph — accumulate until blank or structural element
    const paraLines: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].match(/^#{1,6}\s/) &&
      !lines[i].startsWith("```") &&
      !lines[i].startsWith("> ") &&
      !/^[-*]\s/.test(lines[i]) &&
      !/^\d+\.\s/.test(lines[i]) &&
      !/^---+$/.test(lines[i].trim())
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    blocks.push({ kind: "paragraph", text: paraLines.join(" ") });
  }

  return blocks;
}

export function ArtifactContent({ content, className }: ArtifactContentProps) {
  const blocks = parseBlocks(content);

  const headingClasses: Record<number, string> = {
    1: "mt-6 mb-3 text-xl font-bold tracking-tight text-foreground first:mt-0",
    2: "mt-5 mb-2 text-lg font-semibold text-foreground first:mt-0",
    3: "mt-4 mb-2 text-base font-semibold text-foreground first:mt-0",
    4: "mt-3 mb-1 text-sm font-semibold text-foreground first:mt-0",
    5: "mt-3 mb-1 text-sm font-medium text-foreground first:mt-0",
    6: "mt-3 mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground first:mt-0",
  };

  return (
    <div className={cn("space-y-3 text-sm leading-relaxed text-foreground", className)}>
      {blocks.map((block, idx) => {
        switch (block.kind) {
          case "heading": {
            const Tag = `h${block.level}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
            return (
              <Tag key={idx} className={headingClasses[block.level]}>
                {parseInline(block.text)}
              </Tag>
            );
          }

          case "codeblock":
            return (
              <pre
                key={idx}
                className="overflow-x-auto rounded-lg bg-muted p-3 font-mono text-xs text-foreground ring-1 ring-foreground/10"
              >
                <code>{block.code}</code>
              </pre>
            );

          case "blockquote":
            return (
              <blockquote
                key={idx}
                className="border-l-2 border-border pl-3 italic text-muted-foreground"
              >
                {parseInline(block.text)}
              </blockquote>
            );

          case "ul":
            return (
              <ul key={idx} className="list-disc space-y-1 pl-5">
                {block.items.map((item, j) => (
                  <li key={j}>{parseInline(item)}</li>
                ))}
              </ul>
            );

          case "ol":
            return (
              <ol key={idx} className="list-decimal space-y-1 pl-5">
                {block.items.map((item, j) => (
                  <li key={j}>{parseInline(item)}</li>
                ))}
              </ol>
            );

          case "hr":
            return <hr key={idx} className="border-border" />;

          case "paragraph":
            return (
              <p key={idx} className="text-foreground/90">
                {parseInline(block.text)}
              </p>
            );
        }
      })}
    </div>
  );
}
