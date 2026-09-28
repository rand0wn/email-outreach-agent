/**
 * Generalized "next batch" shortlister, no AI, pure SQL + code. Replaces the
 * manually-bumped shortlist-sprouts-sep14-batchN.ts one-off scripts. Tracks
 * every domain it has ever shortlisted in a persistent file so each run
 * automatically pulls fresh, never-before-seen candidates.
 *
 * Usage:
 *   npx tsx outreach/scripts/shortlist-next.ts --brand fractionalaicto --limit 300
 *   npx tsx outreach/scripts/shortlist-next.ts --brand jalpa --limit 300
 *
 * Writes outreach/targets/shortlist-next-<brand>-<date>.csv and appends the
 * newly-used domains to outreach/targets/used-domains-<brand>.txt.
 */
import { createClient } from "@libsql/client"
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "fs"
import { join } from "path"
import { loadAlreadySentSet } from "./guard-already-sent"

function loadDotEnv(filename: string) {
    if (!existsSync(filename)) return
    for (const line of readFileSync(filename, "utf-8").split("\n")) {
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

// Jalpa filter, tightened 2026-09-15: dropped real-estate/accounting/electric
// after confirming ~13% yield (institutional players have plain, local-
// sounding names -- keyword filtering on name alone cannot separate a
// 2-person boutique from a $1B+ REIT in those categories). See
// outreach/STRATEGY_LOG.md ICP notes for the incident writeup.
// ICP finding, 2026-09-17: the only Jalpa reply so far (n=1, too thin to be
// conclusive alone) was a complaint, from a generic "free inspection call"
// opener with no specific evidence -- see auto-draft.ts's jalpa brandRules
// fix, which addresses the copy problem. Separately, on 2026-09-17 (second
// pass) low-stakes browsing-type categories (salon/spa/gym/bakery/etc) were
// added purely to solve a pool-exhaustion problem, without an ICP check.
// Missed-call economics differ sharply by category: a missed call at an
// HVAC/plumbing/legal/tax business is a real emergency or a high-value job
// walking away, while a missed call at a bakery or nail salon is usually a
// walk-in browsing decision with much lower cost -- a weaker fit for the
// pitch's core premise. Split into two tiers so the higher-economics
// categories are tried first, low-stakes ones only fill remaining volume.
const JALPA_HIGH_STAKES_FILTER = `(
    lower(coalesce(account_name,'')) LIKE '%dentist%'
    OR lower(coalesce(account_name,'')) LIKE '%dental%'
    OR lower(coalesce(account_name,'')) LIKE '%orthodont%'
    OR lower(coalesce(account_name,'')) LIKE '%hvac%'
    OR lower(coalesce(account_name,'')) LIKE '%plumb%'
    OR lower(coalesce(account_name,'')) LIKE '%roof%'
    OR lower(coalesce(account_name,'')) LIKE '%veterinar%'
    OR lower(coalesce(account_name,'')) LIKE '%chiropract%'
    OR lower(coalesce(account_name,'')) LIKE '%law firm%'
    OR lower(coalesce(account_name,'')) LIKE '%law office%'
    OR lower(coalesce(account_name,'')) LIKE '%attorney%'
    OR lower(coalesce(account_name,'')) LIKE '%clinic%'
    OR lower(coalesce(account_name,'')) LIKE '%pest control%'
    OR lower(coalesce(account_name,'')) LIKE '%auto repair%'
    OR lower(coalesce(account_name,'')) LIKE '%locksmith%'
    OR lower(coalesce(account_name,'')) LIKE '%tax service%'
    OR lower(coalesce(account_name,'')) LIKE '%tax prep%'
    OR lower(coalesce(account_name,'')) LIKE '%bookkeeping%'
    OR lower(coalesce(account_name,'')) LIKE '%pool service%'
    OR lower(coalesce(account_name,'')) LIKE '%tree service%'
    OR lower(coalesce(account_name,'')) LIKE '%garage door%'
    OR lower(coalesce(account_name,'')) LIKE '%appliance repair%'
    OR lower(coalesce(account_name,'')) LIKE '%glass repair%'
    OR lower(coalesce(account_name,'')) LIKE '%flooring%'
    OR lower(coalesce(account_name,'')) LIKE '%painting%'
    OR lower(coalesce(account_name,'')) LIKE '%contractor%'
    OR lower(coalesce(account_name,'')) LIKE '%remodel%'
    OR lower(coalesce(account_name,'')) LIKE '%landscap%'
    OR lower(coalesce(domain,'')) LIKE '%dental%'
    OR lower(coalesce(domain,'')) LIKE '%hvac%'
)`

const JALPA_LOW_STAKES_FILTER = `(
    lower(coalesce(account_name,'')) LIKE '%salon%'
    OR lower(coalesce(account_name,'')) LIKE '%spa%'
    OR lower(coalesce(account_name,'')) LIKE '%cleaning%'
    OR lower(coalesce(account_name,'')) LIKE '%car wash%'
    OR lower(coalesce(account_name,'')) LIKE '%gym%'
    OR lower(coalesce(account_name,'')) LIKE '%fitness%'
    OR lower(coalesce(account_name,'')) LIKE '%physical therapy%'
    OR lower(coalesce(account_name,'')) LIKE '%massage%'
    OR lower(coalesce(account_name,'')) LIKE '%moving%'
    OR lower(coalesce(account_name,'')) LIKE '%catering%'
    OR lower(coalesce(account_name,'')) LIKE '%restaurant%'
    OR lower(coalesce(account_name,'')) LIKE '%cafe%'
    OR lower(coalesce(account_name,'')) LIKE '%bakery%'
    OR lower(coalesce(account_name,'')) LIKE '%florist%'
    OR lower(coalesce(account_name,'')) LIKE '%barber%'
    OR lower(coalesce(account_name,'')) LIKE '%nail%'
    OR lower(coalesce(account_name,'')) LIKE '%tattoo%'
    OR lower(coalesce(account_name,'')) LIKE '%daycare%'
    OR lower(coalesce(account_name,'')) LIKE '%childcare%'
    OR lower(coalesce(account_name,'')) LIKE '%tutoring%'
    OR lower(coalesce(account_name,'')) LIKE '%notary%'
    OR lower(coalesce(account_name,'')) LIKE '%dry clean%'
    OR lower(coalesce(account_name,'')) LIKE '%tailor%'
    OR lower(coalesce(account_name,'')) LIKE '%upholstery%'
    OR lower(coalesce(account_name,'')) LIKE '%pool cleaning%'
    OR lower(coalesce(account_name,'')) LIKE '%window%'
)`

// ICP finding, 2026-09-17 reply-audit: all ~50 genuine replies to the
// critique-hook angle came from small, live tech/SaaS products (dev tools,
// apps, indie SaaS with a public claim to point a flaw at) -- the exact
// population Show HN/Product Hunt/BetaList sourcing naturally selects for.
// sprouts_accounts_sep14's `industry` column is 100% empty (verified via a
// one-off COUNT query), so there is no structured way to filter this table
// by vertical -- only a name-keyword heuristic is possible. This tier tries
// that heuristic FIRST (9,711 matches: software/saas/app/studio/labs/tech/
// digital/platform/ai/cloud/data/analytics in the account name) before
// falling back to the broad table below. This does not replace HN/PH/
// BetaList as the ICP-correct primary source -- it's a same-database second
// choice for days sprouts is the only source in play.
const FRAC_TECH_FILTER = `(
    lower(coalesce(account_name,'')) LIKE '%software%'
    OR lower(coalesce(account_name,'')) LIKE '%saas%'
    OR lower(coalesce(account_name,'')) LIKE '%apps%'
    OR lower(coalesce(account_name,'')) LIKE '% app'
    OR lower(coalesce(account_name,'')) LIKE 'app %'
    OR lower(coalesce(account_name,'')) LIKE '%studio%'
    OR lower(coalesce(account_name,'')) LIKE '%labs%'
    OR lower(coalesce(account_name,'')) LIKE '%tech%'
    OR lower(coalesce(account_name,'')) LIKE '%digital%'
    OR lower(coalesce(account_name,'')) LIKE '%platform%'
    OR lower(coalesce(account_name,'')) LIKE '%ai %'
    OR lower(coalesce(account_name,'')) LIKE '% ai'
    OR lower(coalesce(account_name,'')) LIKE '%cloud%'
    OR lower(coalesce(account_name,'')) LIKE '%data%'
    OR lower(coalesce(account_name,'')) LIKE '%analytics%'
)`

// Company-size finding, 2026-09-17: `employee_count` is 100% empty (same as
// `industry`), but `revenue` is populated for 97.7% of rows (130,422/133,490)
// and is usable as a size proxy. The reply-generating ICP is early-stage/
// indie-scale tech products, but sprouts' overall revenue distribution skews
// toward established companies (61% sit at $10M-100M revenue, only ~3.8%
// are under $1M). Cross-filtering FRAC_TECH_FILTER by revenue < $10M or
// unknown still leaves a workable 3,644-row pool (verified via a one-off
// COUNT query) -- small enough to plausibly be a real early-stage/small
// product company, not so small it exhausts immediately. Tried first, ahead
// of the full (any-size) tech tier.
const FRAC_TECH_SMALL_FILTER = `${FRAC_TECH_FILTER} AND (revenue = '' OR revenue IS NULL OR CAST(revenue as INTEGER) < 10000000)`

// Widened 2026-09-17: the narrow keyword-positive filter (agency/studio/
// software/consult/labs/engineering) only ever matched ~4,200 of the 133K
// rows in sprouts_accounts_sep14 -- by day 3 of sourcing, that entire match
// set was already exhausted (used-domains-fractionalaicto.txt had more
// entries than the filter could ever produce), so shortlisting silently
// produced zero candidates. This broad tier is a volume fallback only, used
// once FRAC_TECH_FILTER's pool is exhausted for the day -- it has NOT been
// validated against real reply data (see ICP note above) and is a weaker
// ICP match than the tech-keyword tier.
const FRAC_FILTER = `NOT (
    lower(coalesce(account_name,'')) LIKE '%government%'
    OR lower(coalesce(account_name,'')) LIKE '% bank%'
    OR lower(coalesce(account_name,'')) LIKE '%insurance%'
    OR lower(coalesce(account_name,'')) LIKE '%university%'
    OR lower(coalesce(account_name,'')) LIKE '%hospital%'
    OR lower(coalesce(account_name,'')) LIKE '%ministry%'
    OR lower(coalesce(account_name,'')) LIKE '%municipal%'
    OR lower(coalesce(account_name,'')) LIKE '%county%'
    OR lower(coalesce(account_name,'')) LIKE '%department of%'
    OR lower(coalesce(account_name,'')) LIKE '%foundation%'
    OR lower(coalesce(account_name,'')) LIKE '%holdings%'
    OR lower(coalesce(account_name,'')) LIKE '%international%'
    OR lower(coalesce(account_name,'')) LIKE '%global%'
    OR lower(coalesce(account_name,'')) LIKE '%plc%'
    OR domain = ''
    OR domain IS NULL
)`

const MAJOR = ["apple.com", "google.com", "microsoft.com", "amazon.com", "meta.com", "sprouts.ai"]

function hostOf(domain: string, website: string): string {
    const raw = (website || domain || "").toLowerCase().replace(/^https?:\/\//, "").split("/")[0]
    return raw.replace(/^www\./, "")
}
function isMajor(host: string): boolean {
    return MAJOR.some((m) => host === m || host.endsWith(`.${m}`))
}
function csvEscape(value: string): string {
    if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`
    return value
}
function toCsv(rows: Record<string, string>[]): string {
    if (!rows.length) return ""
    const keys = Object.keys(rows[0])
    return [keys.join(","), ...rows.map((r) => keys.map((k) => csvEscape(r[k] || "")).join(","))].join("\n") + "\n"
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

async function main() {
    const brand = argStr("--brand", "fractionalaicto") as "fractionalaicto" | "jalpa"
    const limit = argNum("--limit", 300)
    // Institutional-name guard for jalpa's keyword tiers: a trade
    // association/chamber/union can share a category keyword (e.g.
    // "Associated General Contractors of Colorado" matches '%contractor%')
    // without being an actual local SMB -- same class of false positive as
    // the "Churchill Real Estate" incident documented in STRATEGY_LOG.md.
    const JALPA_NOT_INSTITUTIONAL = `NOT (
        lower(coalesce(account_name,'')) LIKE '%association%'
        OR lower(coalesce(account_name,'')) LIKE 'associated %'
        OR lower(coalesce(account_name,'')) LIKE '%chamber of%'
        OR lower(coalesce(account_name,'')) LIKE '%union%'
        OR lower(coalesce(account_name,'')) LIKE '%council%'
        OR lower(coalesce(account_name,'')) LIKE '%institute%'
        OR lower(coalesce(account_name,'')) LIKE '%society%'
    )`
    // fractionalaicto tries the ICP-aligned tech-keyword tier first (see
    // FRAC_TECH_FILTER note above), then tops up from the broad fallback
    // tier once that pool is exhausted for the day. Jalpa tries high-stakes
    // categories (dentist/hvac/plumb/law/etc, where a missed call is a real
    // emergency or lost job) before low-stakes ones (salon/bakery/etc).
    const filterTiers =
        brand === "jalpa"
            ? [
                  `${JALPA_HIGH_STAKES_FILTER} AND ${JALPA_NOT_INSTITUTIONAL}`,
                  `${JALPA_LOW_STAKES_FILTER} AND ${JALPA_NOT_INSTITUTIONAL}`,
              ]
            : [FRAC_TECH_SMALL_FILTER, FRAC_TECH_FILTER, FRAC_FILTER]
    const db = createClient({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN! })

    const sent = await loadAlreadySentSet()
    const sentDomains = new Set(
        [...sent].map((e) => e.split("@")[1] || "").filter((d) => d && !d.includes("gmail.") && !d.includes("yahoo."))
    )

    const usedPath = join("outreach", "targets", `used-domains-${brand}.txt`)
    const seen = new Set<string>()
    if (existsSync(usedPath)) {
        for (const line of readFileSync(usedPath, "utf-8").split("\n")) {
            const d = line.trim().toLowerCase()
            if (d) seen.add(d)
        }
    }
    console.log(`[${brand}] excluding ${seen.size} previously-shortlisted domains`)

    const shortlist: Record<string, string>[] = []
    const newlyUsed: string[] = []
    for (const [tierIdx, filter] of filterTiers.entries()) {
        if (shortlist.length >= limit) break
        // jalpa: bias toward smaller local businesses without hard-excluding
        // larger ones (a strict revenue cap shrank the already-thin jalpa
        // pool by ~75%, see JALPA sizing note). Unknown revenue is treated
        // as mid-size ($500M) so it sorts after genuinely-small known values
        // but well ahead of confirmed large/chain accounts.
        const orderBy =
            brand === "jalpa"
                ? "ORDER BY (CASE WHEN revenue = '' OR revenue IS NULL THEN 500000000 ELSE CAST(revenue as INTEGER) END) ASC, domain"
                : "ORDER BY id DESC"
        const rows = await db.execute(`
            SELECT account_name, domain, website, account_country, employee_count, industry
            FROM sprouts_accounts_sep14
            WHERE ${filter}
            ${orderBy}
        `)
        const before = shortlist.length
        for (const row of rows.rows) {
            if (shortlist.length >= limit) break
            const website = String(row.website || "")
            const domain = String(row.domain || "")
            const host = hostOf(domain, website)
            if (!host || seen.has(host) || isMajor(host) || sentDomains.has(host)) continue
            seen.add(host)
            newlyUsed.push(host)
            shortlist.push({
                account_name: String(row.account_name || host),
                domain: host,
                website: website || `https://${host}`,
                country: String(row.account_country || ""),
                employee_count: String(row.employee_count || ""),
                industry: String(row.industry || ""),
                email: "",
                first_name: "",
            last_name: "",
            job_title: "",
            brand,
            email_status: "",
        })
        }
        const tierName =
            brand === "jalpa"
                ? tierIdx === 0
                    ? "high-stakes"
                    : "low-stakes-fallback"
                : ["tech-icp-small", "tech-icp-any-size", "broad-fallback"][tierIdx]
        console.log(`[${brand}] tier ${tierName}: +${shortlist.length - before} candidates (running total ${shortlist.length}/${limit})`)
    }

    // Local date, not UTC -- must match the bash caller's `date +%Y-%m-%d`
    // (run-brand-batch.sh), or the output filename mismatches what the
    // caller looks for whenever local time and UTC straddle midnight.
    const now = new Date()
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
    const outDir = join("outreach", "targets")
    mkdirSync(outDir, { recursive: true })
    const outPath = join(outDir, `shortlist-next-${brand}-${today}.csv`)
    writeFileSync(outPath, toCsv(shortlist))
    if (newlyUsed.length) appendFileSync(usedPath, newlyUsed.join("\n") + "\n")

    console.log(JSON.stringify({ brand, shortlisted: shortlist.length, already_sent_guard: sent.size, outPath }, null, 2))
}

main().catch((error) => {
    console.error(error)
    process.exit(1)
})
