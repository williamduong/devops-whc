import { z } from "zod";
import { ToolRequestEnvelope } from "../contracts/envelope";

const payloadSchema = z
  .object({
    target_environment: z.enum(["live", "staging"]),
    rollback_mode: z.enum(["git_branch", "db_backup", "managed_sync_reverse"]),
    rollback_branch: z.string().min(1).optional(),
    backup_reference: z.string().min(1).optional(),
    direction: z.enum(["live_to_staging", "staging_to_live"]).optional(),
    reason: z.string().min(1),
    verify_release_id: z.string().min(1).optional(),
    verify_report_path: z.string().min(1).optional(),
    repository_root: z.string().min(1).optional(),
  })
  .superRefine((payload, ctx) => {
    if (payload.rollback_mode === "git_branch" && !payload.rollback_branch) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["rollback_branch"],
        message: "rollback_branch is required for rollback_mode=git_branch",
      });
    }

    if (payload.rollback_mode === "db_backup" && !payload.backup_reference) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["backup_reference"],
        message: "backup_reference is required for rollback_mode=db_backup",
      });
    }

    if (payload.rollback_mode === "managed_sync_reverse" && !payload.direction) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["direction"],
        message: "direction is required for rollback_mode=managed_sync_reverse",
      });
    }
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

export type WhcRollbackPayload = z.infer<typeof payloadSchema>;
export type WhcRollbackRequest = ToolRequestEnvelope<WhcRollbackPayload>;

export function validateWhcRollbackRequest(input: unknown): WhcRollbackRequest {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`VALIDATION_ERROR: ${issues}`);
  }
  return parsed.data;
}
