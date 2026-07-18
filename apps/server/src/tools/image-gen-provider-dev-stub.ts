// image-gen-provider-dev-stub.ts — 로컬 dev/테스트용 결정론적 ImageGenPort.
//   LOCAL_ONLY 환경엔 실 이미지 생성 API 키가 없으므로 외부 네트워크 호출 없이 프롬프트에서
//   유도한 단색 PNG 를 반환한다(같은 prompt → 같은 바이트). web-search-provider-dev-stub.ts 의
//   "실 provider 는 배포 시 교체" 원칙과 동일. 반환 PNG 는 실제로 디코딩 가능한 유효 이미지라
//   브라우저 인라인 렌더(Playwright/UAT)에서도 그림이 보인다.
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import type { GeneratedImage, ImageGenPort } from "./image-gen-port.js";

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

// prompt 해시에서 유도한 단색으로 size×size PNG 를 합성한다(결정론적, 유효 PNG).
function solidColorPng(prompt: string, size = 64): Buffer {
  const hash = createHash("sha256").update(prompt).digest();
  const [r, g, b] = [hash[0]!, hash[1]!, hash[2]!];

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); // width
  ihdr.writeUInt32BE(size, 4); // height
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(2, 9); // color type 2 = truecolor RGB
  ihdr.writeUInt8(0, 10); // compression
  ihdr.writeUInt8(0, 11); // filter
  ihdr.writeUInt8(0, 12); // interlace

  // raw scanlines: 각 행 앞에 filter byte(0) + size*3(RGB) 픽셀.
  const raw = Buffer.alloc(size * (1 + size * 3));
  let pos = 0;
  for (let y = 0; y < size; y += 1) {
    raw[pos] = 0; // filter type none
    pos += 1;
    for (let x = 0; x < size; x += 1) {
      raw[pos] = r;
      raw[pos + 1] = g;
      raw[pos + 2] = b;
      pos += 3;
    }
  }
  const idat = deflateSync(raw);

  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

export function createDevStubImageGenProvider(): ImageGenPort {
  return {
    async generate(prompt, opts) {
      opts?.signal?.throwIfAborted?.();
      const n = Math.max(1, Math.min(opts?.n ?? 1, 4));
      const images: GeneratedImage[] = [];
      for (let i = 0; i < n; i += 1) {
        // n>1 이면 인덱스를 섞어 서로 다른 색(그러나 여전히 결정론적)으로.
        const seed = i === 0 ? prompt : `${prompt}#${i}`;
        images.push({ data: solidColorPng(seed), mimeType: "image/png" });
      }
      return images;
    },
  };
}
