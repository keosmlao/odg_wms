import "server-only";
import nodemailer from "nodemailer";

/**
 * Email transport for scheduled reports. Two providers, picked from env:
 *
 *   Resend (HTTP API — no SMTP, no Google):  set WMS_RESEND_API_KEY
 *     WMS_MAIL_ENABLED=1
 *     WMS_RESEND_API_KEY=re_xxx
 *     WMS_MAIL_FROM="WMS <reports@odien.net>"   (must be a Resend-verified domain;
 *                                                 use onboarding@resend.dev to test)
 *
 *   SMTP (Gmail / Google Workspace):  set WMS_MAIL_USER + WMS_MAIL_PASSWORD
 *     WMS_MAIL_ENABLED=1
 *     WMS_MAIL_USER=it@odien.net
 *     WMS_MAIL_PASSWORD=<Google App Password>   (a normal password is rejected)
 *     WMS_MAIL_FROM / WMS_MAIL_HOST / WMS_MAIL_PORT   (optional)
 *
 * If WMS_RESEND_API_KEY is present it wins; otherwise SMTP is used.
 */
export type MailProvider = "resend" | "smtp";

export function mailProvider(): MailProvider {
  return process.env.WMS_RESEND_API_KEY ? "resend" : "smtp";
}

/** The From header. Resend needs an explicit one; SMTP defaults to the login user. */
function fromAddress(): string | undefined {
  return process.env.WMS_MAIL_FROM ?? process.env.WMS_MAIL_USER;
}

export function mailEnabled(): boolean {
  if (process.env.WMS_MAIL_ENABLED !== "1") return false;
  return mailProvider() === "resend"
    ? !!process.env.WMS_RESEND_API_KEY && !!fromAddress()
    : !!process.env.WMS_MAIL_USER && !!process.env.WMS_MAIL_PASSWORD;
}

/** Why mail can't be sent, in Lao, for the settings UI. Null = ready. */
export function mailConfigError(): string | null {
  if (mailProvider() === "resend") {
    if (!process.env.WMS_RESEND_API_KEY) return "ຍັງບໍ່ໄດ້ຕັ້ງ WMS_RESEND_API_KEY ໃນ .env.local";
    if (!fromAddress()) return "ຕ້ອງຕັ້ງ WMS_MAIL_FROM (ອີເມວຜູ້ສົ່ງ) ໃນ .env.local";
    if (process.env.WMS_MAIL_ENABLED !== "1") return "ການສົ່ງເມວຖືກປິດ — ຕັ້ງ WMS_MAIL_ENABLED=1 ໃນ .env.local";
    return null;
  }
  if (!process.env.WMS_MAIL_USER || !process.env.WMS_MAIL_PASSWORD) {
    return "ຍັງບໍ່ໄດ້ຕັ້ງ WMS_MAIL_USER / WMS_MAIL_PASSWORD ໃນ .env.local";
  }
  if (process.env.WMS_MAIL_ENABLED !== "1") {
    return "ການສົ່ງເມວຖືກປິດ — ຕັ້ງ WMS_MAIL_ENABLED=1 ໃນ .env.local";
  }
  return null;
}

// ── SMTP (nodemailer) ────────────────────────────────────────────────────────
let cached: nodemailer.Transporter | null = null;

function transport(): nodemailer.Transporter {
  if (cached) return cached;
  const port = Number(process.env.WMS_MAIL_PORT ?? 587);
  // Shared hosting often serves a TLS cert for the physical server (e.g.
  // thsv26.hostatom.com), not the vanity mail host (mail.odienmall.com), so a
  // plain connection fails cert-name validation. WMS_MAIL_TLS_SERVERNAME lets us
  // validate against the cert's real name while still connecting to WMS_MAIL_HOST
  // — encryption intact, no verification disabled. WMS_MAIL_TLS_INSECURE=1 is the
  // blunt fallback (skip verification entirely) if the cert name is unknown.
  const tls: Record<string, unknown> = {};
  if (process.env.WMS_MAIL_TLS_SERVERNAME) tls.servername = process.env.WMS_MAIL_TLS_SERVERNAME;
  if (process.env.WMS_MAIL_TLS_INSECURE === "1") tls.rejectUnauthorized = false;
  cached = nodemailer.createTransport({
    host: process.env.WMS_MAIL_HOST ?? "smtp.gmail.com",
    port,
    secure: port === 465, // 587 upgrades via STARTTLS instead
    auth: { user: process.env.WMS_MAIL_USER, pass: process.env.WMS_MAIL_PASSWORD },
    ...(Object.keys(tls).length ? { tls } : {}),
  });
  return cached;
}

// ── Resend (HTTP API) ────────────────────────────────────────────────────────
async function resendSend(opts: { to: string[]; subject: string; html: string }): Promise<void> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.WMS_RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: fromAddress(), to: opts.to, subject: opts.subject, html: opts.html }),
  });
  if (!res.ok) {
    // Resend returns { message, name } on error.
    let detail = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { message?: string; name?: string };
      if (body.message) detail = body.message;
    } catch { /* keep the status */ }
    throw new Error(`Resend: ${detail}`);
  }
}

/** Validate Resend auth without sending — hits the domains endpoint. */
async function resendVerify(): Promise<void> {
  const res = await fetch("https://api.resend.com/domains", {
    headers: { Authorization: `Bearer ${process.env.WMS_RESEND_API_KEY}` },
  });
  if (res.status === 401 || res.status === 403) throw new Error("Resend: API key ບໍ່ຖືກຕ້ອງ");
  if (!res.ok) throw new Error(`Resend: HTTP ${res.status}`);
}

// ── Public API ───────────────────────────────────────────────────────────────
export async function sendMail(opts: { to: string[]; subject: string; html: string }): Promise<void> {
  if (!mailEnabled()) throw new Error(mailConfigError() ?? "ສົ່ງເມວບໍ່ໄດ້");
  if (opts.to.length === 0) throw new Error("ບໍ່ມີຜູ້ຮັບ");
  if (mailProvider() === "resend") {
    await resendSend(opts);
    return;
  }
  await transport().sendMail({
    from: fromAddress(),
    to: opts.to.join(", "),
    subject: opts.subject,
    html: opts.html,
  });
}

/** Check credentials without sending — used by the settings page. */
export async function verifyMail(): Promise<void> {
  if (!mailEnabled()) throw new Error(mailConfigError() ?? "ສົ່ງເມວບໍ່ໄດ້");
  if (mailProvider() === "resend") {
    await resendVerify();
    return;
  }
  await transport().verify();
}
