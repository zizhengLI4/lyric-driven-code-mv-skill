# 歌词驱动代码 MV Skill

把歌词写成角色的行动，用原曲重音安排动作和切镜，制作可编辑的代码动画 MV。适用于像素 RPG、游戏界面叙事，以及已有歌词 MV 的分镜和卡点优化。内置 starter 与 Remotion 两条路线。

[查看《冬天又来临·四格相纸》等制作案例](skills/lyric-driven-code-mv/references/production-cases.md)

## 安装到 Codex

```bash
npx skills add zizhengLI4/lyric-driven-code-mv-skill --skill lyric-driven-code-mv -g -a codex
```

手动安装见[起步指南](GETTING-STARTED.md)。内置 starter 使用 Node.js 18+、FFmpeg 与 FFprobe。

## 开始制作

```text
用 $lyric-driven-code-mv 给这首歌做 MV。
录音和歌词：[文件路径]。范围：[片段或整曲]。画幅与风格：[要求]。
先给我场景和主要角色静帧确认，再生成成片。
```

- [起步指南](GETTING-STARTED.md) · 安装、接歌与首次导出
- [主 Skill](skills/lyric-driven-code-mv/SKILL.md) · 制作流程、素材与验收入口
- [维护指南](MAINTENANCE.md) · 开发与回归测试。完整测试随仓库提供，在克隆的仓库根目录运行 `node --test`。
