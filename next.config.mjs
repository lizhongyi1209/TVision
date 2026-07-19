import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: projectRoot,
  // Docker 部署用 standalone 输出（node server.js 直接跑，镜像不带完整 node_modules）
  output: "standalone",
  // better-sqlite3 是原生模块，不能被打进 bundle
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
