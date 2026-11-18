# 渲染故障预防

## 时间与长镜头

所有分镜时间使用成片秒，区间为 `[start,end)`。长镜头不自动切成 4–8 秒；先检查 8–12 秒内是否有可读变化，再决定是否拆镜。starter 的 `designT` 是内置画法的适配时钟，不能误当成真实成片秒。

## 常见故障

- 装置或 HUD 写进 JSON，却没有为 `scene.id` 注册画法：校验通过不等于画面出现；先做代表帧。
- 章节牌跨越镜头边界时只改字幕，背景状态没有同步：在章节起点和结尾各抽帧。
- 长镜头的 HUD 数值只在首帧设置：用时间直接求值，避免上一帧状态漂移。
- 画面元素贴近四边：在最终分辨率检查安全区，不以低分辨率世界层的“看得见”为准。
- 负向值和损坏状态没有结果动作：补上触发原因、失败反馈或留白。
- 把均匀抽帧报告当成 BPM 或实现框架证据：在交付记录中保留“未知/推断”标记。

导出后仍需 FFprobe、完整解码和首尾/转场/动作峰值抽帧。只要没有实际试听，就不要把候选拍点写成已验证同步。

## 出片链路

直出管道（`-f rawvideo` / `image2pipe` 写 FFmpeg 的 stdin）比落盘快，代价是失败时没有中间产物可复用。子进程提前退出时，往它已关闭的管道写会抛异常，异常类型在 Windows + Python 3.13 上实测如下：

| ffmpeg 失败原因 | 实测抛出的异常 |
|---|---|
| 编码器名写错（`-c:v nonexistent`） | `BrokenPipeError: [Errno 32]` |
| 输出目录不存在 | `BrokenPipeError: [Errno 32]` |
| 输入文件不存在 | `BrokenPipeError: [Errno 32]` |
| 参数非法 | `BrokenPipeError: [Errno 32]` |
| 滤镜名不存在 | `BrokenPipeError: [Errno 32]` |

**关键事实：`BrokenPipeError` 是 `OSError` 的子类**（`issubclass(BrokenPipeError, OSError) is True`）。所以 `except BrokenPipeError` 足以接住上面全部五种；写成 `except (BrokenPipeError, OSError)` 并不会多接住什么，它只是让意图更明显。

真正的坑不在异常类型，而在**只 catch 却不读 stderr**：这样拿到的是一个没有上下文的 `Broken pipe`，看不出 ffmpeg 到底为什么退出。所以必须用 `stderr=subprocess.PIPE`，在异常分支里把 ffmpeg 自己的报错读出来：

```python
assert audio.exists(), f"音轨不存在：{audio}"
assert out.parent.exists(), f"输出目录不存在：{out.parent}"
proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stderr=subprocess.PIPE)
try:
    for i in range(total):
        proc.stdin.write(render_frame(i).tobytes())
    proc.stdin.close()
except (BrokenPipeError, OSError):
    try: proc.stdin.close()
    except OSError: pass
    code = proc.wait()
    raise SystemExit(f"FFmpeg 提前退出（码 {code}）：{proc.stderr.read().decode('utf-8', 'replace')[-400:]}")
```

FFmpeg 命令相应地用 `-v error` 限制 stderr 体积，避免管道写满阻塞。加 `stderr=subprocess.DEVNULL` 或写完再 `stdin.close()` 只处理正常收尾，不覆盖「子进程早退」这一种。渲染前的两条 `assert` 价值最高：参数写错时在第一帧就报出来，不用等渲染完几千帧。

长片优先落盘：直出中断要整片重来，`--frames-dir` 配 `--resume` 只补缺失帧；产线取舍见主文档“依赖与交付”参考入口的产线表。
