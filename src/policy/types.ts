import type { RiskLevel } from "../capabilities/types.js";

export interface DomainPolicy {
  allowedRiskLevels?: RiskLevel[];
  confirmFor?: RiskLevel[];
  rateLimit?: {
    requestsPerMinute: number;
  };
}

export interface PolicyConfig {
  defaults: DomainPolicy;
  sites?: Record<string, DomainPolicy>;
}

export interface ConfirmationProvider {
  confirm(message: string): Promise<boolean>;
}

export interface PolicyCheckTarget {
  id: string;
  domain: string;
  riskLevel: RiskLevel;
}
