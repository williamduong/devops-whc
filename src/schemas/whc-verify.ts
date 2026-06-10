import { z } from "zod";
import { ToolRequestEnvelope } from "../contracts/envelope";

const payloadSchema = z.object({
  target_environment: z.enum(["live", "staging"]),
  release_id: z.string().min(1).optional(),
  manifest_path: z.string().min(1).optional(),
  verify_level: z.enum(["default", "with_db"]).default("default"),
  random_sample_size: z.number().int().min(1).max(1000).optional(),
  random_seed: z.string().min(1).optional(),
});

const requestSchema = z.object({
  request_id: z.string().min(1),
  actor: z.object({
    kind: z.literal("copilot"),
    user_hint: z.string().min(1).optional(),
  }),
  payload: payloadSchema,
});

export type WhcVerifyPayload = z.infer<typeof payloadSchema>;
export type WhcVerifyRequest = ToolRequestEnvelope<WhcVerifyPayload>;

export function validateWhcVerifyRequest(input: unknown): WhcVerifyRequest {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`VALIDATION_ERROR: ${issues}`);
  }
  return parsed.data;
}
