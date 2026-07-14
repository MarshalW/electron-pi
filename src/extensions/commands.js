export default function commandsExtension(pi) {
  pi.registerCommand("commands", {
    description: "列出所有可用斜杠命令",
    getArgumentCompletions: (prefix) => {
      const sources = ["extension", "prompt", "skill"];
      const filtered = sources.filter((s) => s.startsWith(prefix));
      return filtered.length > 0 ? filtered.map((s) => ({ value: s, label: s })) : null;
    },
    handler: async (args, ctx) => {
      const commands = pi.getCommands();
      const sourceFilter = args.trim();
      const filtered = sourceFilter
        ? commands.filter((c) => c.source === sourceFilter)
        : commands;

      if (filtered.length === 0) {
        ctx.ui.notify(sourceFilter ? `没有 ${sourceFilter} 类型的命令` : "没有可用命令", "info");
        return;
      }

      const items = [];
      const groups = [
        { key: "extension", label: "--- 扩展 ---" },
        { key: "prompt", label: "--- 提示词 ---" },
        { key: "skill", label: "--- 技能 ---" },
      ];
      for (const { key, label } of groups) {
        const cmds = filtered.filter((c) => c.source === key);
        if (cmds.length > 0) {
          items.push(label);
          items.push(...cmds.map((c) => `/${c.name}${c.description ? ` - ${c.description}` : ""}`));
        }
      }

      const selected = await ctx.ui.select("可用命令", items);
      if (selected && !selected.startsWith("---")) {
        const cmdName = selected.split(" - ")[0].slice(1);
        const cmd = commands.find((c) => c.name === cmdName);
        if (cmd?.sourceInfo?.path) {
          const showPath = await ctx.ui.confirm(cmd.name, `查看来源路径？\n${cmd.sourceInfo.path}`);
          if (showPath) ctx.ui.notify(cmd.sourceInfo.path, "info");
        }
      }
    },
  });

  pi.registerCommand("clear", {
    description: "清空当前对话",
    handler: async (_args, ctx) => {
      ctx.ui.clearMessages()
    },
  });

  pi.registerCommand("new", {
    description: "新建 session 并清空对话",
    handler: async (_args, ctx) => {
      const result = await ctx.newSession()
      if (!result.cancelled) ctx.ui.clearMessages()
    },
  });
}
