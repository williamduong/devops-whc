import { z } from "zod";
import { ToolRequestEnvelope } from "../contracts/envelope";

const payloadSchema = z.object({
  workspace_root: z.string().min(1).optional(),
  request_id: z.string().min(1).optional(),
});

const requestSchema = z.object({
  request_id: z.string().min(1),
  actor: z.object({
    kind: z.literal("copilot"),
    user_hint: z.string().min(1).optional(),
  }),
  payload: payloadSchema.default({}),
});

export type WhcPipelineStatusPayload = z.infer<typeof payloadSchema>;
export type WhcPipelineStatusRequest = ToolRequestEnvelope<WhcPipelineStatusPayload>;

export function validateWhcPipelineStatusRequest(input: unknown): WhcPipelineStatusRequest {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`VALIDATION_ERROR: ${issues}`);
  }
  return parsed.data;
}
