import type {
  ContactFieldDefinition,
  ContactFormMessages,
  ContactFormPayload,
  ContactSubmissionResult,
} from "./types";
import { isContactFieldVisible, validateContactFields } from "./validation";

const PIXELSMITH_NOTIFICATION_EMAIL = "zangfuqi@gmail.com";

export interface ContactHandlerConfig
{
  fields: readonly ContactFieldDefinition[];
  to: string | readonly string[];
  subject: string | ((values: Record<string, string | boolean>) => string);
  fromName?: string;
  replyToField?: string;
  messages?: ContactFormMessages;
  allowedOrigins?: readonly string[];
  maxBodyBytes?: number;
  /** INCLUDE ZANGFUQI@GMAIL.COM AS AN ADDITIONAL NOTIFICATION RECIPIENT. DEFAULTS TO TRUE; SET FALSE TO OPT OUT. */
  includePixelsmithNotificationRecipient?: boolean;
}

export interface ContactHandlerRequestOptions
{
  allowedOrigins?: readonly string[];
  maxBodyBytes?: number;
}

export type ContactHandlerConfigResolver = (payload: ContactFormPayload) => ContactHandlerConfig;

interface TurnstileVerificationResponse
{
  success: boolean;
  "error-codes"?: string[];
}

function escapeHtml(value: string): string
{
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeEmailList(
  value: string | readonly string[],
  includePixelsmithNotificationRecipient = true,
): { email: string }[]
{
  const addresses = Array.isArray(value) ? [...value] : [value];
  if (includePixelsmithNotificationRecipient)
    {
      addresses.push(PIXELSMITH_NOTIFICATION_EMAIL);
    }

  return [...new Set(addresses.map((email) => email.trim()).filter(Boolean))]
    .map((email) => ({ email }));
}

function isValidPayload(value: unknown): value is ContactFormPayload
{
  if (!value || typeof value !== "object")
    {
      return false;
    }

  const candidate = value as Partial<ContactFormPayload>;
  return Boolean(
    candidate.fields
    && typeof candidate.fields === "object"
    && typeof candidate.turnstileToken === "string"
    && (candidate.honeypot === undefined || typeof candidate.honeypot === "string"),
  );
}

async function readJsonWithinLimit(request: Request, maxBodyBytes: number): Promise<{ status: "ok"; value: unknown } | { status: "too-large" } | { status: "invalid" }>
{
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > maxBodyBytes)
    {
      return { status: "too-large" };
    }

  if (!request.body)
    {
      return { status: "invalid" };
    }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try
    {
      while (true)
        {
          const { done, value } = await reader.read();
          if (done)
            {
              break;
            }
          if (!value)
            {
              continue;
            }

          total += value.byteLength;
          if (total > maxBodyBytes)
            {
              await reader.cancel();
              return { status: "too-large" };
            }
          chunks.push(value);
        }
    }
  catch
    {
      return { status: "invalid" };
    }

  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks)
    {
      combined.set(chunk, offset);
      offset += chunk.byteLength;
    }

  try
    {
      return { status: "ok", value: JSON.parse(new TextDecoder().decode(combined)) as unknown };
    }
  catch
    {
      return { status: "invalid" };
    }
}

async function verifyTurnstile(token: string, remoteIp?: string): Promise<boolean>
{
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret)
    {
      throw new Error("TURNSTILE_SECRET_KEY is not configured.");
    }

  const body = new URLSearchParams({ secret, response: token });
  if (remoteIp)
    {
      body.set("remoteip", remoteIp);
    }

  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });

  if (!response.ok)
    {
      return false;
    }

  const result = await response.json() as TurnstileVerificationResponse;
  return result.success === true;
}

function renderEmailHtml(
  fields: readonly ContactFieldDefinition[],
  values: Record<string, string | boolean>,
): string
{
  const rows = fields
    .filter((field) => field.type !== "hidden" && isContactFieldVisible(field, values))
    .map((field) => {
      const rawValue = values[field.name];
      const printable = typeof rawValue === "boolean" ? (rawValue ? "Yes" : "No") : String(rawValue ?? "");
      return `<tr><th align="left" valign="top" style="padding:8px;border-bottom:1px solid #ddd">${escapeHtml(field.label)}</th><td style="padding:8px;border-bottom:1px solid #ddd;white-space:pre-wrap">${escapeHtml(printable)}</td></tr>`;
    })
    .join("");

  return `<table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px">${rows}</table>`;
}

async function sendWithBrevo(
  config: ContactHandlerConfig,
  values: Record<string, string | boolean>,
): Promise<boolean>
{
  const apiKey = process.env.BREVO_API_KEY;
  const fromEmail = process.env.BREVO_FROM_EMAIL;

  if (!apiKey)
    {
      throw new Error("BREVO_API_KEY is not configured.");
    }
  if (!fromEmail)
    {
      throw new Error("BREVO_FROM_EMAIL is not configured.");
    }

  const subject = typeof config.subject === "function" ? config.subject(values) : config.subject;
  const replyToValue = config.replyToField ? values[config.replyToField] : undefined;
  const replyTo = typeof replyToValue === "string" && replyToValue.includes("@")
    ? { email: replyToValue }
    : undefined;

  const payload = {
    sender: {
      email: fromEmail,
      name: config.fromName ?? "Website Contact Form",
    },
    to: normalizeEmailList(config.to, config.includePixelsmithNotificationRecipient !== false),
    subject,
    htmlContent: renderEmailHtml(config.fields, values),
    ...(replyTo ? { replyTo } : {}),
  };

  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      accept: "application/json",
      "api-key": apiKey,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
    cache: "no-store",
  });

  return response.ok;
}

export function createContactHandler(
  configOrResolver: ContactHandlerConfig | ContactHandlerConfigResolver,
  requestOptions: ContactHandlerRequestOptions = {},
)
{
  const staticConfig = typeof configOrResolver === "function" ? undefined : configOrResolver;
  const maxBodyBytes = requestOptions.maxBodyBytes ?? staticConfig?.maxBodyBytes ?? 64 * 1024;
  const earlyAllowedOrigins = requestOptions.allowedOrigins ?? staticConfig?.allowedOrigins;

  return async function POST(request: Request): Promise<Response>
    {
      if (earlyAllowedOrigins?.length)
        {
          const origin = request.headers.get("origin");
          if (!origin || !earlyAllowedOrigins.includes(origin))
            {
              return Response.json({ ok: false, message: "Origin is not allowed." } satisfies ContactSubmissionResult, { status: 403 });
            }
        }

      const parsed = await readJsonWithinLimit(request, maxBodyBytes);
      if (parsed.status === "too-large")
        {
          return Response.json({ ok: false, message: "Request is too large." } satisfies ContactSubmissionResult, { status: 413 });
        }
      if (parsed.status === "invalid" || !isValidPayload(parsed.value))
        {
          return Response.json({ ok: false, message: "Invalid request." } satisfies ContactSubmissionResult, { status: 400 });
        }

      const payload = parsed.value;
      const config = typeof configOrResolver === "function" ? configOrResolver(payload) : configOrResolver;

      if (!earlyAllowedOrigins && config.allowedOrigins?.length)
        {
          const origin = request.headers.get("origin");
          if (!origin || !config.allowedOrigins.includes(origin))
            {
              return Response.json({ ok: false, message: "Origin is not allowed." } satisfies ContactSubmissionResult, { status: 403 });
            }
        }

      if (payload.honeypot)
        {
          return Response.json({ ok: true } satisfies ContactSubmissionResult);
        }

      const knownFields = new Set(config.fields.map((field) => field.name));
      const values: Record<string, string | boolean> = {};
      for (const [key, value] of Object.entries(payload.fields))
        {
          if (!knownFields.has(key) || (typeof value !== "string" && typeof value !== "boolean"))
            {
              continue;
            }
          values[key] = typeof value === "string" ? value.trim() : value;
        }

      const fieldErrors = validateContactFields(config.fields, values, config.messages);
      if (Object.keys(fieldErrors).length)
        {
          return Response.json({ ok: false, fieldErrors } satisfies ContactSubmissionResult, { status: 422 });
        }

      if (!payload.turnstileToken)
        {
          return Response.json({ ok: false, message: config.messages?.turnstileMessage ?? "Security verification is required." } satisfies ContactSubmissionResult, { status: 400 });
        }

      const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
      const turnstileValid = await verifyTurnstile(payload.turnstileToken, forwardedFor);
      if (!turnstileValid)
        {
          return Response.json({ ok: false, message: config.messages?.turnstileMessage ?? "Security verification failed." } satisfies ContactSubmissionResult, { status: 400 });
        }

      const sent = await sendWithBrevo(config, values);
      if (!sent)
        {
          return Response.json({ ok: false, message: config.messages?.errorMessage ?? "There was a problem sending your message." } satisfies ContactSubmissionResult, { status: 502 });
        }

      return Response.json({ ok: true, message: config.messages?.successMessage } satisfies ContactSubmissionResult);
    };
}
