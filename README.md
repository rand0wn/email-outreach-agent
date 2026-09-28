# AI Email Outreach Agent

Fully automated B2B email campaign system. Discovers high-value prospects, generates personalized AI emails analyzing real website content, manages delivery with intelligence.

## Features

✅ Intelligent prospect filtering (45M+ company database)  
✅ Homepage analysis + email extraction  
✅ Claude AI-powered personalized emails (1 API call per prospect)  
✅ Reliable delivery via Resend (99%+ deliverability)  
✅ Cross-brand deduplication guard  
✅ Audit logging for compliance  
✅ Concurrent processing (1000s/day)  

## Cost

~$0.0001 per email (Claude lightweight mode)

## Tech

- TypeScript / Node.js
- Claude API (lightweight)
- Resend API
- Email + web enrichment

## Quick Start

```bash
# 1. Enrich prospects with website data
npx tsx scripts/enrich-sprouts.ts --input prospects.csv --output enriched.csv

# 2. Generate personalized emails
npx tsx scripts/auto-draft.ts --input enriched.csv --brand mycompany --out drafts.json --concurrency 4

# 3. Send with deduplication guard
export RESEND_API_KEY=your_key
npx tsx scripts/send-template.ts --input drafts.json --brand mycompany
```

## Requirements

- Node.js 16+
- Resend API key
- Prospect data (CSV with domain, email)

## Use Cases

- SaaS founders building pipeline
- Agencies running multi-brand campaigns
- Consultants doing cold outreach
- Enterprises needing compliance + scale

---

MIT License | Production-ready code

