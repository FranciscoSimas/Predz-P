import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Resend inbound webhook → forward suporte@ to personal inbox.
 * No Resend SDK: uses REST + fetch so nothing new is installed locally.
 *
 * Vercel env:
 *   RESEND_API_KEY          — Full access key
 *   RESEND_WEBHOOK_SECRET   — whsec_… from Resend webhook
 *   SUPPORT_FORWARD_TO      — e.g. franciscosimas4@gmail.com
 */

const FORWARD_ADDRESSES = new Set(["suporte@predz.app"]);

type ReceivedEvent = {
  type: string;
  data: {
    email_id: string;
    from: string;
    to: string[];
    subject?: string | null;
    received_for?: string[];
  };
};

type ReceivedEmail = {
  html?: string | null;
  text?: string | null;
  subject?: string | null;
  from?: string;
};

type AttachmentMeta = {
  id: string;
  filename?: string | null;
  content_type?: string | null;
  content_disposition?: string | null;
  content_id?: string | null;
  download_url: string;
};

export const Route = createFileRoute("/api/webhooks/resend")({
  server: {
    handlers: {
      GET: async () =>
        Response.json({
          ok: true,
          service: "resend-webhook",
          forwards: [...FORWARD_ADDRESSES],
        }),
      POST: async ({ request }) => {
        const apiKey = process.env.RESEND_API_KEY;
        const webhookSecret = process.env.RESEND_WEBHOOK_SECRET;
        const forwardTo = process.env.SUPPORT_FORWARD_TO?.trim();

        if (!apiKey || !webhookSecret || !forwardTo) {
          console.error(
            "[resend-webhook] Missing RESEND_API_KEY, RESEND_WEBHOOK_SECRET, or SUPPORT_FORWARD_TO",
          );
          return new Response("Server misconfigured", { status: 500 });
        }

        const payload = await request.text();
        const id = request.headers.get("svix-id");
        const timestamp = request.headers.get("svix-timestamp");
        const signature = request.headers.get("svix-signature");

        if (!id || !timestamp || !signature) {
          return new Response("Missing webhook headers", { status: 400 });
        }

        let event: ReceivedEvent;
        try {
          event = verifySvixWebhook(payload, { id, timestamp, signature }, webhookSecret) as ReceivedEvent;
        } catch (err) {
          console.error("[resend-webhook] Invalid signature", err);
          return new Response("Invalid signature", { status: 401 });
        }

        if (event.type !== "email.received") {
          return Response.json({ ok: true, ignored: event.type });
        }

        const recipients = [
          ...(event.data.to ?? []),
          ...(event.data.received_for ?? []),
        ].map(normalizeEmail);

        const matched = recipients.find((addr) => FORWARD_ADDRESSES.has(addr));
        if (!matched) {
          return Response.json({ ok: true, skipped: "unmatched recipient", recipients });
        }

        const emailId = event.data.email_id;
        const email = await resendGet<ReceivedEmail>(
          apiKey,
          `/emails/receiving/${emailId}`,
        );

        const attachmentsList = await resendGet<{ data: AttachmentMeta[] }>(
          apiKey,
          `/emails/receiving/${emailId}/attachments`,
        );

        const attachments: Array<{
          filename?: string;
          content: string;
          content_type?: string;
          content_id?: string;
        }> = [];

        for (const meta of attachmentsList.data ?? []) {
          if (!meta.download_url) continue;
          const fileRes = await fetch(meta.download_url);
          if (!fileRes.ok) {
            console.error(`[resend-webhook] attachment download failed: ${meta.id}`);
            continue;
          }
          const bytes = Buffer.from(await fileRes.arrayBuffer());
          attachments.push({
            filename: meta.filename ?? undefined,
            content: bytes.toString("base64"),
            content_type: meta.content_type ?? undefined,
            content_id: meta.content_id?.replace(/^<|>$/g, "") || undefined,
          });
        }

        const subject =
          email.subject || event.data.subject || "(sem assunto)";
        const replyTo = extractEmailAddress(event.data.from);

        const sendRes = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "Idempotency-Key": `inbound-forward:${emailId}:${forwardTo}`,
          },
          body: JSON.stringify({
            from: `Predz <${matched}>`,
            to: [forwardTo],
            reply_to: replyTo ? [replyTo] : undefined,
            subject: `[${matched.split("@")[0]}] ${subject}`,
            html: email.html || undefined,
            text: email.text || undefined,
            attachments: attachments.length > 0 ? attachments : undefined,
          }),
        });

        if (!sendRes.ok) {
          const errBody = await sendRes.text();
          console.error("[resend-webhook] forward send failed", sendRes.status, errBody);
          return new Response("Forward failed", { status: 502 });
        }

        const sendData = await sendRes.json();
        return Response.json({ ok: true, forwarded_to: forwardTo, send: sendData });
      },
    },
  },
});

function normalizeEmail(value: string): string {
  const match = value.match(/<([^>]+)>/);
  return (match ? match[1] : value).trim().toLowerCase();
}

function extractEmailAddress(from: string): string | null {
  if (!from) return null;
  return normalizeEmail(from);
}

function verifySvixWebhook(
  payload: string,
  headers: { id: string; timestamp: string; signature: string },
  secret: string,
): unknown {
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const signedContent = `${headers.id}.${headers.timestamp}.${payload}`;
  const expected = createHmac("sha256", key).update(signedContent).digest("base64");
  const expectedBuf = Buffer.from(expected);

  const candidates = headers.signature
    .split(" ")
    .map((part) => {
      const [version, sig] = part.split(",");
      return version === "v1" && sig ? sig : null;
    })
    .filter((s): s is string => Boolean(s));

  const valid = candidates.some((sig) => {
    const buf = Buffer.from(sig);
    return buf.length === expectedBuf.length && timingSafeEqual(buf, expectedBuf);
  });

  if (!valid) {
    throw new Error("svix signature mismatch");
  }

  const ts = Number(headers.timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 60 * 5) {
    throw new Error("svix timestamp outside tolerance");
  }

  return JSON.parse(payload) as unknown;
}

async function resendGet<T>(apiKey: string, path: string): Promise<T> {
  const res = await fetch(`https://api.resend.com${path}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend GET ${path} failed: ${res.status} ${body}`);
  }
  return (await res.json()) as T;
}
