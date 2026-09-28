/**
 * Fully-scripted drafting: everything except the actual email text is plain
 * deterministic code (no AI, no tokens). For the email text itself, this
 * shells out to `claude -p` ONCE PER CANDIDATE with the page excerpt already
 * embedded in the prompt -- no tool access, no WebFetch, no agent scaffolding,
 * no SKILL.md re-read per call. This is far cheaper than the Agent-tool
 * pattern (which re-reads the skill file, does its own WebFetch loop, and
 * carries full subagent overhead per chunk) while keeping the one part that
 * genuinely needs judgment -- writing a specific, non-templated pain point --
 * on a real model.
 *
 * Usage:
 *   npx tsx outreach/scripts/auto-draft.ts --input <sendable.csv> --brand fractionalaicto --angle standard --out <drafts.json> [--limit N] [--concurrency 3]
 *   npx tsx outreach/scripts/auto-draft.ts --input <sendable.csv> --brand jalpa --angle short --out <drafts.json>
 *
 * Angles: standard | short | demolink (fractionalaicto uses tools/ai-visibility-check link;
 * jalpa uses demos/missed-call-agent link)
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from "fs"
import { join } from "path"
import { parse } from "csv-parse/sync"
import { execFile } from "child_process"
import { promisify } from "util"

const execFileAsync = promisify(execFile)

function argStr(flag: string, fallback: string): string {
    const idx = process.argv.indexOf(flag)
    return idx === -1 ? fallback : process.argv[idx + 1] || fallback
}
function argNum(flag: string, fallback: number): number {
    const idx = process.argv.indexOf(flag)
    if (idx === -1) return fallback
    return Math.max(1, parseInt(process.argv[idx + 1] || String(fallback), 10) || fallback)
}

// ---------- Pure-code dedupe against every prior sent log (no AI) ----------
function loadSentSet(): Set<string> {
    const sent = new Set<string>()
    const dir = "outreach/logs"
    const files = existsSync(dir)
        ? readdirSync(dir).filter((f) => f.startsWith("outreach-log-") && f.endsWith(".csv"))
        : []
    for (const f of files) {
        const rows: Record<string, string>[] = parse(readFileSync(join(dir, f), "utf-8"), { columns: true, skip_empty_lines: true, relax_column_count: true })
        for (const r of rows) if (r.to) sent.add(r.to.trim().toLowerCase())
    }
    return sent
}

const MAJOR_HINTS = [
    "apple.com", "google.com", "microsoft.com", "amazon.com", "meta.com", "sprouts.ai",
]

function buildPrompt(row: Record<string, string>, brand: string, angle: string): string {
    const excerpt = (row.text_excerpt || "").slice(0, 1500)
    const name = row.account_name || row.domain
    const domain = row.domain

    const brandRules =
        brand === "jalpa"
            ? `You are writing on behalf of Jalpa Consultants (jalpa.co.in).
- 2026-09-19 strategy change: reply rate on the old pain+bridge+evidence structure was extremely low. Switch fully to the plain fractionalaicto.in house style: ONE specific, verifiable pain point actually visible on their site, stated plainly, then straight to the CTA. Do NOT propose a solution, do NOT describe what Jalpa would do about it, no product pitch, no third-party evidence, no case study name-drop -- just the observed flaw and the ask.
- Your hook MUST be the specific flaw you found in the page excerpt below -- e.g. no listed hours, no online booking/scheduling link, phone-only contact with no other channel, no reviews/testimonials shown, a stale year, thin "contact us" copy. Do not default to a generic "you probably miss calls" line if the excerpt doesn't actually support it.
- Sign off EXACTLY:
Jalpa Consultants
jalpa.co.in`
            : `You are writing on behalf of Abhishek Singh Kushwah, a Fractional AI CTO / Full-Stack AI Engineer, for fractionalaicto.in.
- Sign off EXACTLY:
Abhishek Singh Kushwah
Fractional AI CTO
fractionalaicto.in`

    const angleRules =
        angle === "short"
            ? "Length: 3-5 sentences TOTAL including the signature. No padding. State the one pain point in one sentence, then go straight to the CTA."
            : angle === "demolink"
            ? `Length: 5-7 sentences including signature. Include exactly ONE sentence linking a real live example: ${brand === "jalpa" ? "https://fractionalaicto.in/demos/missed-call-agent" : "https://fractionalaicto.in/tools/ai-visibility-check"} -- frame it as "here's a quick example" or similar, one sentence only.`
            : "Length: 5-8 sentences including signature. No padding, no 'I hope this finds you well.'"

    return `You are drafting ONE cold outreach email. Output ONLY a raw JSON object, nothing else -- no markdown fences, no commentary before or after.

Business: ${name} (${domain})
Page title: ${row.page_title || "(none)"}
Page text excerpt (from their live homepage, truncated):
"""
${excerpt || "(could not fetch page content)"}
"""

${brandRules}

STRATEGY (hard requirements):
- Find ONE absolute, specific, genuine pain point that is ACTUALLY VISIBLE in the page excerpt above -- do not invent anything not supported by the text. A "genuine pain point" includes things like: a literal placeholder value left in (e.g. "Client Name", "Lorem Ipsum", "Your Company", a repeated identical testimonial), a stale year/date, a vague/unverifiable claim with no named source, no team/about/founder info at all, no clear contact method beyond a generic inbox, thin/generic copy with no specifics about what they actually do. These ARE valid, sharp, usable hooks on their own -- a placeholder testimonial or an unverifiable stat is a real, pointable-at flaw, not something to skip over. Only respond with {"skip": true, "reason": "<short reason>"} if the excerpt is essentially EMPTY/unreadable, or this is unmistakably a large/famous/public company (household name, obviously huge scale) where a cold pitch would be absurd. When in doubt between drafting and skipping, draft -- skipping should be the exception, not the default.
- ACCURACY CHECK (2026-09-17 reply-audit finding: at least 2 of ~50 sent emails had a flawed premise -- one recipient didn't recognize the claim referenced, another pointed out the "gap" already didn't apply -- and both drew visible annoyance in the reply, worse than a merely mediocre hook). Before finalizing, re-read the exact sentence in the excerpt your hook is based on. If you are not fully confident the specific detail (the number, the claim, the missing element) is literally present in the excerpt text above, either pick a different, more certain hook from the excerpt or respond with {"skip": true, "reason": "no confidently verifiable hook"}. Never state a flaw you are inferring or guessing at.
- ${angleRules}
- End with a DIRECT, concrete, time-boxed ask for a next step (e.g. "worth a 10-minute call this week?", "can I send a 2-minute example?") -- not an open-ended "let me know if interested."
- No em dashes anywhere in the email.
- No pricing, cost, "free", or money mentions about the sender's own rates/services.
- Never mention AI, being an AI, or any AI tool by name.
- Lowercase, specific subject line (not a generic marketing subject).
- Vary tone/opening naturally -- do not use a stock opening phrase.
- Only use a first-name greeting if a real person's name is visible in the page excerpt; otherwise use a neutral greeting (no name).

Output format (exactly one of these two shapes, raw JSON only):
{"subject": "...", "body": "..."}
or
{"skip": true, "reason": "..."}`
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function draftOne(row: Record<string, string>, brand: string, angle: string, attempt = 1): Promise<{ subject: string; body: string } | null> {
    const prompt = buildPrompt(row, brand, angle)
    try {
        const { stdout } = await execFileAsync("claude", ["-p", prompt], {
            maxBuffer: 1024 * 1024,
            timeout: 60000,
        })
        const text = stdout.trim()
        const start = text.indexOf("{")
        const end = text.lastIndexOf("}")
        if (start === -1 || end === -1) return null
        const parsed = JSON.parse(text.slice(start, end + 1))
        if (parsed.skip) return null
        if (!parsed.subject || !parsed.body) return null
        // pure-code validation, no AI needed
        if (parsed.body.includes("—")) return null // em dash check
        const domain = row.domain.toLowerCase()
        if (MAJOR_HINTS.some((m) => domain === m || domain.endsWith(`.${m}`))) return null
        return { subject: String(parsed.subject).trim(), body: String(parsed.body).trim() }
    } catch (err: any) {
        const stderrMsg = err?.stderr ? String(err.stderr).slice(0, 300) : ""
        const isRateLimit = /rate_limit|429|session limit/i.test(stderrMsg) || /rate_limit|429|session limit/i.test(String(err?.message || ""))
        if (attempt < 3) {
            const backoffMs = isRateLimit ? 30000 * attempt : 3000 * attempt
            console.error(`  [retry ${attempt}/2] ${row.domain}: code=${err?.code} rateLimit=${isRateLimit}, backing off ${backoffMs}ms`)
            await sleep(backoffMs)
            return draftOne(row, brand, angle, attempt + 1)
        }
        console.error(`  [error, giving up] ${row.domain}: code=${err?.code} signal=${err?.signal} stderr=${stderrMsg}`)
        return null
    }
}

async function main() {
    const inputPath = argStr("--input", "")
    const brand = argStr("--brand", "fractionalaicto")
    const angle = argStr("--angle", "standard")
    const outPath = argStr("--out", "outreach/drafts/auto-draft-output.json")
    const limit = argNum("--limit", 200)
    const concurrency = argNum("--concurrency", 3)

    if (!inputPath) {
        console.error("--input <sendable.csv> required")
        process.exit(1)
    }

    const rows: Record<string, string>[] = parse(readFileSync(inputPath, "utf-8"), {
        columns: true,
        skip_empty_lines: true,
        relax_column_count: true,
    }).slice(0, limit)

    const sent = loadSentSet() // pure code, zero AI
    const seenEmail = new Set<string>()
    const candidates = rows.filter((r) => {
        const email = (r.email || "").trim().toLowerCase()
        if (!email || sent.has(email) || seenEmail.has(email)) return false
        seenEmail.add(email)
        return true
    })

    console.log(`[auto-draft] ${candidates.length}/${rows.length} candidates after dedupe (brand=${brand} angle=${angle})`)

    const results: { to: string; subject: string; body: string }[] = []
    let cursor = 0
    let processed = 0

    async function worker() {
        while (true) {
            const i = cursor++
            if (i >= candidates.length) return
            const row = candidates[i]
            const draft = await draftOne(row, brand, angle)
            processed++
            if (draft) {
                results.push({ to: row.email, subject: draft.subject, body: draft.body })
                mkdirSync(join(outPath, ".."), { recursive: true })
                writeFileSync(outPath, JSON.stringify(results, null, 2))
                console.log(`  [${processed}/${candidates.length}] drafted: ${row.email}`)
            } else {
                console.log(`  [${processed}/${candidates.length}] skipped: ${row.domain}`)
            }
        }
    }

    await Promise.all(Array.from({ length: Math.min(concurrency, candidates.length || 1) }, () => worker()))

    mkdirSync(join(outPath, ".."), { recursive: true })
    writeFileSync(outPath, JSON.stringify(results, null, 2))
    console.log(JSON.stringify({ drafted: results.length, skipped: candidates.length - results.length, outPath }, null, 2))
}

main().catch((err) => {
    console.error(err)
    process.exit(1)
})
