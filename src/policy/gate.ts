import type { PolicyConfig, DomainPolicy, PolicyCheckTarget, ConfirmationProvider } from "./types.js";

export class PolicyViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PolicyViolationError";
  }
}

export class RateLimiter {
  private windows = new Map<string, number[]>();

  checkAndConsume(domain: string, requestsPerMinute: number): boolean {
    const now = Date.now();
    const windowStart = now - 60_000;

    let timestamps = this.windows.get(domain) ?? [];
    // Evict timestamps older than 60s
    timestamps = timestamps.filter((t) => t > windowStart);

    if (timestamps.length >= requestsPerMinute) {
      this.windows.set(domain, timestamps);
      return false; // Rate limit exceeded
    }

    timestamps.push(now);
    this.windows.set(domain, timestamps);
    return true;
  }
}

export const DEFAULT_POLICY: PolicyConfig = {
  defaults: {
    allowedRiskLevels: ["read", "write", "destructive"],
    confirmFor: ["destructive"],
    rateLimit: {
      requestsPerMinute: 60,
    },
  },
};

export class PolicyGate {
  private config: PolicyConfig;
  private rateLimiter = new RateLimiter();

  constructor(config: PolicyConfig = DEFAULT_POLICY) {
    this.config = config;
  }

  resolvePolicy(domain: string): DomainPolicy {
    const siteOverride = this.config.sites?.[domain] ?? {};
    return {
      allowedRiskLevels: siteOverride.allowedRiskLevels ?? this.config.defaults.allowedRiskLevels,
      confirmFor: siteOverride.confirmFor ?? this.config.defaults.confirmFor,
      rateLimit: siteOverride.rateLimit ?? this.config.defaults.rateLimit,
    };
  }

  requiresConfirmation(target: PolicyCheckTarget): boolean {
    const policy = this.resolvePolicy(target.domain);
    return Boolean(policy.confirmFor?.includes(target.riskLevel));
  }

  async check(target: PolicyCheckTarget, confirmationProvider?: ConfirmationProvider): Promise<void> {
    const policy = this.resolvePolicy(target.domain);

    // 1. Allowed risk level gate
    if (policy.allowedRiskLevels && !policy.allowedRiskLevels.includes(target.riskLevel)) {
      throw new PolicyViolationError(
        `Action '${target.id}' with risk level '${target.riskLevel}' is not permitted on domain '${target.domain}' by policy.`
      );
    }

    // 2. Confirmation gate
    if (this.requiresConfirmation(target)) {
      if (!confirmationProvider) {
        throw new PolicyViolationError(
          `Confirmation required for '${target.riskLevel}' action '${target.id}' on ${target.domain}, but no confirmation provider was available.`
        );
      }
      const confirmed = await confirmationProvider.confirm(
        `Confirm execution of ${target.riskLevel} action '${target.id}' on ${target.domain}?`
      );
      if (!confirmed) {
        throw new PolicyViolationError(`Action '${target.id}' was rejected by confirmation gate.`);
      }
    }

    // 3. Rate limit gate
    if (policy.rateLimit?.requestsPerMinute) {
      const allowed = this.rateLimiter.checkAndConsume(target.domain, policy.rateLimit.requestsPerMinute);
      if (!allowed) {
        throw new PolicyViolationError(
          `Rate limit of ${policy.rateLimit.requestsPerMinute} req/min exceeded for domain '${target.domain}'.`
        );
      }
    }
  }
}
