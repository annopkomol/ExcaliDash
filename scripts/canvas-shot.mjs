#!/usr/bin/env node
// Fastest path to the editor canvas for visual checks (built for cloud sessions).
//
//   node scripts/canvas-shot.mjs [scene.excalidraw] [--out shot.png] [--width 1280] [--height 720]
//
// Starts the no-auth dev stack if it is not already running (scripts/dev-local.mjs,
// ~20s cold, instant when warm), seeds a drawing from a standard .excalidraw file
// (or a small built-in scene) through the public API, opens /editor/<id> in headless
// Chromium and writes a screenshot. Prints the editor URL and the PNG path; read
// the PNG to inspect the rendered canvas. Leaves the stack running for re-runs.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const scenePath = args.find(
  (a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"),
);
const out = path.resolve(
  flag("out", path.join(root, ".dev-local", "canvas.png")),
);
const viewport = {
  width: Number(flag("width", 1280)),
  height: Number(flag("height", 720)),
};
const backend = `http://localhost:${process.env.PORT || 8000}`;
const frontend = "http://localhost:6767";

const up = async (url) => {
  try {
    return (await fetch(url)).ok;
  } catch {
    return false;
  }
};

const ensureDeps = async () => {
  const missing = ["backend", "frontend", "e2e"].filter(
    (p) => !fs.existsSync(path.join(root, p, "node_modules")),
  );
  if (!missing.length) return;
  console.log(
    `[canvas-shot] installing deps in parallel: ${missing.join(", ")}`,
  );
  await Promise.all(
    missing.map(
      (p) =>
        new Promise((resolve, reject) => {
          const child = spawn(
            "npm",
            [
              "--prefix",
              p,
              "ci",
              "--no-audit",
              "--no-fund",
              "--loglevel=error",
            ],
            {
              cwd: root,
              stdio: "inherit",
              env: { ...process.env, PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1" },
            },
          );
          child.on("exit", (code) =>
            code === 0 ? resolve() : reject(new Error(`npm ci ${p} failed`)),
          );
        }),
    ),
  );
};

const ensureStack = async () => {
  if ((await up(`${backend}/health`)) && (await up(frontend))) return;
  fs.mkdirSync(path.join(root, ".dev-local"), { recursive: true });
  const log = fs.openSync(path.join(root, ".dev-local", "stack.log"), "a");
  spawn("node", [path.join(root, "scripts", "dev-local.mjs")], {
    cwd: root,
    detached: true,
    stdio: ["ignore", log, log],
  }).unref();
  console.log("[canvas-shot] starting dev stack (log: .dev-local/stack.log)");
  for (let i = 0; i < 120; i++) {
    if ((await up(`${backend}/health`)) && (await up(frontend))) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(
    "dev stack did not come up in 120s; see .dev-local/stack.log",
  );
};

const sampleScene = () => {
  const base = {
    angle: 0,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    version: 1,
    versionNonce: 1,
    isDeleted: false,
    boundElements: null,
    updated: 1,
    link: null,
    locked: false,
  };
  return {
    elements: [
      {
        ...base,
        id: "r1",
        type: "rectangle",
        x: 100,
        y: 100,
        width: 200,
        height: 120,
        backgroundColor: "#a5d8ff",
        index: "a0",
        seed: 11,
        roundness: { type: 3 },
      },
      {
        ...base,
        id: "e1",
        type: "ellipse",
        x: 400,
        y: 100,
        width: 160,
        height: 120,
        backgroundColor: "#ffc9c9",
        index: "a1",
        seed: 22,
      },
      {
        ...base,
        id: "t1",
        type: "text",
        x: 120,
        y: 140,
        width: 160,
        height: 25,
        index: "a2",
        seed: 33,
        text: "ExcaliDash",
        originalText: "ExcaliDash",
        fontSize: 20,
        fontFamily: 5,
        textAlign: "center",
        verticalAlign: "middle",
        containerId: null,
        autoResize: true,
        lineHeight: 1.25,
      },
    ],
    appState: { viewBackgroundColor: "#ffffff" },
    files: {},
  };
};

const loadScene = () => {
  if (!scenePath) return sampleScene();
  const data = JSON.parse(fs.readFileSync(scenePath, "utf8"));
  return {
    elements: data.elements ?? [],
    appState: { viewBackgroundColor: "#ffffff", ...(data.appState ?? {}) },
    files: data.files ?? {},
  };
};

const seedDrawing = async (scene) => {
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
      name: `Canvas shot ${new Date().toISOString()}`,
      ...scene,
      preview: null,
      collectionId: null,
    }),
  });
  if (!res.ok)
    throw new Error(`seeding failed: ${res.status} ${await res.text()}`);
  return (await res.json()).id;
};

await ensureDeps();
await ensureStack();
const id = await seedDrawing(loadScene());

const { chromium } = createRequire(path.join(root, "e2e", "package.json"))(
  "@playwright/test",
);
// Cloud images ship Chromium at /opt/pw-browsers; its build number rarely matches
// the pinned Playwright, so launch the binary directly when present.
const preinstalled = [
  "/opt/pw-browsers/chromium/chrome-linux64/chrome",
  "/opt/pw-browsers/chromium",
].find((p) => fs.existsSync(p) && fs.statSync(p).isFile());
const browser = await chromium.launch(
  preinstalled ? { executablePath: preinstalled, args: ["--no-sandbox"] } : {},
);
try {
  const page = await browser.newPage({ viewport });
  const url = `${frontend}/editor/${id}`;
  await page.goto(url);
  await page.locator("canvas.excalidraw__canvas.interactive").waitFor();
  await page.waitForFunction(() => !!window.__EXCALIDASH_EXCALIDRAW_API__);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500); // let the static canvas finish its first paint
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await page.screenshot({ path: out });
  console.log(`[canvas-shot] editor: ${url}`);
  console.log(`[canvas-shot] screenshot: ${out}`);
} finally {
  await browser.close();
}
