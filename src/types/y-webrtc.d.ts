declare module 'y-webrtc' {
  export class WebrtcProvider {
    constructor(roomName: string, doc: any, options?: any);
    destroy(): void;
    room: { connected: boolean };
  }
}

declare module 'y-indexeddb' {
  export class IndexeddbPersistence {
    constructor(name: string, doc: any);
    destroy(): void;
  }
}
