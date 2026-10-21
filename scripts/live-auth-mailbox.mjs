const BASE_URL = process.env.E2E_SERVICE_URL || "https://pixelsmith-e2e-tools.vercel.app";
const TOKEN = process.env.E2E_SERVICE_TOKEN;

function requireToken() {
  if (!TOKEN) throw new Error("E2E_SERVICE_TOKEN is required.");
}

async function call(path, payload) {
  requireToken();
  const response = await fetch(new URL(path, BASE_URL), {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await response.text();
  let data;
  try { data = JSON.parse(body); } catch { throw new Error("E2E email service returned a non-JSON response."); }
  if (!response.ok) throw new Error(`E2E email service request failed (${response.status}).`);
  return data;
}

function findEmail(value, seen = new Set()) {
  if (typeof value === "string") return /^[^@\\s]+@pixelsmith\\.space$/i.test(value) ? value : null;
  if (!value || typeof value !== "object" || seen.has(value)) return null;
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    if (/^(email|address|mailbox)$/i.test(key) && typeof child === "string" && /^[^@\\s]+@pixelsmith\\.space$/i.test(child)) return child;
  }
  for (const child of Object.values(value)) {
    const email = findEmail(child, seen);
    if (email) return email;
  }
  return null;
}

export async function createMailbox() {
  const data = await call("/api/e2e/create", { project: "idoc" });
  const email = findEmail(data);
  if (!email) throw new Error("Mailbox creation response did not contain a disposable @pixelsmith.space address.");
  return email;
}

export async function deleteMailbox(email) {
  if (!/^[^@\\s]+@pixelsmith\\.space$/i.test(email)) throw new Error("Refusing to delete a non-disposable mailbox.");
  await call("/api/e2e/delete", { email });
}

export async function messages(email, limit = 20) {
  if (!/^[^@\\s]+@pixelsmith\\.space$/i.test(email)) throw new Error("Refusing to read a non-disposable mailbox.");
  return call("/api/e2e/messages", { email, limit });
}

function collectMessages(value, result = [], seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return result;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const child of value) collectMessages(child, result, seen);
    return result;
  }
  if (typeof value.subject === "string" || typeof value.html === "string" || typeof value.text === "string" || typeof value.body === "string") result.push(value);
  for (const child of Object.values(value)) collectMessages(child, result, seen);
  return result;
}

export async function waitForOtp(email, kind, previousMessageCount = 0, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const data = await messages(email, 20);
    const found = collectMessages(data);
    for (const message of found.slice(previousMessageCount).reverse()) {
      const subject = String(message.subject || "");
      const content = [message.html, message.text, message.body].filter((item) => typeof item === "string").join("\\n").replace(/<[^>]*>/g, " ");
      if (kind && !new RegExp(kind, "i").test(subject + " " + content)) continue;
      const match = />\\s*(\\d{6})\\s*</.exec(String(message.html || "")) || /\\b(\\d{6})\\b/.exec(content);
      if (match) return match[1];
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  throw new Error(`Timed out waiting for the ${kind} email code.`);
}
