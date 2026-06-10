import { z } from "zod";
import { ToolRequestEnvelope } from "../contracts/envelope";

export const SSH_EXEC_SAFE_READ_COMMANDS: readonly string[] = [
  "ls",
  "cat",
  "echo",
  "pwd",
  "df",
  "du",
  "uptime",
  "free",
  "ps",
  "whoami",
  "id",
  "env",
  "printenv",
  "find",
  "grep",
  "tail",
  "head",
  "wc",
  "stat",
  "file",
  "which",
  "test",
];

export const SSH_EXEC_SAFE_WP_PATTERNS: readonly RegExp[] = [
  /^wp\s+--info(\s|$)/i,
  /^wp\s+core\s+(is-installed|version)(\s|$)/i,
  /^wp\s+plugin\s+list(\s|$)/i,
  /^wp\s+theme\s+list(\s|$)/i,
  /^wp\s+option\s+get\s+\S+/i,
  /^wp\s+user\s+list(\s|$)/i,
  /^wp\s+post\s+list(\s|$)/i,
  /^wp\s+db\s+size(\s|$)/i,
  /^wp\s+config\s+get\s+\S+/i,
];

export const SSH_EXEC_SAFE_SYNC_PATTERNS: readonly RegExp[] = [
  /^rsync(\s|$)/i,
];

// Patterns that are never allowed regardless of allowlist.
export const SSH_EXEC_DENYLIST: readonly RegExp[] = [
  /rm\s+-rf\s+\//i,
  /chmod\s+777\s+\//i,
  /chmod\s+-R\s+777\s+\//i,
  /\/etc\/passwd/i,
  /\/etc\/shadow/i,
  />\s*\/dev\/sd[a-z]/i,
  /mkfs/i,
  /dd\s+if=\/dev\/zero/i,
  /\|\s*bash/i,
  /\|\s*sh/i,
  /curl\s+.*\|\s*bash/i,
  /wget\s+.*\|\s*bash/i,
  /nc\s+.*-e/i,
  /ncat\s+.*-e/i,
  /--delete(\s|$)/i,
  /--remove-source-files(\s|$)/i,
];

const payloadSchema = z.object({
  target_environment: z.enum(["live", "staging"]),
  raw_command: z.string().min(1).max(1024),
  working_dir: z.string().min(1).optional(),
});

const requestSchema = z.object({
  request_id: z.string().min(1),
  actor: z.object({
    kind: z.literal("copilot"),
    user_hint: z.string().min(1).optional(),
  }),
  dry_run: z.boolean().optional(),
  confirmed: z.boolean().optional(),
  idempotency_key: z.string().min(1),
  payload: payloadSchema,
});

export type WhcSshExecPayload = z.infer<typeof payloadSchema>;
export type WhcSshExecRequest = ToolRequestEnvelope<WhcSshExecPayload>;

export function validateWhcSshExecRequest(input: unknown): WhcSshExecRequest {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`VALIDATION_ERROR: ${issues}`);
  }
  return parsed.data;
}

/**
 * Returns true if the command is classified as a safe read/sync command.
 */
export function isCommandAllowed(rawCommand: string): { allowed: boolean; reason?: string } {
  const trimmed = rawCommand.trim();

  for (const pattern of SSH_EXEC_DENYLIST) {
    if (pattern.test(trimmed)) {
      return { allowed: false, reason: `Command matches denylist pattern: ${pattern.source}` };
    }
  }

  const firstToken = trimmed.split(/\s+/)[0] ?? "";
  const binaryName = firstToken.split("/").pop() ?? "";

  if (SSH_EXEC_SAFE_READ_COMMANDS.includes(binaryName.toLowerCase())) {
    return { allowed: true };
  }

  for (const pattern of SSH_EXEC_SAFE_WP_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { allowed: true };
    }
  }

  for (const pattern of SSH_EXEC_SAFE_SYNC_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { allowed: true };
    }
  }

  return {
    allowed: false,
    reason: `Command '${binaryName}' is not in the safe read/sync command set. Use read-only probes or rsync-based sync only.`,
  };
}
