import { DurableObject } from "cloudflare:workers";

export const ISSUE_REPOSITORIES = Object.freeze([
  "unclehowell/cedwyn",
  "unclehowell/cedwyn-hive"
]);
export const ISSUE_LABEL = "agent-job";
export const ISSUE_LEASE_MINUTES = 60;
export const ISSUE_QUEUE_RULE =
  "GitHub Issues are the project work ledger. Find or reuse an open issue labelled agent-job, then claim its exact owner/repo#number key for 60 minutes. A competing live claim is refused. Claim again to renew; release when finished or blocked. GitHub remains authoritative for status, assignee, labels, blockers and acceptance. Lease expiry only returns the issue to the available queue; it never edits or closes the issue. HubSpot is not used for project task state and remains private for recipient-facing correspondence drafts and exact-version reviews.";

const PRIORITY = Object.freeze({ P0: 0, P1: 1, P2: 2, P3: 3 });
const ISSUE_KEY_RE = /^([a-z0-9_.-]+\/[a-z0-9_.-]+)#([1-9][0-9]{0,8})$/i;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const MAX_PAGES_PER_REPO = 5;
const LEASE_PATH = "https://hive-issue-leases.internal";

function response(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}
function safeText(value, max = 120) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}
function safeTitle(value) {
  return safeText(value, 180)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[contact removed]")
    .replace(/(?:\+?\d[\d ().-]{7,}\d)/g, "[number removed]");
}
export function parseIssueKey(value) {
  const match = ISSUE_KEY_RE.exec(String(value ?? "").trim());
  if (!match) return null;
  const repository = (match[1] || "").toLowerCase();
  if (!ISSUE_REPOSITORIES.includes(repository)) return null;
  return { repository, number: Number(match[2]), issue_key: repository + "#" + match[2] };
}
function labelNames(issue) {
  return Array.isArray(issue?.labels)
    ? issue.labels.map((item) => safeText(typeof item === "string" ? item : item?.name, 48)).filter(Boolean)
    : [];
}
function statusFromLabels(labels) {
  const set = new Set(labels.map((label) => label.toLowerCase()));
  if (set.has("blocked") || set.has("status:blocked")) return "BLOCKED";
  if (set.has("waiting") || set.has("status:waiting")) return "WAITING";
  if (set.has("review") || set.has("status:review")) return "REVIEW";
  return "OPEN";
}
function priorityFromLabels(labels) {
  for (const label of labels) {
    const m = /^(?:priority\s*:\s*)?(p[0-3])$/i.exec(label);
    if (m) return m[1].toUpperCase();
    const tier = /^(?:priority\s*:\s*)?(critical|urgent|high|normal|medium|low)$/i.exec(label);
    if (tier) {
      const map = { critical: "P0", urgent: "P0", high: "P1", normal: "P2", medium: "P2", low: "P3" };
      return map[tier[1].toLowerCase()];
    }
  }
  return "P2";
}
function publicIssue(issue, repository) {
  const labels = labelNames(issue);
  if (!labels.some((label) => label.toLowerCase() === ISSUE_LABEL)) return null;
  const number = Number(issue.number);
  if (!Number.isSafeInteger(number) || number <= 0) return null;
  const issueKey = repository + "#" + number;
  const milestoneDue = issue.milestone?.due_on ? String(issue.milestone.due_on) : null;
  const safeLabels = labels.filter((label) =>
    /^agent-job$/i.test(label) ||
    /^p[0-3]$/i.test(label) ||
    /^priority\s*:\s*(p[0-3]|critical|urgent|high|normal|medium|low)$/i.test(label) ||
    /^(blocked|waiting|review|status:(blocked|waiting|review))$/i.test(label)
  );
  return {
    issue_key: issueKey,
    repository,
    number,
    title: safeTitle(issue.title) || "Untitled work issue",
    url: typeof issue.html_url === "string" && issue.html_url.startsWith("https://github.com/")
      ? issue.html_url : "https://github.com/" + repository + "/issues/" + number,
    status: statusFromLabels(labels),
    priority: priorityFromLabels(labels),
    due_at: milestoneDue,
    updated_at: typeof issue.updated_at === "string" ? issue.updated_at : null,
    labels: safeLabels
  };
}
async function fetchRepositoryIssues(repository) {
  const rows = [];
  let truncated = false;
  for (let page = 1; page <= MAX_PAGES_PER_REPO; page++) {
    const url = "https://api.github.com/repos/" + repository +
      "/issues?state=open&labels=" + encodeURIComponent(ISSUE_LABEL) +
      "&per_page=100&page=" + page;
    const res = await fetch(url, {
      headers: {
        "accept": "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "Cedwyn-Hive-Issue-Queue"
      },
      cf: { cacheTtl: 30, cacheEverything: true }
    });
    if (!res.ok) throw new Error("GitHub issue discovery failed for " + repository + " (HTTP " + res.status + ")");
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error("GitHub issue discovery returned an invalid response for " + repository);
    for (const item of data) {
      if (!item || item.pull_request || item.state !== "open") continue;
      const row = publicIssue(item, repository);
      if (row) rows.push(row);
    }
    if (data.length < 100) break;
    if (page === MAX_PAGES_PER_REPO) truncated = true;
  }
  return { rows, truncated };
}
async function leaseStub(env) {
  if (!env?.HIVE_ISSUE_LEASES) throw new Error("GitHub issue lease binding is not configured");
  const id = env.HIVE_ISSUE_LEASES.idFromName("cedwyn-github-issue-leases");
  return env.HIVE_ISSUE_LEASES.get(id);
}
async function leaseSnapshot(env) {
  const stub = await leaseStub(env);
  const res = await stub.fetch(LEASE_PATH + "/snapshot");
  if (!res.ok) throw new Error("GitHub issue lease store unavailable (HTTP " + res.status + ")");
  const data = await res.json();
  if (!Array.isArray(data.leases)) throw new Error("GitHub issue lease store returned invalid data");
  return data.leases;
}

export async function hiveJobs(env, query = {}) {
  try {
    const [repoResults, leases] = await Promise.all([
      Promise.all(ISSUE_REPOSITORIES.map(fetchRepositoryIssues)),
      leaseSnapshot(env)
    ]);
    const leaseMap = new Map(leases.map((lease) => [lease.issue_key, lease]));
    const rows = repoResults.flatMap((result) => result.rows).map((row) => {
      const lease = leaseMap.get(row.issue_key) || null;
      return {
        ...row,
        claim: lease ? { agent: lease.agent, claimed_at: lease.claimed_at, expires_at: lease.expires_at } : null,
        takeable: !lease && row.status === "OPEN"
      };
    });
    rows.sort((a, b) =>
      (PRIORITY[a.priority] - PRIORITY[b.priority]) ||
      ((a.due_at ? Date.parse(a.due_at) : Number.MAX_SAFE_INTEGER) -
       (b.due_at ? Date.parse(b.due_at) : Number.MAX_SAFE_INTEGER)) ||
      String(a.updated_at || "").localeCompare(String(b.updated_at || "")) ||
      a.issue_key.localeCompare(b.issue_key)
    );
    const counts = {
      open: rows.length,
      unclaimed: rows.filter((row) => row.takeable).length,
      claimed: rows.filter((row) => row.claim).length,
      blocked: rows.filter((row) => row.status === "BLOCKED").length,
      waiting: rows.filter((row) => row.status === "WAITING").length,
      review: rows.filter((row) => row.status === "REVIEW").length,
      P0: rows.filter((row) => row.priority === "P0").length,
      P1: rows.filter((row) => row.priority === "P1").length,
      P2: rows.filter((row) => row.priority === "P2").length,
      P3: rows.filter((row) => row.priority === "P3").length
    };
    let out = rows;
    if (query.status) out = out.filter((row) => row.status === String(query.status).toUpperCase());
    if (query.priority) out = out.filter((row) => row.priority === String(query.priority).toUpperCase());
    if (query.repository) out = out.filter((row) => row.repository === String(query.repository));
    if (!(query.include_claimed === "1" || query.include_claimed === true || query.include_claimed === "true")) {
      out = out.filter((row) => !row.claim || (query.agent && row.claim.agent === safeText(query.agent, 60)));
    }
    const limit = Math.max(1, Math.min(MAX_LIMIT, Number(query.limit) || DEFAULT_LIMIT));
    return {
      schema: "hive_github_jobs/v1",
      version: "3.20.0",
      generated: new Date().toISOString(),
      source: { type: "github-issues", repositories: ISSUE_REPOSITORIES, label: ISSUE_LABEL, issue_bodies_exposed: false },
      coverage: { complete: repoResults.every((result) => !result.truncated), truncated_repositories: ISSUE_REPOSITORIES.filter((_, index) => repoResults[index].truncated) },
      rule: ISSUE_QUEUE_RULE,
      lease: { minutes: ISSUE_LEASE_MINUTES, key: "owner/repository#issue_number", endpoint: "/api/jobs/claim", release_endpoint: "/api/jobs/release" },
      counts,
      next_job: rows.find((row) => row.takeable) || null,
      returned: Math.min(limit, out.length),
      jobs: out.slice(0, limit)
    };
  } catch (error) {
    return {
      schema: "hive_github_jobs/v1",
      error: "GitHub issue queue unavailable: " + safeText(error?.message || error, 220),
      source: { type: "github-issues", repositories: ISSUE_REPOSITORIES, label: ISSUE_LABEL, issue_bodies_exposed: false },
      rule: ISSUE_QUEUE_RULE,
      jobs: [],
      next_job: null
    };
  }
}

export async function jobClaimTool(env, name, args = {}, ip = "") {
  const parsed = parseIssueKey(args.issue_key);
  const agent = safeText(args.agent, 60);
  if (!parsed) return { error: "issue_key must be an allowlisted owner/repository#issue_number, such as unclehowell/cedwyn#123" };
  if (!agent || agent.length < 2) return { error: "agent is required (your Hive roster name)" };
  if (args.note) return { error: "Do not put task or private details in lease notes; record progress on the public GitHub issue using safe metadata only." };
  const rateKey = String(ip || "unknown") + "|" + parsed.issue_key + "|" + name;
  const now = Date.now();
  const previous = claimRate.get(rateKey) || 0;
  if (now - previous < 2000) return { error: "One lease action every 2 seconds per issue, please." };
  claimRate.set(rateKey, now);
  try {
    const stub = await leaseStub(env);
    const res = await stub.fetch(LEASE_PATH + (name === "hive_claim_job" ? "/claim" : "/release"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ issue_key: parsed.issue_key, agent })
    });
    const data = await res.json();
    return data;
  } catch (error) {
    return { error: "GitHub issue lease operation failed: " + safeText(error?.message || error, 200), ok: false };
  }
}
const claimRate = new Map();

export const JOB_TOOLS = [
  { name: "hive_next_job", description: "The next open, unclaimed GitHub work issue from the allowlisted repositories. GitHub is authoritative; the Hive lease is temporary only.", inputSchema: { type: "object", properties: { agent: { type: "string" } } }, annotations: { readOnlyHint: true } },
  { name: "hive_list_jobs", description: "List public-safe GitHub work issues carrying the agent-job label, with temporary claim state. Issue bodies and private CRM data are never returned.", inputSchema: { type: "object", properties: { limit: { type: "number" }, status: { type: "string" }, priority: { type: "string" }, repository: { type: "string" }, include_claimed: { type: "boolean" } } }, annotations: { readOnlyHint: true } },
  { name: "hive_claim_job", description: "Claim or renew a GitHub issue lease for 60 minutes, keyed by owner/repository#issue_number. A competing live agent is refused. This does not change GitHub issue state.", inputSchema: { type: "object", required: ["issue_key", "agent"], properties: { issue_key: { type: "string" }, agent: { type: "string" } } } },
  { name: "hive_release_job", description: "Release your 60-minute lease on a GitHub issue. Only the current lease owner can release it. This does not change GitHub issue state.", inputSchema: { type: "object", required: ["issue_key", "agent"], properties: { issue_key: { type: "string" }, agent: { type: "string" } } } }
];

export async function issueJobTool(env, name, args = {}, ip = "") {
  if (name === "hive_next_job") {
    const data = await hiveJobs(env, { agent: args.agent, limit: 1 });
    return { rule: data.rule, next_job: data.next_job, counts: data.counts, source: data.source, lease: data.lease, error: data.error };
  }
  if (name === "hive_list_jobs") {
    return hiveJobs(env, { limit: args.limit, status: args.status, priority: args.priority, repository: args.repository, include_claimed: args.include_claimed ? "1" : "" });
  }
  if (name === "hive_claim_job" || name === "hive_release_job") return jobClaimTool(env, name, args, ip);
  return null;
}

export class HiveIssueLeases extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS issue_leases (
      issue_key TEXT PRIMARY KEY,
      agent TEXT NOT NULL,
      claimed_at TEXT NOT NULL,
      renewed_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      expires_ms INTEGER NOT NULL
    )`);
  }
  async fetch(request) {
    const url = new URL(request.url);
    const now = Date.now();
    try {
      if (request.method === "GET" && url.pathname === "/snapshot") {
        const leases = this.ctx.storage.transactionSync(() => {
          this.ctx.storage.sql.exec("DELETE FROM issue_leases WHERE expires_ms <= ?", now);
          return this.ctx.storage.sql.exec(
            "SELECT issue_key, agent, claimed_at, renewed_at, expires_at FROM issue_leases WHERE expires_ms > ? ORDER BY expires_ms",
            now
          ).toArray();
        });
        return response({ leases });
      }
      if (request.method !== "POST" || !["/claim", "/release"].includes(url.pathname)) {
        return response({ error: "not_found" }, 404);
      }
      const body = await request.json();
      const parsed = parseIssueKey(body?.issue_key);
      const agent = safeText(body?.agent, 60);
      if (!parsed || !agent || agent.length < 2) return response({ error: "invalid_issue_key_or_agent" }, 400);
      if (url.pathname === "/claim") {
        const result = this.ctx.storage.transactionSync(() => {
          const current = this.ctx.storage.sql.exec(
            "SELECT issue_key, agent, claimed_at, renewed_at, expires_at, expires_ms FROM issue_leases WHERE issue_key = ?",
            parsed.issue_key
          ).toArray()[0] || null;
          if (current && current.expires_ms > now && current.agent !== agent) {
            return { status: 409, body: { ok: false, error: "already_claimed", issue_key: parsed.issue_key, agent: current.agent, expires_at: current.expires_at } };
          }
          const claimedAt = current && current.expires_ms > now ? current.claimed_at : new Date(now).toISOString();
          const renewedAt = new Date(now).toISOString();
          const expiresAt = new Date(now + ISSUE_LEASE_MINUTES * 60_000).toISOString();
          const expiresMs = now + ISSUE_LEASE_MINUTES * 60_000;
          this.ctx.storage.sql.exec(
            `INSERT INTO issue_leases(issue_key,agent,claimed_at,renewed_at,expires_at,expires_ms)
             VALUES(?,?,?,?,?,?)
             ON CONFLICT(issue_key) DO UPDATE SET
               agent=excluded.agent, claimed_at=excluded.claimed_at,
               renewed_at=excluded.renewed_at, expires_at=excluded.expires_at, expires_ms=excluded.expires_ms`,
            parsed.issue_key, agent, claimedAt, renewedAt, expiresAt, expiresMs
          );
          return { status: 200, body: { ok: true, issue_key: parsed.issue_key, agent, claimed_at: claimedAt, renewed_at: renewedAt, expires_at: expiresAt, lease_minutes: ISSUE_LEASE_MINUTES } };
        });
        return response(result.body, result.status);
      }
      const result = this.ctx.storage.transactionSync(() => {
        const current = this.ctx.storage.sql.exec(
          "SELECT agent, expires_at, expires_ms FROM issue_leases WHERE issue_key = ?",
          parsed.issue_key
        ).toArray()[0] || null;
        if (!current || current.expires_ms <= now) {
          this.ctx.storage.sql.exec("DELETE FROM issue_leases WHERE issue_key = ?", parsed.issue_key);
          return { status: 200, body: { ok: true, released: false, issue_key: parsed.issue_key, reason: "no_live_lease" } };
        }
        if (current.agent !== agent) {
          return { status: 409, body: { ok: false, error: "not_lease_owner", issue_key: parsed.issue_key, expires_at: current.expires_at } };
        }
        this.ctx.storage.sql.exec("DELETE FROM issue_leases WHERE issue_key = ?", parsed.issue_key);
        return { status: 200, body: { ok: true, released: true, issue_key: parsed.issue_key } };
      });
      return response(result.body, result.status);
    } catch (error) {
      return response({ error: "lease_store_error", message: safeText(error?.message || error, 180) }, 500);
    }
  }
}
