# Sitegeist Server Architecture & Developer Experience

## Current Setup

### Local Development

**Architecture:**
- **Backend**: TypeScript Node.js server running via `tsx watch` (hot reload)
  - Port: 3000
  - Entry: `src/backend/server.ts`
  - Data stored in: `./data` directory
  - No database currently, likely file-based storage

- **Frontend**: Vite dev server with hot module replacement
  - Port: 8080
  - Root: `src/frontend`
  - Multi-page app: main, admin, install pages
  - Proxies `/api/*` requests to backend at `localhost:3000`
  - Tailwind CSS via @tailwindcss/vite plugin
  - Custom middleware for `/admin` SPA routing

**Starting Local Dev:**
```bash
./run.sh dev
```
This spawns two processes with proper cleanup on Ctrl+C.

**Build Process:**
```bash
./run.sh build
```
1. Vite builds frontend → `dist/frontend`
2. TypeScript compiles backend → `dist/backend` + `dist/shared`

### Production Deployment

**Target Server:** slayer.marioslab.io (`/home/badlogic/sitegeist.ai`)

**Architecture:**
- **Docker Compose** with two services:
  - **web (Caddy)**: Alpine-based reverse proxy
    - Serves static files from `dist/frontend`
    - Serves uploads from `/uploads`
    - Proxies `/api/*` to backend:3000
    - Compression: zstd/gzip (256+ bytes)
    - Connects to external `caddy-network` for TLS/domain routing

  - **backend (Node 22)**: Custom Docker image
    - Runs `npm ci --omit=dev` on startup
    - Executes `dist/backend/server.js`
    - Mounts: package files (ro), dist directories (ro), data directory (rw)
    - Uses named volume for `node_modules`
    - Port 3000 (internal network only)

**Deployment Flow:**
```bash
./run.sh deploy
```
1. `npm install` locally
2. Build frontend and backend
3. `rsync` selective files to server (dist/, infra/, run.sh, package files)
4. SSH: stop services, restart production, stream logs

**Network Topology:**
- External `caddy-network`: For TLS termination and domain routing (shared infrastructure)
- Internal network: Backend ↔ Web service communication

---

## Proposed Enhancements

### 1. PostgreSQL Database Integration

#### Local Development
Add `docker-compose.dev.yml`:

```yaml
services:
  postgres-dev:
    image: postgres:16-alpine
    ports:
      - "5432:5432"
    environment:
      POSTGRES_DB: sitegeist_dev
      POSTGRES_USER: dev
      POSTGRES_PASSWORD: devpassword
    volumes:
      - postgres_dev_data:/var/lib/postgresql/data
      - ./infra/init-db.sql:/docker-entrypoint-initdb.d/init.sql:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U dev"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  postgres_dev_data:
```

**Updated dev command:**
```bash
# Start postgres in background
docker compose -f infra/docker-compose.dev.yml up -d postgres-dev

# Wait for health check, then start app servers
npx tsx watch src/backend/server.ts &
npx vite --config infra/vite.config.ts --port 8080 &
```

**Environment Variables (.env.dev):**
```
DATABASE_URL=postgresql://dev:devpassword@localhost:5432/sitegeist_dev
NODE_ENV=development
PORT=3000
```

#### Production Deployment
Add to `infra/docker-compose.yml`:

```yaml
services:
  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: sitegeist_prod
      POSTGRES_USER: ${DB_USER}
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./backups:/backups
    networks:
      - internal
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${DB_USER}"]
      interval: 10s
      timeout: 5s
      retries: 5

  backend:
    # ... existing config ...
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      - DATABASE_URL=postgresql://${DB_USER}:${DB_PASSWORD}@postgres:5432/sitegeist_prod
      # ... other env vars ...

volumes:
  postgres_data:
```

#### Migration Strategy
Use **node-pg-migrate** or **Prisma**:

**Option A: node-pg-migrate**
```json
{
  "scripts": {
    "migrate:up": "node-pg-migrate up",
    "migrate:down": "node-pg-migrate down",
    "migrate:create": "node-pg-migrate create"
  }
}
```
- Migrations in `migrations/` directory
- SQL-based, simple
- Run migrations in deployment script before restart

**Option B: Prisma**
```json
{
  "scripts": {
    "prisma:migrate:dev": "prisma migrate dev",
    "prisma:migrate:deploy": "prisma migrate deploy",
    "prisma:generate": "prisma generate",
    "prisma:studio": "prisma studio"
  }
}
```
- Type-safe queries
- Schema in `prisma/schema.prisma`
- Built-in GUI (Prisma Studio) for dev
- Auto-generated client

**Recommendation:** Prisma for better DX (type safety, Studio GUI, migrations)

---

### 2. E2E Testing

#### Setup with Playwright
```bash
npm install -D @playwright/test
npx playwright install
```

**`playwright.config.ts`:**
```typescript
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  use: {
    baseURL: 'http://localhost:8080',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run test:server',
    port: 8080,
    reuseExistingServer: !process.env.CI,
  },
});
```

**Test Database Setup:**
Create `tests/setup/test-db.ts`:
```typescript
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export async function setupTestDb() {
  // Drop and recreate test database
  await execAsync('psql -U dev -c "DROP DATABASE IF EXISTS sitegeist_test"');
  await execAsync('psql -U dev -c "CREATE DATABASE sitegeist_test"');

  // Run migrations
  await execAsync('DATABASE_URL=postgresql://dev:devpassword@localhost:5432/sitegeist_test npm run migrate:up');

  // Seed test data
  await execAsync('npm run test:seed');
}

export async function teardownTestDb() {
  await execAsync('psql -U dev -c "DROP DATABASE IF EXISTS sitegeist_test"');
}
```

**Package.json scripts:**
```json
{
  "scripts": {
    "test:e2e": "playwright test",
    "test:e2e:ui": "playwright test --ui",
    "test:e2e:debug": "playwright test --debug",
    "test:server": "NODE_ENV=test DATABASE_URL=postgresql://dev:devpassword@localhost:5432/sitegeist_test tsx src/backend/server.ts",
    "test:seed": "tsx tests/setup/seed.ts"
  }
}
```

**Example Test Structure:**
```
tests/
├── e2e/
│   ├── auth.spec.ts
│   ├── admin.spec.ts
│   └── api.spec.ts
├── setup/
│   ├── test-db.ts
│   ├── seed.ts
│   └── fixtures.ts
└── playwright.config.ts
```

**CI Integration:**
Add to GitHub Actions or similar:
```yaml
- name: Run E2E tests
  run: |
    docker compose -f infra/docker-compose.dev.yml up -d postgres-dev
    npm run test:e2e
```

---

### 3. Node.js Debugger Attachment

#### VSCode Launch Configuration
Create `.vscode/launch.json`:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Debug Backend",
      "type": "node",
      "request": "attach",
      "port": 9229,
      "restart": true,
      "skipFiles": ["<node_internals>/**"],
      "sourceMaps": true,
      "resolveSourceMapLocations": [
        "${workspaceFolder}/**",
        "!**/node_modules/**"
      ]
    },
    {
      "name": "Debug Backend (Launch)",
      "type": "node",
      "request": "launch",
      "runtimeExecutable": "npx",
      "runtimeArgs": ["tsx", "watch", "--inspect=9229", "src/backend/server.ts"],
      "cwd": "${workspaceFolder}",
      "env": {
        "NODE_ENV": "development",
        "DATABASE_URL": "postgresql://dev:devpassword@localhost:5432/sitegeist_dev"
      },
      "skipFiles": ["<node_internals>/**"],
      "console": "integratedTerminal",
      "restart": true
    },
    {
      "name": "Debug E2E Tests",
      "type": "node",
      "request": "launch",
      "program": "${workspaceFolder}/node_modules/.bin/playwright",
      "args": ["test", "--debug"],
      "console": "integratedTerminal"
    }
  ]
}
```

#### Updated run.sh for Debug Mode
Add to `run.sh`:

```bash
dev-debug)
    echo "Starting development environment with debugger..."
    echo "Backend API: http://localhost:3000"
    echo "Debugger: localhost:9229"
    echo "Frontend: http://localhost:8080"
    echo ""

    mkdir -p data
    docker compose -f infra/docker-compose.dev.yml up -d postgres-dev

    # Start backend with debugger
    npx tsx watch --inspect=9229 src/backend/server.ts &
    BACKEND_PID=$!

    # Start frontend
    npx vite --config infra/vite.config.ts --port 8080 --clearScreen false &
    VITE_PID=$!

    # Cleanup on exit
    trap "kill $BACKEND_PID $VITE_PID 2>/dev/null || true; exit 0" INT TERM
    wait
    ;;
```

**Usage:**
```bash
# Option 1: Use VSCode "Debug Backend (Launch)"
# Just press F5 in VSCode

# Option 2: Attach to running process
./run.sh dev-debug  # Starts with --inspect
# Then use "Debug Backend" (attach) configuration

# Option 3: CLI debugging
npx tsx watch --inspect-brk=9229 src/backend/server.ts  # Breaks on first line
```

**Chrome DevTools:**
Navigate to `chrome://inspect` to attach Chrome debugger.

---

### 4. Metabase Integration

#### Local Development
Add to `docker-compose.dev.yml`:

```yaml
services:
  metabase-dev:
    image: metabase/metabase:latest
    ports:
      - "3001:3000"
    environment:
      MB_DB_TYPE: postgres
      MB_DB_DBNAME: metabase_dev
      MB_DB_PORT: 5432
      MB_DB_USER: dev
      MB_DB_PASS: devpassword
      MB_DB_HOST: postgres-dev
    volumes:
      - metabase_dev_data:/metabase-data
    depends_on:
      postgres-dev:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/api/health"]
      interval: 30s
      timeout: 10s
      retries: 5

  postgres-dev:
    # ... existing config ...
    environment:
      POSTGRES_DB: sitegeist_dev
      POSTGRES_USER: dev
      POSTGRES_PASSWORD: devpassword
    # Create metabase DB on startup
    command: >
      bash -c "
        docker-entrypoint.sh postgres &
        until pg_isready -U dev; do sleep 1; done;
        psql -U dev -c 'CREATE DATABASE metabase_dev' || true;
        wait
      "

volumes:
  metabase_dev_data:
```

**Access:** http://localhost:3001

#### Production Deployment
Add to `infra/docker-compose.yml`:

```yaml
services:
  metabase:
    image: metabase/metabase:latest
    restart: unless-stopped
    environment:
      MB_DB_TYPE: postgres
      MB_DB_DBNAME: metabase_prod
      MB_DB_PORT: 5432
      MB_DB_USER: ${DB_USER}
      MB_DB_PASS: ${DB_PASSWORD}
      MB_DB_HOST: postgres
      MB_SITE_URL: https://sitegeist.ai/metabase
    volumes:
      - metabase_data:/metabase-data
    depends_on:
      postgres:
        condition: service_healthy
    networks:
      - internal
      - caddy-network
    labels:
      caddy: sitegeist.ai
      caddy.reverse_proxy: /metabase* backend:3000
      # Or use subdomain:
      # caddy: metabase.sitegeist.ai
      # caddy.reverse_proxy: '{{upstreams 3000}}'

volumes:
  metabase_data:
```

**Update Caddyfile for path-based routing:**
```caddyfile
:80 {
  encode {
    zstd
    gzip
    minimum_length 256
  }

  # Metabase (requires auth middleware ideally)
  handle /metabase* {
    reverse_proxy metabase:3000
  }

  # API proxy to backend
  handle /api/* {
    reverse_proxy backend:3000
  }

  # ... rest of config ...
}
```

**Initial Setup:**
1. First time: navigate to Metabase URL, create admin account
2. Add data source: postgres service (host: `postgres`, port: 5432)
3. Create dashboards, queries, alerts
4. Set up permissions for team members

**Metabase Database Creation:**
Update postgres init script or use migration:
```sql
CREATE DATABASE metabase_dev;
CREATE DATABASE metabase_prod;
```

---

## Proposed Developer Experience Improvements

### 1. Unified Docker Compose for Dev & Prod Parity

**Goal:** Run local dev in Docker to match production exactly.

Create `docker-compose.dev.yml` with hot reload:

```yaml
services:
  backend-dev:
    build:
      context: ..
      dockerfile: infra/Dockerfile.dev  # New Dockerfile with dev dependencies
    ports:
      - "3000:3000"
      - "9229:9229"  # Debugger
    environment:
      - NODE_ENV=development
      - DATABASE_URL=postgresql://dev:devpassword@postgres-dev:5432/sitegeist_dev
    volumes:
      - ../src:/app/src:ro
      - ../package.json:/app/package.json:ro
      - ../tsconfig.json:/app/tsconfig.json:ro
    command: npx tsx watch --inspect=0.0.0.0:9229 src/backend/server.ts
    depends_on:
      postgres-dev:
        condition: service_healthy

  frontend-dev:
    build:
      context: ..
      dockerfile: infra/Dockerfile.frontend  # Node with Vite
    ports:
      - "8080:8080"
    volumes:
      - ../src/frontend:/app/src/frontend
      - ../infra/vite.config.ts:/app/infra/vite.config.ts
    command: npx vite --config infra/vite.config.ts --port 8080 --host 0.0.0.0

  # ... postgres-dev, metabase-dev ...
```

**Benefits:**
- Identical networking, service discovery
- No "works on my machine" issues
- Easy onboarding for new developers

**Trade-offs:**
- Slower than native (but tsx watch is fast)
- More Docker complexity
- File system performance (use cached mounts on macOS)

---

### 2. Environment Management

**Structure:**
```
.env.example          # Template for developers
.env.dev              # Local dev (gitignored)
.env.test             # Test environment
.env.production       # Production secrets (server-side only, never committed)
```

**Validation Script (`src/backend/config.ts`):**
```typescript
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().url(),
  DATA_DIR: z.string().default('./data'),
  UPLOAD_DIR: z.string().default('./uploads'),
  // Add all required env vars
});

export const config = envSchema.parse(process.env);
```

**Load in server.ts:**
```typescript
import 'dotenv/config';
import { config } from './config';
```

---

### 3. Database Migrations & Seeding

**Migration Workflow:**
```bash
# Create migration
npm run migrate:create add_users_table

# Apply migrations (dev)
npm run migrate:up

# Rollback (dev)
npm run migrate:down

# Apply migrations (production, part of deployment)
npm run migrate:deploy
```

**Seed Data for Development:**
```typescript
// src/backend/seeds/dev.seed.ts
import { db } from '../db';

export async function seedDev() {
  await db.users.createMany([
    { email: 'admin@example.com', role: 'admin' },
    { email: 'user@example.com', role: 'user' },
  ]);

  await db.sites.createMany([
    { url: 'https://example.com', userId: 1 },
  ]);
}
```

```bash
npm run seed:dev  # Run after migrations in local dev
```

---

### 4. Health Checks & Observability

**Health Check Endpoint:**
```typescript
// src/backend/routes/health.ts
app.get('/api/health', async (req, res) => {
  const dbHealthy = await checkDatabase();
  const uptime = process.uptime();

  res.json({
    status: dbHealthy ? 'healthy' : 'unhealthy',
    uptime,
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version,
  });
});
```

**Docker Health Checks:**
```yaml
backend:
  healthcheck:
    test: ["CMD", "curl", "-f", "http://localhost:3000/api/health"]
    interval: 30s
    timeout: 10s
    retries: 3
    start_period: 40s
```

**Logging:**
- Use `pino` for structured logging (JSON in production, pretty in dev)
- Log levels: debug, info, warn, error
- Request logging middleware

---

### 5. Automated Backup Strategy

**Postgres Backups:**
Add to `infra/docker-compose.yml`:

```yaml
services:
  backup:
    image: postgres:16-alpine
    depends_on:
      - postgres
    volumes:
      - ./backups:/backups
    environment:
      PGPASSWORD: ${DB_PASSWORD}
    entrypoint: /bin/sh
    command: -c "while true; do
      pg_dump -h postgres -U ${DB_USER} -d sitegeist_prod -F c -f /backups/backup_$$(date +%Y%m%d_%H%M%S).dump;
      find /backups -name '*.dump' -mtime +7 -delete;
      sleep 86400;
      done"
```

**Restore:**
```bash
docker compose exec postgres pg_restore -U $DB_USER -d sitegeist_prod /backups/backup_20250129.dump
```

---

### 6. Updated run.sh Commands

```bash
#!/bin/bash

# ... existing functions ...

case "$1" in
dev)
    echo "Starting development environment..."
    docker compose -f infra/docker-compose.dev.yml up -d postgres-dev
    # Wait for postgres
    until docker compose -f infra/docker-compose.dev.yml exec postgres-dev pg_isready -U dev; do
      sleep 1
    done

    # Run migrations
    npm run migrate:up

    # Start servers
    npx tsx watch src/backend/server.ts &
    BACKEND_PID=$!
    npx vite --config infra/vite.config.ts --port 8080 &
    VITE_PID=$!

    trap "kill $BACKEND_PID $VITE_PID; docker compose -f infra/docker-compose.dev.yml down" INT TERM
    wait
    ;;

dev-docker)
    echo "Starting development in Docker (prod-like)..."
    docker compose -f infra/docker-compose.dev.yml up
    ;;

dev-debug)
    # ... as described above ...
    ;;

test:e2e)
    echo "Running E2E tests..."
    docker compose -f infra/docker-compose.dev.yml up -d postgres-dev
    npm run test:e2e
    ;;

metabase)
    echo "Starting Metabase..."
    docker compose -f infra/docker-compose.dev.yml up -d postgres-dev metabase-dev
    echo "Metabase available at http://localhost:3001"
    ;;

migrate)
    docker compose -f infra/docker-compose.dev.yml up -d postgres-dev
    npm run migrate:up
    ;;

seed)
    docker compose -f infra/docker-compose.dev.yml up -d postgres-dev
    npm run seed:dev
    ;;

backup)
    echo "Creating backup..."
    ssh $SERVER "docker compose -f $SERVER_DIR/infra/docker-compose.yml exec postgres pg_dump -U \$DB_USER -d sitegeist_prod -F c -f /backups/manual_backup_\$(date +%Y%m%d_%H%M%S).dump"
    ;;

restore)
    if [ -z "$2" ]; then
      echo "Usage: $0 restore <backup_file>"
      exit 1
    fi
    echo "Restoring from $2..."
    ssh $SERVER "docker compose -f $SERVER_DIR/infra/docker-compose.yml exec postgres pg_restore -U \$DB_USER -d sitegeist_prod /backups/$2"
    ;;

# ... existing deploy, prod, stop, logs commands ...

*)
    echo "Usage: $0 {dev|dev-docker|dev-debug|test:e2e|metabase|migrate|seed|backup|restore|build|deploy|prod|stop|logs}"
    exit 1
    ;;
esac
```

---

## Summary: Ideal Developer Experience

### Day 1 for New Developer
```bash
git clone <repo>
cd site
cp .env.example .env.dev
./run.sh dev  # Starts postgres, runs migrations, starts backend+frontend
```

### Daily Development Workflow
```bash
# Normal development
./run.sh dev

# With debugger
./run.sh dev-debug
# Attach VSCode debugger (F5)

# Query data
./run.sh metabase  # Open localhost:3001

# Run tests
npm run test:e2e
```

### Database Changes
```bash
npm run migrate:create add_new_column
# Edit migration file
npm run migrate:up
git add migrations/
git commit -m "Add new column to users table"
```

### Deployment
```bash
./run.sh deploy  # Builds, syncs, runs migrations, restarts, streams logs
# Migrations run automatically before service restart
```

---

## Implementation Checklist

### Phase 1: Database Foundation
- [ ] Create `docker-compose.dev.yml` with postgres-dev
- [ ] Add postgres to production `docker-compose.yml`
- [ ] Choose migration tool (Prisma recommended)
- [ ] Set up initial schema & migrations
- [ ] Create seed scripts
- [ ] Update backend to use postgres
- [ ] Add database health checks

### Phase 2: Testing Infrastructure
- [ ] Install Playwright
- [ ] Create `playwright.config.ts`
- [ ] Set up test database scripts
- [ ] Write initial E2E tests
- [ ] Add to CI/CD pipeline

### Phase 3: Debugging & DX
- [ ] Create `.vscode/launch.json`
- [ ] Add `dev-debug` command to run.sh
- [ ] Test debugger attachment
- [ ] Document debugging workflow

### Phase 4: Metabase
- [ ] Add Metabase to `docker-compose.dev.yml`
- [ ] Add Metabase to production compose
- [ ] Update Caddyfile for routing
- [ ] Create initial dashboards
- [ ] Set up authentication/permissions

### Phase 5: Polish
- [ ] Implement structured logging (pino)
- [ ] Add environment validation (zod)
- [ ] Create backup scripts
- [ ] Update documentation
- [ ] Add health check endpoints
- [ ] Create onboarding guide

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                       DEVELOPMENT                            │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  Developer Machine                                           │
│  ┌────────────┐     ┌──────────────┐    ┌────────────┐     │
│  │  VSCode    │────▶│ tsx watch    │───▶│ Backend    │     │
│  │  Debugger  │     │ --inspect    │    │ :3000      │     │
│  │  :9229     │     └──────────────┘    └─────┬──────┘     │
│  └────────────┘                               │             │
│                                                │             │
│  ┌────────────┐                                │             │
│  │  Browser   │     ┌──────────────┐          │             │
│  │  :8080     │────▶│   Vite HMR   │          │             │
│  └────────────┘     │   :8080      │          │             │
│                     └──────────────┘          │             │
│                                                │             │
│  ┌────────────┐                                │             │
│  │  Metabase  │     ┌──────────────┐          │             │
│  │  :3001     │────▶│  Metabase    │──────────┤             │
│  └────────────┘     │  Container   │          │             │
│                     └──────────────┘          │             │
│                                                │             │
│                     ┌──────────────┐          │             │
│                     │  PostgreSQL  │◀─────────┘             │
│                     │  :5432       │                         │
│                     │  Docker      │                         │
│                     └──────────────┘                         │
│                                                               │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                       PRODUCTION                             │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  slayer.marioslab.io                                         │
│                                                               │
│  ┌────────────┐                                              │
│  │  Internet  │                                              │
│  └──────┬─────┘                                              │
│         │                                                     │
│         ▼                                                     │
│  ┌─────────────────┐    caddy-network (external)            │
│  │  Caddy Proxy    │    (shared TLS termination)            │
│  │  sitegeist.ai   │                                         │
│  └────────┬────────┘                                         │
│           │                                                   │
│           │         internal network                         │
│  ┌────────┼─────────────────────────────┐                   │
│  │        │                              │                   │
│  │        ▼                              │                   │
│  │  ┌──────────┐    ┌───────────┐      │                   │
│  │  │  Caddy   │───▶│  Backend  │      │                   │
│  │  │  Static  │    │  Node:3000│      │                   │
│  │  │  Server  │    └─────┬─────┘      │                   │
│  │  └──────────┘          │             │                   │
│  │        │                │             │                   │
│  │        │                ▼             │                   │
│  │        │          ┌───────────┐      │                   │
│  │        │          │ Postgres  │      │                   │
│  │        │          │  :5432    │      │                   │
│  │        │          └─────┬─────┘      │                   │
│  │        │                │             │                   │
│  │        ▼                │             │                   │
│  │  ┌───────────┐          │             │                   │
│  │  │ Metabase  │──────────┘             │                   │
│  │  │  :3000    │                        │                   │
│  │  └───────────┘                        │                   │
│  │                                        │                   │
│  └────────────────────────────────────────┘                   │
│                                                               │
│  ┌──────────────────────┐                                    │
│  │  Persistent Storage  │                                    │
│  │  - postgres_data     │                                    │
│  │  - metabase_data     │                                    │
│  │  - ../data           │                                    │
│  │  - ../uploads        │                                    │
│  │  - ./backups         │                                    │
│  └──────────────────────┘                                    │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

---

## Key Benefits of This Architecture

1. **Dev/Prod Parity**: Docker Compose used in both environments
2. **Fast Feedback**: Hot reload for frontend & backend
3. **Easy Debugging**: VSCode integration, Chrome DevTools support
4. **Type Safety**: TypeScript + Prisma for end-to-end types
5. **Data Insights**: Metabase for quick querying without custom dashboards
6. **Robust Testing**: Playwright E2E with test database isolation
7. **Simple Deployment**: Single command, automated migrations
8. **Data Safety**: Automated backups, easy restore
9. **Observability**: Health checks, structured logging, Metabase analytics
10. **Onboarding**: `./run.sh dev` and you're running

---

## Trade-offs & Considerations

### Docker for Local Dev
**Pros:** Exact prod parity, consistent environment
**Cons:** Slower on macOS (file system), more memory usage
**Recommendation:** Hybrid approach - Docker for postgres/metabase, native for app servers

### Prisma vs node-pg-migrate
**Prisma Pros:** Type safety, Prisma Studio, generated client, great DX
**Prisma Cons:** Abstraction layer, learning curve, larger bundle
**node-pg-migrate Pros:** Simple SQL, lightweight, no abstraction
**node-pg-migrate Cons:** No type safety, manual query building
**Recommendation:** Use Prisma unless you have specific SQL requirements

### Metabase Subdomain vs Path
**Subdomain (metabase.sitegeist.ai):**
- Cleaner URLs
- Requires DNS configuration
- Separate TLS cert handling

**Path (/metabase):**
- No DNS changes
- Simpler config
- May require Metabase `MB_SITE_URL` configuration

**Recommendation:** Path-based for simplicity, unless you need separate auth domains

### Backup Strategy
**Current proposal:** Daily dumps kept for 7 days
**Consider:** Point-in-time recovery with WAL archiving for critical production data
**Recommendation:** Start simple, upgrade if recovery requirements increase

---

## Next Steps

1. **Review this document** with team/other LLMs
2. **Prioritize phases** based on current pain points
3. **Spike on Prisma** vs node-pg-migrate (1-2 hours)
4. **Start with Phase 1** - get postgres running in both environments
5. **Iterate** - each phase should be deployable independently
