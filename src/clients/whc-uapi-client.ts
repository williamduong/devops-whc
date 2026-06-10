import { AppConfig } from "../config/env";

export interface UapiProbeResult {
  ok: boolean;
  status?: number;
  latencyMs: number;
  message: string;
}

export interface UapiRepository {
  repository_root: string;
  type: string;
}

export interface UapiListRepositoriesResult {
  ok: boolean;
  latencyMs: number;
  repositories: UapiRepository[];
  message: string;
}

export interface UapiCreateRepositoryResult {
  ok: boolean;
  latencyMs: number;
  repository_root?: string;
  message: string;
}

export interface UapiTriggerDeploymentResult {
  ok: boolean;
  latencyMs: number;
  deployment_id?: string;
  message: string;
}

interface CpanelUapiResponse<T> {
  result: {
    data: T | null;
    errors: string[] | null;
    status: 0 | 1;
    warnings: string[] | null;
  };
}

export class WhcUapiClient {
  constructor(private readonly config: AppConfig) {}

  private authHeader(): string {
    return `cpanel ${this.config.user}:${this.config.apiToken}`;
  }

  async probe(): Promise<UapiProbeResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.apiTimeoutMs);
    const startedAt = Date.now();

    try {
      const response = await fetch(`${this.config.apiBaseUrl}/execute/VersionControl/list_repositories`, {
        method: "GET",
        headers: {
          Authorization: this.authHeader(),
          Accept: "application/json",
        },
        signal: controller.signal,
      });

      const latencyMs = Date.now() - startedAt;
      if (!response.ok) {
        return {
          ok: false,
          status: response.status,
          latencyMs,
          message: `UAPI probe failed with status ${response.status}`,
        };
      }

      return {
        ok: true,
        status: response.status,
        latencyMs,
        message: "UAPI connectivity probe succeeded",
      };
    } catch (error) {
      const latencyMs = Date.now() - startedAt;
      const message = error instanceof Error ? error.message : "Unknown UAPI probe error";
      return {
        ok: false,
        latencyMs,
        message,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  async listRepositories(): Promise<UapiListRepositoriesResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.apiTimeoutMs);
    const startedAt = Date.now();

    try {
      const response = await fetch(`${this.config.apiBaseUrl}/execute/VersionControl/list_repositories`, {
        method: "GET",
        headers: { Authorization: this.authHeader(), Accept: "application/json" },
        signal: controller.signal,
      });

      const latencyMs = Date.now() - startedAt;
      if (!response.ok) {
        return { ok: false, latencyMs, repositories: [], message: `HTTP ${response.status}` };
      }

      const body = (await response.json()) as CpanelUapiResponse<UapiRepository[]>;
      if (!body.result || body.result.status !== 1) {
        const err = (body.result?.errors ?? []).join("; ") || "UAPI list_repositories failed";
        return { ok: false, latencyMs, repositories: [], message: err };
      }

      return {
        ok: true,
        latencyMs,
        repositories: body.result.data ?? [],
        message: "list_repositories succeeded",
      };
    } catch (error) {
      const latencyMs = Date.now() - startedAt;
      const message = error instanceof Error ? error.message : "Unknown error";
      return { ok: false, latencyMs, repositories: [], message };
    } finally {
      clearTimeout(timeout);
    }
  }

  async createRepository(repositoryRoot: string, originUrl?: string): Promise<UapiCreateRepositoryResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.apiTimeoutMs);
    const startedAt = Date.now();

    const params = new URLSearchParams({ repository_root: repositoryRoot, type: "git" });
    if (originUrl) {
      params.set("origin_url", originUrl);
    }

    try {
      const response = await fetch(`${this.config.apiBaseUrl}/execute/VersionControl/create`, {
        method: "POST",
        headers: {
          Authorization: this.authHeader(),
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: params.toString(),
        signal: controller.signal,
      });

      const latencyMs = Date.now() - startedAt;
      if (!response.ok) {
        return { ok: false, latencyMs, message: `HTTP ${response.status}` };
      }

      const body = (await response.json()) as CpanelUapiResponse<{ repository_root: string }>;
      if (!body.result || body.result.status !== 1) {
        const err = (body.result?.errors ?? []).join("; ") || "UAPI create failed";
        return { ok: false, latencyMs, message: err };
      }

      return {
        ok: true,
        latencyMs,
        repository_root: body.result.data?.repository_root ?? repositoryRoot,
        message: "Repository created successfully",
      };
    } catch (error) {
      const latencyMs = Date.now() - startedAt;
      const message = error instanceof Error ? error.message : "Unknown error";
      return { ok: false, latencyMs, message };
    } finally {
      clearTimeout(timeout);
    }
  }

  async triggerDeployment(repositoryRoot: string, branch?: string): Promise<UapiTriggerDeploymentResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.apiTimeoutMs);
    const startedAt = Date.now();

    const params = new URLSearchParams({ repository_root: repositoryRoot });
    if (branch) {
      params.set("branch", branch);
    }

    try {
      const response = await fetch(`${this.config.apiBaseUrl}/execute/VersionControl/deployment`, {
        method: "POST",
        headers: {
          Authorization: this.authHeader(),
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: params.toString(),
        signal: controller.signal,
      });

      const latencyMs = Date.now() - startedAt;
      if (!response.ok) {
        return { ok: false, latencyMs, message: `HTTP ${response.status}` };
      }

      const body = (await response.json()) as CpanelUapiResponse<{ deployment_id?: string }>;
      if (!body.result || body.result.status !== 1) {
        const err = (body.result?.errors ?? []).join("; ") || "UAPI deployment trigger failed";
        return { ok: false, latencyMs, message: err };
      }

      return {
        ok: true,
        latencyMs,
        deployment_id: body.result.data?.deployment_id,
        message: "Deployment triggered successfully",
      };
    } catch (error) {
      const latencyMs = Date.now() - startedAt;
      const message = error instanceof Error ? error.message : "Unknown error";
      return { ok: false, latencyMs, message };
    } finally {
      clearTimeout(timeout);
    }
  }
}
