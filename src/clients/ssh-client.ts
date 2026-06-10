import { readFileSync } from "node:fs";
import { Client } from "ssh2";
import { AppConfig } from "../config/env";

export interface KeySshTarget {
  host: string;
  port: number;
  username: string;
  privateKeyPath: string;
}

export interface PasswordSshTarget {
  host: string;
  port: number;
  username: string;
  password: string;
}

export interface SshProbeResult {
  ok: boolean;
  latencyMs: number;
  message: string;
}

export interface SshExecResult {
  ok: boolean;
  latencyMs: number;
  stdout: string;
  stderr: string;
  message: string;
}

export class WhcSshClient {
  constructor(private readonly config: AppConfig) {}

  async probe(): Promise<SshProbeResult> {
    return this.probeTarget(this.config.sshTargets.prod);
  }

  async probeTarget(target: KeySshTarget): Promise<SshProbeResult> {
    const startedAt = Date.now();
    const privateKey = readFileSync(target.privateKeyPath);

    return new Promise((resolve) => {
      const client = new Client();

      const timeoutId = setTimeout(() => {
        client.end();
        resolve({
          ok: false,
          latencyMs: Date.now() - startedAt,
          message: "SSH probe timed out",
        });
      }, this.config.sshTimeoutMs);

      client
        .on("ready", () => {
          clearTimeout(timeoutId);
          client.end();
          resolve({
            ok: true,
            latencyMs: Date.now() - startedAt,
            message: "SSH connectivity probe succeeded",
          });
        })
        .on("error", (error) => {
          clearTimeout(timeoutId);
          client.end();
          resolve({
            ok: false,
            latencyMs: Date.now() - startedAt,
            message: error.message,
          });
        })
        .connect({
          host: target.host,
          port: target.port,
          username: target.username,
          privateKey,
          readyTimeout: this.config.sshTimeoutMs,
        });
    });
  }

  async execWithKey(target: KeySshTarget, command: string): Promise<SshExecResult> {
    const startedAt = Date.now();
    const privateKey = readFileSync(target.privateKeyPath);

    return new Promise((resolve) => {
      const client = new Client();

      const timeoutId = setTimeout(() => {
        client.end();
        resolve({
          ok: false,
          latencyMs: Date.now() - startedAt,
          stdout: "",
          stderr: "",
          message: "SSH command timed out",
        });
      }, this.config.sshTimeoutMs);

      client
        .on("ready", () => {
          client.exec(command, (err, stream) => {
            if (err) {
              clearTimeout(timeoutId);
              client.end();
              resolve({
                ok: false,
                latencyMs: Date.now() - startedAt,
                stdout: "",
                stderr: "",
                message: err.message,
              });
              return;
            }

            let stdout = "";
            let stderr = "";
            stream
              .on("close", (code: number | null) => {
                clearTimeout(timeoutId);
                client.end();
                resolve({
                  ok: code === 0,
                  latencyMs: Date.now() - startedAt,
                  stdout: stdout.trim(),
                  stderr: stderr.trim(),
                  message: code === 0 ? "SSH command succeeded" : `SSH command failed with exit code ${code ?? -1}`,
                });
              })
              .on("data", (data: Buffer) => {
                stdout += data.toString("utf8");
              });

            stream.stderr.on("data", (data: Buffer) => {
              stderr += data.toString("utf8");
            });
          });
        })
        .on("error", (error) => {
          clearTimeout(timeoutId);
          client.end();
          resolve({
            ok: false,
            latencyMs: Date.now() - startedAt,
            stdout: "",
            stderr: "",
            message: error.message,
          });
        })
        .connect({
          host: target.host,
          port: target.port,
          username: target.username,
          privateKey,
          readyTimeout: this.config.sshTimeoutMs,
        });
    });
  }

  async execWithPassword(target: PasswordSshTarget, command: string): Promise<SshExecResult> {
    const startedAt = Date.now();

    return new Promise((resolve) => {
      const client = new Client();

      const timeoutId = setTimeout(() => {
        client.end();
        resolve({
          ok: false,
          latencyMs: Date.now() - startedAt,
          stdout: "",
          stderr: "",
          message: "SSH command timed out",
        });
      }, this.config.sshTimeoutMs);

      client
        .on("ready", () => {
          client.exec(command, (err, stream) => {
            if (err) {
              clearTimeout(timeoutId);
              client.end();
              resolve({
                ok: false,
                latencyMs: Date.now() - startedAt,
                stdout: "",
                stderr: "",
                message: err.message,
              });
              return;
            }

            let stdout = "";
            let stderr = "";
            stream
              .on("close", (code: number | null) => {
                clearTimeout(timeoutId);
                client.end();
                resolve({
                  ok: code === 0,
                  latencyMs: Date.now() - startedAt,
                  stdout: stdout.trim(),
                  stderr: stderr.trim(),
                  message: code === 0 ? "SSH command succeeded" : `SSH command failed with exit code ${code ?? -1}`,
                });
              })
              .on("data", (data: Buffer) => {
                stdout += data.toString("utf8");
              });

            stream.stderr.on("data", (data: Buffer) => {
              stderr += data.toString("utf8");
            });
          });
        })
        .on("error", (error) => {
          clearTimeout(timeoutId);
          client.end();
          resolve({
            ok: false,
            latencyMs: Date.now() - startedAt,
            stdout: "",
            stderr: "",
            message: error.message,
          });
        })
        .connect({
          host: target.host,
          port: target.port,
          username: target.username,
          password: target.password,
          readyTimeout: this.config.sshTimeoutMs,
        });
    });
  }
}
