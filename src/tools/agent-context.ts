/**
 * Agent identity carried through the tool pipeline in HTTP multi-tenant mode.
 * In stdio mode this is `null` (unrestricted access).
 */
export interface AgentContext {
  /** Human-readable agent id from agents.yaml. */
  agentId: string;
  /** Email addresses this agent is authorized to access. */
  accounts: string[];
  /** Whether this agent can provision/remove accounts. */
  provisioning: boolean;
}

/**
 * Check that an agent is authorized to operate on the given email account.
 * In stdio mode (agentContext is null), access is unrestricted.
 *
 * Returns an error message string if denied, or `null` if allowed.
 */
export function checkAccountAccess(
  agentContext: AgentContext | null,
  accountEmail: string,
): string | null {
  if (!agentContext) return null; // stdio mode — unrestricted
  const norm = accountEmail.trim().toLowerCase();
  if (agentContext.accounts.some((a) => a.toLowerCase() === norm)) {
    return null;
  }
  return `Agent "${agentContext.agentId}" is not authorized for account "${accountEmail}"`;
}

/**
 * Check that an agent has provisioning permission.
 * In stdio mode (agentContext is null), provisioning is unrestricted.
 *
 * Returns an error message string if denied, or `null` if allowed.
 */
export function checkProvisioning(
  agentContext: AgentContext | null,
): string | null {
  if (!agentContext) return null; // stdio mode — unrestricted
  if (agentContext.provisioning) return null;
  return `Agent "${agentContext.agentId}" does not have provisioning permission`;
}
