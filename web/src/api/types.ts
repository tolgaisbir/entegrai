// Backend'in döndürdüğü şekillerin frontend tarafındaki (kasıtlı olarak gevşek) karşılığı.
// Tam şema için bkz. packages/db/prisma/schema.prisma ve app/src/routes/**.

export interface AuthUser {
  id: string;
  fullName: string;
  email: string;
  authSource: "local" | "ldap";
  isActive: boolean;
  mustChangePassword: boolean;
  isAdmin: boolean;
}

export interface Skill {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
}

export interface RoleMcpPermission {
  id: string;
  mcpIntegrationId: string;
  allowedOperations: string[];
  getFilters: Record<string, unknown>;
  mcpIntegration: { id: string; name: string; type: string };
}

export interface RoleAiProviderGrant {
  id: string;
  aiProviderId: string;
  aiProvider: { id: string; name: string; providerType: string };
}

export interface Role {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  createdAt: string;
  mcpPermissions: RoleMcpPermission[];
  aiProviders: RoleAiProviderGrant[];
}

export interface User {
  id: string;
  fullName: string;
  email: string;
  authSource: "local" | "ldap";
  ldapDn: string | null;
  isActive: boolean;
  mustChangePassword: boolean;
  createdAt: string;
  skills?: Skill[];
  roles?: Role[];
}

export interface AiProvider {
  id: string;
  name: string;
  providerType: "openai" | "anthropic" | "azure_openai" | "google" | "other";
  apiBaseUrl: string | null;
  model: string;
  defaultParams: Record<string, unknown>;
  isActive: boolean;
  apiKeyPreview: string;
  createdAt: string;
  updatedAt: string;
}

export interface McpIntegration {
  id: string;
  name: string;
  type: "http_api" | "database" | "internal_tool" | "file_share" | "smtp_mail";
  connectionConfig: Record<string, unknown>;
  toolSchema: Record<string, unknown>;
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BudgetPolicy {
  id: string;
  aiProviderId: string;
  scopeType: "global" | "skill" | "user";
  scopeId: string | null;
  period: "daily" | "monthly";
  limitUsd: string;
  createdAt: string;
  updatedAt: string;
}

export interface BudgetStatus {
  period: "daily" | "monthly";
  source: "user" | "skill" | "global";
  limitUsd: number;
  usedUsd: number;
  remainingUsd: number;
  exceeded: boolean;
}

export interface ChatSession {
  id: string;
  userId: string;
  skillId: string;
  aiProviderId: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
  skill?: Skill;
  aiProvider?: { id: string; name: string; providerType: string };
  messages?: ChatMessage[];
  budget?: BudgetStatus[];
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: "user" | "assistant" | "tool";
  content: string;
  toolCallData: unknown;
  createdAt: string;
}

export interface ChatSessionGroup {
  skill: Skill;
  sessions: ChatSession[];
}
