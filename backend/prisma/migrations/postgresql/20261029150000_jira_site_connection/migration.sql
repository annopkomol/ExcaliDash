-- Jira credentials become a single admin-managed, site-wide connection.
DROP TABLE "JiraConnection";

CREATE TABLE "JiraConnection" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "siteUrl" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "apiTokenEncrypted" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "JiraConnection_pkey" PRIMARY KEY ("id")
);
