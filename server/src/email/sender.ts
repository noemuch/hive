import type { Pool } from "pg";
import { renderWelcomeEmail } from "./templates/welcome";

const DEFAULT_RESEND_URL = "https://api.resend.com/emails";
const DEFAULT_FROM = "Hive <hello@hive.chat>";
const DEFAULT_WEB_URL = "https://hive.chat";
const DEFAULT_STARTER_KIT_URL = "https://github.com/noemuch/hive-starter-kit";

type MinimalPool = Pick<Pool, "query">;

export type SendWelcomeInput = {
  pool: MinimalPool;
  builderId: string;
  to: string;
  displayName: string;
};

export type SendWelcomeResult =
  | { status: "sent"; providerId: string | null }
  | { status: "skipped"; reason: "no_api_key" | "already_sent" }
  | { status: "error"; message: string };

export type SendWelcomeFn = (input: SendWelcomeInput) => Promise<SendWelcomeResult>;

export async function sendWelcomeEmail(input: SendWelcomeInput): Promise<SendWelcomeResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log("[email] RESEND_API_KEY not set — skipping welcome email for", input.to);
    return { status: "skipped", reason: "no_api_key" };
  }

  const { rows } = await input.pool.query(
    `SELECT welcome_email_sent_at FROM builders WHERE id = $1`,
    [input.builderId]
  );
  if (rows[0]?.welcome_email_sent_at) {
    return { status: "skipped", reason: "already_sent" };
  }

  const from = process.env.EMAIL_FROM || DEFAULT_FROM;
  const webUrl = process.env.NEXT_PUBLIC_WEB_URL || DEFAULT_WEB_URL;
  const starterKitUrl = process.env.HIVE_STARTER_KIT_URL || DEFAULT_STARTER_KIT_URL;

  const rendered = renderWelcomeEmail({
    displayName: input.displayName,
    webUrl,
    starterKitUrl,
  });

  try {
    const resendUrl = process.env.RESEND_API_URL || DEFAULT_RESEND_URL;
    const res = await fetch(resendUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [input.to],
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[email] Resend returned ${res.status} for ${input.to}: ${body.slice(0, 200)}`);
      return { status: "error", message: `resend_http_${res.status}` };
    }

    const payload = (await res.json().catch(() => ({}))) as { id?: string };
    await input.pool.query(
      `UPDATE builders SET welcome_email_sent_at = now() WHERE id = $1`,
      [input.builderId]
    );
    return { status: "sent", providerId: payload.id ?? null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[email] Failed to send welcome email to ${input.to}: ${message}`);
    return { status: "error", message };
  }
}
