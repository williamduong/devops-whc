import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface AuditEntry {
  actionId: string;
  tool: string;
  status: "success" | "failure";
  timestamp: string;
  details?: Record<string, string | number | boolean>;
}

export interface AuditLogger {
  log(entry: AuditEntry): void;
}

export class ConsoleAuditLogger implements AuditLogger {
  log(entry: AuditEntry): void {
    const safeEntry = toSafeEntry(entry);
    // Console logging is temporary; production sink can be added later.
    console.log("[AUDIT]", JSON.stringify(safeEntry));
  }
}

export class FileAuditLogger implements AuditLogger {
  constructor(private readonly filePath: string) {}

  log(entry: AuditEntry): void {
    const safeEntry = toSafeEntry(entry);
    mkdirSync(dirname(this.filePath), { recursive: true });
    appendFileSync(this.filePath, JSON.stringify(safeEntry) + "\n", { encoding: "utf8" });
  }
}

export class CompositeAuditLogger implements AuditLogger {
  constructor(private readonly sinks: AuditLogger[]) {}

  log(entry: AuditEntry): void {
    for (const sink of this.sinks) {
      sink.log(entry);
    }
  }
}

function toSafeEntry(entry: AuditEntry): AuditEntry {
  return {
    ...entry,
    details: redactSecrets(entry.details),
  };
}

function redactSecrets(details?: Record<string, string | number | boolean>): Record<string, string | number | boolean> | undefined {
  if (!details) {
    return undefined;
  }

  const result: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(details)) {
    if (/token|secret|password|key/i.test(key)) {
      result[key] = "[REDACTED]";
      continue;
    }
    result[key] = value;
  }
  return result;
}
