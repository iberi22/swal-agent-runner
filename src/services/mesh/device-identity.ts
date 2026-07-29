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

export interface DeviceInfo {
  deviceId: string;
  name: string;
  deviceType: DeviceType;
  createdAt: number;
  lastSeen: number;
}

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
        await db.put(STORE_NAME, stored);
        this.cachedInfo = stored;
      } else {
        const newInfo: DeviceInfo = {
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

  /** Obtener el ID persistente del dispositivo. */
  async getId(): Promise<string> {
    await this.init();
    return this.cachedInfo!.deviceId;
  }

  /** Obtener toda la info del dispositivo. */
  async getInfo(): Promise<DeviceInfo> {
    await this.init();
    return { ...this.cachedInfo! };
  }

  /** Establecer un nombre legible para el dispositivo. */
  async setName(name: string): Promise<void> {
    await this.init();
    this.cachedInfo!.name = name;
    this.cachedInfo!.lastSeen = Date.now();
    const db = await this.ensureDB();
    await db.put(STORE_NAME, this.cachedInfo);
  }

  /** Obtener el nombre del dispositivo. */
  async getName(): Promise<string> {
    await this.init();
    return this.cachedInfo!.name;
  }

  /** Obtener el tipo de dispositivo detectado. */
  async getDeviceType(): Promise<DeviceType> {
    await this.init();
    return this.cachedInfo!.deviceType;
  }

  /** Resetear identidad (genera una nueva). */
  async reset(): Promise<DeviceInfo> {
    this.initPromise = null;
    this.cachedInfo = null;
    const db = await this.ensureDB();
    await db.delete(STORE_NAME, 'deviceInfo');
    await this.init();
    return { ...this.cachedInfo! };
  }
}

/** Singleton global de identidad de dispositivo. */
export const deviceIdentity = new DeviceIdentityManager();
