CREATE TABLE "JiraConnection" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "siteUrl" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "apiTokenEncrypted" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "JiraConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
