/**
 * Jira integration routes (one site-wide connection, managed by an admin):
 *   GET    /integrations/jira              – status for any user (email only for admins; never the token)
 *   PUT    /integrations/jira              – admin: verify + store site URL, email, API token (encrypted)
 *   DELETE /integrations/jira              – admin: remove stored credentials
 *   GET    /integrations/jira/issues/:key  – any user: fetch issue fields for a card
 */
import express from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { PrismaClient } from "../generated/client";
import { config } from "../config";
import { decryptSecret, encryptSecret } from "../integrations/jiraCrypto";
import {
  JiraRequestError,
  fetchIssue,
  isValidIssueKey,
  normalizeSiteUrl,
  verifyCredentials,
} from "../integrations/jiraClient";

const connectSchema = z.object({
  siteUrl: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(254),
  apiToken: z.string().trim().min(8).max(2048),
});

type Deps = {
  prisma: PrismaClient;
  requireAuth: express.RequestHandler;
  asyncHandler: (
    fn: (req: express.Request, res: express.Response) => Promise<unknown>,
  ) => express.RequestHandler;
};

const CONNECTION_ID = "default";

const encryptionSecret = () =>
  process.env.JIRA_TOKEN_ENCRYPTION_KEY?.trim() || config.jwtSecret;

export const registerJiraRoutes = (
  app: express.Express,
  { prisma, requireAuth, asyncHandler }: Deps,
) => {
  const limiter = rateLimit({
    windowMs: 60_000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.user?.id ?? "anonymous",
    validate: {
      trustProxy: false,
      xForwardedForHeader: false,
      keyGeneratorIpFallback: false,
    },
    message: {
      error: "Rate limit exceeded",
      message: "Too many Jira requests",
    },
  });

  // Only an admin acting as themselves may change the shared credentials.
  const adminOnly: express.RequestHandler = (req, res, next) => {
    if (req.user?.role !== "ADMIN" || req.user.impersonatorId) {
      return res.status(403).json({
        error: "Forbidden",
        message: "Only an admin can manage the Jira connection",
      });
    }
    return next();
  };

  const handleError = (res: express.Response, error: unknown) => {
    if (error instanceof JiraRequestError) {
      // 401 from Jira means stale creds, not a failed session: don't log the user out.
      const status = error.status === 401 ? 400 : error.status;
      return res
        .status(status)
        .json({ error: "Jira error", message: error.message });
    }
    throw error;
  };

  app.get(
    "/integrations/jira",
    requireAuth,
    limiter,
    asyncHandler(async (req, res) => {
      const row = await prisma.jiraConnection.findUnique({
        where: { id: CONNECTION_ID },
        select: { siteUrl: true, email: true },
      });
      if (!row) return res.json({ connected: false });
      const isAdmin = req.user!.role === "ADMIN";
      res.json({
        connected: true,
        siteUrl: row.siteUrl,
        ...(isAdmin ? { email: row.email } : {}),
      });
    }),
  );

  app.put(
    "/integrations/jira",
    requireAuth,
    adminOnly,
    limiter,
    asyncHandler(async (req, res) => {
      const parsed = connectSchema.safeParse(req.body);
      const siteUrl = parsed.success
        ? normalizeSiteUrl(parsed.data.siteUrl)
        : null;
      if (!parsed.success || !siteUrl) {
        return res.status(400).json({
          error: "Validation error",
          message:
            "Enter a Jira Cloud site (https://your-team.atlassian.net), your Atlassian email and an API token",
        });
      }
      const { email, apiToken } = parsed.data;
      try {
        await verifyCredentials(siteUrl, email, apiToken);
      } catch (error) {
        return handleError(res, error);
      }
      const apiTokenEncrypted = encryptSecret(apiToken, encryptionSecret());
      await prisma.jiraConnection.upsert({
        where: { id: CONNECTION_ID },
        create: {
          id: CONNECTION_ID,
          siteUrl,
          email,
          apiTokenEncrypted,
          updatedById: req.user!.id,
        },
        update: {
          siteUrl,
          email,
          apiTokenEncrypted,
          updatedById: req.user!.id,
        },
      });
      res.json({ connected: true, siteUrl, email });
    }),
  );

  app.delete(
    "/integrations/jira",
    requireAuth,
    adminOnly,
    limiter,
    asyncHandler(async (_req, res) => {
      await prisma.jiraConnection.deleteMany({ where: { id: CONNECTION_ID } });
      res.json({ connected: false });
    }),
  );

  app.get(
    "/integrations/jira/issues/:key",
    requireAuth,
    limiter,
    asyncHandler(async (req, res) => {
      const key = String(req.params.key || "").toUpperCase();
      if (!isValidIssueKey(key)) {
        return res
          .status(400)
          .json({ error: "Validation error", message: "Invalid issue key" });
      }
      const row = await prisma.jiraConnection.findUnique({
        where: { id: CONNECTION_ID },
      });
      if (!row) {
        return res
          .status(404)
          .json({
            error: "Not connected",
            message:
              "Jira is not connected. Ask an admin to connect it in Settings",
          });
      }
      const apiToken = decryptSecret(row.apiTokenEncrypted, encryptionSecret());
      if (!apiToken) {
        return res.status(409).json({
          error: "Reconnect required",
          message:
            "Stored Jira token can no longer be read; ask an admin to reconnect Jira in Settings",
        });
      }
      try {
        res.json(await fetchIssue(row.siteUrl, row.email, apiToken, key));
      } catch (error) {
        return handleError(res, error);
      }
    }),
  );
};
