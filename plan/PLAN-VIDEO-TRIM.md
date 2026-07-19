# PLAN-VIDEO-TRIM：参考视频快速裁剪

## 背景

Seedance 2.0 参考视频要求单个 2-15s、总时长 ≤15s。目前超长视频直接被
`handleReferenceVideo` 拒绝（报错"单个参考视频时长必须在 2-15 秒之间"），
用户必须先用外部工具剪好再上传。需要一个内置的快速时长裁剪。

## 方案：浏览器端裁剪（mediabunny）

- 新增依赖 `mediabunny`（纯 TS，无 wasm，走 WebCodecs；npm 最新 1.50.9）。
  裁剪在浏览器完成，服务器 / Docker / Windows 启动脚本零改动。
- 无变换时 mediabunny 直接复制编码样本（不重编码），速度快；需要精确
  切点时自动用 WebCodecs 重编码。输出统一 MP4（上传本来就只收 MP4/MOV）。
- 老浏览器不支持 WebCodecs 时 toast 报错降级（提示用户升级浏览器或自行裁剪）。

## 改动清单

### 1. `package.json`
- 添加 `mediabunny` 依赖。

### 2. 新文件 `src/lib/videoTrim.ts`
- `trimVideoFile(file: File, start: number, end: number): Promise<File>`：
  ```ts
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });
  const conversion = await Conversion.init({ input, output, trim: { start, end } });
  await conversion.execute();
  // BufferTarget.buffer -> new File([...], `trim-<原名>.mp4`, { type: "video/mp4" })
  ```
- 失败（不支持的编码 / 无 WebCodecs）抛中文错误信息。

### 3. 新组件 `src/components/VideoTrimPanel.tsx`
仿 `CropPanel.tsx` 的 modal 模式（motion 遮罩 + glass 面板 + Esc 关闭）：
- `<video>` 预览（可播放）；
- 双柄时间范围滑条（自绘：一条轨道 + start/end 两个拖柄，无新依赖），
  显示 `开始 xx.xs / 结束 xx.xs / 时长 xx.xs`；
- 拖动时 video.currentTime 跳到对应位置便于对帧；
- 约束：选区时长 clamp 到 [2s, 15s]（不足 2s 不允许应用；初始选区默认
  从 0 开始、min(15s, 视频总长)）；
- 「应用裁剪」→ 调 `trimVideoFile`，转圈中禁用按钮，完成后回调
  `onDone(file)`、失败 toast。

### 4. `src/components/VideoWorkshop.tsx` 集成
- 本地 state：`trimTarget: { file, previewUrl, duration, replaceIndex: number | null } | null`。
- **入口 A（超长自动弹出）**：`handleReferenceVideo` 中时长 >15s 时不再报
  错拒绝，改为打开裁剪面板（`replaceIndex: null` = 裁完新增）。时长 <2s
  仍直接拒绝（裁剪救不了太短的）。
- **入口 B（卡片裁剪按钮）**：`ReferenceMediaSection` 视频卡片右上角在
  「移除」旁加一个「裁剪」按钮（Scissors 图标），点击带 `replaceIndex`
  打开面板（裁完替换原位置）。
- 裁剪完成回调：走既有 `readMediaMetadata` 校验（时长/尺寸/总时长），
  然后 `addRefVideo` 或替换 `refVideos[replaceIndex]`（替换用
  remove+add 组合即可，注意 revoke 旧 previewUrl）。

### 5. `src/lib/videoStore.ts`
- 追加 `replaceRefVideo(index, asset)` action（替换并 revoke 旧 preview），
  供入口 B 使用。

## 测试

- `npm run test:unit` 回归（videoTrim 依赖浏览器 WebCodecs，不写 node 单测）。
- `npx tsc --noEmit` 通过。
- 手工验证：上传 >15s MP4 自动弹裁剪 → 应用后卡片时长标签正确；
  卡片裁剪按钮二次裁剪正常；总时长 >15s 拦截仍生效。
