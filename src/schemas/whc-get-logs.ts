import { z } from "zod";
import { ToolRequestEnvelope } from "../contracts/envelope";

const payloadSchema = z.object({
  target_environment: z.enum(["live", "staging"]),
  log_type: z.enum(["apache_error", "apache_access", "cron", "php_error"]).default("apache_error"),
  lines: z.number().int().min(1).max(500).default(50),
});

const requestSchema = z.object({
  request_id: z.string().min(1),
  actor: z.object({
    kind: z.literal("copilot"),
    user_hint: z.string().min(1).optional(),
  }),
  payload: payloadSchema,
});

export type WhcGetLogsPayload = z.infer<typeof payloadSchema>;
export type WhcGetLogsRequest = ToolRequestEnvelope<WhcGetLogsPayload>;

export function validateWhcGetLogsRequest(input: unknown): WhcGetLogsRequest {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`VALIDATION_ERROR: ${issues}`);
  }
  return parsed.data;
}
