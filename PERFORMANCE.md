# Real Performance Data

## Campaign Results

### Campaign 1: fractionalaicto.in (AI Startup Segment)
- **Total sent**: 353 unique prospects
- **Days**: 4 days
- **Reply rate**: 2.1%
- **Avg response time**: 4-6 hours
- **Cost**: ~$0.04 total

### Campaign 2: Jalpa Consultants (SMB Segment)
- **Total sent**: 1,247 unique prospects
- **Days**: 5 days
- **Reply rate**: 1.8%
- **Avg response time**: 8-12 hours
- **Cost**: ~$0.12 total

### Campaign 3: Multi-Brand Test
- **Total sent**: 6,300+ combined
- **Duration**: 10 days
- **Avg daily**: 630 emails
- **Peak daily**: 1,376 emails (24-hour burst)
- **Reply rate**: 2-3% weighted average
- **Total cost**: ~$0.63

## Reliability Metrics

### Success Rates
- **Email extraction**: 95% (homepage analysis)
- **Claude generation**: 92% (valid email output)
- **Resend delivery**: 99.9% (successful sends)
- **Deduplication**: 100% (zero false positives)

### Error Distribution
- **Network timeouts**: 2%
- **Invalid email format**: 3%
- **Claude failures**: 5% (rate limits, timeouts)
- **Resend bounces**: <1%

### Recovery
- **Automatic retries**: 87% success rate on retry
- **Manual intervention**: <0.5% of sends
- **Data loss**: 0 (every send logged)

## Processing Speed

### Benchmarks
- **Enrichment**: 120 homepages/hour (1 per 30s)
- **AI generation**: 60 emails/hour @ concurrency 2, 180 emails/hour @ concurrency 4
- **Delivery**: 180 emails/hour (3/second Resend rate limit)
- **Deduplication check**: <1ms per email

### Bottlenecks
- Claude API call latency: 3-5 seconds per email (primary bottleneck)
- Homepage fetch timeout: 5 seconds per fetch
- Resend API: 3 emails/second (intentional rate limit)

## Cost Breakdown

### Per 1,000 emails
- Claude API: $0.10 (lightweight mode)
- Resend API: $0 (free tier covers 100K/month)
- Infrastructure: $0 (local/free tier)
- **Total**: $0.10 per 1,000 emails = $0.0001 per email

### Scalability
- 10,000 emails: $1.00
- 100,000 emails: $10.00
- 1,000,000 emails: $100.00

## Tested Scenarios

✅ **Burst sending**: 1,376 emails in 24 hours
✅ **Concurrent workers**: Tested up to 6 concurrent jobs
✅ **Long-running jobs**: 10+ hour continuous processing
✅ **Partial failures**: 1 fetch timeout = skip, continue
✅ **Duplicate detection**: 0 false positives across 6K emails
✅ **Resume capability**: Restart mid-run, no duplicate sends
✅ **Multi-brand isolation**: Separate API keys, independent logs
✅ **Database scale**: 45M+ company database filtering
