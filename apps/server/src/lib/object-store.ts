// object-store.ts — 업로드/문서 원본 바이트 저장 포트 + dev 구현.
//   LOCAL_ONLY 환경엔 실 S3 가 없으므로, 라우트는 이 포트에 의존하고 dev 는 로컬 FS,
//   테스트는 in-memory 로 주입한다. 배포 시 동일 포트의 S3 구현으로 교체(prod).
//   반환하는 key 를 uploads.s3_key / project_documents.s3_key 컬럼에 저장한다.
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";

export interface ObjectStore {
  /** key 로 바이트 저장 (덮어쓰기). */
  put(key: string, data: Buffer): Promise<void>;
  /** key 의 바이트 조회. 없으면 throw. */
  get(key: string): Promise<Buffer>;
  exists(key: string): Promise<boolean>;
  remove(key: string): Promise<void>;
}

// 경로 탈출(../) 차단 — key 는 상대 경로로만.
function safeJoin(base: string, key: string): string {
  const p = resolve(base, key);
  if (p !== base && !p.startsWith(base + "/")) {
    throw new Error(`object-store: 잘못된 key '${key}'`);
  }
  return p;
}

/** 로컬 FS 기반 dev ObjectStore. baseDir 기본 = $OBJECT_STORE_DIR 또는 os.tmpdir()/wchat-objects. */
export function createLocalObjectStore(baseDir?: string): ObjectStore {
  const base = resolve(
    baseDir ?? process.env.OBJECT_STORE_DIR ?? join(tmpdir(), "wchat-objects"),
  );
  return {
    async put(key, data) {
      const p = safeJoin(base, key);
      await mkdir(dirname(p), { recursive: true });
      await writeFile(p, data);
    },
    async get(key) {
      return readFile(safeJoin(base, key));
    },
    async exists(key) {
      try {
        await readFile(safeJoin(base, key));
        return true;
      } catch {
        return false;
      }
    },
    async remove(key) {
      await rm(safeJoin(base, key), { force: true });
    },
  };
}

/** 테스트용 in-memory ObjectStore. */
export function createInMemoryObjectStore(): ObjectStore {
  const m = new Map<string, Buffer>();
  return {
    async put(key, data) {
      m.set(key, Buffer.from(data));
    },
    async get(key) {
      const v = m.get(key);
      if (!v) throw new Error(`object-store: key 없음 '${key}'`);
      return v;
    },
    async exists(key) {
      return m.has(key);
    },
    async remove(key) {
      m.delete(key);
    },
  };
}
