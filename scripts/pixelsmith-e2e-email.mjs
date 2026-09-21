#!/usr/bin/env node

const BASE_URL = process.env.E2E_SERVICE_URL || "https://pixelsmith-e2e-tools.vercel.app";
const TOKEN = process.env.E2E_SERVICE_TOKEN;

if (!TOKEN) {
  console.error("E2E_SERVICE_TOKEN is not configured.");
  process.exit(2);
}

async function call(path, payload) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { error: text }; }

  if (!response.ok) {
    console.error(JSON.stringify(data, null, 2));
    process.exit(1);
  }

  console.log(JSON.stringify(data, null, 2));
}

const [command, ...args] = process.argv.slice(2);

switch (command) {
  case "create": {
    const [project = "idoc"] = args;
    await call("/api/e2e/create", { project });
    break;
  }
  case "messages": {
    const [email, limit = "10"] = args;
    if (!email) throw new Error("Usage: messages <email> [limit]");
    await call("/api/e2e/messages", { email, limit: Number(limit) });
    break;
  }
  case "send": {
    const [email, subject, body] = args;
    if (!email || !subject || !body) throw new Error("Usage: send <email> <subject> <body>");
    await call("/api/e2e/send", { email, subject, body });
    break;
  }
  case "delete": {
    const [email] = args;
    if (!email) throw new Error("Usage: delete <email>");
    await call("/api/e2e/delete", { email });
    break;
  }
  default:
    console.error("Usage: pixelsmith-e2e-email.mjs <create|messages|send|delete> ...");
    process.exit(2);
}
