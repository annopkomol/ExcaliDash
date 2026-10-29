#!/usr/bin/env node
// `make canvas`: no-auth dev stack + a fresh blank drawing, printed as an
// /editor/<id> URL (opened in the browser unless --no-open), while a loop keeps
// fast-forwarding the checkout to origin/main. The backend (node --watch) and
// Vite pick up pulled changes on their own; lockfile changes trigger `npm ci`.
//
//   node scripts/dev-canvas.mjs [--tailscale] [--no-open] [--interval 30] [--branch main] [--no-pull]
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const branch = flag("branch", "main");
const intervalMs = Number(flag("interval", 30)) * 1000;
const backend = `http://localhost:${process.env.PORT || 8000}`;
let host = "localhost";
let publicHost = "localhost";
if (args.includes("--tailscale")) {
  // Bind to the tailnet IP only; the MagicDNS name is what the phone opens.
  try {
    host = execFileSync("tailscale", ["ip", "-4"], { encoding: "utf8" })
      .trim()
      .split("\n")[0];
    const status = JSON.parse(
      execFileSync("tailscale", ["status", "--json"], { encoding: "utf8" }),
    );
    const name = String(status.Self?.DNSName ?? "").replace(/\.$/, "");
    publicHost = name || host;
    process.env.DEV_TAILSCALE_IP = host;
    process.env.DEV_TAILSCALE_NAME = name;
  } catch (e) {
    console.error(`[canvas] --tailscale needs a running tailscale: ${e.message}`);
    process.exit(1);
  }
}
const frontend = `http://${host}:6767`;

const git = (...a) =>
  execFileSync("git", a, { cwd: root, encoding: "utf8" }).trim();
const npmCi = (pkg) =>
  new Promise((resolve) => {
    console.log(`[canvas] lockfile changed, npm ci in ${pkg}`);
    spawn("npm", ["--prefix", pkg, "ci", "--no-audit", "--no-fund", "--loglevel=error"], {
      cwd: root,
      stdio: "inherit",
    }).on("exit", resolve);
  });
const prismaGenerate = () =>
  new Promise((resolve) => {
    console.log("[canvas] prisma generate");
    spawn("npx", ["prisma", "generate"], {
      cwd: path.join(root, "backend"),
      stdio: "ignore",
    }).on("exit", resolve);
  });
const up = async (url) => {
  try {
    return (await fetch(url)).ok;
  } catch {
    return false;
  }
};

for (const pkg of ["backend", "frontend"]) {
  if (!fs.existsSync(path.join(root, pkg, "node_modules"))) await npmCi(pkg);
}

await prismaGenerate(); // a pulled schema change would otherwise crash ts-node

const stack = spawn("node", [path.join(root, "scripts", "dev-local.mjs")], {
  cwd: root,
  stdio: "inherit",
});
const stop = (code = 0) => {
  stack.kill("SIGTERM");
  process.exit(code);
};
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
stack.on("exit", (code) => process.exit(code ?? 1));

for (let i = 0; ; i++) {
  if ((await up(`${backend}/health`)) && (await up(frontend))) break;
  if (i > 120) {
    console.error("[canvas] stack did not come up in 120s");
    stop(1);
  }
  await new Promise((r) => setTimeout(r, 1000));
}

// The CSRF token is bound to a cookie, so replay the cookie with the POST.
const tokenRes = await fetch(`${backend}/csrf-token`);
const csrf = await tokenRes.json();
const cookie = tokenRes.headers
  .getSetCookie()
  .map((c) => c.split(";")[0])
  .join("; ");
const res = await fetch(`${backend}/drawings`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Cookie: cookie,
    [csrf.header || "x-csrf-token"]: csrf.token,
  },
  body: JSON.stringify({
    name: `Canvas test ${new Date().toLocaleString()}`,
    elements: [],
    appState: { viewBackgroundColor: "#ffffff" },
    files: {},
    preview: null,
    collectionId: null,
  }),
});
if (!res.ok) {
  console.error(`[canvas] seeding failed: ${res.status} ${await res.text()}`);
  stop(1);
}
const url = `http://${publicHost}:6767/editor/${(await res.json()).id}`;
console.log(`\n[canvas] ➜ ${url}\n`);
if (!args.includes("--no-open")) {
  const opener = process.platform === "darwin" ? "open" : "xdg-open";
  spawn(opener, [url], { stdio: "ignore", detached: true })
    .on("error", () => {})
    .unref();
}

if (args.includes("--no-pull")) {
  await new Promise(() => {});
}
console.log(`[canvas] auto-pulling origin/${branch} every ${intervalMs / 1000}s`);
let pulling = false;
setInterval(async () => {
  if (pulling) return;
  pulling = true;
  try {
    if (git("rev-parse", "--abbrev-ref", "HEAD") !== branch) return;
    if (git("status", "--porcelain", "--untracked-files=no")) return; // keep local edits safe
    git("fetch", "origin", branch);
    const before = git("rev-parse", "HEAD");
    if (before === git("rev-parse", `origin/${branch}`)) return;
    git("merge", "--ff-only", `origin/${branch}`);
    const changed = git("diff", "--name-only", before, "HEAD").split("\n");
    console.log(`[canvas] pulled ${git("log", "--oneline", "-1")}`);
    for (const pkg of ["backend", "frontend"]) {
      if (changed.includes(`${pkg}/package-lock.json`)) await npmCi(pkg);
    }
    if (changed.some((f) => f.startsWith("backend/prisma/") || f === "backend/package-lock.json")) {
      await prismaGenerate();
    }
  } catch (e) {
    console.error(`[canvas] pull skipped: ${e.message.split("\n")[0]}`);
  } finally {
    pulling = false;
  }
}, intervalMs);
