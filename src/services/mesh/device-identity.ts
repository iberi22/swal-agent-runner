/**
 * DeviceIdentity — Identidad persistente del dispositivo.
 *
 * Almacena un UUID único en IndexedDB (via idb) que sobrevive
 * recargas de página. Expuesto via edgeMeshClient.deviceId.
 *
 * Formato: swal-{uuid-v4-suffix} (ej: swal-a1b2c3d4)
 *
 * Uso:
 *   import { deviceIdentity } from './device-identity';
 *   const id = await deviceIdentity.getId();
 *   const name = await deviceIdentity.getName();
 */

import type { IDBPDatabase } from 'idb';

const STORE_NAME = 'device-identity';
const DB_NAME = 'swal-device-identity';
const DB_VERSION = 1;

/**
 * Device identity information stored in IndexedDB.
 *
 * @property deviceId - Unique device identifier (prefix "swal-")
 * @property name - Human-readable device name
 * @property deviceType - Detected device category (phone, tablet, pc, etc.)
 * @property createdAt - Timestamp when the identity was first created
 * @property lastSeen - Timestamp of the last access
 */
export interface DeviceInfo {
  deviceId: string;
  name: string;
  deviceType: DeviceType;
  createdAt: number;
  lastSeen: number;
}

/**
 * Detected device type categories.
 */
export type DeviceType = 'phone' | 'tablet' | 'pc' | 'web' | 'unknown';

function detectDeviceType(): DeviceType {
  if (typeof navigator === 'undefined') return 'unknown';
  const ua = navigator.userAgent.toLowerCase();
  const isMobile = /android|iphone|ipod|mobile/i.test(ua);
  const isTablet = /ipad|tablet/i.test(ua) || (isMobile && screen.width >= 768);

  if (isTablet) return 'tablet';
  if (isMobile) return 'phone';
  return 'pc';
}

/**
 * Persistent device identity manager.
 *
 * Stores a unique device identifier in IndexedDB (via idb) that survives
 * page reloads. Exposed via {@link EdgeMeshClient.deviceId}.
 *
 * ID format: `swal-{uuid-v4-suffix}` (e.g. `swal-a1b2c3d4`).
 * Device type is auto-detected from user agent and screen dimensions.
 *
 * Usage:
 * ```ts
 * import { deviceIdentity } from './device-identity';
 * const id = await deviceIdentity.getId();
 * const name = await deviceIdentity.getName();
 * ```
 */
class DeviceIdentityManager {
  private cachedInfo: DeviceInfo | null = null;
  private initPromise: Promise<void> | null = null;

  private async ensureDB(): Promise<IDBPDatabase> {
    const { openDB } = await import('idb');
    return openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'key' });
        }
      },
    });
  }

  private async init(): Promise<void> {
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      const db = await this.ensureDB();
      const stored = await db.get(STORE_NAME, 'deviceInfo') as DeviceInfo | undefined;

      if (stored) {
        // Update lastSeen
        stored.lastSeen = Date.now();
        (stored as any).key = 'deviceInfo';
        await db.put(STORE_NAME, stored);
        this.cachedInfo = stored;
      } else {
        const newInfo: DeviceInfo & { key?: string } = {
          key: 'deviceInfo',
          deviceId: 'swal-' + crypto.randomUUID().slice(0, 8),
          name: `Device-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
          deviceType: detectDeviceType(),
          createdAt: Date.now(),
          lastSeen: Date.now(),
        };
        await db.put(STORE_NAME, newInfo);
        this.cachedInfo = newInfo;
      }
    })();

    return this.initPromise;
  }

  /**
   * Get the persistent device ID.
   *
   * @returns The unique device identifier string
   */
  async getId(): Promise<string> {
    await this.init();
    return this.cachedInfo!.deviceId;
  }

  /**
   * Get full device info.
   *
   * @returns A copy of the current DeviceInfo object
   */
  async getInfo(): Promise<DeviceInfo> {
    await this.init();
    return { ...this.cachedInfo! };
  }

  /**
   * Set a human-readable name for this device.
   *
   * @param name - The new device name
   */
  async setName(name: string): Promise<void> {
    await this.init();
    this.cachedInfo!.name = name;
    this.cachedInfo!.lastSeen = Date.now();
    const db = await this.ensureDB();
    await db.put(STORE_NAME, this.cachedInfo);
  }

  /**
   * Get the current device name.
   *
   * @returns The human-readable device name
   */
  async getName(): Promise<string> {
    await this.init();
    return this.cachedInfo!.name;
  }

  /**
   * Get the auto-detected device type.
   *
   * @returns The detected device type (phone, tablet, pc, web, or unknown)
   */
  async getDeviceType(): Promise<DeviceType> {
    await this.init();
    return this.cachedInfo!.deviceType;
  }

  /**
   * Reset device identity, generating a new one.
   *
   * Deletes the existing identity from IndexedDB and creates fresh
   * credentials with a new device ID.
   *
   * @returns The newly created DeviceInfo
   */
  async reset(): Promise<DeviceInfo> {
    this.initPromise = null;
    this.cachedInfo = null;
    const db = await this.ensureDB();
    await db.delete(STORE_NAME, 'deviceInfo');
    await this.init();
    return { ...this.cachedInfo! };
  }
}

/** Global singleton device identity instance. */
export const deviceIdentity = new DeviceIdentityManager();
