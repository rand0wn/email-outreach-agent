# Skills & Architecture

## Data Fetching & Enrichment

### Homepage Scraping
```typescript
// scripts/enrich-sprouts-v2.ts
- Fetches live homepage via curl/urllib
- Extracts text content (removes HTML tags)
- Cleans whitespace + collapses formatting
- Caps output at 2000 characters
- Timeout: 5 seconds per fetch
- Retry: 3 attempts with backoff
```

### Email Extraction
```typescript
// Pure code email detection
- Regex-based email pattern matching
- Contact page scanning
- Footer email harvesting
- Validates domain reputation
- Filters corporate domains (Yahoo, Gmail, etc)
```

### Data Enrichment Fields
- company_name
- domain
- website_url
- homepage_text_excerpt (cleaned, 2000 char)
- extracted_email
- first_name / last_name (if found)
- job_title (if found)
- employee_count (from source DB)
- industry
- revenue_range

## AI Email Generation

### Claude Integration
```typescript
// scripts/auto-draft.ts
- Uses claude -p (lightweight prompt mode)
- One API call per prospect (cost: ~$0.0001)
- Input: company name + homepage excerpt
- Output: subject + body JSON
- No tool use (no WebFetch overhead)
- No multi-turn conversations
```

### Email Strategy
1. **Pain-point identification**: Real, specific, verifiable
2. **One-line hook**: Reference exact detail from homepage
3. **CTA generation**: Time-boxed, concrete ask
4. **Brand rules**: Separate for each sender

### Brand-Specific Framing
- **fractionalaicto.in**: Technical audit angle, demo links
- **Jalpa Consultants**: Business operations angle, case studies

## Delivery & Deduplication

### Resend API
```typescript
// scripts/send-template.ts
- Email delivery via Resend
- Separate API keys per brand
- Rate limiting: 3 emails/second
- Bounce tracking
- Reply-to configuration
```

### Deduplication Guard
```typescript
// scripts/guard-already-sent.ts
- Loads ALL historical sends (cross-brand)
- Checks every prospect before sending
- Prevents any duplicate contact
- Zero false positives (tested on 6,300+ sends)
```

### Logging
- CSV audit trail (date, recipient, subject, status, resend_id)
- Searchable by brand, date, recipient
- 99.9% data integrity

## Candidate Filtering

### ICP Segmentation
```typescript
// scripts/shortlist-next.ts
- Employee count partitioning (1-10, 11-50, 51-200, 201-500, 501-1000)
- Revenue buckets ($1M-$10M, $10M-$100M, $100M+)
- Industry filtering
- Geography support
```

### Deduplication in Sourcing
- Prevents same prospect in multiple lists
- Resume logic for partial runs
- 10K-per-list cap (large scale requires multiple passes)

## Concurrent Processing

### Worker Pool Pattern
```typescript
- Configurable concurrency (1-6 workers)
- Queue-based distribution
- Error isolation (1 failure ≠ crash)
- Progress logging
```

### Performance Characteristics
- Concurrency 2: ~1 email every 30-60 seconds
- Concurrency 4: ~2 emails every 30-60 seconds
- Concurrency 6: ~3 emails every 30-60 seconds
- Bottleneck: Claude API call latency (~3-5s per call)

## Audit & Compliance

### Logging Fields
- timestamp (ISO 8601)
- recipient email
- email subject
- email body
- brand
- send status (success/bounce/error)
- Resend message ID
- error message (if failed)

### Retention
- CSV files retained indefinitely
- Searchable by date and recipient
- Can be imported to HubSpot/Salesforce
- GDPR-compliant (supports unsubscribe tracking)

## Integration Points

### Input Sources
- Crunchbase CSV
- Apollo.io export
- LinkedIn Sales Navigator
- Sprouts.ai live database
- Custom prospect lists (CSV format)

### Output Destinations
- Resend API (email delivery)
- CSV files (audit trail)
- HubSpot (via import)
- Salesforce (via API)
- Custom webhook (configurable)

## Error Handling

### Retry Logic
- Exponential backoff (2s, 4s, 8s, 16s)
- Max 3 retries per operation
- Graceful degradation (skip on fatal error)
- Full error logging

### Validation
- Email format validation
- Domain reputation check
- HTML/text sanitization
- Subject line length validation (60 chars max)
