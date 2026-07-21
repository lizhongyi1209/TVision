#!/usr/bin/env node
// 存量媒体迁移：把本地回退模式攒下的 output/<uid>/<file> 上传到 S3/R2，
// 键名 <S3_PREFIX>/outputs/<uid>/<file>，与 storage.server.ts 的 objectKey 一致。
//
// 用法（在仓库根目录，.env 里 S3_* 已填好之后）：
//   1) docker cp tvision-app-1:/data/output ./migrate-tmp
//   2) node scripts/migrate-output-to-s3.mjs ./migrate-tmp
//   3) 核对无误后 rm -rf ./migrate-tmp
//
// 幂等：重复运行只是覆盖同键对象，安全。只上传，不删本地。

import { readFileSync, readdirSync, statSync } from "fs";
import path from "path";
import { S3Client, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";

// 读 .env（不引入 dotenv，够用即可）
for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
}

const { S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY } = process.env;
const S3_REGION = process.env.S3_REGION || "auto";
const S3_PREFIX = (process.env.S3_PREFIX || "").replace(/^\/|\/$/g, "");

if (!S3_ENDPOINT || !S3_BUCKET || !S3_ACCESS_KEY || !S3_SECRET_KEY) {
  console.error("缺少 S3 配置，请先在 .env 里填 S3_ENDPOINT / S3_BUCKET / S3_ACCESS_KEY / S3_SECRET_KEY");
  process.exit(1);
}

const root = process.argv[2];
if (!root || !statSync(root, { throwIfNoEntry: false })?.isDirectory()) {
  console.error("用法: node scripts/migrate-output-to-s3.mjs <output目录>  (先 docker cp tvision-app-1:/data/output ./migrate-tmp)");
  process.exit(1);
}

const TYPES = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".mp4": "video/mp4" };

const s3 = new S3Client({
  endpoint: S3_ENDPOINT,
  region: S3_REGION,
  credentials: { accessKeyId: S3_ACCESS_KEY, secretAccessKey: S3_SECRET_KEY },
  forcePathStyle: true,
});

let uploaded = 0, skipped = 0, failed = 0, bytes = 0;

for (const uid of readdirSync(root)) {
  const dir = path.join(root, uid);
  if (!statSync(dir).isDirectory()) continue;
  for (const name of readdirSync(dir)) {
    const type = TYPES[path.extname(name).toLowerCase()];
    if (!type) { console.log(`跳过（类型不识别）: ${uid}/${name}`); skipped++; continue; }
    const key = `${S3_PREFIX ? S3_PREFIX + "/" : ""}outputs/${uid}/${name}`;
    const body = readFileSync(path.join(dir, name));
    try {
      // 已存在且大小一致就跳过，让重跑更快
      const head = await s3.send(new HeadObjectCommand({ Bucket: S3_BUCKET, Key: key })).catch(() => null);
      if (head?.ContentLength === body.length) { skipped++; continue; }
      await s3.send(new PutObjectCommand({ Bucket: S3_BUCKET, Key: key, Body: body, ContentType: type }));
      uploaded++; bytes += body.length;
      console.log(`上传 ${key} (${(body.length / 1024 / 1024).toFixed(1)}MB)`);
    } catch (e) {
      failed++;
      console.error(`失败 ${key}: ${e.message}`);
    }
  }
}

console.log(`\n完成：上传 ${uploaded} 个（${(bytes / 1024 / 1024).toFixed(1)}MB），跳过 ${skipped} 个，失败 ${failed} 个`);
process.exit(failed ? 1 : 0);
