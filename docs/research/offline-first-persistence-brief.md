# Research Brief — Persistencia Offline-First para PWA Agentic

**Fecha:** 2026-07-28  
**Scope:** swal-agent-runner (PWA React 19 + Vite + TypeScript)  
**Versiones analizadas:** `idb@8.0.2`, edge-mesh `storage/index.ts`, `swal-agent-runner` actual

---

## 1. Estado Actual

### 1.1 IndexedDB — XavierMemoryNode
- Librería: `idb` ^8.0.2 (wrapper promise de IndexedDB, ~3KB)
- Single object store `chunks` con `keyPath: 'id'`
- Índices: `projectId`, `category`, `syncedToMaster`
- Sin migraciones de esquema (DB version = 1)
- Query: carga todo por `projectId` y filtra en JS con scoring BM25-like (keyword matching)
- Sin caché en memoria — cada read golpea IndexedDB directo

### 1.2 localStorage (EdgeMeshSyncService + LLM configs)
- `swal_xavier_peer_endpoint` — endpoint del Xavier Master Node
- `swal_llm_providers` — configuración de proveedores LLM
- `swal_llm_active` — proveedor activo
- `swal_gemini_oauth` — tokens OAuth
- `swal_git_projects` — metadatos de proyectos git
- **Problema:** localStorage es síncrono, bloquea el main thread, límite ~5MB, sin transacciones

### 1.3 Service Worker
- Registro manual en `main.tsx` → `/sw.js`
- Sin vite-plugin-pwa, sin workbox, sin precaching, sin caching strategies

### 1.4 EdgeMeshSyncService
- Polling cada 30s al Xavier Master Node
- Sin cola offline: si falla la red, descarta el sync
- Sin retry exponencial, sin Background Sync API

---

## 2. Edge-Mesh StorageManager (IStorage)

```typescript
interface IStorage {
  get<T>(key: string): Promise<StorageEntry<T> | null>;
  set<T>(key: string, valor: T): Promise<void>;
  delete(key: string): Promise<boolean>;
  list(filter?: StorageFilter): Promise<readonly StorageEntry<unknown>[]>;
  clear(prefijo?: string): Promise<void>;
  size(): Promise<number>;
}

interface StorageEntry<T = unknown> {
  readonly key: string;
  readonly valor: T;
  readonly timestamp: number;
  readonly version: number;
}

interface StorageFilter {
  readonly prefijo?: string;
  readonly desde?: number;    // timestamp filter
  readonly hasta?: number;    // timestamp filter (sic)
  readonly limite?: number;
}
```

**Implementaciones:**
- `InMemoryStorage` — para testing, Map-based
- `StorageManager` — IndexedDB vía `idb`, single store `kv` con `keyPath: "key"`, versionado incremental

**Ventajas del StorageManager:**
- Abstracción limpia con interface `IStorage` → fácil swap backend (mem ↔ idb)
- Type-safe genérica
- Filtros por prefix, timestamp, límite
- Versión de cada entrada para conflictos/CRDT

**Desventajas:**
- Carga todo el store para `list()` con filtro (no usa índices)
- Single object store → mezcla todos los tipos de datos
- Sin soporte de transacciones multi-store en la API
- `clear(prefijo)` filtra en JS → ineficiente con muchos registros

---

## 3. Mejores Prácticas de IndexedDB para Memoria de Agente (2026)

### 3.1 Arquitectura de 4 Capas (consenso industria)

| Capa | Propósito | Backend | Retención | Tamaño |
|------|-----------|---------|-----------|--------|
| **Working** | Contexto activo de la sesión | Context window del LLM | Sesión actual | 8K–200K tokens |
| **Episodic** | Eventos específicos del pasado | IndexedDB + vector search opcional | 30–60 días (decay) | Crecimiento lineal |
| **Semantic** | Hechos duraderos sobre usuario/dominio | IndexedDB (persistente) | 180 días+ (decay lento) | Estable con pruning |
| **Procedural** | Cómo hacer cosas (skills, patterns) | IndexedDB + git (immutable) | Indefinido | Bajo, versionado |

**Fuentes:**
- [AI Agent Memory Architecture 2026 — Feather DB](https://www.getfeather.store/theory/ai-agent-memory-architecture-2026)
- [Persistent Memory AI Agents — RetainDB](https://www.retaindb.com/blogs/persistent-memory-ai-agents)

### 3.2 Patrones Clave para IndexedDB

1. **Múltiples object stores por tipo de entidad**
   - Cada capa de memoria (episodic, semantic, procedural) → su propio store
   - Working memory NO persiste — se reconstruye del context window al inicio

2. **Índices compuestos para queries eficientes**
   - `[projectId+timestamp]` → time-range queries
   - `[category+timestamp]` → filtro por capa
   - `[syncedToMaster]` → sync pendiente sin full scan

3. **In-memory cache layer (LRU)**
   - Cachear reads frecuentes en un Map (ej. últimas 100 entries)
   - IndexedDB es rápido (10–20ms) pero la memoria es instantánea
   - Patrón: `read-through cache` → si no está en LRU, traer de IDB

4. **Persistent storage request**
   - `navigator.storage.persist()` → evita que el browser evacue IDB bajo presión de almacenamiento
   - Best-effort por defecto → LRU-eviction peligrosa para datos del agente

5. **Schema versioning con migraciones**
   - `openDB(..., version: N)` con `upgrade()` manejando `db.oldVersion`
   - Cada cambio de schema = bump de versión + case-switch en upgrade

6. **Transacciones multi-store en writes críticos**
   - Escribir chunk + actualizar índice de búsqueda en misma transacción

### 3.3 Dexie.js vs idb vs localForage

| Criterio | Dexie.js | idb | localForage |
|----------|----------|-----|-------------|
| Bundle size | ~65KB | ~3KB | ~8KB |
| Queries indexed | ✅ Sí | ❌ Manual | ❌ KV only |
| Live queries React | ✅ `useLiveQuery` | ❌ | ❌ |
| Schema migrations | ✅ Versioned tables | ✅ Manual | ❌ |
| Transactions | ✅ Explícitas | ✅ Explícitas | ❌ |
| **Recomendación** | **Si necesitas queries complejas + UI reactiva** | **Si control total + bundle mínimo** | **Solo KV simple** |

**Veredicto para swal-agent-runner:** idb **es adecuado** si se mantiene el control manual de índices. Dexie.js **vale la pena si** el MemoryGraph necesita queries complejas (filtros combinados + ordenamiento + proyecciones). localForage no aporta nada que idb no tenga.

---

## 4. Arquitectura Offline-First

### 4.1 Service Worker + Workbox

**Estado actual:** Sin vite-plugin-pwa, sin workbox, sin caching strategies

**Recomendado:**
```
vite-plugin-pwa (workbox) →
  - Precaching de assets estáticos (app shell)
  - Runtime caching network-first para API calls a Xavier master node
  - Stale-while-revalidate para resources no críticos
  - Cache-first para fonts/libs estáticas
```

### 4.2 Sync offline-first

**Estado actual:** Polling 30s, sin cola offline

**Recomendado:**
```
Background Sync API (registrar sync event en SW) →
  Queue de chunks pendientes en IndexedDB (ya existe syncedToMaster flag)
  Al recuperar conexión → SW ejecuta sync en background
  Retry exponencial: 30s → 1min → 5min → 30min → 2h
```

### 4.3 Conflict Resolution

**Patrón sugerido:** Last-Writer-Wins con version tracking
- `StorageEntry.version` ya existe en edge-mesh
- Completar el campo `version` en `MemoryChunk` (actualmente no tiene version tracking fino)
- Master node decide: si `incoming.version > local.version` → acepta

### 4.4 Flujo completo offline-first para el agente:

```
1. App carga → SW entrega app shell desde precache
2. Agent ejecuta tarea → escribe MemoryChunks a IndexedDB
3. Chunks marcados como syncedToMaster: false
4. Si hay conexión → sync inmediato al Xavier Master Node
5. Si NO hay conexión → chunks quedan en cola offline
6. Al recuperar conexión → Background Sync envía chunks pendientes
7. UI muestra pendingSyncCount en MemorySyncPanel
```

---

## 5. StorageManager vs Implementación Actual — Decisión

### 5.1 Adoptar StorageManager (edge-mesh)?

| Factor | A favor | En contra |
|--------|---------|-----------|
| Interface limpia | ✅ `IStorage` permite swap backend | — |
| Single store | ❌ Mezcla todos los datos | ✅ Simple de implementar |
| Índices | ❌ No usa índices IDB | — |
| Filtros | ✅ Prefix, timestamp, límite | ❌ `list()` hace full scan |
| Type-safe | ✅ Genérica | — |
| Versiones | ✅ `version` tracking | — |

### 5.2 Recomendación: **NO adoptar tal cual; inspirarse**

StorageManager es un **KV genérico** diseñado para edge-mesh (mesh de nodos P2P). La memoria de agente necesita:

1. **Múltiples stores** (episodic, semantic, procedural) — no un solo KV
2. **Índices específicos** (`projectId + timestamp`, `category`, `syncedToMaster`)
3. **Semantic search** (embedding vectors + cosine similarity) — KV no lo cubre
4. **Decay policies** (TTL por capa de memoria)

**Enfoque recomendado:**
- Tomar la **interface `IStorage`** como base (ya es clean)
- Extenderla para el MemoryGraph:
  ```typescript
  interface IMemoryGraphStore extends IStorage {
    queryVector(embedding: number[], topK: number): Promise<MemoryChunk[]>;
    queryByTimeRange(projectId: string, from: number, to: number): Promise<MemoryChunk[]>;
    getDecayStats(): Promise<{ total: number; byLayer: Record<string, number> }>;
  }
  ```
- Implementar `IndexedDBMemoryGraphStore` usando `idb` con 3 object stores
- Dejar `InMemoryStorage` para testing (como edge-mesh)

---

## 6. Arquitectura Recomendada para MemoryGraph en IndexedDB

### 6.1 Schema

```typescript
// DB: swal_xavier_memory_node v2
// Object Stores:

// Store 1: memories
//   keyPath: 'id'
//   indexes:
//     - [projectId+timestamp]  (compound)
//     - [category+timestamp]  (compound)
//     - syncedToMaster        (boolean)
//     - ttl                   (number — expiresAt timestamp)
//   entry: MemoryChunk (ampliado)

// Store 2: embeddings
//   keyPath: 'memoryId'
//   value: Float32Array (vector de embedding)
//   NOTA: IndexedDB no soporta cosine similarity nativa.
//         Para búsqueda semántica real: 
//         Opción A: IndexedDB + scan secuencial (viable con <10K chunks)
//         Opción B: wa-sqlite con sqlite-vec (vector search WASM)
//         Opción C: traer embeddings a memoria y hacer dot product

// Store 3: sync_queue
//   keyPath: 'id'
//   autoIncrement: true
//   indexes:
//     - status  (pending/syncing/failed)
//     - retryAt (timestamp para retry exponencial)
//   metadata: retryCount, lastError
```

### 6.2 Componentes

```mermaid
graph TD
    A[Agent Loop] --> B[XavierMemoryNode (facade)]
    B --> C[MemoryGraphStore (IStorage)]
    B --> D[SyncQueueManager]
    C --> E[IndexedDB vía idb]
    D --> E
    D --> F[Xavier Master Node HTTP]
    D --> G[Background Sync API]
    F --> H[SW sync event]
    G --> H
```

### 6.3 Prioridad de Implementación

1. **PWA hardening** (bajo esfuerzo, alto impacto)
   - `vite-plugin-pwa` + workbox precaching
   - `navigator.storage.persist()`
   - Estrategias de caching en SW (network-first para API, cache-first para assets)

2. **MemoryGraph multi-store** (esfuerzo medio)
   - Dividir `chunks` en 3-4 object stores por capa
   - Añadir índices compuestos
   - Schema migration v1→v2

3. **Sync queue offline-first** (esfuerzo medio)
   - Background Sync API
   - Cola de chunks pendientes con retry exponencial
   - Reemplazar polling 30s por push vía SW

4. **In-memory LRU cache** (bajo esfuerzo)
   - Wrap LRU cache alrededor de MemoryGraphStore
   - ~100 entries, read-through policy

5. **Vector search** (esfuerzo alto — fase posterior)
   - Evaluar wa-sqlite + sqlite-vec si el número de chunks crece >10K
   - Alternativa: secuencial scan con dot product (aceptable para <10K)

---

## 7. Fuentes

| Fuente | URL |
|--------|-----|
| AI Agent Memory Architecture 2026 (Feather DB) | https://www.getfeather.store/theory/ai-agent-memory-architecture-2026 |
| Persistent Memory AI Agents (RetainDB) | https://www.retaindb.com/blogs/persistent-memory-ai-agents |
| Dexie.js vs localForage vs idb 2026 (PkgPulse) | https://www.pkgpulse.com/guides/dexie-vs-localforage-vs-idb-indexeddb-browser-storage-2026 |
| Offline-First PWAs: SW Caching Strategies (MagicBell) | https://www.magicbell.com/blog/offline-first-pwas-service-worker-caching-strategies |
| Work with IndexedDB (web.dev) | https://web.dev/articles/indexeddb |
| Offline-First Local-First PWA (DEV.to) | https://dev.to/crisiscoresystems/offline-first-without-a-backend-a-local-first-pwa-architecture-you-can-trust-3j15 |
| Is IndexedDB viable in 2026? (Reddit) | https://www.reddit.com/r/webdev/comments/1rn206u/is_indexeddb_actually_viable_in_2026_or_am_i |
| Edge-mesh StorageManager | `/home/belal/proyectosSWAL/edge-mesh/src/storage/index.ts` |
| swal-agent-runner XavierMemoryNode | `/home/belal/proyectosSWAL/swal-agent-runner/src/services/memory/xavier-memory-node.ts` |
| swal-agent-runner EdgeMeshSyncService | `/home/belal/proyectosSWAL/swal-agent-runner/src/services/memory/edge-mesh-sync.ts` |
| swal-agent-runner MemoryChunk type | `/home/belal/proyectosSWAL/swal-agent-runner/src/types/index.ts` |

---

## 8. Conclusiones

1. **idb se queda** — es la librería correcta para el nivel de abstracción que necesitamos (3KB, control total, tipos TypeScript excelentes). Dexie.js sería overkill hasta que el MemoryGraph requiera queries complejas reactivas.

2. **StorageManager no se adopta directamente** — es un KV genérico para edge-mesh P2P. La memoria de agente necesita stores diferenciados, índices, y semantic search. Sí se toma la interface `IStorage` como inspiración.

3. **La prioridad #1 es PWA hardening** — falta `vite-plugin-pwa`, `navigator.storage.persist()`, y caching strategies. Es bajo esfuerzo y alto impacto en UX offline.

4. **La actual taxonomía de MemoryChunk (episodic/semantic/procedural/working) es correcta** y se alinea con la industria 2026. Solo hay que separarla en stores distintos.

5. **El patrón offline-first ya está esbozado** (syncedToMaster flag) pero le falta: Background Sync, retry exponencial, y que el Service Worker maneje el sync en background.

6. **Vector search es fase posterior** — con <10K chunks, el scoring secuencial (BM25-like actual) es suficiente. Cuando crezca, evaluar wa-sqlite + sqlite-vec en WebWorker.
