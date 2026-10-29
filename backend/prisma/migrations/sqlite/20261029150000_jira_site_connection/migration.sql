-- Jira credentials become a single admin-managed, site-wide connection.
DROP TABLE "JiraConnection";

CREATE TABLE "JiraConnection" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
    "siteUrl" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "apiTokenEncrypted" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
