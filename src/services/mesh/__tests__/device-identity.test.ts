import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { DeviceInfo } from '../device-identity';

// ----------------------------------------------------------------
// Hoisted mock targets — survive resetModules across re-imports
// ----------------------------------------------------------------

// Shared db mock object
const mockDb = {
  get: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
};

// Upgrade callback spies — track whether createObjectStore was called correctly
const mockCreateObjectStore = vi.hoisted(() => vi.fn());
const mockContains = vi.hoisted(() => vi.fn());
const mockOpenDB = vi.hoisted(() => vi.fn());

vi.mock('idb', () => ({
  openDB: mockOpenDB,
}));

// Configure openDB default behaviour
function setupOpenDB() {
  mockOpenDB.mockReset();
  mockOpenDB.mockImplementation(
    async (_name: string, _version: number, { upgrade }: any) => {
      upgrade({
        objectStoreNames: { contains: mockContains },
        createObjectStore: mockCreateObjectStore,
      });
      return mockDb;
    },
  );
}

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------
const uuid = vi.fn();
const random = vi.fn();

async function freshModule() {
  vi.resetModules();
  setupOpenDB();
  return import('../device-identity');
}

let mockDeviceInfo: DeviceInfo | undefined;

beforeEach(() => {
  mockDeviceInfo = undefined;

  // crypto.randomUUID
  uuid.mockReturnValue('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
  Object.defineProperty(globalThis, 'crypto', {
    value: { randomUUID: uuid },
    configurable: true,
    writable: true,
  });

  // Math.random — 0.42 gives Device-F4BI
  random.mockReturnValue(0.42);
  vi.spyOn(Math, 'random').mockImplementation(random);

  // Fixed time
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-07-29T20:00:00Z'));

  // Reset mock DB
  mockDb.get.mockReset();
  mockDb.put.mockReset();
  mockDb.delete.mockReset();
  mockCreateObjectStore.mockReset();
  mockContains.mockReset();

  mockDb.get.mockImplementation(async () => mockDeviceInfo);
  mockDb.put.mockImplementation(async (_store: string, value: DeviceInfo) => {
    mockDeviceInfo = value;
  });
  mockDb.delete.mockImplementation(async () => {
    mockDeviceInfo = undefined;
  });

  // Default: store does not exist yet
  mockContains.mockReturnValue(false);
  setupOpenDB();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// ----------------------------------------------------------------
// Tests
// ----------------------------------------------------------------
describe('DeviceIdentityManager', () => {
  // ─── singleton export ───────────────────────────────────────
  describe('singleton export', () => {
    it('exports a deviceIdentity singleton with all async methods', async () => {
      const { deviceIdentity } = await freshModule();
      expect(deviceIdentity).toBeDefined();
      expect(typeof deviceIdentity.getId).toBe('function');
      expect(typeof deviceIdentity.getInfo).toBe('function');
      expect(typeof deviceIdentity.getName).toBe('function');
      expect(typeof deviceIdentity.setName).toBe('function');
      expect(typeof deviceIdentity.getDeviceType).toBe('function');
      expect(typeof deviceIdentity.reset).toBe('function');
    });
  });

  // ─── IndexedDB setup — kills upgrade + DB-name mutants ──────
  describe('IndexedDB setup', () => {
    it('calls openDB with the correct database name and version', async () => {
      await freshModule();
      // The first import triggers init → ensureDB → openDB
      // Wait for lazy init by calling any method
      const { deviceIdentity } = await import('../device-identity');
      await deviceIdentity.getId();

      expect(mockOpenDB).toHaveBeenCalledWith(
        'swal-device-identity',
        1,
        expect.objectContaining({ upgrade: expect.any(Function) }),
      );
    });

    it('creates the object store when it does not exist yet', async () => {
      mockContains.mockReturnValue(false);
      const { deviceIdentity } = await freshModule();
      await deviceIdentity.getId();

      expect(mockContains).toHaveBeenCalledWith('device-identity');
      expect(mockCreateObjectStore).toHaveBeenCalledWith('device-identity', {
        keyPath: 'key',
      });
    });

    it('does not re-create the object store when it already exists', async () => {
      mockContains.mockReturnValue(true);
      const { deviceIdentity } = await freshModule();
      await deviceIdentity.getId();

      expect(mockContains).toHaveBeenCalledWith('device-identity');
      expect(mockCreateObjectStore).not.toHaveBeenCalled();
    });
  });

  // ─── getId ──────────────────────────────────────────────────
  describe('getId', () => {
    it('returns a string prefixed with "swal-"', async () => {
      const { deviceIdentity } = await freshModule();
      const id = await deviceIdentity.getId();
      expect(id).toMatch(/^swal-/);
    });

    it('uses the first 8 hex chars of crypto.randomUUID', async () => {
      const { deviceIdentity } = await freshModule();
      const id = await deviceIdentity.getId();
      // randomUUID mock returns 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
      // slice(0,8) → 'a1b2c3d4'
      expect(id).toBe('swal-a1b2c3d4');
    });

    it('returns the same id on repeated calls', async () => {
      const { deviceIdentity } = await freshModule();
      const id1 = await deviceIdentity.getId();
      const id2 = await deviceIdentity.getId();
      expect(id2).toBe(id1);
    });

    it('reads existing identity from IndexedDB on init', async () => {
      mockDeviceInfo = {
        deviceId: 'swal-99999999',
        name: 'ExistingDevice',
        deviceType: 'pc',
        createdAt: 1000,
        lastSeen: 2000,
      };

      const { deviceIdentity } = await freshModule();
      const id = await deviceIdentity.getId();
      expect(id).toBe('swal-99999999');
      expect(await deviceIdentity.getName()).toBe('ExistingDevice');
    });

    it('updates lastSeen when re-initializing from stored data', async () => {
      mockDeviceInfo = {
        deviceId: 'swal-persist',
        name: 'Old',
        deviceType: 'pc',
        createdAt: 100,
        lastSeen: 100,
      };

      const { deviceIdentity } = await freshModule();
      const info = await deviceIdentity.getInfo();

      expect(info.lastSeen).toBe(Date.now());
      expect(info.createdAt).toBe(100);
      expect(mockDb.put).toHaveBeenCalledWith(
        'device-identity',
        expect.objectContaining({ lastSeen: Date.now() }),
      );
    });
  });

  // ─── getInfo ────────────────────────────────────────────────
  describe('getInfo', () => {
    it('returns a DeviceInfo object with all fields', async () => {
      const { deviceIdentity } = await freshModule();
      const info = await deviceIdentity.getInfo();
      expect(info).toMatchObject({
        deviceId: expect.any(String),
        name: expect.any(String),
        deviceType: expect.any(String),
        createdAt: expect.any(Number),
        lastSeen: expect.any(Number),
      });
    });

    it('returns a shallow copy, not internal reference', async () => {
      const { deviceIdentity } = await freshModule();
      const info1 = await deviceIdentity.getInfo();
      const info2 = await deviceIdentity.getInfo();
      expect(info1).not.toBe(info2);
      expect(info1).toEqual(info2);
    });
  });

  // ─── getName ────────────────────────────────────────────────
  describe('getName', () => {
    it('returns default name in Device-XXXX format', async () => {
      const { deviceIdentity } = await freshModule();
      const name = await deviceIdentity.getName();
      expect(name).toMatch(/^Device-/);
    });

    it('uses Math.random to generate the suffix', async () => {
      // 0.42.toString(36) → '0.f4bi...' → slice(2,6) → 'f4bi' → 'F4BI'
      const { deviceIdentity } = await freshModule();
      const name = await deviceIdentity.getName();
      expect(name).toBe('Device-F4BI');
    });
  });

  // ─── setName ────────────────────────────────────────────────
  describe('setName', () => {
    it('updates the device name', async () => {
      const { deviceIdentity } = await freshModule();
      await deviceIdentity.setName('My Device');
      expect(await deviceIdentity.getName()).toBe('My Device');
    });

    it('persists new name to IndexedDB', async () => {
      const { deviceIdentity } = await freshModule();
      await deviceIdentity.setName('StoredName');

      expect(mockDb.put).toHaveBeenCalledWith(
        'device-identity',
        expect.objectContaining({ name: 'StoredName' }),
      );
    });

    it('updates lastSeen after setName', async () => {
      const { deviceIdentity } = await freshModule();
      const before = Date.now();
      vi.advanceTimersByTime(1000);
      await deviceIdentity.setName('Updated');
      const info = await deviceIdentity.getInfo();
      expect(info.lastSeen).toBeGreaterThan(before);
    });

    it('handles empty string name', async () => {
      const { deviceIdentity } = await freshModule();
      await deviceIdentity.setName('');
      expect(await deviceIdentity.getName()).toBe('');
    });

    it('handles unicode characters in name', async () => {
      const { deviceIdentity } = await freshModule();
      await deviceIdentity.setName('🔥 ñoño 🔥');
      expect(await deviceIdentity.getName()).toBe('🔥 ñoño 🔥');
    });
  });

  // ─── getDeviceType ──────────────────────────────────────────
  describe('getDeviceType', () => {
    it('returns "pc" for a desktop-like user agent', async () => {
      const { deviceIdentity } = await freshModule();
      expect(await deviceIdentity.getDeviceType()).toBe('pc');
    });

    it('returns "phone" when userAgent contains mobile keywords', async () => {
      Object.defineProperty(navigator, 'userAgent', {
        value: 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 ... Mobile',
        configurable: true,
      });
      Object.defineProperty(screen, 'width', {
        value: 375,
        configurable: true,
        writable: true,
      });
      const { deviceIdentity } = await freshModule();
      expect(await deviceIdentity.getDeviceType()).toBe('phone');
    });

    it('returns "tablet" when userAgent contains ipad', async () => {
      Object.defineProperty(navigator, 'userAgent', {
        value:
          'Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X) AppleWebKit/605.1.15',
        configurable: true,
      });
      const { deviceIdentity } = await freshModule();
      expect(await deviceIdentity.getDeviceType()).toBe('tablet');
    });

    it('returns "tablet" when mobile UA and screen width >= 768', async () => {
      Object.defineProperty(navigator, 'userAgent', {
        value: 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 ... Mobile',
        configurable: true,
      });
      Object.defineProperty(screen, 'width', {
        value: 1024,
        configurable: true,
        writable: true,
      });
      const { deviceIdentity } = await freshModule();
      expect(await deviceIdentity.getDeviceType()).toBe('tablet');
    });

    it('returns "tablet" when mobile UA and screen width exactly 768', async () => {
      // Kills the >= → > mutant: width === 768 must still be tablet
      Object.defineProperty(navigator, 'userAgent', {
        value: 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 ... Mobile',
        configurable: true,
      });
      Object.defineProperty(screen, 'width', {
        value: 768,
        configurable: true,
        writable: true,
      });
      const { deviceIdentity } = await freshModule();
      expect(await deviceIdentity.getDeviceType()).toBe('tablet');
    });

    it('returns "unknown" when navigator is undefined', async () => {
      const origNav = globalThis.navigator;
      // @ts-expect-error — testing edge case
      delete globalThis.navigator;
      const { deviceIdentity } = await freshModule();
      expect(await deviceIdentity.getDeviceType()).toBe('unknown');
      globalThis.navigator = origNav;
    });
  });

  // ─── reset ──────────────────────────────────────────────────
  describe('reset', () => {
    it('returns a new DeviceInfo with a different deviceId', async () => {
      const { deviceIdentity } = await freshModule();
      const origId = await deviceIdentity.getId();

      uuid.mockReturnValue('ffffffff-ffff-ffff-ffff-ffffffffffff');
      random.mockReturnValue(0.99);

      const newInfo = await deviceIdentity.reset();
      expect(newInfo.deviceId).toBe('swal-ffffffff');
      expect(newInfo.deviceId).not.toBe(origId);
    });

    it('makes getId return the new id after reset', async () => {
      const { deviceIdentity } = await freshModule();
      const origId = await deviceIdentity.getId();

      uuid.mockReturnValue('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
      await deviceIdentity.reset();

      expect(await deviceIdentity.getId()).toBe('swal-bbbbbbbb');
      expect(await deviceIdentity.getId()).not.toBe(origId);
    });

    it('deletes old record from IndexedDB before re-initializing', async () => {
      const { deviceIdentity } = await freshModule();
      await deviceIdentity.getId();

      mockDb.delete.mockClear();
      await deviceIdentity.reset();

      expect(mockDb.delete).toHaveBeenCalledWith(
        'device-identity',
        'deviceInfo',
      );
    });

    it('generates a new random name after reset', async () => {
      const { deviceIdentity } = await freshModule();
      const origName = await deviceIdentity.getName();

      random.mockReturnValue(0.12345);
      await deviceIdentity.reset();

      const newName = await deviceIdentity.getName();
      expect(newName).not.toBe(origName);
    });
  });

  // ─── IndexedDB interaction ──────────────────────────────────
  describe('IndexedDB persistence', () => {
    it('puts the new identity into the store on first init', async () => {
      const { deviceIdentity } = await freshModule();
      await deviceIdentity.getId();

      expect(mockDb.put).toHaveBeenCalledWith(
        'device-identity',
        expect.objectContaining({
          deviceId: expect.stringMatching(/^swal-/),
        }),
      );
    });

    it('reads identity from the store when one already exists', async () => {
      mockDeviceInfo = {
        deviceId: 'swal-already-exists',
        name: 'Already Here',
        deviceType: 'tablet',
        createdAt: 500,
        lastSeen: 500,
      };

      const { deviceIdentity } = await freshModule();
      const id = await deviceIdentity.getId();
      expect(id).toBe('swal-already-exists');
      expect(await deviceIdentity.getName()).toBe('Already Here');
    });
  });

  // ─── Edge cases ─────────────────────────────────────────────
  describe('edge cases', () => {
    it('handles concurrent getId calls without error', async () => {
      const { deviceIdentity } = await freshModule();
      const [id1, id2, id3] = await Promise.all([
        deviceIdentity.getId(),
        deviceIdentity.getId(),
        deviceIdentity.getId(),
      ]);
      expect(id1).toBe(id2);
      expect(id2).toBe(id3);
    });

    it('handles reset → getId → setName → getInfo sequence', async () => {
      const { deviceIdentity } = await freshModule();
      await deviceIdentity.reset();
      const id = await deviceIdentity.getId();
      expect(id).toMatch(/^swal-/);

      await deviceIdentity.setName('AfterReset');
      const info = await deviceIdentity.getInfo();
      expect(info.name).toBe('AfterReset');
      expect(info.deviceId).toBe(id);
    });

    it('handles very long device names', async () => {
      const { deviceIdentity } = await freshModule();
      const longName = 'x'.repeat(1000);
      await deviceIdentity.setName(longName);
      expect(await deviceIdentity.getName()).toBe(longName);
    });
  });
});
