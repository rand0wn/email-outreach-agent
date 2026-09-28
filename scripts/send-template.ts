/**
 * Send template-drafted emails via Resend with cross-brand dedup guard.
 *
 * Usage:
 *   npx tsx outreach/scripts/send-template.ts --input outreach/drafts/template-output.json --brand jalpa
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from "fs"
import { join } from "path"
import { parse } from "csv-parse/sync"

interface TemplateDraft {
    to: string
    subject: string
    body: string
    pain_point: string
    domain: string
}

interface LogRow {
    date: string
    to: string
    subject: string
    body: string
    brand: string
    status: string
    resend_id?: string
    error?: string
}

function argStr(flag: string, fallback: string): string {
    const idx = process.argv.indexOf(flag)
    return idx === -1 ? fallback : process.argv[idx + 1] || fallback
}

// Load all previously sent emails from CSV logs
function loadSentSet(): Set<string> {
    const sent = new Set<string>()
    const dir = "outreach/logs"
    const files = existsSync(dir)
        ? readdirSync(dir).filter((f) => f.startsWith("outreach-log-") && f.endsWith(".csv"))
        : []
    for (const f of files) {
        const rows: Record<string, string>[] = parse(readFileSync(join(dir, f), "utf-8"), {
            columns: true,
            skip_empty_lines: true,
            relax_column_count: true,
        })
        for (const r of rows) if (r.to) sent.add(r.to.trim().toLowerCase())
    }
    return sent
}

async function sendOne(draft: TemplateDraft, brand: string, resendKey: string): Promise<{ success: boolean; resendId?: string; error?: string }> {
    const url = "https://api.resend.com/emails"
    const fromEmail = brand === "jalpa" ? "hello@jalpa.co.in" : "hello@fractionalaicto.in"
    const replyTo = brand === "jalpa" ? "abhishekfractionalcto@gmail.com" : "abhishekfractionalcto@gmail.com"

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${resendKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                from: fromEmail,
                to: draft.to,
                subject: draft.subject,
                html: `<p>${draft.body.replace(/\n/g, "</p><p>")}</p>`,
                reply_to: replyTo,
            }),
        })

        if (!response.ok) {
            const text = await response.text()
            return { success: false, error: `HTTP ${response.status}: ${text}` }
        }

        const data: any = await response.json()
        return { success: true, resendId: data.id }
    } catch (err: any) {
        return { success: false, error: String(err.message || err) }
    }
}

async function main() {
    const inputPath = argStr("--input", "outreach/drafts/template-output.json")
    const brand = argStr("--brand", "fractionalaicto")
    const dryRun = process.argv.includes("--dry-run")

    const resendKey = brand === "jalpa"
        ? (process.env.RESEND_API_KEY_JALPA || process.env.RESEND_API_KEY)
        : process.env.RESEND_API_KEY
    if (!resendKey) {
        console.error(`Error: RESEND_API_KEY not set`)
        process.exit(1)
    }

    if (!existsSync(inputPath)) {
        console.error(`Error: ${inputPath} not found`)
        process.exit(1)
    }

    const rawContent = readFileSync(inputPath, "utf-8").trim()
    if (!rawContent || rawContent === "[]") {
        console.log(`[send-template] Draft file empty, nothing to send`)
        return
    }

    const drafts: TemplateDraft[] = JSON.parse(rawContent)
    if (drafts.length === 0) {
        console.log(`[send-template] No drafts to send`)
        return
    }

    const sent = loadSentSet()

    console.log(`[send-template] ${drafts.length} drafts, checking against ${sent.size} already-sent`)

    const logRows: LogRow[] = []
    let sent_count = 0

    for (const draft of drafts) {
        const email = draft.to.trim().toLowerCase()

        if (sent.has(email)) {
            console.log(`  [skip] ${email} (already contacted)`)
            continue
        }

        if (dryRun) {
            console.log(`  [dry-run] would send to ${email}: "${draft.subject}"`)
            continue
        }

        const result = await sendOne(draft, brand, resendKey)

        if (result.success) {
            sent.add(email)
            sent_count++
            console.log(`  [sent] ${email} (${result.resendId})`)
            logRows.push({
                date: new Date().toISOString(),
                to: email,
                subject: draft.subject,
                body: draft.body,
                brand,
                status: "sent",
                resend_id: result.resendId,
            })
        } else {
            console.error(`  [error] ${email}: ${result.error}`)
            logRows.push({
                date: new Date().toISOString(),
                to: email,
                subject: draft.subject,
                body: draft.body,
                brand,
                status: "error",
                error: result.error,
            })
        }

        // Rate limit: ~3 per second
        await new Promise((r) => setTimeout(r, 350))
    }

    // Write log
    const logPath = `outreach/logs/outreach-log-${brand}-${new Date().toISOString().split("T")[0]}.csv`
    mkdirSync("outreach/logs", { recursive: true })

    const header = "date,to,subject,body,brand,status,resend_id,error\n"
    const csvRows = logRows
        .map((r) => {
            const esc = (s: string) => {
                // Replace newlines with space, escape quotes
                const clean = (s || "").replace(/[\r\n]+/g, " ").replace(/"/g, '""')
                return `"${clean}"`
            }
            return [r.date, r.to, r.subject, r.body, r.brand, r.status, r.resend_id || "", r.error || ""]
                .map(esc)
                .join(",")
        })
        .join("\n")

    writeFileSync(logPath, header + csvRows)

    // Clear draft file after sending to prevent resending same people
    writeFileSync(inputPath, "[]")

    console.log(`\n[done] ${sent_count}/${drafts.length} sent, log: ${logPath}`)
}

main().catch((err) => {
    console.error(err)
    process.exit(1)
})
