#!/usr/bin/env node
// R2 连通性自检 + 设置 bucket CORS。
// CORS 只为「资产页本地下载」用：下载是 fetch(预签名直链) 再写盘，跨域读响应体
// 必须要 bucket 返回 CORS 头。图片/视频单纯显示不需要 CORS。
//
// 用法：node scripts/r2-setup-cors.mjs
// 读 .env 里的 S3_* 与 DOMAIN。幂等（PutBucketCors 覆盖式）。

import { readFileSync } from "fs";
import {
  S3Client,
  PutBucketCorsCommand,
  GetBucketCorsCommand,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";

for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
}

const { S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY, DOMAIN } = process.env;
if (!S3_ENDPOINT || !S3_BUCKET || !S3_ACCESS_KEY || !S3_SECRET_KEY) {
  console.error("缺少 S3 配置");
  process.exit(1);
}

const s3 = new S3Client({
  endpoint: S3_ENDPOINT,
  region: process.env.S3_REGION || "auto",
  credentials: { accessKeyId: S3_ACCESS_KEY, secretAccessKey: S3_SECRET_KEY },
  forcePathStyle: true,
});

// 允许的来源：生产域名 + 本地开发。带 https 前缀。
const origins = [`https://${DOMAIN}`, "http://localhost:3000", "http://localhost:3002"];

async function main() {
  // 1) 连通性 + 读写权限自检：put 一个探针对象再删掉
  const probeKey = "_healthcheck/probe.txt";
  try {
    await s3.send(new PutObjectCommand({ Bucket: S3_BUCKET, Key: probeKey, Body: "ok", ContentType: "text/plain" }));
    await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: probeKey }));
    await s3.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: probeKey }));
    console.log("✓ R2 读/写/删权限正常");
  } catch (e) {
    console.error(`✗ R2 访问失败：${e.name} ${e.message}`);
    process.exit(1);
  }

  // 2) 设 CORS
  await s3.send(
    new PutBucketCorsCommand({
      Bucket: S3_BUCKET,
      CORSConfiguration: {
        CORSRules: [
          {
            AllowedOrigins: origins,
            AllowedMethods: ["GET", "HEAD"],
            AllowedHeaders: ["*"],
            ExposeHeaders: ["Content-Length", "Content-Type", "ETag"],
            MaxAgeSeconds: 3600,
          },
        ],
      },
    }),
  );
  const got = await s3.send(new GetBucketCorsCommand({ Bucket: S3_BUCKET }));
  console.log("✓ CORS 已设置，允许来源：", got.CORSRules?.[0]?.AllowedOrigins?.join(", "));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
