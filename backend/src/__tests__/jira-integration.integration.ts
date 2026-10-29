import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import request from "supertest";
import bcrypt from "bcrypt";
import jwt, { SignOptions } from "jsonwebtoken";
import { StringValue } from "ms";
import { config } from "../config";
import { PrismaClient } from "../generated/client";
import { getTestPrisma, setupTestDb } from "./testUtils";
import { decryptSecret, encryptSecret } from "../integrations/jiraCrypto";
import { normalizeSiteUrl } from "../integrations/jiraClient";

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("Jira integration", () => {
  let prisma: PrismaClient;
  let app: any;
  let agent: any;
  let csrf: { token: string; header: string };
  let adminAuth: string;
  let userAuth: string;
  const UA = "vitest-jira";

  const asAdmin = (r: any) =>
    r
      .set("User-Agent", UA)
      .set("Authorization", adminAuth)
      .set(csrf.header, csrf.token);
  const asUser = (r: any) =>
    r
      .set("User-Agent", UA)
      .set("Authorization", userAuth)
      .set(csrf.header, csrf.token);

  beforeAll(async () => {
    setupTestDb();
    prisma = getTestPrisma();
    ({ app } = await import("../index"));
    await prisma.systemConfig.upsert({
      where: { id: "default" },
      update: { authEnabled: true, registrationEnabled: false },
      create: { id: "default", authEnabled: true, registrationEnabled: false },
    });
    const passwordHash = await bcrypt.hash("password123", 10);
    const sign = (u: { id: string; email: string }) =>
      `Bearer ${jwt.sign(
        { userId: u.id, email: u.email, type: "access" },
        config.jwtSecret,
        {
          expiresIn: config.jwtAccessExpiresIn as StringValue,
        } as SignOptions,
      )}`;
    const admin = await prisma.user.create({
      data: {
        email: "jira-admin@test.local",
        passwordHash,
        name: "Admin",
        role: "ADMIN",
        isActive: true,
      },
    });
    const user = await prisma.user.create({
      data: {
        email: "jira-user@test.local",
        passwordHash,
        name: "User",
        role: "USER",
        isActive: true,
      },
    });
    adminAuth = sign(admin);
    userAuth = sign(user);
    agent = request.agent(app);
    const res = await agent.get("/csrf-token").set("User-Agent", UA);
    csrf = { token: res.body.token, header: res.body.header };
  });

  afterEach(() => vi.unstubAllGlobals());
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("round-trips encrypted secrets and rejects a wrong key", () => {
    const sealed = encryptSecret("super-secret-token", "key-a");
    expect(sealed).not.toContain("super-secret-token");
    expect(decryptSecret(sealed, "key-a")).toBe("super-secret-token");
    expect(decryptSecret(sealed, "key-b")).toBeNull();
  });

  it("only allows https Jira Cloud sites", () => {
    expect(normalizeSiteUrl("https://Acme.atlassian.net/jira")).toBe(
      "https://acme.atlassian.net",
    );
    for (const bad of [
      "http://acme.atlassian.net",
      "https://acme.atlassian.net.evil.com",
      "https://evil.com/acme.atlassian.net",
      "https://user:pw@acme.atlassian.net",
      "https://localhost:8000",
      "https://169.254.169.254",
    ]) {
      expect(normalizeSiteUrl(bad)).toBeNull();
    }
  });

  const body = {
    siteUrl: "https://acme.atlassian.net",
    email: "me@acme.com",
    apiToken: "ATATT-plain-token",
  };

  it("lets only an admin set the connection", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await asUser(agent.put("/integrations/jira")).send(body);
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await prisma.jiraConnection.count()).toBe(0);
  });

  it("stores the admin's token encrypted and never returns it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ accountId: "1" })),
    );
    const put = await asAdmin(agent.put("/integrations/jira")).send(body);
    expect(put.status).toBe(200);
    expect(JSON.stringify(put.body)).not.toContain("ATATT");

    const row = await prisma.jiraConnection.findFirstOrThrow();
    expect(row.apiTokenEncrypted).not.toContain("ATATT");

    const adminStatus = await asAdmin(agent.get("/integrations/jira"));
    expect(adminStatus.body).toEqual({
      connected: true,
      siteUrl: "https://acme.atlassian.net",
      email: "me@acme.com",
    });
    // Regular users learn it is connected, but not whose account it is.
    const userStatus = await asUser(agent.get("/integrations/jira"));
    expect(userStatus.body).toEqual({
      connected: true,
      siteUrl: "https://acme.atlassian.net",
    });
  });

  it("rejects non-Atlassian hosts without making a request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await asAdmin(agent.put("/integrations/jira")).send({
      ...body,
      siteUrl: "https://internal.example.com",
    });
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("lets any user fetch an issue with the shared token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: any) => {
        expect(url).toBe(
          "https://acme.atlassian.net/rest/api/3/issue/KERN-12?fields=summary,issuetype,status,assignee",
        );
        expect(init.redirect).toBe("manual");
        return jsonResponse({
          key: "KERN-12",
          fields: {
            summary: "Fix login",
            issuetype: { name: "Bug" },
            status: {
              name: "In Review",
              statusCategory: { key: "indeterminate" },
            },
            assignee: { displayName: "Nop K" },
          },
        });
      }),
    );
    const res = await asUser(agent.get("/integrations/jira/issues/kern-12"));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      key: "KERN-12",
      summary: "Fix login",
      issueType: "bug",
      status: "In Review",
      statusCategory: "inprogress",
      assignee: "Nop K",
      url: "https://acme.atlassian.net/browse/KERN-12",
    });
  });

  it("rejects malformed issue keys", async () => {
    const res = await asUser(
      agent.get("/integrations/jira/issues/..%2F..%2Fmyself"),
    );
    expect(res.status).toBe(400);
  });

  it("lets only an admin disconnect", async () => {
    const denied = await asUser(agent.delete("/integrations/jira"));
    expect(denied.status).toBe(403);
    expect(await prisma.jiraConnection.count()).toBe(1);
    const res = await asAdmin(agent.delete("/integrations/jira"));
    expect(res.status).toBe(200);
    expect(await prisma.jiraConnection.count()).toBe(0);
  });
});
