// Hard runtime guard against sending a second email to the same recipient,
// across ANY brand (fractionalaicto.in, Jalpa, or any future brand run out
// of this repo). This is the last line of defense -- call it immediately
// before every Resend API call, not just at drafting time. A stale draft
// file, a re-run script, or a bad merge should never be able to cause a
// duplicate send once this guard is wired in.
//
// Built after a real incident on 2026-08-21: a stale /tmp pool file's
// existing entries were never re-validated against updated logs, causing 74
// duplicate fractionalaicto sends. Backing store moved from scattered CSV
// logs to a Turso DB (outreach_contacts table) on 2026-08-22 -- CSV logs
// still get written per-batch for human-readable history, but the DB is now
// the real source of truth this guard checks against.
import { createClient } from "@libsql/client"
import { readFileSync, existsSync } from "fs"
import { join } from "path"

function loadDotEnv(filename: string) {
    const path = join(process.cwd(), filename)
    if (!existsSync(path)) return
    for (const line of readFileSync(path, "utf-8").split("\n")) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith("#")) continue
        const eq = trimmed.indexOf("=")
        if (eq === -1) continue
        const key = trimmed.slice(0, eq).trim()
        let value = trimmed.slice(eq + 1).trim()
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1)
        }
        if (!(key in process.env)) process.env[key] = value
    }
}
loadDotEnv(".env.local")
loadDotEnv(".env")

function getDb() {
    const url = process.env.TURSO_DATABASE_URL
    const authToken = process.env.TURSO_AUTH_TOKEN
    if (!url || !authToken) {
        throw new Error("TURSO_DATABASE_URL / TURSO_AUTH_TOKEN not set -- cannot load contacted set")
    }
    return createClient({ url, authToken })
}

export async function loadAlreadySentSet(): Promise<Set<string>> {
    const db = getDb()
    const result = await db.execute("SELECT DISTINCT email FROM outreach_contacts")
    const sent = new Set<string>()
    for (const row of result.rows) {
        sent.add(String(row.email).trim().toLowerCase())
    }
    return sent
}

/** Throws if this exact address was already sent to in any prior batch. */
export function assertNotAlreadySent(sent: Set<string>, to: string): void {
    if (sent.has(to.trim().toLowerCase())) {
        throw new Error(`REFUSING TO SEND: ${to} was already contacted in a prior batch (cross-brand guard).`)
    }
}

/** Record a send in the DB immediately after Resend confirms it -- called
 * alongside the CSV log append, not instead of it. */
export async function recordSent(params: {
    email: string
    brand: string
    subject?: string | null
    variant?: string | null
    cta?: string | null
    resendId?: string | null
    status: string
    sourceLog: string
}): Promise<void> {
    const db = getDb()
    await db.execute({
        sql: `INSERT INTO outreach_contacts (email, brand, subject, variant, cta, resend_id, status, source_log, sent_date)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(email, source_log) DO NOTHING`,
        args: [
            params.email.trim().toLowerCase(),
            params.brand,
            params.subject ?? null,
            params.variant ?? null,
            params.cta ?? null,
            params.resendId ?? null,
            params.status,
            params.sourceLog,
            new Date().toISOString().slice(0, 10),
        ],
    })
}
