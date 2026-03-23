# Shuvgeist Database & Subscription Architecture

**Date:** 2025-10-24
**Status:** Architecture Design Phase

---

## Table of Contents
1. [Requirements](#requirements)
2. [Current Infrastructure](#current-infrastructure)
3. [Storage Options Analysis](#storage-options-analysis)
4. [Recommendation](#recommendation)
5. [Database Schema](#database-schema)
6. [API Endpoints](#api-endpoints)
7. [Payment Flow](#payment-flow)
8. [Implementation Plan](#implementation-plan)

---

## Requirements

### User Flow
1. **Installation** - User installs Shuvgeist browser extension
2. **Authentication** - If not logged in, user is prompted to log in or create account (email + password)
3. **Email Verification** - Account creation requires one-time code via email for verification
4. **Trial Period** - New accounts get $1.00 in token credits with Shuvgeist-provided Haiku model
   - **No BYOK required during trial** - Shuvgeist handles API keys and model access
   - Extension sends requests to backend, which proxies to AI provider
   - Server tracks token usage in dollars but **NOT message content** (privacy-first)
   - Usage deducted per request: prompt tokens + completion tokens = cost in credits
   - User can finish current session but cannot create new sessions when credits depleted
5. **Paywall** - After $1.00 credits exhausted, user is presented with subscription option ($5-10/month)
6. **Payment** - Subscription action redirects to payment provider (Stripe/LemonSqueezy/Paddle)
7. **Status Sync** - Extension polls server for subscription status until payment completes or is cancelled
8. **Post-Payment** - Paid users can use BYOK or continue with Shuvgeist-provided models (unlimited)

### Data Storage Requirements
Per-user data on server:
- **User Account**: email, password hash, email verification status
- **Plan Status**: trial, paid, expired
- **Token Credits**: Remaining balance during trial (e.g., $0.47 remaining)
- **Token Usage Stats**: Total tokens used, total cost (for analytics, not per-message tracking)
- **Payment Provider Data**: customer ID, subscription ID, subscription status

### Non-Requirements
- ❌ Multi-device sync (user data lives locally in extension, only auth/subscription on server)
- ❌ Message content storage (privacy-first design)
- ❌ Per-message history or detailed token logs (only aggregate totals)
- ❌ Complex user profiles or settings

---

## Current Infrastructure

### Existing Server: slayer.marioslab.io

**Hardware Specs:**
```
CPU:    32 cores (current load: 0.10-0.17)
RAM:    62GB total, 45GB available (14GB used)
Disk:   1.7TB total, 1.4TB free (258GB used)
Uptime: 97+ days
Region: Germany (Hetzner)
```

**Current Load:**
- Elasticsearch: ~7.5GB RAM (11.7%)
- Node.js services: ~2-3GB RAM total
- Docker/containerd: minimal
- **≈99% CPU capacity unused**
- **≈70% RAM capacity unused**

**Can Easily Support:**
- 50,000+ Shuvgeist users
- No performance impact on existing services
- Zero additional hosting cost

### Existing Site Infrastructure

**Location:** `/site` directory

**Deployment Stack:**
```yaml
# site/infra/docker-compose.yml
services:
  web:        # Caddy (reverse proxy + static files)
  backend:    # Node.js Express API server
```

**Current Storage:**
```typescript
// site/src/backend/storage.ts
class FileStore<T> {
  // Single JSON file key/value store
  // Loads entire file on init, writes on modification
  // Currently used for: signups.json, settings.json
}
```

**Deployment Flow:**
```bash
# Local development
./run.sh dev         # tsx watch + vite dev server

# Build for production
./run.sh build       # tsc + vite build

# Deploy to slayer.marioslab.io
./run.sh deploy      # build + rsync + docker compose restart

# On server
./run.sh prod        # docker compose up -d
./run.sh logs        # docker compose logs -f
```

**Server Location:** `/home/shuv1337/geist.shuv.ai`

**Reverse Proxy:** Caddy with automatic HTTPS (geist.shuv.ai)

---

## Storage Options Analysis

### Option 1: JSON Files (FileStore)

**Current Implementation:**
```typescript
// site/src/backend/storage.ts
const signupsStore = new FileStore<EmailSignup[]>('./data/signups.json');
```

**Pros:**
- ✅ Already implemented in codebase
- ✅ Zero setup, identical local/prod
- ✅ No additional services needed
- ✅ Works offline
- ✅ Simple backups (just copy JSON files)
- ✅ No external dependencies

**Cons:**
- ❌ **Race conditions** on concurrent writes (multiple extensions calling API simultaneously)
- ❌ **No atomic operations** (message increment + limit check = unsafe)
- ❌ **Critical for payments** (subscription status updates must be atomic)
- ❌ **Performance degrades** with many users (loads entire file into memory)
- ❌ **No transactions** (can't rollback failed operations)
- ❌ **Risky for payment data** (corrupted file = lost subscription data)

**Verdict:** ⚠️ **Only viable for <50 users or MVP validation phase**

---

### Option 2: Self-Hosted PostgreSQL on slayer.marioslab.io

**Setup:**
```yaml
# Add to site/infra/docker-compose.yml
services:
  postgres:
    image: postgres:16
    restart: unless-stopped
    environment:
      POSTGRES_DB: shuvgeist
      POSTGRES_USER: shuvgeist
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    networks:
      - internal

volumes:
  postgres_data:
```

**Local Development:**
```yaml
# docker-compose.dev.yml (local)
services:
  postgres:
    image: postgres:16
    ports:
      - "5432:5432"
    environment:
      POSTGRES_DB: shuvgeist_dev
      POSTGRES_PASSWORD: dev
```

**Pros:**
- ✅ **ACID transactions** (critical for message counting & payments)
- ✅ **Proper concurrency** control (no race conditions)
- ✅ **Atomic operations** (increment + check in single transaction)
- ✅ **No recurring costs** (runs on existing server)
- ✅ **Full control** over data and backups
- ✅ **Production-ready** for 10k+ users
- ✅ **Same server** you already manage

**Cons:**
- ⚠️ Requires Docker Compose or PostgreSQL install for local dev
- ⚠️ Need to manage migrations (Drizzle/Prisma helps)
- ⚠️ Manual backups (can automate with cron)
- ⚠️ More complex than JSON files

**Resource Impact on slayer.marioslab.io:**
```
PostgreSQL (10k users):
- RAM: ~500MB (0.8% of available 45GB)
- CPU: <1% of one core
- Disk: ~1-2GB (0.1% of available 1.4TB)

Total Impact: Negligible
```

**Verdict:** ✅ **Best option for production on existing infrastructure**

---

### Option 3: Cloud Managed Database (EU)

#### Option 3a: Neon (Serverless PostgreSQL)
```
Region:     Frankfurt, Germany
Free Tier:  0.5GB storage, 3GB compute
Paid:       $19/month when exceeded
Features:   Auto-scaling, branching, connection pooling
```

#### Option 3b: Railway
```
Region:     EU available
Starter:    $5/month + usage
Features:   PostgreSQL + deployment platform
```

#### Option 3c: DigitalOcean Managed Database
```
Region:     Frankfurt, Amsterdam
Minimum:    $15/month
Features:   Auto backups, point-in-time recovery
```

#### Option 3d: Render
```
Region:     Frankfurt
Free Tier:  90 days only
Paid:       $7/month starter
```

**Pros:**
- ✅ Zero database ops (backups, updates automatic)
- ✅ EU data residency (GDPR compliant)
- ✅ Easy dev/prod setup (different projects, same code)
- ✅ Auto-scaling

**Cons:**
- ❌ **Recurring costs** ($5-25/month)
- ❌ **External dependency** (can't access if service is down)
- ❌ **Vendor lock-in**
- ❌ **Unnecessary** (you have 99% unused server capacity)

**Verdict:** ⚠️ **Not recommended** - adds cost and complexity when you have available infrastructure

---

## Recommendation

### Phase 1: PostgreSQL on slayer.marioslab.io

**Why:**
1. ✅ **Zero additional cost** (runs on existing server with 99% unused capacity)
2. ✅ **Production-ready** (ACID transactions for payment operations)
3. ✅ **EU-hosted** (Germany - GDPR compliant)
4. ✅ **Simple deployment** (add to existing docker-compose.yml)
5. ✅ **Scales easily** (can handle 50k+ users on current hardware)

**Tech Stack:**
```
Database:  PostgreSQL 16 (Docker container)
ORM:       Drizzle (lightweight, SQL-like syntax)
Auth:      bcrypt + JWT (simple, no external dependencies)
Payments:  Stripe (most popular) or Paddle (EU-friendly)
```

**Why Drizzle over Prisma:**
- Lighter bundle size (~1MB vs ~30MB)
- SQL-like syntax (easier to reason about)
- Better for extensions (smaller bundle)
- Type-safe with minimal overhead

### Migration Path (if needed)

If you grow beyond server capacity or want managed services later:
```bash
# 1. Export from PostgreSQL
pg_dump shuvgeist > backup.sql

# 2. Import to managed service (Neon/Railway)
psql $NEW_DATABASE_URL < backup.sql

# 3. Update environment variable
DATABASE_URL=postgresql://new-host/shuvgeist

# 4. Done - zero code changes
```

---

## AI Proxy Architecture

### Overview

Since trial users don't provide their own API keys (BYOK), the backend must proxy AI requests to Anthropic on their behalf. This requires:

1. **Server-side API key management** - Store Shuvgeist API keys securely
2. **Request proxying** - Forward extension requests to Anthropic API
3. **Token usage tracking** - Calculate costs and deduct from user credits
4. **Credit enforcement** - Prevent usage when credits exhausted

### Architecture Diagram

```
┌─────────────────┐
│   Extension     │
│   (Frontend)    │
└────────┬────────┘
         │ POST /api/ai/chat
         │ { messages: [...], model: "haiku" }
         │ Authorization: Bearer <jwt>
         ↓
┌─────────────────────────────────────────────┐
│  Backend Server (Node.js + Express)         │
├─────────────────────────────────────────────┤
│  1. Authenticate user (JWT)                 │
│  2. Check subscription plan & credits       │
│  3. Forward to Anthropic API                │
│  4. Calculate cost from usage               │
│  5. Deduct credits (atomic transaction)     │
│  6. Return response + updated status        │
└────────┬────────────────────────────────────┘
         │
         │ POST https://api.anthropic.com/v1/messages
         │ x-api-key: <shuvgeist_api_key>
         │ { messages: [...], model: "claude-3-haiku-20240307" }
         ↓
┌─────────────────┐
│  Anthropic API  │
└─────────────────┘
```

### Token Pricing (Anthropic)

```typescript
// src/backend/ai/pricing.ts
export const MODEL_PRICING = {
  'claude-3-haiku-20240307': {
    inputPer1M: 0.25,    // $0.25 per 1M input tokens
    outputPer1M: 1.25,   // $1.25 per 1M output tokens
  },
  'claude-3-5-sonnet-20241022': {
    inputPer1M: 3.00,    // $3.00 per 1M input tokens
    outputPer1M: 15.00,  // $15.00 per 1M output tokens
  }
} as const;

export function calculateCost(
  model: string,
  promptTokens: number,
  completionTokens: number
): number {
  const pricing = MODEL_PRICING[model];
  if (!pricing) throw new Error(`Unknown model: ${model}`);

  const inputCost = (promptTokens / 1_000_000) * pricing.inputPer1M;
  const outputCost = (completionTokens / 1_000_000) * pricing.outputPer1M;

  return inputCost + outputCost;
}
```

### Trial Credit Calculations

```typescript
// How far does $1.00 get you with Haiku?

// Average request: 1000 input tokens, 500 output tokens
const avgCost = (1000 / 1_000_000 * 0.25) + (500 / 1_000_000 * 1.25)
             = 0.00025 + 0.000625
             = 0.000875 per request

// $1.00 / $0.000875 ≈ 1,143 requests

// Small request: 500 input, 200 output
const smallCost = (500 / 1_000_000 * 0.25) + (200 / 1_000_000 * 1.25)
               = 0.000125 + 0.00025
               = 0.000375 per request

// $1.00 / $0.000375 ≈ 2,667 requests

// Large request: 5000 input, 2000 output
const largeCost = (5000 / 1_000_000 * 0.25) + (2000 / 1_000_000 * 1.25)
               = 0.00125 + 0.0025
               = 0.00375 per request

// $1.00 / $0.00375 ≈ 267 requests
```

**Conclusion**: $1.00 provides approximately 300-2,500 AI requests depending on conversation length. More than sufficient for trial evaluation.

### Security Considerations

**API Key Storage**:
```yaml
# site/infra/docker-compose.yml
services:
  backend:
    environment:
      - ANTHROPIC_API_KEY_FILE=/run/secrets/anthropic_api_key
    secrets:
      - anthropic_api_key

secrets:
  anthropic_api_key:
    file: ./secrets/anthropic_api_key.txt
```

**Rate Limiting**:
```typescript
// Prevent abuse even with valid JWT
// Limit: 100 requests per minute per user
import rateLimit from 'express-rate-limit';

const aiProxyLimiter = rateLimit({
  windowMs: 60 * 1000,  // 1 minute
  max: 100,  // 100 requests per window
  keyGenerator: (req) => req.userId,  // Rate limit per user
  handler: (req, res) => {
    res.status(429).json({ error: 'Too many requests, please slow down' });
  }
});

app.post('/api/ai/chat', authMiddleware, aiProxyLimiter, aiChatHandler);
```

**Input Validation**:
```typescript
// Prevent malicious input
const MAX_MESSAGES = 100;  // Max messages in conversation
const MAX_MESSAGE_LENGTH = 50000;  // Max chars per message

function validateChatRequest(body: any): void {
  if (!Array.isArray(body.messages)) {
    throw new Error('messages must be an array');
  }

  if (body.messages.length > MAX_MESSAGES) {
    throw new Error(`Too many messages (max ${MAX_MESSAGES})`);
  }

  for (const msg of body.messages) {
    if (!msg.role || !msg.content) {
      throw new Error('Invalid message format');
    }
    if (msg.content.length > MAX_MESSAGE_LENGTH) {
      throw new Error(`Message too long (max ${MAX_MESSAGE_LENGTH} chars)`);
    }
  }
}
```

---

## Database Schema

### Users Table
```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  email_verified BOOLEAN DEFAULT FALSE,
  verification_code TEXT,
  verification_code_expires TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_verification_code ON users(verification_code);
```

### Subscriptions Table
```sql
CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Plan status
  plan TEXT NOT NULL CHECK (plan IN ('trial', 'paid', 'expired')),

  -- Trial tracking (credit-based)
  token_credits_remaining NUMERIC(10, 6) DEFAULT 1.000000,  -- $1.00 in credits
  token_credits_initial NUMERIC(10, 6) DEFAULT 1.000000,
  total_tokens_used BIGINT DEFAULT 0,  -- Aggregate tokens (analytics only)
  total_cost_usd NUMERIC(10, 6) DEFAULT 0.000000,  -- Aggregate cost (analytics only)
  trial_started_at TIMESTAMP DEFAULT NOW(),
  trial_ended_at TIMESTAMP,

  -- Payment provider data (Stripe/LemonSqueezy/Paddle)
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  subscription_status TEXT CHECK (subscription_status IN ('active', 'canceled', 'past_due', 'incomplete')),
  subscription_period_end TIMESTAMP,

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),

  UNIQUE(user_id),
  CHECK (token_credits_remaining >= 0)  -- Cannot go negative
);

CREATE INDEX idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX idx_subscriptions_stripe_customer_id ON subscriptions(stripe_customer_id);
CREATE INDEX idx_subscriptions_stripe_subscription_id ON subscriptions(stripe_subscription_id);
```

### Drizzle Schema (TypeScript)
```typescript
// src/backend/db/schema.ts
import { pgTable, uuid, text, integer, timestamp, boolean, numeric, bigint } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  emailVerified: boolean('email_verified').default(false),
  verificationCode: text('verification_code'),
  verificationCodeExpires: timestamp('verification_code_expires'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const subscriptions = pgTable('subscriptions', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull().unique(),

  // Plan status
  plan: text('plan').notNull(), // 'trial' | 'paid' | 'expired'

  // Trial tracking (credit-based)
  tokenCreditsRemaining: numeric('token_credits_remaining', { precision: 10, scale: 6 }).default('1.000000'),
  tokenCreditsInitial: numeric('token_credits_initial', { precision: 10, scale: 6 }).default('1.000000'),
  totalTokensUsed: bigint('total_tokens_used', { mode: 'number' }).default(0),
  totalCostUsd: numeric('total_cost_usd', { precision: 10, scale: 6 }).default('0.000000'),
  trialStartedAt: timestamp('trial_started_at').defaultNow(),
  trialEndedAt: timestamp('trial_ended_at'),

  // Payment provider data
  stripeCustomerId: text('stripe_customer_id'),
  stripeSubscriptionId: text('stripe_subscription_id'),
  subscriptionStatus: text('subscription_status'), // 'active' | 'canceled' | 'past_due' | 'incomplete'
  subscriptionPeriodEnd: timestamp('subscription_period_end'),

  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});
```

### Data Size Estimation
```
1 user record:     ~500 bytes (email, hash, timestamps)
1 subscription:    ~900 bytes (plan, credits/numeric fields, stripe data)
Total per user:    ~1.4KB

1,000 users:       ~1.4MB
10,000 users:      ~14MB
100,000 users:     ~140MB

Database on disk:  ~2-3x data size (indexes, overhead)
RAM requirement:   ~100MB per 10k active users
```

---

## API Endpoints

### Authentication Endpoints

#### POST /api/auth/signup
```typescript
Request:
{
  email: string,
  password: string
}

Response:
{
  message: "Verification email sent",
  userId: string
}

Flow:
1. Validate email format & password strength
2. Check if email already exists
3. Hash password with bcrypt
4. Generate 6-digit verification code
5. Send email with code (expires in 15 minutes)
6. Create user record (email_verified=false)
7. Create subscription record (plan='trial', message_count=0)
```

#### POST /api/auth/verify
```typescript
Request:
{
  email: string,
  code: string
}

Response:
{
  token: string,  // JWT for authenticated requests
  user: {
    id: string,
    email: string
  }
}

Flow:
1. Find user by email
2. Check verification code matches and hasn't expired
3. Set email_verified=true
4. Generate JWT token (expires in 30 days)
5. Return token + user data
```

#### POST /api/auth/login
```typescript
Request:
{
  email: string,
  password: string
}

Response:
{
  token: string,
  user: {
    id: string,
    email: string
  }
}

Flow:
1. Rate limit: 5 attempts per 15 minutes per IP
2. Find user by email
3. Check email_verified=true
4. Verify password with bcrypt
5. Generate JWT token
6. Return token + user data
```

#### POST /api/auth/resend-verification
```typescript
Request:
{
  email: string
}

Response:
{
  message: "Verification email sent"
}

Flow:
1. Find user by email
2. Check if already verified (return early)
3. Generate new verification code
4. Send email
5. Update user record
```

---

### Subscription Endpoints

#### POST /api/ai/chat (AI Proxy Endpoint)
```typescript
Headers:
{
  Authorization: "Bearer <jwt_token>"
}

Request:
{
  messages: Array<{role: string, content: string}>,
  model?: string  // Optional, defaults to haiku for trial users
}

Response:
{
  response: {
    id: string,
    content: string,
    model: string,
    usage: {
      promptTokens: number,
      completionTokens: number,
      totalTokens: number
    }
  },
  subscription: {
    tokenCreditsRemaining: number,
    totalTokensUsed: number,
    plan: 'trial' | 'paid' | 'expired'
  }
}

Flow:
1. Authenticate user from JWT
2. Check subscription plan:
   - If 'trial': Use Shuvgeist API keys, check credits > 0
   - If 'paid': Use user's BYOK or Shuvgeist keys (unlimited)
   - If 'expired': Return 402 Payment Required
3. Forward request to AI provider (Anthropic)
4. Calculate cost based on usage:
   cost = (promptTokens * promptPrice) + (completionTokens * completionPrice)
   Example: Haiku = $0.25/1M input, $1.25/1M output
5. Atomic credit deduction (if trial):
   UPDATE subscriptions
   SET token_credits_remaining = token_credits_remaining - $cost,
       total_tokens_used = total_tokens_used + $totalTokens,
       total_cost_usd = total_cost_usd + $cost,
       updated_at = NOW()
   WHERE user_id = $1 AND plan = 'trial'
   RETURNING *
6. If credits <= 0 after deduction: set plan='expired'
7. Return AI response + updated subscription status
```

#### GET /api/subscription/status
```typescript
Headers:
{
  Authorization: "Bearer <jwt_token>"
}

Response:
{
  plan: 'trial' | 'paid' | 'expired',
  tokenCreditsRemaining: number,  // Only for trial
  totalTokensUsed: number,
  totalCostUsd: number,
  subscriptionStatus?: 'active' | 'canceled' | 'past_due',
  subscriptionPeriodEnd?: string,
  trialStartedAt: string
}

Flow:
1. Authenticate user from JWT
2. Query subscription by user_id
3. Return subscription data
```

#### POST /api/subscription/create-checkout
```typescript
Headers:
{
  Authorization: "Bearer <jwt_token>"
}

Response:
{
  checkoutUrl: string  // Stripe checkout session URL
}

Flow:
1. Authenticate user from JWT
2. Get/create Stripe customer:
   - If stripe_customer_id exists, use it
   - Else create customer with user email
3. Create Stripe checkout session:
   - Price: $5-10/month
   - Success URL: extension://success
   - Cancel URL: extension://cancel
   - Customer email prefilled
   - Metadata: userId
4. Return checkout URL
```

---

### Webhook Endpoint

#### POST /webhooks/stripe
```typescript
Headers:
{
  Stripe-Signature: string  // Verify webhook authenticity
}

Body: (Stripe webhook event)

Flow:
1. Verify Stripe webhook signature
2. Handle event types:

   checkout.session.completed:
     - Extract customer_id, subscription_id from event
     - Find user by stripe_customer_id
     - Update subscription:
       - plan = 'paid'
       - subscription_status = 'active'
       - stripe_subscription_id = event.subscription
       - subscription_period_end = event.period_end

   customer.subscription.updated:
     - Find user by stripe_subscription_id
     - Update subscription_status and period_end

   customer.subscription.deleted:
     - Find user by stripe_subscription_id
     - Set plan = 'expired', subscription_status = 'canceled'

   invoice.payment_failed:
     - Find user by stripe_subscription_id
     - Set subscription_status = 'past_due'

3. Return 200 OK (Stripe retries on failure)
```

---

## Payment Flow

### Step-by-Step User Journey

```
┌─────────────────────────────────────────────────────────────┐
│ 1. User Exhausts $1.00 Trial Credits                        │
├─────────────────────────────────────────────────────────────┤
│ Extension calls: POST /api/ai/chat                          │
│ Response: {                                                  │
│   subscription: {                                            │
│     plan: 'expired',                                         │
│     tokenCreditsRemaining: 0.000000                          │
│   }                                                           │
│ }                                                            │
│ Extension shows paywall modal                               │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ 2. User Clicks "Upgrade to Paid Plan"                       │
├─────────────────────────────────────────────────────────────┤
│ Extension calls: POST /api/subscription/create-checkout     │
│ Server creates Stripe checkout session                      │
│ Response: { checkoutUrl: "https://checkout.stripe.com/..." }│
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ 3. Open Checkout in New Tab                                 │
├─────────────────────────────────────────────────────────────┤
│ chrome.tabs.create({ url: checkoutUrl })                    │
│ User completes payment in Stripe-hosted checkout            │
│ Stripe redirects to success/cancel URL                      │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ 4. Extension Polls for Status                               │
├─────────────────────────────────────────────────────────────┤
│ Poll every 5 seconds: GET /api/subscription/status          │
│                                                              │
│ const pollInterval = setInterval(async () => {              │
│   const status = await fetch('/api/subscription/status');   │
│   if (status.plan === 'paid') {                             │
│     clearInterval(pollInterval);                            │
│     showSuccessMessage();                                   │
│     enableChatInput();                                      │
│   }                                                          │
│ }, 5000);                                                    │
│                                                              │
│ Timeout after 5 minutes (user probably abandoned)           │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ 5. Stripe Sends Webhook (Parallel to Polling)               │
├─────────────────────────────────────────────────────────────┤
│ POST /webhooks/stripe                                        │
│ Event: checkout.session.completed                           │
│                                                              │
│ Server updates database:                                    │
│   UPDATE subscriptions                                      │
│   SET plan = 'paid',                                        │
│       subscription_status = 'active',                       │
│       stripe_subscription_id = '...'                        │
│   WHERE user_id = ...                                       │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ 6. Extension Detects Plan Change                            │
├─────────────────────────────────────────────────────────────┤
│ Next poll returns: { plan: 'paid' }                         │
│ Stop polling, show success, resume chat                     │
└─────────────────────────────────────────────────────────────┘
```

### Cancellation Flow
```
User cancels in Stripe customer portal
  ↓
Stripe sends webhook: customer.subscription.deleted
  ↓
Server updates: plan = 'expired', subscription_status = 'canceled'
  ↓
Next time user opens extension:
  GET /api/subscription/status
  → { plan: 'expired' }
  → Show "resubscribe" modal
```

---

## Implementation Plan

### Phase 1: Local Development Setup (1 day)

**1. Add PostgreSQL to docker-compose**
```bash
# Create docker-compose.dev.yml
cat > site/infra/docker-compose.dev.yml <<EOF
services:
  postgres:
    image: postgres:16
    ports:
      - "5432:5432"
    environment:
      POSTGRES_DB: shuvgeist_dev
      POSTGRES_USER: dev
      POSTGRES_PASSWORD: dev
    volumes:
      - postgres_dev_data:/var/lib/postgresql/data

volumes:
  postgres_dev_data:
EOF

# Update run.sh dev command
docker compose -f infra/docker-compose.dev.yml up -d postgres
```

**2. Install dependencies**
```bash
cd site
npm install drizzle-orm pg
npm install -D drizzle-kit @types/pg
```

**3. Setup Drizzle**
```typescript
// site/src/backend/db/schema.ts
// (copy schema from above)

// site/src/backend/db/client.ts
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ||
    'postgresql://dev:dev@localhost:5432/shuvgeist_dev'
});

export const db = drizzle(pool);

// site/drizzle.config.ts
import type { Config } from 'drizzle-kit';

export default {
  schema: './src/backend/db/schema.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ||
      'postgresql://dev:dev@localhost:5432/shuvgeist_dev'
  }
} satisfies Config;
```

**4. Generate and run migrations**
```bash
npx drizzle-kit generate
npx drizzle-kit migrate
```

---

### Phase 2: Auth Implementation (2 days)

**1. Password hashing utilities**
```typescript
// site/src/backend/auth/password.ts
import bcrypt from 'bcrypt';

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
```

**2. JWT utilities**
```typescript
// site/src/backend/auth/jwt.ts
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-prod';

export function generateToken(userId: string): string {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '30d' });
}

export function verifyToken(token: string): { userId: string } | null {
  try {
    return jwt.verify(token, JWT_SECRET) as { userId: string };
  } catch {
    return null;
  }
}
```

**3. Auth middleware**
```typescript
// site/src/backend/auth/middleware.ts
import { Request, Response, NextFunction } from 'express';
import { verifyToken } from './jwt.js';

export function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = auth.slice(7);
  const payload = verifyToken(token);

  if (!payload) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  // Attach userId to request
  (req as any).userId = payload.userId;
  next();
}
```

**4. Email service (verification codes)**
```typescript
// site/src/backend/email/service.ts
import nodemailer from 'nodemailer';

// Use SMTP service (Sendgrid, Mailgun, AWS SES, etc.)
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

export async function sendVerificationEmail(
  email: string,
  code: string
): Promise<void> {
  await transporter.sendMail({
    from: 'noreply@geist.shuv.ai',
    to: email,
    subject: 'Verify your Shuvgeist account',
    text: `Your verification code is: ${code}\n\nThis code expires in 15 minutes.`,
    html: `
      <h1>Welcome to Shuvgeist!</h1>
      <p>Your verification code is:</p>
      <h2>${code}</h2>
      <p>This code expires in 15 minutes.</p>
    `
  });
}

export function generateVerificationCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}
```

**5. Auth handlers**
```typescript
// site/src/backend/handlers/auth.ts
// Implement signup, verify, login, resend-verification
// (Use schema from API Endpoints section above)
```

---

### Phase 3: AI Proxy Implementation (2 days)

**1. Install Anthropic SDK**
```bash
npm install @anthropic-ai/sdk
```

**2. Token pricing module**
```typescript
// site/src/backend/ai/pricing.ts
export const MODEL_PRICING = {
  'claude-3-haiku-20240307': {
    inputPer1M: 0.25,
    outputPer1M: 1.25,
  },
} as const;

export function calculateCost(
  model: string,
  promptTokens: number,
  completionTokens: number
): number {
  const pricing = MODEL_PRICING[model];
  if (!pricing) throw new Error(`Unknown model: ${model}`);

  const inputCost = (promptTokens / 1_000_000) * pricing.inputPer1M;
  const outputCost = (completionTokens / 1_000_000) * pricing.outputPer1M;

  return inputCost + outputCost;
}
```

**3. AI proxy handler**
```typescript
// site/src/backend/handlers/ai.ts
import Anthropic from '@anthropic-ai/sdk';
import { db } from '../db/client.js';
import { subscriptions } from '../db/schema.js';
import { eq, sql } from 'drizzle-orm';
import { calculateCost } from '../ai/pricing.js';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

export async function handleAiChat(req: any, res: any) {
  const userId = req.userId;  // From auth middleware
  const { messages, model = 'claude-3-haiku-20240307' } = req.body;

  // Get subscription
  const [subscription] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId));

  // Check plan status
  if (subscription.plan === 'expired') {
    return res.status(402).json({ error: 'Trial credits exhausted' });
  }

  if (subscription.plan === 'trial' && subscription.tokenCreditsRemaining <= 0) {
    return res.status(402).json({ error: 'Insufficient credits' });
  }

  // Forward to Anthropic
  const response = await anthropic.messages.create({
    model,
    messages,
    max_tokens: 4096
  });

  // Calculate cost
  const cost = calculateCost(
    model,
    response.usage.input_tokens,
    response.usage.output_tokens
  );

  // Deduct credits (atomic) if trial
  if (subscription.plan === 'trial') {
    const [updated] = await db
      .update(subscriptions)
      .set({
        tokenCreditsRemaining: sql`token_credits_remaining - ${cost}`,
        totalTokensUsed: sql`total_tokens_used + ${response.usage.input_tokens + response.usage.output_tokens}`,
        totalCostUsd: sql`total_cost_usd + ${cost}`,
        plan: sql`CASE WHEN token_credits_remaining - ${cost} <= 0 THEN 'expired' ELSE plan END`,
        updatedAt: new Date()
      })
      .where(eq(subscriptions.userId, userId))
      .returning();

    return res.json({
      response: {
        id: response.id,
        content: response.content[0].text,
        model: response.model,
        usage: {
          promptTokens: response.usage.input_tokens,
          completionTokens: response.usage.output_tokens,
          totalTokens: response.usage.input_tokens + response.usage.output_tokens
        }
      },
      subscription: {
        tokenCreditsRemaining: Number(updated.tokenCreditsRemaining),
        totalTokensUsed: updated.totalTokensUsed,
        plan: updated.plan
      }
    });
  }

  // Paid users: just return response
  return res.json({
    response: {
      id: response.id,
      content: response.content[0].text,
      model: response.model,
      usage: {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens
      }
    },
    subscription: {
      plan: subscription.plan
    }
  });
}
```

**4. Rate limiting**
```bash
npm install express-rate-limit
```

```typescript
// site/src/backend/middleware/rate-limit.ts
import rateLimit from 'express-rate-limit';

export const aiProxyLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  keyGenerator: (req: any) => req.userId,
  handler: (req, res) => {
    res.status(429).json({ error: 'Too many requests' });
  }
});
```

---

### Phase 4: Subscription & Payments (2 days)

**1. Stripe setup**
```bash
npm install stripe
```

**2. Stripe client**
```typescript
// site/src/backend/payments/stripe.ts
import Stripe from 'stripe';

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-11-20.acacia'
});

export async function createCheckoutSession(
  userId: string,
  email: string,
  customerId?: string
): Promise<string> {
  // Create customer if doesn't exist
  if (!customerId) {
    const customer = await stripe.customers.create({ email });
    customerId = customer.id;
  }

  // Create checkout session
  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    line_items: [{
      price: process.env.STRIPE_PRICE_ID!, // Create in Stripe dashboard
      quantity: 1
    }],
    success_url: 'https://geist.shuv.ai/success',
    cancel_url: 'https://geist.shuv.ai/cancel',
    metadata: { userId }
  });

  return session.url!;
}
```

**3. Webhook handler**
```typescript
// site/src/backend/payments/webhook.ts
import { stripe } from './stripe.js';
import { db } from '../db/client.js';
import { subscriptions } from '../db/schema.js';
import { eq } from 'drizzle-orm';

export async function handleStripeWebhook(
  signature: string,
  body: Buffer
): Promise<void> {
  const event = stripe.webhooks.constructEvent(
    body,
    signature,
    process.env.STRIPE_WEBHOOK_SECRET!
  );

  switch (event.type) {
    case 'checkout.session.completed':
      const session = event.data.object;
      await db.update(subscriptions)
        .set({
          plan: 'paid',
          subscriptionStatus: 'active',
          stripeCustomerId: session.customer as string,
          stripeSubscriptionId: session.subscription as string,
          subscriptionPeriodEnd: new Date(session.expires_at * 1000),
          updatedAt: new Date()
        })
        .where(eq(subscriptions.stripeCustomerId, session.customer as string));
      break;

    case 'customer.subscription.deleted':
      const subscription = event.data.object;
      await db.update(subscriptions)
        .set({
          plan: 'expired',
          subscriptionStatus: 'canceled',
          updatedAt: new Date()
        })
        .where(eq(subscriptions.stripeSubscriptionId, subscription.id));
      break;

    // Handle other events...
  }
}
```

**4. Subscription handlers**
```typescript
// site/src/backend/handlers/subscription.ts
// Implement /subscription/status, /subscription/create-checkout
// (Use schema from API Endpoints section above)
```

---

### Phase 5: Production Deployment (1 day)

**1. Update production docker-compose.yml**
```yaml
# site/infra/docker-compose.yml
services:
  postgres:
    image: postgres:16
    restart: unless-stopped
    environment:
      POSTGRES_DB: shuvgeist
      POSTGRES_USER: shuvgeist
      POSTGRES_PASSWORD_FILE: /run/secrets/db_password
    volumes:
      - postgres_data:/var/lib/postgresql/data
    secrets:
      - db_password
    networks:
      - internal

  web:
    # ... existing config

  backend:
    # ... existing config
    environment:
      - DATABASE_URL=postgresql://shuvgeist:${DB_PASSWORD}@postgres:5432/shuvgeist
      - JWT_SECRET_FILE=/run/secrets/jwt_secret
      - ANTHROPIC_API_KEY_FILE=/run/secrets/anthropic_api_key
      - STRIPE_SECRET_KEY_FILE=/run/secrets/stripe_secret
      - STRIPE_WEBHOOK_SECRET_FILE=/run/secrets/stripe_webhook
    secrets:
      - jwt_secret
      - anthropic_api_key
      - stripe_secret
      - stripe_webhook

secrets:
  db_password:
    file: ./secrets/db_password.txt
  jwt_secret:
    file: ./secrets/jwt_secret.txt
  anthropic_api_key:
    file: ./secrets/anthropic_api_key.txt
  stripe_secret:
    file: ./secrets/stripe_secret.txt
  stripe_webhook:
    file: ./secrets/stripe_webhook.txt

volumes:
  postgres_data:
```

**2. Create secrets on server**
```bash
ssh slayer.marioslab.io

cd /home/shuv1337/geist.shuv.ai/infra
mkdir -p secrets

# Generate secure passwords
openssl rand -base64 32 > secrets/db_password.txt
openssl rand -base64 64 > secrets/jwt_secret.txt

# Add API keys
echo "sk-ant-..." > secrets/anthropic_api_key.txt  # From Anthropic Console
echo "sk_live_..." > secrets/stripe_secret.txt     # From Stripe dashboard
echo "whsec_..." > secrets/stripe_webhook.txt      # From Stripe webhook config

chmod 600 secrets/*
```

**3. Configure Stripe webhook**
```bash
# In Stripe dashboard:
# 1. Go to Developers → Webhooks
# 2. Add endpoint: https://geist.shuv.ai/webhooks/stripe
# 3. Select events:
#    - checkout.session.completed
#    - customer.subscription.updated
#    - customer.subscription.deleted
#    - invoice.payment_failed
# 4. Copy webhook signing secret to secrets/stripe_webhook.txt
```

**4. Deploy**
```bash
# From local machine
cd site
./run.sh deploy

# On server, migrations run automatically on first start
# Or manually:
ssh slayer.marioslab.io
cd /home/shuv1337/geist.shuv.ai
docker compose -f infra/docker-compose.yml exec backend \
  npx drizzle-kit migrate
```

**5. Setup automated backups**
```bash
# On slayer.marioslab.io
# Create backup script
cat > /home/shuv1337/geist.shuv.ai/backup.sh <<'EOF'
#!/bin/bash
BACKUP_DIR=/home/shuv1337/backups/shuvgeist
DATE=$(date +%Y%m%d_%H%M%S)

mkdir -p $BACKUP_DIR

# Backup PostgreSQL
docker compose -f /home/shuv1337/geist.shuv.ai/infra/docker-compose.yml \
  exec -T postgres pg_dump -U shuvgeist shuvgeist \
  | gzip > $BACKUP_DIR/db_$DATE.sql.gz

# Keep last 30 days
find $BACKUP_DIR -type f -mtime +30 -delete
EOF

chmod +x /home/shuv1337/geist.shuv.ai/backup.sh

# Add to crontab (daily at 3am)
crontab -e
# Add: 0 3 * * * /home/shuv1337/geist.shuv.ai/backup.sh
```

---

### Phase 6: Extension Integration (2 days)

**1. Add auth state to extension**
```typescript
// src/storage/auth.ts
import { Store } from './store.js';

export interface AuthState {
  token: string | null;
  userId: string | null;
  email: string | null;
}

export const authStore = new Store<AuthState>('auth', {
  token: null,
  userId: null,
  email: null
});
```

**2. API client**
```typescript
// src/api/client.ts
const API_BASE = 'https://geist.shuv.ai/api';

export class ApiClient {
  private token: string | null = null;

  setToken(token: string) {
    this.token = token;
  }

  private async request(path: string, options: RequestInit = {}) {
    const headers = new Headers(options.headers);

    if (this.token) {
      headers.set('Authorization', `Bearer ${this.token}`);
    }

    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers
    });

    if (!response.ok) {
      throw new Error(await response.text());
    }

    return response.json();
  }

  // Auth methods
  async signup(email: string, password: string) {
    return this.request('/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
  }

  async verify(email: string, code: string) {
    return this.request('/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code })
    });
  }

  async login(email: string, password: string) {
    return this.request('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
  }

  // AI methods
  async chat(messages: Array<{role: string, content: string}>) {
    return this.request('/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, model: 'claude-3-haiku-20240307' })
    });
  }

  // Subscription methods
  async getSubscriptionStatus() {
    return this.request('/subscription/status');
  }

  async createCheckout() {
    return this.request('/subscription/create-checkout', {
      method: 'POST'
    });
  }
}

export const api = new ApiClient();
```

**3. AI integration (replace existing AI provider calls)**
```typescript
// In src/sidepanel.ts or wherever AI requests are made:
import { api } from './api/client.js';

async function sendMessage(messages: Array<{role: string, content: string}>) {
  try {
    // Call backend AI proxy instead of direct Anthropic API
    const result = await api.chat(messages);

    // Check if trial expired
    if (result.subscription.plan === 'expired') {
      showPaywallDialog();
      return null;
    }

    // Update UI with remaining credits (for trial users)
    if (result.subscription.plan === 'trial') {
      updateCreditsDisplay(result.subscription.tokenCreditsRemaining);
    }

    return result.response.content;
  } catch (error) {
    if (error.message.includes('402')) {
      // Payment required
      showPaywallDialog();
      return null;
    }
    throw error;
  }
}
```

**4. Credits display component**
```typescript
// src/components/credits-display.ts
export function updateCreditsDisplay(creditsRemaining: number) {
  const percentage = (creditsRemaining / 1.0) * 100;
  const element = document.getElementById('trial-credits');

  if (element) {
    element.textContent = `Trial: $${creditsRemaining.toFixed(2)} remaining`;

    // Visual warning when low
    if (percentage < 20) {
      element.classList.add('low-credits');
    }
  }
}
```

**5. Paywall dialog**
```typescript
// src/dialogs/paywall-dialog.ts
export class PaywallDialog {
  static async show() {
    const result = await showDialog({
      title: 'Trial Credits Exhausted',
      message: `You've used your $1.00 trial credits.
                Upgrade to continue using Shuvgeist with your own API keys.`,
      buttons: [
        { label: 'Upgrade ($9/month)', value: 'upgrade' },
        { label: 'Not Now', value: 'cancel' }
      ]
    });

    if (result === 'upgrade') {
      await this.handleUpgrade();
    }
  }

  private static async handleUpgrade() {
    // Get checkout URL
    const { checkoutUrl } = await api.createCheckout();

    // Open in new tab
    chrome.tabs.create({ url: checkoutUrl });

    // Poll for status
    const pollInterval = setInterval(async () => {
      const status = await api.getSubscriptionStatus();

      if (status.plan === 'paid') {
        clearInterval(pollInterval);
        showSuccessToast('Subscription activated! 🎉');
        location.reload(); // Refresh UI
      }
    }, 5000);

    // Timeout after 5 minutes
    setTimeout(() => {
      clearInterval(pollInterval);
    }, 5 * 60 * 1000);
  }
}
```

---

## Monitoring & Maintenance

### Health Checks
```typescript
// site/src/backend/handlers/health.ts
export async function health() {
  // Check database connection
  const dbOk = await db.select().from(users).limit(1)
    .then(() => true)
    .catch(() => false);

  return {
    status: dbOk ? 'healthy' : 'unhealthy',
    database: dbOk ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString()
  };
}
```

### Monitoring Queries
```sql
-- Active subscriptions
SELECT plan, COUNT(*)
FROM subscriptions
GROUP BY plan;

-- Trial users with low credits (< $0.20 remaining)
SELECT u.email,
       s.token_credits_remaining,
       s.total_tokens_used,
       s.total_cost_usd,
       s.trial_started_at
FROM users u
JOIN subscriptions s ON u.id = s.user_id
WHERE s.plan = 'trial'
  AND s.token_credits_remaining < 0.20
ORDER BY s.token_credits_remaining ASC;

-- Trial usage statistics
SELECT
  AVG(total_cost_usd) as avg_trial_cost,
  AVG(total_tokens_used) as avg_tokens_used,
  MAX(total_cost_usd) as max_trial_cost,
  COUNT(*) as total_trials
FROM subscriptions
WHERE plan IN ('trial', 'expired');

-- Conversion rate
SELECT
  COUNT(CASE WHEN plan = 'paid' THEN 1 END) as paid_users,
  COUNT(CASE WHEN plan IN ('trial', 'expired') THEN 1 END) as trial_users,
  ROUND(
    COUNT(CASE WHEN plan = 'paid' THEN 1 END)::numeric /
    NULLIF(COUNT(*), 0) * 100,
    2
  ) as conversion_rate_pct
FROM subscriptions;

-- Revenue (active paid subscriptions)
SELECT COUNT(*) as paid_users,
       COUNT(*) * 9 as monthly_revenue_usd
FROM subscriptions
WHERE plan = 'paid' AND subscription_status = 'active';

-- Daily trial costs
SELECT
  DATE(trial_started_at) as date,
  COUNT(*) as new_trials,
  COUNT(*) * 1.00 as trial_cost_usd
FROM subscriptions
WHERE trial_started_at > NOW() - INTERVAL '30 days'
GROUP BY DATE(trial_started_at)
ORDER BY date DESC;
```

---

## Security Considerations

### Password Requirements
```typescript
function validatePassword(password: string): boolean {
  return password.length >= 8 &&
         /[A-Z]/.test(password) &&
         /[a-z]/.test(password) &&
         /[0-9]/.test(password);
}
```

### Rate Limiting
```typescript
// Already implemented in server.ts for /api/login
// Consider adding to other auth endpoints:
// - /auth/signup: 3 per hour per IP
// - /auth/verify: 5 per hour per email
// - /auth/resend-verification: 3 per hour per email
```

### Database Connection Pooling
```typescript
// site/src/backend/db/client.ts
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20, // Maximum connections
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});
```

### SQL Injection Prevention
```typescript
// Drizzle ORM automatically parameterizes queries
// Never use raw SQL with user input:

// ❌ BAD
db.execute(sql.raw(`SELECT * FROM users WHERE email = '${userEmail}'`));

// ✅ GOOD
db.select().from(users).where(eq(users.email, userEmail));
```

---

## Cost Analysis

### Current Infrastructure (slayer.marioslab.io)
```
Server Cost:     Already paid (existing server)
PostgreSQL:      $0 (runs on existing server)
Additional RAM:  ~500MB (negligible from 45GB available)
Additional CPU:  <1% of one core (negligible from 32 cores)

Total Cost:      $0/month
```

### External Services
```
Email (Required):
- Sendgrid:     $15/month (40k emails) ✅
- Mailgun:      $15/month (50k emails)
- AWS SES:      $0.10/1000 emails (~$1/month for 10k users)

Payments (Required):
- Stripe:       2.9% + $0.30 per transaction ✅ Most popular
- Paddle:       5% + $0.50 per transaction (better EU support)
- LemonSqueezy: 5% per transaction

Domain (Existing):
- geist.shuv.ai: Already registered

SSL Certificate:
- $0 (Caddy handles Let's Encrypt automatically)
```

### Break-Even Analysis

**Cost Per Trial User**:
```
Trial credit provided:   $1.00 (Anthropic API costs)
Email verification:      $0.001 (AWS SES)
---------------------------------
Total cost per trial:    $1.001

Assumption: 10% conversion rate (trial → paid)
Cost to acquire 1 paid user: $1.001 × 10 = $10.01
```

**Monthly Revenue Per Paid User**:
```
Assumptions:
- Subscription: $9/month
- Stripe fees: 2.9% + $0.30 = $0.56 per transaction
- Email: $0.10 per user/month (AWS SES)
- AI costs: $0 (users provide own API keys post-payment)

Revenue per user:    $9.00
Stripe fees:         -$0.56
Email costs:         -$0.10
---------------------------------
Net per user:        $8.34/month
```

**Payback Period & Profitability**:
```
Acquisition cost:     $10.01 (one-time)
Monthly profit:       $8.34

Payback period:       $10.01 / $8.34 = 1.2 months
Lifetime value (12mo): $8.34 × 12 = $100.08

Profit after 1 year:  $100.08 - $10.01 = $90.07 per user
```

**Break-Even with Fixed Costs**:
```
Fixed costs:         $15/month (SendGrid email service)
Monthly profit:      $8.34 per paid user

Break-even:          2 paid users ($16.68/month > $15)

With 100 paid users:  $834/month - $15 = $819/month profit
With 1000 paid users: $8,340/month - $15 = $8,325/month profit
```

**Trial User Cost Scenarios**:
```
Scenario 1: 1,000 trials/month, 10% conversion
- Trial costs: 1,000 × $1.00 = $1,000
- Paid users: 100
- Monthly revenue: 100 × $8.34 = $834
- Net: $834 - $1,000 = -$166 (loss in first month)
- Month 2+ (assuming no new trials): $834/month profit
- Break-even: Month 1.2

Scenario 2: 10,000 trials/month, 10% conversion
- Trial costs: 10,000 × $1.00 = $10,000
- Paid users: 1,000
- Monthly revenue: 1,000 × $8.34 = $8,340
- Net: $8,340 - $10,000 = -$1,660 (loss in first month)
- Month 2+: $8,340/month profit
- Break-even: Month 1.2

Key insight: Trial costs are one-time per user, subscription revenue is recurring.
After payback period, each user generates $8.34/month profit indefinitely.
```

---

## Risk Assessment

### Technical Risks

**1. Database Corruption**
- Risk: Medium
- Impact: Critical
- Mitigation: Daily automated backups + weekly manual verification

**2. Payment Webhook Failures**
- Risk: Low (Stripe retries)
- Impact: High (lost revenue)
- Mitigation: Webhook logging + manual reconciliation script

**3. Race Conditions in Credit Deduction**
- Risk: Low (PostgreSQL ACID guarantees)
- Impact: Medium (incorrect balances, users get free credits)
- Mitigation: Use atomic SQL updates with CHECK constraint (already in design)

**4. AI Proxy API Key Exposure**
- Risk: Medium
- Impact: Critical (API key theft = unlimited usage on your account)
- Mitigation:
  - Store keys in Docker secrets (not environment variables)
  - Rate limiting per user (100 req/min)
  - Monitor Anthropic usage dashboard for anomalies
  - Rotate keys if compromised

**5. Trial Credit Abuse**
- Risk: High (users create multiple accounts for free credits)
- Impact: Medium ($1 per abuser, but can add up)
- Mitigation:
  - Email verification required
  - Rate limit signups per IP (3 per hour)
  - Monitor for patterns (same payment method, device fingerprinting)
  - Consider captcha for signup

**6. Anthropic API Downtime**
- Risk: Low (Anthropic SLA: 99.9%)
- Impact: High (trial users can't use extension at all)
- Mitigation:
  - Graceful error handling in extension
  - Show clear error message
  - Don't deduct credits on failed requests
  - Consider fallback to direct BYOK mode

**7. Server Downtime**
- Risk: Low (97+ day uptime)
- Impact: High (can't verify subscriptions OR proxy AI requests)
- Mitigation: Health checks + monitoring + redundancy planning

### Business Risks

**1. Subscription Abandonment**
- Risk: High (payment flow requires leaving extension)
- Impact: High (lost conversions)
- Mitigation:
  - Clear messaging in paywall
  - Email reminders for abandoned checkouts
  - Simple re-entry flow
  - Show value prop: "After payment, use your own API keys (no usage limits)"

**2. Trial Costs Exceeding Revenue**
- Risk: Medium (if conversion rate is very low)
- Impact: High (negative cash flow)
- Mitigation:
  - Monitor conversion rate closely
  - Target: 10% conversion minimum
  - If <5% conversion after 1000 trials, re-evaluate trial amount or model
  - Payback period is only 1.2 months, so sustainable with normal churn

**3. High Trial Usage (Power Users)**
- Risk: Medium (users maximize their $1 credit)
- Impact: Low ($1 is capped cost per user)
- Mitigation:
  - Monitor for outlier usage patterns
  - Rate limiting prevents abuse (100 req/min)
  - Max $1 loss per trial user regardless of usage

---

## Next Steps

1. **Review this document** with another LLM or technical reviewer
2. **Decide on payment provider** (Stripe recommended)
3. **Choose email service** (AWS SES for cost, SendGrid for simplicity)
4. **Set up development environment** (Phase 1)
5. **Implement auth system** (Phase 2)
6. **Integrate Stripe** (Phase 3)
7. **Deploy to production** (Phase 4)
8. **Update extension** (Phase 5)
9. **Test end-to-end flow** with test mode Stripe
10. **Launch** 🚀

---

## Questions for Review

### Trial & Credits
1. **Trial Amount:** Is $1.00 the right amount? (Provides ~300-2,500 requests with Haiku)
2. **Trial Abuse:** How to prevent users from creating multiple accounts to get more free credits?
   - Email verification already in place
   - Consider: IP-based rate limiting on signups
   - Consider: Device fingerprinting (more complex)
3. **Credit Display:** Show remaining credits in extension UI? Just balance or usage history?
4. **Grace Period:** Allow users to finish current session after credits exhausted? (Currently yes if session started)

### Payments & Pricing
5. **Payment Provider:** Stripe (most popular) vs Paddle (EU-friendly, higher fees)?
6. **Pricing:** $5-10/month - what's the target price?
   - Note: After payment, users use their own API keys (BYOK) - no ongoing AI costs
7. **Subscription Model:** Monthly only, or also offer annual discount?

### Technical
8. **Email Service:** AWS SES (cheapest) vs SendGrid (simpler) vs Mailgun?
9. **AI Model Choice:** Haiku only for trial, or allow users to choose? (Sonnet is 12x more expensive)
10. **Rate Limiting:** 100 requests/minute per user - is this sufficient?
11. **Max Token Limits:** 4096 max_tokens per request - adjust this?

### Legal & Privacy
12. **Data Retention:** Keep expired trial users in database? For how long?
13. **GDPR:** Need user data export/deletion endpoints? (Probably yes for EU)
14. **Terms of Service:** Trial users agree that Shuvgeist proxies their requests through Anthropic?
15. **Privacy Policy:** Clarify that message content is never stored, only aggregate token counts

### Business
16. **Conversion Strategy:** What happens when trial expires?
   - Current: Hard paywall, can't create new sessions
   - Alternative: Allow BYOK immediately without payment?
17. **Trial Reset:** Can users who expired trial get more credits? (Probably no)
18. **Refunds:** Stripe subscription refund policy?

---

**End of Document**
