"use client";

// 参考视频快速裁剪（PLAN-VIDEO-TRIM）：浏览器端用 mediabunny（WebCodecs）
// 把上传的 MP4/MOV 裁到指定时间段，输出 MP4 File。无变换的样本直接复制
// （不重编码），只有切点附近需要重编码，速度接近无损剪辑。

import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  Conversion,
  Input,
  Mp4OutputFormat,
  Output,
} from "mediabunny";

/** 把 file 裁剪到 [start, end]（秒），返回新的 MP4 File。 */
export async function trimVideoFile(
  file: File,
  start: number,
  end: number,
  onProgress?: (ratio: number) => void,
): Promise<File> {
  if (typeof VideoEncoder === "undefined" || typeof VideoDecoder === "undefined") {
    throw new Error("当前浏览器不支持视频裁剪（需要 WebCodecs），请升级浏览器或自行裁剪后上传");
  }
  if (!(end > start)) throw new Error("裁剪区间无效");

  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat(), target });

  let conversion: Conversion;
  try {
    conversion = await Conversion.init({ input, output, trim: { start, end }, showWarnings: false });
  } catch {
    throw new Error("无法读取该视频编码，浏览器不支持裁剪此文件");
  }
  if (!conversion.isValid) {
    throw new Error("该视频的编码格式无法在浏览器中裁剪");
  }
  if (onProgress) conversion.onProgress = (ratio) => onProgress(ratio);

  try {
    await conversion.execute();
  } catch {
    throw new Error("视频裁剪失败，请更换浏览器或自行裁剪后上传");
  }

  const buffer = target.buffer;
  if (!buffer || buffer.byteLength === 0) throw new Error("裁剪结果为空");

  const base = file.name.replace(/\.(mp4|mov)$/i, "");
  return new File([buffer], `${base}-trim.mp4`, { type: "video/mp4" });
}
