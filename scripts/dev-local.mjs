#!/usr/bin/env node
// One-command local stack for quick visual testing: backend on a throwaway
// SQLite database with AUTH_MODE=disabled (no sign-in or admin setup) plus the
// Vite frontend. No Docker needed. Data lives in .dev-local/; pass --fresh to
// wipe it first.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(root, ".dev-local");

if (process.argv.includes("--fresh")) {
  fs.rmSync(dataDir, { recursive: true, force: true });
}
fs.mkdirSync(path.join(dataDir, "backups"), { recursive: true });

for (const pkg of ["backend", "frontend"]) {
  if (!fs.existsSync(path.join(root, pkg, "node_modules"))) {
    console.error(
      `[dev-local] Missing ${pkg}/node_modules. Run: npm --prefix ${pkg} ci`,
    );
    process.exit(1);
  }
}

// Set by dev-canvas.mjs --tailscale: serve the frontend on the tailnet address
// only (auth is disabled, so never bind all interfaces) and allow its origins.
const tailscaleHosts = [
  process.env.DEV_TAILSCALE_IP,
  process.env.DEV_TAILSCALE_NAME,
].filter(Boolean);
const tailscaleOrigins = tailscaleHosts.map((h) => `http://${h}:6767`);

const backendPort = process.env.PORT || "8000";
const env = {
  ...process.env,
  NODE_ENV: "development",
  PORT: backendPort,
  BACKEND_HOST: "127.0.0.1",
  AUTH_MODE: "disabled",
  // Fixed so open tabs keep working when node --watch restarts the backend
  // (a random per-process secret invalidates their CSRF tokens -> save fails).
  CSRF_SECRET: process.env.CSRF_SECRET || "dev-local-csrf-secret",
  DATABASE_URL: `file:${path.join(dataDir, "dev.db")}`,
  BACKUP_DIR: path.join(dataDir, "backups"),
  FRONTEND_URL: ["http://localhost:6767", ...tailscaleOrigins].join(","),
  VITE_API_URL: "/api",
  ...(process.env.DEV_TAILSCALE_IP
    ? { VITE_DEV_HOST: process.env.DEV_TAILSCALE_IP }
    : {}),
  VITE_DEV_BACKEND_URL: `http://localhost:${backendPort}`,
};

// Ambient AWS_* credentials (common in cloud sessions) make the backend refuse
// to start with a "half-configured" S3 setup; local dev uses database storage.
for (const key of Object.keys(env)) {
  if (key.startsWith("AWS_")) delete env[key];
}

const children = [];
const run = (name, cwd) => {
  const child = spawn("npm", ["run", "dev"], {
    cwd: path.join(root, cwd),
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const prefix = (stream, out) => {
    let buffered = "";
    stream.on("data", (chunk) => {
      buffered += chunk;
      const lines = buffered.split("\n");
      buffered = lines.pop();
      for (const line of lines) out.write(`[${name}] ${line}\n`);
    });
  };
  prefix(child.stdout, process.stdout);
  prefix(child.stderr, process.stderr);
  child.on("exit", (code) => {
    console.log(`[dev-local] ${name} exited (${code}); stopping`);
    shutdown(code ?? 1);
  });
  children.push(child);
};

let stopping = false;
const shutdown = (code = 0) => {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  process.exit(code);
};
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

run("backend", "backend");
run("frontend", "frontend");
console.log(
  "[dev-local] Open http://localhost:6767 (auth disabled, data in .dev-local/)",
);
