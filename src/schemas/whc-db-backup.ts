import { z } from "zod";
import { ToolRequestEnvelope } from "../contracts/envelope";

const payloadSchema = z.object({
  target_environment: z.enum(["live", "staging"]),
  output_path: z.string().min(1).optional(),
  compress: z.boolean().default(true),
  tables: z.array(z.string().min(1)).optional(),
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

export type WhcDbBackupPayload = z.infer<typeof payloadSchema>;
export type WhcDbBackupRequest = ToolRequestEnvelope<WhcDbBackupPayload>;

export function validateWhcDbBackupRequest(input: unknown): WhcDbBackupRequest {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`VALIDATION_ERROR: ${issues}`);
  }
  return parsed.data;
}
