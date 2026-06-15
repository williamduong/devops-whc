import { readFileSync, statSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { Client, SFTPWrapper } from "ssh2";
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

export interface SftpUploadResult {
  ok: boolean;
  latencyMs: number;
  uploaded: number;
  failed: number;
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

  async sftpUploadDir(
    target: KeySshTarget,
    localDir: string,
    remoteDir: string,
    skipPatterns?: string[],
  ): Promise<SftpUploadResult> {
    const startedAt = Date.now();
    const privateKey = readFileSync(target.privateKeyPath);
    const allFiles = this.collectLocalFiles(localDir);
    const files = skipPatterns && skipPatterns.length > 0
      ? allFiles.filter((f) => {
          const rel = relative(localDir, f).split(sep).join("/");
          return !skipPatterns.some((pattern) => {
            if (pattern.includes("*")) {
              const regex = new RegExp("^" + pattern.replace(/\*/g, ".*").replace(/\?/g, ".") + "$");
              return regex.test(rel) || regex.test(f.split(/[/\\]/).pop()!);
            }
            return rel === pattern || f.split(/[/\\]/).pop() === pattern;
          });
        })
      : allFiles;
    let uploaded = 0;
    let failed = 0;

    const skipped = allFiles.length - files.length;
    const skipNote = skipped > 0 ? ` (${skipped} file(s) skipped by pattern)` : "";

    return new Promise((resolve) => {
      const client = new Client();

      const timeoutId = setTimeout(() => {
        client.end();
        resolve({
          ok: false,
          latencyMs: Date.now() - startedAt,
          uploaded,
          failed: files.length - uploaded,
          message: "SFTP upload timed out",
        });
      }, this.config.sshTimeoutMs * 3);

      client
        .on("ready", () => {
          client.sftp((err, sftp) => {
            if (err) {
              clearTimeout(timeoutId);
              client.end();
              resolve({
                ok: false,
                latencyMs: Date.now() - startedAt,
                uploaded: 0,
                failed: files.length,
                message: `SFTP session failed: ${err.message}`,
              });
              return;
            }

            this.uploadFiles(sftp, files, localDir, remoteDir)
              .then((result) => {
                clearTimeout(timeoutId);
                client.end();
                resolve({
                  ...result,
                  message: result.message + skipNote,
                });
              })
              .catch((uploadErr) => {
                clearTimeout(timeoutId);
                client.end();
                resolve({
                  ok: false,
                  latencyMs: Date.now() - startedAt,
                  uploaded,
                  failed: files.length - uploaded,
                  message: (uploadErr instanceof Error ? uploadErr.message : "SFTP upload failed") + skipNote,
                });
              });
          });
        })
        .on("error", (error) => {
          clearTimeout(timeoutId);
          client.end();
          resolve({
            ok: false,
            latencyMs: Date.now() - startedAt,
            uploaded: 0,
            failed: files.length,
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

  private collectLocalFiles(localDir: string): string[] {
    const result: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (entry.isFile()) {
          result.push(fullPath);
        }
      }
    };
    walk(localDir);
    return result;
  }

  private async uploadFiles(
    sftp: SFTPWrapper,
    files: string[],
    localDir: string,
    remoteDir: string,
  ): Promise<SftpUploadResult> {
    const startedAt = Date.now();
    let uploaded = 0;
    let failed = 0;
    const localNorm = localDir.replace(/[/\\]$/, "");

    // Ensure remote base directory exists
    await this.mkdirRemote(sftp, remoteDir);

    for (const localPath of files) {
      const relPath = relative(localNorm, localPath).split(sep).join("/");
      const remotePath = `${remoteDir.replace(/\/$/, "")}/${relPath}`;
      const remoteDirname = remotePath.substring(0, remotePath.lastIndexOf("/"));

      try {
        await this.mkdirRemote(sftp, remoteDirname);
        await this.putFile(sftp, localPath, remotePath);
        uploaded++;
      } catch {
        failed++;
      }
    }

    return {
      ok: failed === 0,
      latencyMs: Date.now() - startedAt,
      uploaded,
      failed,
      message: failed === 0
        ? `Uploaded ${uploaded} file(s)`
        : `Uploaded ${uploaded} file(s), ${failed} failed`,
    };
  }

  private mkdirRemote(sftp: SFTPWrapper, remotePath: string): Promise<void> {
    return new Promise((resolve, _reject) => {
      // Try to mkdir, ignore errors (directory may already exist)
      sftp.mkdir(remotePath, { mode: 0o755 }, () => resolve());
    });
  }

  private putFile(sftp: SFTPWrapper, localPath: string, remotePath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const readStream = readFileSync(localPath);
      const writeStream = sftp.createWriteStream(remotePath, {
        mode: 0o644,
      });
      writeStream.on("close", () => resolve());
      writeStream.on("error", (err: Error) => reject(err));
      writeStream.end(readStream);
    });
  }
}
