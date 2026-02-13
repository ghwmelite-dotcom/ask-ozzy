# Deployment Guide

## Prerequisites
- Node.js 18+ installed
- npm installed
- Wrangler CLI: `npm install -g wrangler`
- Cloudflare account (sign up at cloudflare.com)
- Git

## Production Deployment Checklist

### 1. Cloudflare Account Setup
```bash
# Login to Cloudflare
npx wrangler login
```

### 2. Create Resources
```bash
# Create D1 database
npx wrangler d1 create ghana-civil-ai-db
# Note the database_id from output

# Create KV namespace
npx wrangler kv namespace create SESSIONS
# Note the id from output

# Create Vectorize index
npx wrangler vectorize create askozzy-knowledge --dimensions=768 --metric=cosine
```

### 3. Update Configuration
Update `wrangler.jsonc` with the IDs from step 2:
```jsonc
{
  "name": "askozzy",
  "main": "src/index.ts",
  "compatibility_date": "2025-12-01",
  "assets": { "directory": "./public" },
  "ai": { "binding": "AI" },
  "d1_databases": [{
    "binding": "DB",
    "database_name": "ghana-civil-ai-db",
    "database_id": "<your-database-id>"
  }],
  "kv_namespaces": [{
    "binding": "SESSIONS",
    "id": "<your-kv-namespace-id>"
  }],
  "vectorize": [{
    "binding": "VECTORIZE",
    "index_name": "askozzy-knowledge"
  }]
}
```

### 4. Database Migration
Run all 9 schema files in order:
```bash
npx wrangler d1 execute ghana-civil-ai-db --remote --file=schema.sql
npx wrangler d1 execute ghana-civil-ai-db --remote --file=schema-kb.sql
npx wrangler d1 execute ghana-civil-ai-db --remote --file=schema-phase1.sql
npx wrangler d1 execute ghana-civil-ai-db --remote --file=schema-phase2.sql
npx wrangler d1 execute ghana-civil-ai-db --remote --file=schema-phase4.sql
npx wrangler d1 execute ghana-civil-ai-db --remote --file=schema-phase5.sql
npx wrangler d1 execute ghana-civil-ai-db --remote --file=schema-phase5b.sql
npx wrangler d1 execute ghana-civil-ai-db --remote --file=schema-ussd.sql
npx wrangler d1 execute ghana-civil-ai-db --remote --file=schema-affiliate.sql
```

Note: schema-phase1.sql may show errors for ALTER TABLE if columns already exist — this is safe to ignore.

### 5. Set Secrets
```bash
npx wrangler secret put JWT_SECRET
# Enter a strong random string

npx wrangler secret put VAPID_PUBLIC_KEY
# Enter your VAPID public key (generate with web-push library)
```

### 6. Deploy
```bash
npx wrangler deploy
```

### 7. Bootstrap Super Admin
```bash
curl -X POST https://askozzy.ghwmelite.workers.dev/api/admin/bootstrap \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@gov.gh","fullName":"Super Admin","bootstrapSecret":"<your-JWT_SECRET>"}'
```
Save the returned access code.

### 8. Seed Default Agents
Log into admin portal → AI Agents tab → Click "Seed Default Agents"

## Domain Setup

### Custom Domain
1. Go to Cloudflare Dashboard → Workers & Pages → askozzy
2. Click "Custom Domains" tab
3. Add your domain (must be on Cloudflare DNS)
4. SSL certificate auto-provisioned

### Workers Routes
Alternative to custom domains:
1. In wrangler.jsonc add routes
2. Or configure via Cloudflare dashboard → Workers Routes

## Monitoring

### Real-time Logs
```bash
# Stream production logs
npx wrangler tail
# Filter by status
npx wrangler tail --status error
```

### Cloudflare Dashboard
- Workers → askozzy → Analytics
- Metrics: requests/sec, CPU time, errors, duration
- D1 → ghana-civil-ai-db → Metrics
- KV → SESSIONS → Analytics

### Health Check
```bash
# Quick health check
curl https://askozzy.ghwmelite.workers.dev/api/pricing
# Should return pricing tiers JSON
```

## Rollback Procedure
```bash
# List recent deployments
npx wrangler deployments list

# Rollback to previous version
npx wrangler rollback
```

## Backup & Disaster Recovery

### D1 Database Backup
```bash
# Export database
npx wrangler d1 export ghana-civil-ai-db --remote --output=backup.sql

# Restore from backup
npx wrangler d1 execute ghana-civil-ai-db --remote --file=backup.sql
```

### KV Data
- Sessions are ephemeral (7-day TTL) — no backup needed
- Session loss = users re-login (not data loss)

### Vectorize
- Re-index from D1 document_chunks table if needed
- Documents table has full content for re-processing

## Scaling Considerations

| Resource | Free Tier Limit | Paid Plan Limit |
|----------|----------------|-----------------|
| Workers requests | 100K/day | 10M+/month |
| D1 storage | 5 GB | 10 GB+ |
| D1 reads | 5M/day | 25B/month |
| D1 writes | 100K/day | 50M/month |
| KV reads | 100K/day | 10M/month |
| KV writes | 1K/day | 1M/month |
| Workers AI | Varies by model | Varies by model |
| Vectorize | 5 indexes, 200K vectors | More with paid |

### Optimization Tips
- D1: Add indexes for frequent queries (already done in schemas)
- KV: Session TTL prevents unbounded growth
- AI: Rate limiting prevents abuse
- Vectorize: Batch embeddings (5 per batch)
- Workers: Edge caching for static assets

## Security Hardening Checklist
- [ ] Set strong JWT_SECRET (32+ random chars)
- [ ] Generate proper VAPID keys
- [ ] Bootstrap admin with secure email
- [ ] Remove /api/admin/bootstrap after first admin created (or protect with secret)
- [ ] Review rate limit settings
- [ ] Enable Cloudflare WAF rules
- [ ] Set up DDoS protection (Cloudflare default)
- [ ] Monitor audit log regularly
- [ ] Review moderation flags weekly

## CI/CD Pipeline (GitHub Actions)

```yaml
name: Deploy AskOzzy
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '18'

      - run: npm install

      - name: Deploy to Cloudflare
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          command: deploy
```

### Setting Up
1. Create Cloudflare API token with Worker edit permissions
2. Add CLOUDFLARE_API_TOKEN to GitHub repo secrets
3. Push to main branch triggers automatic deployment

## Environment Variables Summary

| Variable | Type | Description |
|----------|------|-------------|
| JWT_SECRET | Secret | Token signing key |
| VAPID_PUBLIC_KEY | Secret | Push notification key |
| AI | Binding | Workers AI |
| DB | Binding | D1 database |
| SESSIONS | Binding | KV namespace |
| VECTORIZE | Binding | Vectorize index |
