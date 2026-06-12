import dotenv from "dotenv";
import { z } from "zod";

if (process.env.WHC_ENV_FILE && process.env.WHC_ENV_FILE.trim().length > 0) {
  dotenv.config({ path: process.env.WHC_ENV_FILE });
} else {
  dotenv.config();
}

const envSchema = z.object({
  WHC_API_TOKEN: z.string().min(1),
  WHC_USER: z.string().min(1),
  WHC_HOST: z.string().min(1),
  WHC_WORKFLOW_MODE: z.enum(["managed_clone_sync"]).default("managed_clone_sync"),

  WHC_PRIMARY_DOMAIN: z.string().min(1).optional(),
  WHC_TESTING_DOMAIN: z.string().min(1).optional(),
  WHC_STAGING_DOMAIN: z.string().min(1).optional(),

  WHC_PROD_PATH: z.string().min(1).default("/public_html"),
  WHC_STAGING_PATH: z.string().min(1).optional(),

  WHC_REQUIRE_STAGING_CONFIRM: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  WHC_WARN_DYNAMIC_DATA_SYNC: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  WHC_ENFORCE_STAGING_FIRST: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  WHC_PROD_SSH_HOST: z.string().min(1),
  WHC_PROD_SSH_PORT: z.coerce.number().int().positive().default(27),
  WHC_PROD_SSH_USERNAME: z.string().min(1),
  WHC_PROD_SSH_PRIVATE_KEY_PATH: z.string().min(1),

  WHC_STAGING_SSH_HOST: z.string().min(1).optional(),
  WHC_STAGING_SSH_PORT: z.coerce.number().int().positive().optional(),
  WHC_STAGING_SSH_USERNAME: z.string().min(1).optional(),
  WHC_STAGING_SSH_PRIVATE_KEY_PATH: z.string().min(1).optional(),
  WHC_STAGING_SSH_PASSWORD: z.string().min(1).optional(),
  WHC_STAGING_SSH_HOSTKEY: z.string().min(1).optional(),

  WHC_LOCAL_PROJECT_ROOT: z.string().min(1).optional(),
  WHC_LOCAL_APP_PATH: z.string().min(1).optional(),
  WHC_SOURCE_KIND: z
    .enum(["full_site", "partial_content", "package_only", "artifact_first", "monorepo_slice"])
    .default("full_site"),
  WHC_DEPLOY_UNIT: z.enum(["raw_source", "build_artifact", "package_bundle"]).default("raw_source"),
  WHC_BUILD_COMMAND: z.string().min(1).optional(),
  WHC_BUILD_ARTIFACT_PATH: z.string().min(1).optional(),
  WHC_DEFAULT_RELEASE_INTENT: z
    .enum(["refresh", "deploy", "promote", "migrate", "recover"])
    .default("deploy"),

  WHC_API_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
  WHC_SSH_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
  WHC_FLOW_LOG_PATH: z.string().min(1).optional(),
});

export type AppConfig = {
  apiToken: string;
  user: string;
  host: string;
  apiBaseUrl: string;
  workflowMode: "managed_clone_sync";
  domains: {
    primary?: string;
    testing?: string;
    staging?: string;
  };
  paths: {
    prod: string;
    staging?: string;
  };
  sourceProfile: {
    localProjectRoot?: string;
    localAppPath?: string;
    sourceKind: "full_site" | "partial_content" | "package_only" | "artifact_first" | "monorepo_slice";
    deployUnit: "raw_source" | "build_artifact" | "package_bundle";
    buildCommand?: string;
    buildArtifactPath?: string;
    defaultReleaseIntent: "refresh" | "deploy" | "promote" | "migrate" | "recover";
  };
  safety: {
    requireStagingConfirm: boolean;
    warnDynamicDataSync: boolean;
    enforceStagingFirst?: boolean;
  };
  sshTargets: {
    prod: {
      host: string;
      port: number;
      username: string;
      privateKeyPath: string;
    };
    staging?: {
      host: string;
      port: number;
      username: string;
      privateKeyPath?: string;
      password?: string;
      hostKey?: string;
    };
  };
  apiTimeoutMs: number;
  sshTimeoutMs: number;
  flowLogPath?: string;
};

export function loadConfig(env = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => issue.path.join("."))
      .filter((field) => field.length > 0);
    throw new Error(`VALIDATION_ERROR: Missing or invalid env vars: ${issues.join(", ")}`);
  }

  const data = parsed.data;

  const prodSshHost = data.WHC_PROD_SSH_HOST;
  const prodSshPort = data.WHC_PROD_SSH_PORT;
  const prodSshUsername = data.WHC_PROD_SSH_USERNAME;
  const prodSshPrivateKeyPath = data.WHC_PROD_SSH_PRIVATE_KEY_PATH;

  const hasStagingSsh =
    !!data.WHC_STAGING_SSH_HOST || !!data.WHC_STAGING_SSH_USERNAME || !!data.WHC_STAGING_SSH_PRIVATE_KEY_PATH;

  return {
    apiToken: data.WHC_API_TOKEN,
    user: data.WHC_USER,
    host: data.WHC_HOST,
    apiBaseUrl: `https://${data.WHC_HOST}:2083`,
    workflowMode: data.WHC_WORKFLOW_MODE,
    domains: {
      primary: data.WHC_PRIMARY_DOMAIN,
      testing: data.WHC_TESTING_DOMAIN,
      staging: data.WHC_STAGING_DOMAIN,
    },
    paths: {
      prod: data.WHC_PROD_PATH,
      staging: data.WHC_STAGING_PATH,
    },
    sourceProfile: {
      localProjectRoot: data.WHC_LOCAL_PROJECT_ROOT,
      localAppPath: data.WHC_LOCAL_APP_PATH,
      sourceKind: data.WHC_SOURCE_KIND,
      deployUnit: data.WHC_DEPLOY_UNIT,
      buildCommand: data.WHC_BUILD_COMMAND,
      buildArtifactPath: data.WHC_BUILD_ARTIFACT_PATH,
      defaultReleaseIntent: data.WHC_DEFAULT_RELEASE_INTENT,
    },
    safety: {
      requireStagingConfirm: data.WHC_REQUIRE_STAGING_CONFIRM,
      warnDynamicDataSync: data.WHC_WARN_DYNAMIC_DATA_SYNC,
      enforceStagingFirst: data.WHC_ENFORCE_STAGING_FIRST,
    },
    sshTargets: {
      prod: {
        host: prodSshHost,
        port: prodSshPort,
        username: prodSshUsername,
        privateKeyPath: prodSshPrivateKeyPath,
      },
      staging: hasStagingSsh
        ? {
            host: data.WHC_STAGING_SSH_HOST ?? prodSshHost,
            port: data.WHC_STAGING_SSH_PORT ?? prodSshPort,
            username: data.WHC_STAGING_SSH_USERNAME ?? prodSshUsername,
            privateKeyPath: data.WHC_STAGING_SSH_PRIVATE_KEY_PATH,
            password: data.WHC_STAGING_SSH_PASSWORD,
            hostKey: data.WHC_STAGING_SSH_HOSTKEY,
          }
        : undefined,
    },
    apiTimeoutMs: data.WHC_API_TIMEOUT_MS,
    sshTimeoutMs: data.WHC_SSH_TIMEOUT_MS,
    flowLogPath: data.WHC_FLOW_LOG_PATH,
  };
}
