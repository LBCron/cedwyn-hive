const LEASE_KEY = "lease";
const MAX_TTL_MS = 2 * 60 * 60 * 1000;
const DEFAULT_TTL_MS = 60 * 60 * 1000;

export function cleanAgent(value) {
  return String(value || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 60);
}

export async function readLease(storage, now = Date.now()) {
  const lease = await storage.get(LEASE_KEY);
  if (!lease || !Number.isFinite(Date.parse(lease.expires_at)) || Date.parse(lease.expires_at) <= now) {
    if (lease) await storage.delete(LEASE_KEY);
    return null;
  }
  return lease;
}

export async function claimLease(storage, agentValue, now = Date.now(), ttlMs = DEFAULT_TTL_MS) {
  const agent = cleanAgent(agentValue);
  if (!agent) return { ok: false, error: "agent is required" };
  const ttl = Math.max(60_000, Math.min(MAX_TTL_MS, Number(ttlMs) || DEFAULT_TTL_MS));
  const current = await readLease(storage, now);
  if (current && current.agent !== agent) {
    return { ok: false, error: "already claimed by another agent", lease: current };
  }
  const lease = {
    agent,
    claimed_at: current ? current.claimed_at : new Date(now).toISOString(),
    renewed_at: new Date(now).toISOString(),
    expires_at: new Date(now + ttl).toISOString()
  };
  await storage.put(LEASE_KEY, lease);
  return { ok: true, lease };
}

export async function renewLease(storage, agentValue, now = Date.now(), ttlMs = DEFAULT_TTL_MS) {
  const agent = cleanAgent(agentValue);
  if (!agent) return { ok: false, error: "agent is required" };
  const current = await readLease(storage, now);
  if (!current) return { ok: false, error: "no active lease to renew" };
  if (current.agent !== agent) {
    return { ok: false, error: "only the current lease holder can renew", lease: current };
  }
  const ttl = Math.max(60_000, Math.min(MAX_TTL_MS, Number(ttlMs) || DEFAULT_TTL_MS));
  const lease = {
    agent,
    claimed_at: current.claimed_at,
    renewed_at: new Date(now).toISOString(),
    expires_at: new Date(now + ttl).toISOString()
  };
  await storage.put(LEASE_KEY, lease);
  return { ok: true, lease };
}

export async function releaseLease(storage, agentValue, now = Date.now()) {
  const agent = cleanAgent(agentValue);
  if (!agent) return { ok: false, error: "agent is required" };
  const current = await readLease(storage, now);
  if (!current) return { ok: true, released: false };
  if (current.agent !== agent) return { ok: false, error: "only the current lease holder can release", lease: current };
  await storage.delete(LEASE_KEY);
  return { ok: true, released: true };
}
