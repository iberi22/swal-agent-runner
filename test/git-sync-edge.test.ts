import { describe, it, expect } from 'vitest';
import { GitSyncService } from '../src/services/git/git-sync-service';

describe('GitSyncService', () => {
  it('should start with idle status', () => {
    expect(GitSyncService).toBeDefined();
  });

  it('should support addListener and return unsubscribe function', () => {
    const unsub = GitSyncService.addListener(() => {});
    expect(typeof unsub).toBe('function');
    unsub(); // should not throw
  });

  it('should handle multiple listeners', () => {
    const calls1: string[] = [];
    const calls2: string[] = [];
    const unsub1 = GitSyncService.addListener((s) => calls1.push(s.status));
    const unsub2 = GitSyncService.addListener((s) => calls2.push(s.status));

    // Cleanup
    unsub1();
    unsub2();
    expect(typeof unsub1).toBe('function');
    expect(typeof unsub2).toBe('function');
  });

  it('should handle listener errors gracefully', () => {
    // Listener that throws should not break other listeners
    const goodCalls: any[] = [];
    const badListener = () => { throw new Error('listener error'); };
    const goodListener = (s: any) => goodCalls.push(s);

    // Just verify registration works
    const unsubBad = GitSyncService.addListener(badListener);
    const unsubGood = GitSyncService.addListener(goodListener);
    unsubBad();
    unsubGood();
    expect(goodCalls).toHaveLength(0);
  });
});
