import { z } from "zod";
import { ToolRequestEnvelope } from "../contracts/envelope";

const payloadSchema = z.object({
  workspace_root: z.string().min(1).optional(),
  target_environment: z.enum(["live", "staging"]).optional(),
  ensure_gitignore_rule: z.boolean().default(true),
  force_reinitialize: z.boolean().default(false),
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

export type WhcPreparePayload = z.infer<typeof payloadSchema>;
export type WhcPrepareRequest = ToolRequestEnvelope<WhcPreparePayload>;

export function validateWhcPrepareRequest(input: unknown): WhcPrepareRequest {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`VALIDATION_ERROR: ${issues}`);
  }
  return parsed.data;
}
