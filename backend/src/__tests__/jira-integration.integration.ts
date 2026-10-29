import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
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

  beforeAll(async () => {
    setupTestDb();
    prisma = getTestPrisma();
    ({ app } = await import("../index"));
    await prisma.systemConfig.upsert({
      where: { id: "default" },
      update: { authEnabled: false },
      create: { id: "default", authEnabled: false },
    });
    agent = request.agent(app);
    const res = await agent.get("/csrf-token");
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

  it("stores the token encrypted and never returns it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ accountId: "1" })));
    const put = await agent
      .put("/integrations/jira")
      .set(csrf.header, csrf.token)
      .send({
        siteUrl: "https://acme.atlassian.net",
        email: "me@acme.com",
        apiToken: "ATATT-plain-token",
      });
    expect(put.status).toBe(200);
    expect(JSON.stringify(put.body)).not.toContain("ATATT");

    const row = await prisma.jiraConnection.findFirstOrThrow();
    expect(row.apiTokenEncrypted).not.toContain("ATATT");

    const status = await agent.get("/integrations/jira");
    expect(status.body).toEqual({
      connected: true,
      siteUrl: "https://acme.atlassian.net",
      email: "me@acme.com",
    });
  });

  it("rejects non-Atlassian hosts without making a request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await agent
      .put("/integrations/jira")
      .set(csrf.header, csrf.token)
      .send({
        siteUrl: "https://internal.example.com",
        email: "me@acme.com",
        apiToken: "ATATT-plain-token",
      });
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps a Jira issue into card fields", async () => {
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
            status: { name: "In Review", statusCategory: { key: "indeterminate" } },
            assignee: { displayName: "Nop K" },
          },
        });
      }),
    );
    const res = await agent.get("/integrations/jira/issues/kern-12");
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
    const res = await agent.get("/integrations/jira/issues/..%2F..%2Fmyself");
    expect(res.status).toBe(400);
  });

  it("disconnects", async () => {
    const res = await agent
      .delete("/integrations/jira")
      .set(csrf.header, csrf.token);
    expect(res.status).toBe(200);
    expect(await prisma.jiraConnection.count()).toBe(0);
  });
});
