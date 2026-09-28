/**
 * Enrichment v2: everything here is a plain deterministic script, zero AI calls.
 * Fetches homepage (+contact page if no email found), extracts email, title,
 * AND a cleaned text excerpt of the page (stripped tags, collapsed whitespace,
 * capped length) so the drafting step never needs to WebFetch again -- it can
 * write directly from this excerpt via a single lightweight `claude -p` call.
 *
 * Usage: npx tsx outreach/scripts/enrich-sprouts-v2.ts --input <path> --tag <tag> [--limit N] [--concurrency 8]
 * Writes outreach/targets/sprouts-<tag>-enriched.csv (full) and -sendable.csv
 * (live + has email), both including a `text_excerpt` column.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import { join } from "path"
import { parse } from "csv-parse/sync"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const EXCERPT_MAX = 2000

function csvEscape(value: string): string {
    if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`
    return value
}

function toCsv(rows: Record<string, string>[]): string {
    if (!rows.length) return ""
    const keys = [
        "account_name", "domain", "website", "country", "employee_count", "industry",
        "email", "first_name", "last_name", "job_title", "brand", "email_status",
        "email_source", "live", "http_status", "page_title", "text_excerpt",
    ]
    return (
        [keys.join(","), ...rows.map((r) => keys.map((k) => csvEscape(r[k] || "")).join(","))].join("\n") + "\n"
    )
}

function extractEmail(html: string, host: string): string {
    const mailto = html.match(/mailto:([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i)
    if (mailto) {
        const found = mailto[1].toLowerCase()
        const mailHost = found.split("@")[1] || ""
        if (mailHost === host || mailHost.endsWith(`.${host}`) || host.endsWith(`.${mailHost}`)) return found
        if (!/gmail\.com|yahoo\.com|outlook\.com|hotmail\.com|icloud\.com/.test(mailHost)) return found
    }
    const patterns = [/\b(hello|hi|contact|founders?)@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/i]
    for (const p of patterns) {
        const m = html.match(p)
        if (m) return m[0].toLowerCase()
    }
    return ""
}

function extractTitle(html: string): string {
    const m = html.match(/<title>([^<]*)<\/title>/i)
    return m ? m[1].trim().slice(0, 180) : ""
}

// Strip script/style, tags, collapse whitespace, cap length -- a plain text
// excerpt good enough for a drafting model to find a real pain point from,
// without needing to render or re-fetch the page.
function extractTextExcerpt(html: string): string {
    let text = html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<!--[\s\S]*?-->/g, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&#\d+;/g, " ")
        // Strip control chars and unicode line/paragraph separators (U+2028,
        // U+2029) that JS \s doesn't reliably normalize and that broke
        // csv-parse downstream (a raw separator inside a quoted CSV field
        // shifted the parser's line count, corrupting the whole batch --
        // 2026-09-17 incident). Also normalize curly/smart quotes to plain
        // ASCII quotes so downstream CSV quote-doubling stays predictable.
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u2028\u2029]/g, " ")
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/[\u201c\u201d]/g, '"')
        .replace(/\s+/g, " ")
        .trim()
    return text.slice(0, EXCERPT_MAX)
}

async function fetchPage(url: string): Promise<{ ok: boolean; html: string; status: string }> {
    const controller = new AbortController()
    const t = setTimeout(() => controller.abort(), 6000)
    try {
        const res = await fetch(url, {
            signal: controller.signal,
            redirect: "follow",
            headers: { "User-Agent": "Mozilla/5.0 (compatible; OutreachResearch/1.0)" },
        })
        const html = res.ok ? await res.text() : ""
        return { ok: res.ok, html, status: String(res.status) }
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "unreachable"
        return { ok: false, html: "", status: message.slice(0, 80) }
    } finally {
        clearTimeout(t)
    }
}

function argStr(flag: string, fallback: string): string {
    const idx = process.argv.indexOf(flag)
    return idx === -1 ? fallback : process.argv[idx + 1] || fallback
}
function argNum(flag: string, fallback: number): number {
    const idx = process.argv.indexOf(flag)
    if (idx === -1) return fallback
    return Math.max(1, parseInt(process.argv[idx + 1] || String(fallback), 10) || fallback)
}

async function enrichOne(row: Record<string, string>): Promise<Record<string, string>> {
    const host = (row.domain || "").toLowerCase()
    const website = row.website.startsWith("http") ? row.website : `https://${host}`
    let email = (row.email || "").trim().toLowerCase()
    let source = email ? "sprouts" : ""
    let live = "false"
    let status = ""
    let pageTitle = ""
    let textExcerpt = ""

    const home = await fetchPage(website)
    status = home.status
    live = home.ok ? "true" : "false"
    if (home.ok) {
        pageTitle = extractTitle(home.html)
        textExcerpt = extractTextExcerpt(home.html)
        if (!email) {
            email = extractEmail(home.html, host)
            if (email) source = "homepage"
        }
        if (!email) {
            const contact = await fetchPage(website.replace(/\/$/, "") + "/contact")
            if (contact.ok) {
                email = extractEmail(contact.html, host)
                if (email) source = "contact_page"
            }
        }
    }

    return { ...row, email, email_source: source, live, http_status: status, page_title: pageTitle, text_excerpt: textExcerpt }
}

async function main() {
    const tag = argStr("--tag", "batch")
    const inputArg = argStr("--input", "")
    const limit = argNum("--limit", 2000)
    const concurrency = argNum("--concurrency", 8)
    if (!inputArg) {
        console.error("--input <path> is required")
        process.exit(1)
    }
    const outPath = join("outreach", "targets", `sprouts-${tag}-enriched.csv`)
    const sendablePath = join("outreach", "targets", `sprouts-${tag}-sendable.csv`)

    const rows: Record<string, string>[] = parse(readFileSync(inputArg, "utf-8"), {
        columns: true,
        skip_empty_lines: true,
        relax_column_count: true,
    }).slice(0, limit)

    const done: Record<string, string>[] = existsSync(outPath)
        ? parse(readFileSync(outPath, "utf-8"), { columns: true, skip_empty_lines: true, relax_column_count: true })
        : []
    const doneHosts = new Set(done.map((r) => (r.domain || "").toLowerCase()).filter(Boolean))
    const pending = rows.filter((r) => !doneHosts.has((r.domain || "").toLowerCase()))

    console.log(`[${tag}] resume: ${done.length} done, ${pending.length} remaining, concurrency ${concurrency}`)

    const all = [...done]
    let completedNew = 0
    let cursor = 0

    async function worker() {
        while (true) {
            const i = cursor++
            if (i >= pending.length) return
            const result = await enrichOne(pending[i])
            all.push(result)
            completedNew++
            if (completedNew % 50 === 0 || completedNew === pending.length) {
                writeFileSync(outPath, toCsv(all))
                const found = all.filter((r) => r.email && r.live === "true")
                writeFileSync(sendablePath, toCsv(found))
                console.log(`[${tag}] checkpoint ${all.length}/${rows.length} new=${completedNew} emails=${found.length}`)
            }
            await sleep(150)
        }
    }

    await Promise.all(Array.from({ length: Math.min(concurrency, pending.length || 1) }, () => worker()))
    writeFileSync(outPath, toCsv(all))
    const found = all.filter((r) => r.email && r.live === "true")
    writeFileSync(sendablePath, toCsv(found))
    console.log(JSON.stringify({ tag, enriched: all.length, live: all.filter((r) => r.live === "true").length, with_email: found.length, sendablePath }, null, 2))
}

main().catch((error) => {
    console.error(error)
    process.exit(1)
})
