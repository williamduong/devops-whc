export interface DeploymentLock {
  key: string;
  owner: string;
  acquiredAt: number;
  expiresAt: number;
}

export interface DeploymentLockService {
  acquire(key: string, owner: string, ttlMs?: number): { ok: true; lock: DeploymentLock } | { ok: false; reason: string };
  release(key: string, owner: string): void;
}

export class InMemoryDeploymentLockService implements DeploymentLockService {
  private readonly locks = new Map<string, DeploymentLock>();

  acquire(key: string, owner: string, ttlMs = 5 * 60 * 1000): { ok: true; lock: DeploymentLock } | { ok: false; reason: string } {
    const now = Date.now();
    const existing = this.locks.get(key);

    if (existing && existing.expiresAt > now) {
      return {
        ok: false,
        reason: `Deployment lock already held by ${existing.owner}`,
      };
    }

    const lock: DeploymentLock = {
      key,
      owner,
      acquiredAt: now,
      expiresAt: now + ttlMs,
    };

    this.locks.set(key, lock);
    return { ok: true, lock };
  }

  release(key: string, owner: string): void {
    const existing = this.locks.get(key);
    if (!existing) {
      return;
    }

    if (existing.owner === owner || existing.expiresAt <= Date.now()) {
      this.locks.delete(key);
    }
  }
}
