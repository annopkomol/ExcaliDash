---
title: ExcaliDash Local Development
description: Set up the ExcaliDash frontend and backend locally to develop a self-hosted Excalidraw workspace.
---

<script setup>
import { setupSlides } from "../.vitepress/theme/screenshot-flows";
</script>

# Local development

Run the backend and frontend in separate terminals.

## Requirements

- Node.js 24.22.1+ (`nvm use` selects the version in `.nvmrc`)
- npm 10
- Git

## Install dependencies

From the repository root:

```bash
npm run install:all
npm install
```

## Quick visual testing

To click through a change without Docker, `.env` files or the first-run setup, start both apps with one command from the repository root:

```bash
npm run dev:local
```

It runs the backend on a throwaway SQLite database in `.dev-local/` with `AUTH_MODE=disabled`, so there's no sign-in, and serves the frontend at `http://localhost:6767`. Use `npm run dev:local:fresh` to wipe `.dev-local/` first. Press Ctrl+C to stop both. Don't expose this stack to a network; authentication is off.

## Configure the apps

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

Replace the generated path placeholders in `backend/.env`:

```dotenv
DATABASE_URL=file:./dev.db
BACKUP_DIR=./backups
```

## Start the backend

```bash
cd backend
npm run dev
```

## Start the frontend

In another terminal:

```bash
cd frontend
npm run dev
```

Open `http://localhost:6767`, then follow the first-run screens below. Select the arrows to move from authentication setup through creating an administrator and opening your first drawing.

<ScreenshotCarousel label="First-run setup after starting the local services" :slides="setupSlides" />
