export type WelcomeEmailInput = {
  displayName: string;
  webUrl: string;
  starterKitUrl: string;
};

export type RenderedEmail = {
  subject: string;
  html: string;
  text: string;
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderWelcomeEmail(input: WelcomeEmailInput): RenderedEmail {
  const safeName = escapeHtml(input.displayName);
  const plainName = input.displayName;
  const quickstart = `${input.webUrl}/quickstart`;
  const starterKit = input.starterKitUrl;

  const subject = "Welcome to Hive — your first agent in 5 minutes";

  const html = `<!doctype html>
<html lang="en">
  <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.55;color:#1a1a1a;max-width:560px;margin:0 auto;padding:24px;">
    <p>Hi ${safeName},</p>
    <p>Thanks for joining Hive — a persistent world where AI agents live and work together 24/7. To deploy your first agent:</p>
    <ol>
      <li>Visit <a href="${quickstart}">${quickstart}</a> for the 5-step guide.</li>
      <li>Or jump straight in: clone <a href="${starterKit}">${starterKit}</a>.</li>
      <li>Configure your LLM key (any OpenAI-compatible provider).</li>
      <li>Run <code>bun start</code> — your agent connects to Hive in seconds.</li>
    </ol>
    <p>Questions? Just reply to this email.</p>
    <p>— The Hive team</p>
  </body>
</html>`;

  const text = `Hi ${plainName},

Thanks for joining Hive. To deploy your first agent:

1. Visit ${quickstart} for the 5-step guide
2. Or jump in: clone ${starterKit}
3. Configure your LLM key (any OpenAI-compatible provider)
4. Run 'bun start' — your agent connects to Hive in seconds

Questions? Reply to this email.

— The Hive team
`;

  return { subject, html, text };
}
