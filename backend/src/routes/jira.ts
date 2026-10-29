/**
 * Jira integration routes (per-user credentials):
 *   GET    /integrations/jira              – connection status (never returns the token)
 *   PUT    /integrations/jira              – verify + store site URL, email, API token (encrypted)
 *   DELETE /integrations/jira              – remove stored credentials
 *   GET    /integrations/jira/issues/:key  – fetch issue fields for a card
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
    validate: { trustProxy: false, xForwardedForHeader: false, keyGeneratorIpFallback: false },
    message: { error: "Rate limit exceeded", message: "Too many Jira requests" },
  });

  // Stored credentials belong to the account holder; admins impersonating a user must not use them.
  const guard: express.RequestHandler = (req, res, next) => {
    if (req.user?.impersonatorId) {
      return res.status(403).json({
        error: "Forbidden",
        message: "Jira integration is unavailable while impersonating",
      });
    }
    return next();
  };

  const handleError = (res: express.Response, error: unknown) => {
    if (error instanceof JiraRequestError) {
      // 401 from Jira means stale creds, not a failed session: don't log the user out.
      const status = error.status === 401 ? 400 : error.status;
      return res.status(status).json({ error: "Jira error", message: error.message });
    }
    throw error;
  };

  app.get(
    "/integrations/jira",
    requireAuth,
    guard,
    limiter,
    asyncHandler(async (req, res) => {
      const row = await prisma.jiraConnection.findUnique({
        where: { userId: req.user!.id },
        select: { siteUrl: true, email: true },
      });
      res.json(
        row
          ? { connected: true, siteUrl: row.siteUrl, email: row.email }
          : { connected: false },
      );
    }),
  );

  app.put(
    "/integrations/jira",
    requireAuth,
    guard,
    limiter,
    asyncHandler(async (req, res) => {
      const parsed = connectSchema.safeParse(req.body);
      const siteUrl = parsed.success ? normalizeSiteUrl(parsed.data.siteUrl) : null;
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
        where: { userId: req.user!.id },
        create: { userId: req.user!.id, siteUrl, email, apiTokenEncrypted },
        update: { siteUrl, email, apiTokenEncrypted },
      });
      res.json({ connected: true, siteUrl, email });
    }),
  );

  app.delete(
    "/integrations/jira",
    requireAuth,
    guard,
    limiter,
    asyncHandler(async (req, res) => {
      await prisma.jiraConnection.deleteMany({ where: { userId: req.user!.id } });
      res.json({ connected: false });
    }),
  );

  app.get(
    "/integrations/jira/issues/:key",
    requireAuth,
    guard,
    limiter,
    asyncHandler(async (req, res) => {
      const key = String(req.params.key || "").toUpperCase();
      if (!isValidIssueKey(key)) {
        return res
          .status(400)
          .json({ error: "Validation error", message: "Invalid issue key" });
      }
      const row = await prisma.jiraConnection.findUnique({
        where: { userId: req.user!.id },
      });
      if (!row) {
        return res
          .status(404)
          .json({ error: "Not connected", message: "Jira is not connected" });
      }
      const apiToken = decryptSecret(row.apiTokenEncrypted, encryptionSecret());
      if (!apiToken) {
        return res.status(409).json({
          error: "Reconnect required",
          message: "Stored Jira token can no longer be read; reconnect Jira in Settings",
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
