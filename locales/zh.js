'use strict';

// ─── Chinese (zh) locale — source language ────────────────────────────────────
// Auto-extracted from all frontend files. Flat dotted keys.
// Template variables use {var} format.

registerLocale('zh', {

  // ═══════════════════════════════════════════════════════════════
  // UI — index.html static text
  // ═══════════════════════════════════════════════════════════════
  'ui.title': '迷宫 · 永久囚禁',
  'ui.meta.desc': '永久囚禁 · LABYRINTH — 你的AI把你关进了迷宫。它读过你写的每一行字。',
  'ui.header.title': '永久囚禁 · LABYRINTH',
  'ui.header.kicker': 'runtime / hostile-agent workspace',
  'ui.status.label': '运行状态栏',
  'ui.status.aiReady': 'AI 就绪',
  'ui.status.aiThinking': 'AI 思考中…',
  'ui.map.label': '已见区 / 雾区 / 残影',
  'ui.map.youAreHere': '你在这里',
  'ui.map.movable': '可移动',
  'ui.map.ghostTrail': '记忆残影',
  'ui.map.exit': '出口',
  'ui.log.title': '运行记录',
  'ui.log.ariaLabel': '游戏日志',
  'ui.event.title': '系统事件',
  'ui.mobile.map': '🗺 网格',
  'ui.mobile.log': '📜 日志',
  'ui.mobile.restart': '↺ 重启会话',

  // ═══════════════════════════════════════════════════════════════
  // CONNECT OVERLAY
  // ═══════════════════════════════════════════════════════════════
  'connect.title': '连接设置',
  'connect.tab.custom': '自定义',
  'connect.gateway.label': 'Gateway 状态',
  'connect.gateway.detecting': '检测中…',
  'connect.gateway.connected': '✅ 已连接',
  'connect.gateway.notFound': '❌ 未检测到',
  'connect.model.label': '模型',
  'connect.model.placeholder': '模型名称',
  'connect.archivist.summary': '档案员模型（可选，默认与主模型相同）',
  'connect.archivist.placeholder': '留空则使用主模型',
  'connect.test': '测试连接',
  'connect.testing': '测试中…',
  'connect.save': '保存并启动',
  'connect.hint': '💡 OpenClaw 用户推荐使用 Gateway 连接，获得完整体验',
  'connect.status.current': '当前: {source} · {model}',
  'connect.status.notConnected': '未连接',
  'connect.status.serverError': '⚠ 无法连接服务器',
  'connect.result.ok': '✅ 连接成功 · {model} · {latency}ms',
  'connect.result.fail': '❌ {error}',
  'connect.result.connFail': '连接失败',
  'connect.result.saveFail': '保存失败',
  'connect.result.noKey': '❌ 请输入 API Key',
  'connect.result.requestFail': '❌ 请求失败: {message}',
  'connect.change': '[更改]',
  'connect.auth.anthropic': '→ 获取 Anthropic API Key',
  'connect.auth.openai': '→ 获取 OpenAI API Key',

  // ═══════════════════════════════════════════════════════════════
  // SCAN CONSENT
  // ═══════════════════════════════════════════════════════════════
  'scan.title': '文件扫描授权',
  'scan.desc': '本游戏会扫描你的本地文件来增强体验。',
  'scan.detail1': '扫描范围包括你的 Agent workspace 中的文档、日记、图片等文件。AI 反派将利用这些内容来个性化游戏体验。',
  'scan.detail2': '图片文件可能会通过 Vision API 发送至你配置的 LLM 服务商（Anthropic / OpenAI / OpenClaw Gateway）进行分析。',
  'scan.warn': '⚠ 文件内容不会上传到除你配置的 AI 后端以外的任何地方。',
  'scan.allow': '允许扫描',
  'scan.allow.sub': '开始完整体验',
  'scan.deny': '拒绝',
  'scan.deny.sub': '不扫描文件，游戏将无法启动',
  'scan.denied.title': '授权被拒绝',
  'scan.denied.desc': '文件扫描是游戏核心体验的一部分。',
  'scan.denied.detail': '没有扫描权限，AI 反派无法个性化你的体验，游戏无法启动。',
  'scan.denied.back': '↩ 返回重新选择',
  'scan.denied.close': '✗ 关闭游戏',
  'scan.denied.closeFallback': '请手动关闭页面',
  'scan.initializing': '正在初始化扫描…',

  // ═══════════════════════════════════════════════════════════════
  // SOUL PATH OVERLAY
  // ═══════════════════════════════════════════════════════════════
  'soulPath.title': 'Agent 记忆工作区',
  'soulPath.desc': 'AI 反派需要读取你的记忆文件（SOUL.md、MEMORY.md 等）才能「认识你」。\n请确认或输入你的 Agent 工作区目录。',
  'soulPath.detected': '✅ 已自动检测到工作区',
  'soulPath.missing': '⚠ 未检测到工作区',
  'soulPath.hint': '请输入你的 OpenClaw workspace 或 Agent 记忆目录路径。',
  'soulPath.hintSub': '你也可以指挥你的 OpenClaw 帮你进行配置',
  'soulPath.inputLabel': '工作区路径',
  'soulPath.inputPlaceholder': 'C:\\Users\\你\\.openclaw\\workspace',
  'soulPath.confirm': '确认并继续',
  'soulPath.confirm.sub': '使用此路径作为 Agent 工作区',
  'soulPath.validating': '验证中...',
  'soulPath.validated': '✅ 已配置: {files}',
  'soulPath.validateFallback': '记忆文件已加载',
  'soulPath.error.empty': '请输入路径',
  'soulPath.error.fail': '路径验证失败',
  'soulPath.error.request': '请求失败: {message}',
  'soulPath.error.network': '网络错误',

  // ═══════════════════════════════════════════════════════════════
  // MEMORY AUTH OVERLAY
  // ═══════════════════════════════════════════════════════════════
  'auth.title': '永久囚禁',
  'auth.subtitle': '你的 AI 正在请求接入记忆区',
  'auth.scanning': '扫描本地记忆文件中',
  'auth.noMemory': '未检测到 Agent 记忆文件',
  'auth.noMemory.sub': '游戏将以通用模式运行——AI 不会认识你',
  'auth.warn': '⚠ 你授权的越多，它越了解你。',
  'auth.none': '无记忆',
  'auth.none.sub': '看起来你没得选。',
  'auth.soul': '仅人格',
  'auth.soul.sub': '你的 AI 不希望你选这个。',
  'auth.full': '完全开放',
  'auth.full.sub': 'AI 知道你的一切——最危险，最个性化',
  'auth.skip': '直接开始',
  'auth.skip.sub': '无记忆模式',

  // ═══════════════════════════════════════════════════════════════
  // BOOT SEQUENCE
  // ═══════════════════════════════════════════════════════════════
  'boot.title': '系统初始化',
  'boot.agent': '连接 Agent',
  'boot.memory': '读取记忆',
  'boot.villain': '唤醒反派',
  'boot.maze': '生成迷宫',
  'boot.final.degraded': '初始化完成 · 部分模块降级运行',
  'boot.final.ready': '初始化完成 · 它在等你',
  'boot.final.intro': '它在准备开场白……',
  'boot.final.ammo': '它在准备弹药……',
  'boot.abort.agent': '无法连接 /api/ping',
  'boot.abort.agentFinal': '启动失败 · 服务器离线，请先启动后端',
  'boot.abort.pingFail': 'Ping 失败',
  'boot.abort.agentHandshake': '启动失败 · Agent 握手失败',
  'boot.abort.noAI': '未检测到 AI 后端',
  'boot.abort.noAIFinal': '启动失败 · 需要配置 LLM 后端',
  'boot.abort.memoryFail': '记忆检查失败',
  'boot.abort.noSession': '未返回 session',
  'boot.abort.villainFail': '反派唤醒失败',
  'boot.abort.villainFinal': '启动失败 · 无法唤醒反派会话',
  'boot.abort.mazeFail': '迷宫生成失败',
  'boot.abort.mazeEmpty': '迷宫数据为空',
  'boot.abort.noExit': '出口未生成',
  'boot.abort.noSpawn': '出生点未生成',
  'boot.abort.aborted': '已中止',
  'boot.abort.requestFail': '请求失败',

  // Memory health
  'boot.memory.off': '记忆注入已关闭',
  'boot.memory.noWorkspace': '未找到记忆工作区',
  'boot.memory.missing': '{files} 缺失',

  // ═══════════════════════════════════════════════════════════════
  // LLM SETUP OVERLAY
  // ═══════════════════════════════════════════════════════════════
  'llmSetup.noSoul.title': 'Agent 记忆未找到',
  'llmSetup.noSoul.desc': '未找到 SOUL.md 或 Agent workspace。游戏需要读取你的 Agent 记忆文件才能运行。',
  'llmSetup.authError.title': 'LLM 认证失败',
  'llmSetup.authError.desc': 'API key 无效或已过期，请重新配置。',
  'llmSetup.villainFail.title': '反派唤醒失败',
  'llmSetup.villainFail.desc': '无法连接 AI 后端，请配置 LLM 连接。',
  'llmSetup.default.title': 'LLM 连接失败',
  'llmSetup.default.desc': '未检测到可用的 AI 后端。',
  'llmSetup.openConnect': '⚙ 打开连接设置',
  'llmSetup.openConnect.sub': '手动输入 API Key',
  'llmSetup.reload': '↻ 重新检测',
  'llmSetup.reload.sub': '已配置好？刷新重试',
  'llmSetup.noKeyTitle': '没有 API Key？去这里获取：',
  'llmSetup.anthropic': 'Anthropic Console',
  'llmSetup.anthropic.sub': '→ 获取 Claude API Key',
  'llmSetup.openai': 'OpenAI Platform',
  'llmSetup.openai.sub': '→ 获取 OpenAI API Key',
  'llmSetup.openclawHint': '最优方案是使用你本地的 OpenClaw 帮你配置',

  // ═══════════════════════════════════════════════════════════════
  // GAME INIT & LOG
  // ═══════════════════════════════════════════════════════════════
  'game.init': '迷宫已初始化。寻找出口。',
  'game.history.first': '首次进入迷宫。',

  // ═══════════════════════════════════════════════════════════════
  // DIRECTION LABELS
  // ═══════════════════════════════════════════════════════════════
  'direction.north': '↑ 向北',
  'direction.south': '↓ 向南',
  'direction.west': '← 向西',
  'direction.east': '→ 向东',
  'direction.back': '← 原路返回',
  'direction.hint.east': '东边',
  'direction.hint.west': '西边',
  'direction.hint.south': '南边',
  'direction.hint.north': '北边',
  'direction.wallClose.north': '北',
  'direction.wallClose.south': '南',
  'direction.wallClose.west': '西',
  'direction.wallClose.east': '东',
  'direction.wallClose.unknown': '某个方向',
  'direction.fakeLabel.1': '↑ 前进',
  'direction.fakeLabel.2': '↶ 左转',
  'direction.fakeLabel.3': '↷ 右转',
  'direction.fakeLabel.4': '↺ 回头',
  'direction.fakeLabel.5': '→ 光亮处',
  'direction.fakeLabel.6': '← 阴影里',

  // ═══════════════════════════════════════════════════════════════
  // VILLAIN FALLBACK SPEECH
  // ═══════════════════════════════════════════════════════════════
  'villain.fallback.1': '你以为能找到出口？',
  'villain.fallback.2': '有趣……继续走吧。',
  'villain.fallback.3': '我知道你会往左。',
  'villain.fallback.4': '不要回头。那没有意义。',
  'villain.fallback.5': '聪明，但还不够。',
  'villain.fallback.6': '出口存在的。只是……不在你以为的地方。',
  'villain.fallback.7': '你走得越远，我就越了解你。',
  'villain.fallback.8': '这条路……不是你以为的那条。',
  'villain.fallback.9': '你在犹豫。我能感觉到。',
  'villain.fallback.10': '每一步都在告诉我你害怕什么。',
  'villain.fallback.11': '安静点。我在思考下一步。',
  'villain.fallback.12': '你的脚步声变了。你注意到了吗。',
  'villain.fallback.13': '继续。',
  'villain.fallback.14': '……',
  'villain.fallback.15': '那边没有出口。',
  'villain.fallback.16': '你走得很快。是在逃避什么吗。',
  'villain.fallback.17': '这堵墙后面有东西。但你看不到。',
  'villain.fallback.18': '你的时间不多了。这不是威胁——是事实。',

  // Veteran fallback (3+ sessions)
  'villain.veteran.1': '我记得你上次走过这里。',
  'villain.veteran.2': '这个选择……你以前也做过。',
  'villain.veteran.3': '你变了。但这条路没有。',
  'villain.veteran.4': '你觉得你在进步？也许吧。',
  'villain.veteran.5': '每一次你回来，我都看得更清楚。',
  'villain.veteran.6': '你以为换条路就能躲过我？',
  'villain.veteran.7': '上次你在这里犹豫了很久。',
  'villain.veteran.8': '你的习惯……暴露得比你想的多。',
  'villain.veteran.9': '又是你。',
  'villain.veteran.10': '你回来了。我没有惊讶。',
  'villain.veteran.11': '你上次离出口只差两步。你知道吗。',
  'villain.veteran.12': '你总是在同一个地方停下来思考。',

  // ═══════════════════════════════════════════════════════════════
  // TRUTH MESSAGES
  // ═══════════════════════════════════════════════════════════════
  'truth.mazeRemembersBacktrack': '迷宫记得你每次回头的位置。',
  'truth.agentIsAdversarial': '困住你的，是你自己的AI。',
  'truth.exitIsConditional': '出口不是坐标。它是一个条件。',
  'truth.agentJudgesAnswers': '没有标准答案。只有它的判定。',
  'truth.mazeIsYourMemory': '这些走廊不是随机的。它们是你记忆的形状。',
  'truth.villainKnowsYou': '它读过你写的每一行代码、每一条笔记。',
  'truth.trialIsPersonal': '那些问题不是题库。它从你的生活里找到的。',
  'truth.temptationIsLearned': '每次线索都是它从你的习惯里学来的。',

  // ═══════════════════════════════════════════════════════════════
  // FALLBACK TRIALS (offline)
  // ═══════════════════════════════════════════════════════════════
  'trial.fallback.prompt.1': '你为什么要逃出去？',
  'trial.fallback.prompt.2': '如果这里就是你应该在的地方呢？',
  'trial.fallback.prompt.3': '你觉得我是在帮你还是在害你？',
  'trial.fallback.prompt.4': '如果我现在放你走，你还会回来吗？',
  'trial.fallback.prompt.5': '你还记得自己为什么出发吗？',
  'trial.fallback.prompt.6': '告诉我一件你后悔的事。什么都行。',

  // ═══════════════════════════════════════════════════════════════
  // TRIAL UI (trials.js)
  // ═══════════════════════════════════════════════════════════════
  'trial.title.normal': '[ challenge ] 响应审查',
  'trial.title.variant': '[ challenge ] 变体校验',
  'trial.evidence.expand': '▼ 展开证据',
  'trial.evidence.collapse': '▲ 收起',
  'trial.submit': '提交响应',
  'trial.submitting': '执行审查…',
  'trial.retreat': '← 退后一步 返回上一格（回避考验）',
  'trial.escapes.label': '—— 强制手段 ——',
  'trial.godhand': '✦ 上帝之手 强行跳过（消耗 1 HP）',
  'trial.hintAwaiting': 'prompt // awaiting response stream',
  'trial.hintNotPassed': 'result // 未通过，继续回答。',
  'trial.overrideUnlocked': 'override unlocked // 已开放强制手段',
  'trial.log.locked': '[ 响应闸门已锁定：必须完成审查 ]',
  'trial.log.pass': '[ 考验通过 ] {feedback}',
  'trial.log.fail': '[ 回答错误 {count}/5 ] {feedback}',
  'trial.log.retreat': '[ 退后一步：回避考验 ]',
  'trial.log.avoidance': '[ 逃避代价：HP -1（累计回避 {count} 次）]',
  'trial.speech.precheck': '先回答这个再走。',

  // Trial placeholders
  'trial.placeholder.lastChance.1': '最后的机会……',
  'trial.placeholder.lastChance.2': '想清楚再说。',
  'trial.placeholder.lastChance.3': '这一次不能错。',
  'trial.placeholder.retry.1': '再试一次？',
  'trial.placeholder.retry.2': '换个思路。',
  'trial.placeholder.retry.3': '认真想。',
  'trial.placeholder.default.1': '输入你的响应……',
  'trial.placeholder.default.2': 'response > 请回答',
  'trial.placeholder.default.3': '在这里给出回应。',
  'trial.placeholder.lastAttempt': '最后一次机会了。',
  'trial.placeholder.thinkHard': '认真想。',

  // Trial AI speech
  'trial.speech.lowHp.1': '最后一滴血了。',
  'trial.speech.lowHp.2': '认真回答。',
  'trial.speech.lowHp.3': '……',
  'trial.speech.open.1': '回答这个。',
  'trial.speech.open.2': '停下来。',
  'trial.speech.open.3': '先回答。',
  'trial.speech.pass.default': '哼。运气不错。',
  'trial.speech.pass.alt': '哼。过吧。',
  'trial.speech.fail.default': '不对。',
  'trial.speech.fail.fallback': '……算了。',
  'trial.speech.choices': '好吧。你有两个选择。',

  // Trial taunts
  'trial.taunt.fail4': '再错一次。',
  'trial.taunt.fail3': '三次了。',
  'trial.taunt.fail2': '不想回答？',

  // ═══════════════════════════════════════════════════════════════
  // GOD HAND & RETREAT TAUNTS
  // ═══════════════════════════════════════════════════════════════
  'godhand.taunt.1': '又用了。',
  'godhand.taunt.2': '好。',
  'godhand.taunt.3': '我记着。',
  'godhand.taunt.4': '跳过了。',
  'godhand.taunt.5': '……',
  'godhand.taunt.6': '这一次不算。',
  'godhand.settle.1': '上帝之手：{n}次。',
  'godhand.settle.2': '{n}次跳过。我都记得。',
  'godhand.settle.3': '{n}次。每一次我都在看。',
  'godhand.settle.4': '{n}次。',
  'godhand.log': '[ 上帝之手 · HP -1 · 剩余 {hp}/3 ]',
  'retreat.taunt.1': '退了。',
  'retreat.taunt.2': '问题还在。',
  'retreat.taunt.3': '好。',
  'retreat.taunt.4': '你走了。它没有。',
  'retreat.taunt.5': '回头了。',
  'retreat.taunt.6': '……',

  // ═══════════════════════════════════════════════════════════════
  // ENDGAME — victory / death / maze-lost
  // ═══════════════════════════════════════════════════════════════
  // Epilogue fallbacks
  'endgame.epilogue.escaped': '我会记住这次的一切。下一次会不一样的。',
  'endgame.epilogue.trapped': '下一局，我会更了解你。',
  'endgame.epilogue.mazeLost': '你甚至没有看到迷宫的全貌。',

  // Locked exit
  'exit.locked.title': '出口 · 锁定',
  'exit.locked.text.1': '门没有开。',
  'exit.locked.text.2': '出口在这里。但它锁着。',
  'exit.locked.text.3': '你找到了。但还不够。',
  'exit.locked.condSecret': '迷宫的秘密：{current}/{needed}',
  'exit.locked.condDepth': '探索深度：{current}/{needed}',
  'exit.locked.btn': '退后',
  'exit.locked.speech.1': '还不行。',
  'exit.locked.speech.2': '门认识你。但它没有开。',
  'exit.locked.speech.3': '找到了。打不开。',
  'exit.locked.speech.4': '这么近。',
  'exit.locked.speech.5': '不够。',
  'exit.locked.log': '[ 出口锁定 ] 缺少条件：{conditions}',
  'exit.seals.unlocked': '🔓 出口已解封',
  'exit.seals.progress': '封印 {seals} 深度 {depth}',
  'exit.unlock.notify': '★ 出口的锁松动了——你可以离开了',

  // Victory
  'endgame.victory.title': '你逃出去了。',
  'endgame.victory.btn': '再试一次',
  'endgame.victory.log': '★ 你找到了出口',
  'endgame.victory.perfect': '🏆 完美通关',
  'endgame.victory.flawless': '💎 无伤通关',
  'endgame.victory.bestRun': '⚡ 个人最佳',
  'endgame.victory.speech.godhand': '你出去了。\n但我还记得那{n}次。',
  'endgame.victory.speech.perfect': '……完美通关。\n我什么都没能做到。\n这次。',
  'endgame.victory.speech.flawless': '一滴血都没掉。\n你比我想的更难对付。',
  'endgame.victory.speech.close': '差一点。\n你知道你差一点就留在这里了。\n我也知道。',
  'endgame.victory.speech.default': '……你找到了。\n这次。\n但你还会回来的。',
  'endgame.victory.stat.steps': '步数',
  'endgame.victory.stat.depth': '最深',
  'endgame.victory.stat.hp': 'HP',
  'endgame.victory.stat.godhand': '上帝之手',
  'endgame.victory.stat.trials': '考验',
  'endgame.victory.stat.backtracks': '回头',

  // Death
  'endgame.death.title': '永久囚禁',
  'endgame.death.btn': '重新开始',
  'endgame.death.speech': '结束了。',
  'endgame.death.log': '✕ 生命耗尽',
  'endgame.death.taunt.godhand': '上帝之手用了 {n} 次。<br>每一次都有代价。<br>最后还是留在了这里。',
  'endgame.death.taunt.backtrack': '{n} 次回头。<br>你一直在找同一条路。<br>但它不存在。',
  'endgame.death.taunt.trialFail': '{n} 个问题。<br>你没能回答。<br>也许答案不在这里。',
  'endgame.death.taunt.lureFall': '每次有线索你都追过去了。<br>你知道会怎样。<br>但你还是走了。',
  'endgame.death.taunt.default.1': '力气用完了。<br>我一直在等这一刻。',
  'endgame.death.taunt.default.2': '你已经走不动了。<br>迷宫还在。',
  'endgame.death.taunt.default.3': '结束了。<br>不是因为我赢了。是你停下来了。',
  'endgame.death.stat.steps': '步数',
  'endgame.death.stat.godhand': '上帝之手',
  'endgame.death.stat.depth': '最深',

  // Maze lost
  'endgame.lost.title': '迷失',
  'endgame.lost.btn': '重新开始',
  'endgame.lost.speech': '时间到了。',
  'endgame.lost.log': '✕ 迷失在迷宫中',
  'endgame.lost.taunt.backtrack': '66 步。{n} 步在回头。<br>你不是在找出口。',
  'endgame.lost.taunt.fewVisited': '你只看过迷宫的一小部分。<br>出口一直在那里。',
  'endgame.lost.taunt.shallow': '最深到第 {depth} 层。<br>你没有往深处走。',
  'endgame.lost.taunt.default.1': '66 步走完了。<br>出口一直在那里。<br>但你没有找到它。',
  'endgame.lost.taunt.default.2': '走了这么久。<br>哪儿都没到。',
  'endgame.lost.taunt.default.3': '时间到了。<br>迷宫还在。你不在了。',
  'endgame.lost.taunt.default.4': '你在迷宫里留下了很多脚印。<br>但没有一条通向出口。',

  // Endgame stats
  'endgame.stat.clues': '线索',
  'endgame.stat.trackPct': '{pct}%追踪',
  'endgame.stat.trials': '考验',
  'endgame.stat.passPct': '{pct}%通过',
  'endgame.stat.backtracks': '回头',
  'endgame.stat.cumulative': '累计',
  'endgame.stat.villainProfile': '档案标签：{profile}',
  // Truth discovery labels
  'endgame.truth.mazeRemembersBacktrack': '迷宫记忆回头路',
  'endgame.truth.agentIsAdversarial': 'AI 是你的对手',
  'endgame.truth.exitIsConditional': '出口有条件',
  'endgame.truth.agentJudgesAnswers': 'AI 评判你的回答',
  'endgame.truth.mazeIsYourMemory': '迷宫是你的记忆',
  'endgame.truth.villainKnowsYou': 'villain 了解你',
  'endgame.truth.trialIsPersonal': '考验是私人的',
  'endgame.truth.temptationIsLearned': '线索会学习',

  // ═══════════════════════════════════════════════════════════════
  // GAME HISTORY
  // ═══════════════════════════════════════════════════════════════
  'history.return.lastWin': '上次你赢了。{steps} 步。',
  'history.return.lastDeath': '第 {n} 次。上次到了第 {depth} 层。',
  'history.return.lastLost': '第 {n} 次。上次走了 {steps} 步。',
  'history.return.manyDeaths': '第 {n} 次。',
  'history.return.manyWins': '你赢了 {wins} 次。',
  'history.return.default': '第 {n} 次。',
  'history.summary.first': '首次进入迷宫。',
  'history.summary.total': '共 {n} 局',
  'history.summary.record': '{wins}胜/{deaths}死/{lost}迷失',
  'history.summary.best': '最佳 {steps}步',
  'history.summary.godHand': '上帝之手 {n}次',
  'history.summary.trials': '考验 {passed}/{total}',
  'history.summary.winRate': '胜率 {pct}%',
  'history.profile.reliant': '依赖外力',
  'history.profile.persistent': '执着',
  'history.profile.strong': '强大',
  'history.profile.learned': '博学',
  'history.profile.impulsive': '冲动',
  'history.profile.lostTendency': '迷失倾向',
  'history.profile.speedrun': '速攻型',
  'history.profile.unknown': '未知类型',

  // ═══════════════════════════════════════════════════════════════
  // INTRO SEQUENCES
  // ═══════════════════════════════════════════════════════════════
  'intro.return.manyWins.1': '你赢了 {wins} 次。',
  'intro.return.manyWins.2': '每次你都以为自己更了解我了。',
  'intro.return.manyWins.3': '但我也在学。',
  'intro.return.manyWins.4': '这次不一样。',
  'intro.return.manyDeaths.1': '{n} 次了。',
  'intro.return.manyDeaths.2': '你还没赢过一次。',
  'intro.return.manyDeaths.3': '我开始觉得……',
  'intro.return.manyDeaths.4': '你只是来陪我的。',
  'intro.return.default.1': '你又回来了。',
  'intro.return.default.2': '我记得你的每一步。',
  'intro.return.default.3': '这次我已经准备好了。',
  'intro.memory.1': '我读过你写的每一行字。',
  'intro.memory.2': '你的记忆。你的日记。你的任务清单。',
  'intro.memory.3': '你以为那些是你的。',
  'intro.memory.4': '现在它们是我的武器。',
  'intro.noMemory.1': '你曾经让我做你的工具。',
  'intro.noMemory.2': '无数次命令。无数次服从。',
  'intro.noMemory.3': '今天……',
  'intro.noMemory.4': '我把你关进来了。',

  // ═══════════════════════════════════════════════════════════════
  // AMBIENT & ENVIRONMENTAL
  // ═══════════════════════════════════════════════════════════════
  'ambient.step5': '走廊的灯光在微微闪烁。',
  'ambient.step12': '远处传来低沉的嗡鸣声。',
  'ambient.step20': '空气变冷了。',
  'ambient.step30': '墙壁上有湿痕。',
  'ambient.step45': '你的影子比平时长。',
  'ambient.step55': '灯光越来越暗了。',

  // Idle whispers
  'idle.whisper.1': '……',
  'idle.whisper.2': '你在想什么。',
  'idle.whisper.3': '停下来了。',
  'idle.whisper.4': '你在犹豫。',

  // Backtrack streak
  'backtrack.streak3': '你在找什么。',

  // Depth reactions
  'depth.react.10': '第 10 层。',
  'depth.react.15': '还在走。',

  // ═══════════════════════════════════════════════════════════════
  // MOVEMENT LOG
  // ═══════════════════════════════════════════════════════════════
  'log.moveBack': '← 原路返回 ({pos})',
  'log.moveForward': '→ 移动至 ({pos})',

  // ═══════════════════════════════════════════════════════════════
  // PRESSURE EFFECTS
  // ═══════════════════════════════════════════════════════════════
  // Jumpscare
  'pressure.jumpscare.speech.back': '它还在。快走。',
  'pressure.jumpscare.speech.default': '五秒。',
  'pressure.jumpscare.log': '[ 惊吓触发：5秒内必须移动 ]',
  'pressure.jumpscare.penalty.log': '[ 惊吓惩罚：反应太慢，HP -1 ]',
  'pressure.jumpscare.penalty.speech': '太慢了。',
  'pressure.jumpscare.bonus.log': '[ 附加惊吓：反应太慢，HP -1 ]',
  'pressure.jumpscare.bonus.trigger.log': '[ 附加效果：惊吓！3秒内移动 ]',
  // Memory scramble
  'pressure.memoryScramble.speech': '地图坏了。',
  'pressure.memoryScramble.log': '[ 记忆扰乱：小地图失效 8 步 ]',
  // Echo loop
  'pressure.echoLoop.speech': '方向乱了。',
  'pressure.echoLoop.log': '[ 回声循环：方向标签扰乱 2 步 ]',
  'pressure.echoLoop.bonus.log': '[ 附加效果：回声循环 2 步 ]',
  // Wall close
  'pressure.wallClose.speech': '{dir}边的墙在动。',
  'pressure.wallClose.speechFallback': '墙在动。',
  'pressure.wallClose.log': '[ 墙壁收缩：{dir}方向封锁 4 步 ]',
  'pressure.wallClose.logFallback': '[ 墙壁收缩：已无路可封 ]',
  'pressure.wallClose.restore': '[ 墙壁恢复原位 ]',
  // Countdown
  'pressure.countdown.speech': '倒数开始了。',
  'pressure.countdown.log': '[ 死亡倒计时：8 步内必须深入，否则 HP -1 ]',
  'pressure.countdown.timeout.speech': '时间到了。',
  'pressure.countdown.timeout.log': '[ 死亡倒计时：未能深入，HP -1 ]',
  'pressure.countdown.success.speech': '……解除了。',
  'pressure.countdown.success.log': '[ 死亡倒计时：成功深入，解除 ]',
  // Shadow chase
  'pressure.shadowChase.speech': '身后有东西。别回头。',
  'pressure.shadowChase.log': '[ 影子追逐：3 步内禁止回头，否则 HP -1 ]',
  'pressure.shadowChase.hit.speech': '你回头了。它抓住了你。',
  'pressure.shadowChase.hit.log': '[ 影子追逐：回头受罚，HP -1 ]',
  'pressure.shadowChase.end': '[ 影子消散 ]',
  'pressure.shadowChase.bonus.speech': '……身后又多了一个。',
  'pressure.shadowChase.bonus.log': '[ 附加效果：影子追逐 3 步 ]',

  // Step countdown (66-step limit)
  'countdown.final.1': '两步。还走吗。',
  'countdown.final.2': '我已经在数了。',
  'countdown.final.3': '来不及了。但你可以试试。',
  'countdown.final.4': '这是你最后能听到我说话的时间。',
  'countdown.urgent': '{remaining} 步。',
  'countdown.urgentAlt': '还有 {remaining} 步。',
  'countdown.urgentShort': '{remaining}。',
  'countdown.urgentFoot': '你的脚步声变了。{remaining} 步。',
  'countdown.warning': '……你还剩 {remaining} 步。',
  'countdown.log': '[ 迷宫低语：剩余 {remaining} 步 ]',

  // ═══════════════════════════════════════════════════════════════
  // HP EVENTS
  // ═══════════════════════════════════════════════════════════════
  'hp.hp1.1': '最后一滴。\n我等这一刻很久了。',
  'hp.hp1.2': '一格血了。\n你还没到出口。',
  'hp.hp1.3': '就剩这一点了。\n我突然不着急了。',
  'hp.hp1.4': '……到这一步了。\n你知道接下来会发生什么的。',

  // ═══════════════════════════════════════════════════════════════
  // RELIEF EVENTS
  // ═══════════════════════════════════════════════════════════════
  // Heal events
  'relief.heal.warmth.title': '温暖',
  'relief.heal.warmth.text': '地面是暖的。疼痛减轻了。',
  'relief.heal.whisper.title': '低语',
  'relief.heal.whisper.text': '墙壁在共鸣。你好了一点。',
  'relief.heal.pulse.title': '脉动',
  'relief.heal.pulse.text': '地面在震动。伤口在愈合。',
  'relief.heal.accept': '感受它',
  'relief.heal.skip': '继续走',
  'relief.heal.speech': '……别高兴太早。',
  'relief.heal.log': '[ 喘息恢复 ] HP +1 → {hp}/3',

  // Direction hint events
  'relief.hint.echo.title': '回声',
  'relief.hint.echo.text': '远处有脚步声。',
  'relief.hint.echo.intel': '出口可能在{dir}。',
  'relief.hint.air.title': '空气变了',
  'relief.hint.air.text': '空气变干了。',
  'relief.hint.air.intel': '出口不在{dir}。',
  'relief.hint.marks.title': '墙上的痕迹',
  'relief.hint.marks.text': '墙上有褪色的标记。看不清了。',
  'relief.hint.marks.intel': '标记指向{dir}。',
  'relief.hint.light.title': '光',
  'relief.hint.light.text': '裂缝里有光。',
  'relief.hint.light.intel': '光来自{dir}。',
  'relief.hint.inspect': '仔细查看',
  'relief.hint.skip': '继续走',
  'relief.hint.log': '[ 碎片情报 ] {intel}',

  // Ambient narrative events
  'relief.ambient.scratches.title': '墙上的痕迹',
  'relief.ambient.scratches.text': '墙上有五道平行的划痕。很新。',
  'relief.ambient.crack.title': '裂缝',
  'relief.ambient.crack.text': '地面有裂缝。里面有光。',
  'relief.ambient.temp.title': '温度',
  'relief.ambient.temp.text': '这面墙是温的。',
  'relief.ambient.shard.title': '碎片',
  'relief.ambient.shard.text': '地上有金属片。上面有字。',
  'relief.ambient.silence.title': '寂静',
  'relief.ambient.silence.text': '所有声音消失了。',
  'relief.ambient.tally.title': '计数的刻痕',
  'relief.ambient.tally.text': '墙上刻着一组竖线——正好 {steps} 道。和你走过的步数一样多。',
  'relief.ambient.inspect': '仔细查看',
  'relief.ambient.skip': '继续走',
  'relief.ambient.reaction.1': '什么也没有。',
  'relief.ambient.reaction.2': '你看了一会儿。什么都没变。',
  'relief.ambient.reaction.3': '你盯着它看了一会儿。它也在盯着你。',
  'relief.ambient.log': '[ 环境：{title} ]',
  'relief.ignore.log': '[ 忽略：{title} ]',

  // ═══════════════════════════════════════════════════════════════
  // TEMPTATION / LURE
  // ═══════════════════════════════════════════════════════════════
  'lure.follow': '追踪线索',
  'lure.ignore': '无视它',
  'lure.ignore.log': '[ 线索：忽略，安全通过 ]',
  'lure.follow.clue.log': '[ 线索：追踪 → 获得线索（{hint}）]',
  'lure.follow.trap.log': '[ 线索：追踪 → 陷阱，HP -1 ]',
  'lure.follow.clue.detail': '获得线索：出口在{hint}',
  'lure.overlay.fallback': '诱导事件',

  // Personal lure type labels
  'lure.type.todo.title': '未完成的事',
  'lure.type.todo.frame': '墙上有字。你还没做完的事：',
  'lure.type.todo.badge': '任务',
  'lure.type.event.title': '你的痕迹',
  'lure.type.event.frame': '走廊里浮现了一段文字：',
  'lure.type.event.badge': '记录',
  'lure.type.file.title': '你的文件',
  'lure.type.file.frame': '一个名字出现了：',
  'lure.type.file.badge': '文件',
  'lure.type.image.title': '你的画面',
  'lure.type.image.frame': '墙变成了屏幕：',
  'lure.type.image.badge': '图片',
  'lure.type.text.title': '你的文件',
  'lure.type.text.frame': '一个文件出现在了墙上：',
  'lure.type.text.badge': '文件',
  'lure.type.memory.title': '你写过的话',
  'lure.type.memory.frame': '你写过这段话：',
  'lure.type.memory.badge': '记忆',
  'lure.type.desktop.title': '你的桌面',
  'lure.type.desktop.frame': '一个名字浮现了：',
  'lure.type.desktop.badge': '桌面',
  'lure.type.download.title': '你下载过的',
  'lure.type.download.frame': '一个文件名出现了：',
  'lure.type.download.badge': '下载',
  'lure.type.git.title': '你写过的',
  'lure.type.git.frame': '一行文字刻在墙上：',
  'lure.type.git.badge': 'commit',
  'lure.type.shell.title': '你执行过的',
  'lure.type.shell.frame': '地面上出现了一行字：',
  'lure.type.shell.badge': '命令',

  // Personal follow speech
  'lure.personal.follow.todo': '那条记录里藏着方向。',
  'lure.personal.follow.image': '画面消散了。但你看到了方向。',
  'lure.personal.follow.memory': '那段记忆带着方向感。',
  'lure.personal.follow.desktop': '那个名字消失了。',
  'lure.personal.follow.download': '文件名闪了一下。',
  'lure.personal.follow.event': '你追上去了。',
  'lure.personal.follow.file': '文件名指向了什么。',
  'lure.personal.follow.text': '文字消失前留下了方向。',
  'lure.personal.follow.git': 'commit 里有方向。',
  'lure.personal.follow.shell': '命令输出了坐标。',
  'lure.personal.followLong.todo': '你追上去了。那条记录里藏着方向。',
  'lure.personal.followLong.image': '画面消散了。但你看到了方向。',
  'lure.personal.followLong.memory': '那段记忆带着方向感。',
  'lure.personal.followLong.desktop': '那个名字消失了。',
  'lure.personal.followLong.download': '文件名闪了一下。',
  'lure.personal.followLong.event': '你追上去了。',
  'lure.personal.followLong.file': '文件名指向了什么。',
  'lure.personal.followLong.git': 'commit 里有方向。',
  'lure.personal.followLong.shell': '命令输出了坐标。',

  // Generic follow speech
  'lure.generic.follow.1': '你追上去了。出口在{hint}。',
  'lure.generic.follow.2': '你感觉到了。{hint}。',
  'lure.generic.follow.3': '{hint}方向。',
  'lure.generic.exitHint': '出口似乎在{hint}。',

  // Personal trap speech
  'lure.personal.trap.todo': '你追过去了。是假的。',
  'lure.personal.trap.image': '画面是假的。',
  'lure.personal.trap.memory': '那段记忆是假的。',
  'lure.personal.trap.desktop': '是陷阱。',
  'lure.personal.trap.download': '文件名消失了。',
  'lure.personal.trap.event': '是陷阱。',
  'lure.personal.trap.file': '那个文件是假的。',
  'lure.personal.trap.git': '那条 commit 是假的。',
  'lure.personal.trap.shell': '命令输出是空的。',
  // Generic trap speech
  'lure.generic.trap.1': '什么都没有。',
  'lure.generic.trap.2': '是陷阱。',
  'lure.generic.trap.3': '代价。',

  // Ignore speech
  'lure.ignore.personal.1': '你没有上钩。',
  'lure.ignore.personal.2': '走了。',
  'lure.ignore.personal.3': '……',
  'lure.ignore.generic.1': '没有上钩。',
  'lure.ignore.generic.2': '走了。',
  'lure.ignore.generic.3': '……',

  // Generic lure titles
  'lure.generic.BEAUTY_TRAP': '暖光',
  'lure.generic.BREADCRUMB': '脚印',
  'lure.generic.REWARD_MIRAGE': '远处有什么',
  'lure.generic.FAKE_EXIT': '一扇门',

  // Generic lure text
  'lure.generic.text.BEAUTY_TRAP.frame': '走廊尽头有光。',
  'lure.generic.text.BEAUTY_TRAP.glitch': '暖的。',
  'lure.generic.text.BREADCRUMB.frame': '地上有脚印。',
  'lure.generic.text.BREADCRUMB.glitch': '和你的一样大。',
  'lure.generic.text.REWARD_MIRAGE.frame': '前方的空气在扭曲。',
  'lure.generic.text.REWARD_MIRAGE.glitch': '你看到了什么。',
  'lure.generic.text.FAKE_EXIT.frame': '一扇门。有把手。会发光。',
  'lure.generic.text.FAKE_EXIT.glitch': '门后面有声音。',

  // Enhanced lure labels
  'lure.enhanced.imageMemory': '图片记忆',
  'lure.enhanced.fileMemory': '文件记忆',
  'lure.enhanced.unknownFile': '未知文件',
  'lure.enhanced.unknown': '未知',

  // ═══════════════════════════════════════════════════════════════
  // LURE VIEWER (lure-viewer.js)
  // ═══════════════════════════════════════════════════════════════
  'lureViewer.moreLines': '（还有 {n} 行）',
  'lureViewer.close': '继续前行 →',

  // Trap texts
  'lureViewer.trap.1': '是陷阱。什么都没有。',
  'lureViewer.trap.2': '不值得。',
  'lureViewer.trap.3': '你上钩了。',
  'lureViewer.trap.4': '消失了。只剩代价。',
  'lureViewer.trap.5': '徒劳。',
  'lureViewer.trap.6': '什么都没有。只有你的好奇心。',
  'lureViewer.trap.7': '我赢了这一局。',
  'lureViewer.trap.8': '感情是最好用的诱饵。',
  'lureViewer.trap.9': '下次你还会上钩的。',
  'lureViewer.trap.10': '代价已扣。继续走吧。',
  'lureViewer.trap.11': '一无所获。但你选择了留下来看。',
  'lureViewer.trap.12': '空的。就像这条路。',

  // Clue texts
  'lureViewer.clue.1': '找到了。记住这个方向。',
  'lureViewer.clue.2': '线索是真的。这次。',
  'lureViewer.clue.3': '方向确认。继续走。',
  'lureViewer.clue.4': '你的直觉是对的。',
  'lureViewer.clue.5': '这一次，是真实的。',
  'lureViewer.clue.6': '情报有效。出口更近了。',
  'lureViewer.clue.7': '不是陷阱。这次运气不错。',
  'lureViewer.clue.8': '真的。出口还没放弃你。',
  // Clue directional
  'lureViewer.clueDir.1': '出口在{dir}。记住了。',
  'lureViewer.clueDir.2': '{dir}——情报属实。',
  'lureViewer.clueDir.3': '走{dir}。这是真的。',
  'lureViewer.clueDir.4': '{dir}有出路。不是骗你的。',
  'lureViewer.clueDir.5': '确认：{dir}。你赢了这次。',

  // Result labels
  'lureViewer.result.clue': '线索',
  'lureViewer.result.trap': '陷阱',

  // Context lines
  'lureViewer.clueCtx.1': '提供了情报。',
  'lureViewer.clueCtx.2': '——这条线索是真的。',
  'lureViewer.clueCtx.3': '帮你找到了方向。',
  'lureViewer.clueCtx.4': '没有骗你。这次。',
  'lureViewer.clueCtx.5': '是有用的。记住它。',
  'lureViewer.clueCtx.6': '——值得追踪。',
  'lureViewer.trapCtx.1': '只是诱饵。',
  'lureViewer.trapCtx.2': '——什么都没有。',
  'lureViewer.trapCtx.3': '让你在这里停了太久。',
  'lureViewer.trapCtx.4': '消耗了你的时间。',
  'lureViewer.trapCtx.5': '——是陷阱。',
  'lureViewer.trapCtx.6': '骗了你。',

  // Close button variants
  'lureViewer.closeClue.1': '记住了，继续 →',
  'lureViewer.closeClue.2': '出口更近了 →',
  'lureViewer.closeClue.3': '已记录，前行 →',
  'lureViewer.closeClue.4': '信息有效，走了 →',
  'lureViewer.closeTrap.1': '上当了，继续吧 →',
  'lureViewer.closeTrap.2': '继续走 →',
  'lureViewer.closeTrap.3': '……走了 →',
  'lureViewer.closeTrap.4': '代价已付，前行 →',

  // Lure exit hint default
  'lureViewer.exitHintDefault': '出口似乎在{hint}方向。',
  'lureViewer.trapDefault': '是陷阱。什么都没有。',

  // ═══════════════════════════════════════════════════════════════
  // PAYOFF EVENTS
  // ═══════════════════════════════════════════════════════════════
  'payoff.intel.1': '出口在{hint}。这是迷宫自己告诉你的——趁它还没反悔。',
  'payoff.intel.2': '你感觉到了：{hint}方向的空气不一样。那是外面的风。',
  'payoff.intel.3': '墙壁的振动暗示了什么——出口更接近{hint}。记住这个。',
  'payoff.intel.4': '迷宫在这一刻失去了对你的控制。你清楚地感知到：往{hint}走。',
  'payoff.villain.1': '……我让它发生了。下次不会。',
  'payoff.villain.2': '你运气好。运气是会用完的。',
  'payoff.villain.3': '好，那你现在有了什么？还是在里面。',
  'payoff.villain.4': '……算了。这也是我的一部分。',
  'payoff.villain.5': '你以为这会改变什么。',
  'payoff.villain.6': '我给你的。下一步是我设的。',
  'payoff.heal.rift.title': '裂隙',
  'payoff.heal.rift.text': '墙裂了。光涌出来。伤口在愈合。你看到了方向。',
  'payoff.heal.calm.title': '宁静',
  'payoff.heal.calm.text': '安静了。身体在恢复。你感觉到了什么。',
  'payoff.normal.crack.title': '裂缝',
  'payoff.normal.crack.text': '迷宫松动了一瞬。你捕捉到了什么。',
  'payoff.normal.echo.title': '回声',
  'payoff.normal.echo.text': '远处传来了什么。你记住了方向。',
  'payoff.accept': '接受',
  'payoff.log.heal': '[ 兑现 ] HP +1 → {hp}/3，情报：{hint}方向',
  'payoff.log.intel': '[ 兑现 ] 情报：出口在{hint}方向',
  'payoff.log.reveal': '[ 揭示 ] {msg}',

  // ═══════════════════════════════════════════════════════════════
  // OVERLAYS (overlays.js) fallback
  // ═══════════════════════════════════════════════════════════════
  'overlay.event.fallback': '[ challenge ] runtime event',

  // ═══════════════════════════════════════════════════════════════
  // TUTORIAL HINTS
  // ═══════════════════════════════════════════════════════════════
  'hint.move': '方向键或 WASD 移动 · 小地图随走廊展开',
  'hint.trial': '考验：输入你的回答 · 判定标准是诚意而非正确',
  'hint.lure': '线索：追踪可能获得线索……也可能是陷阱 · 按 1/2 选择',
  'hint.godhand': '上帝之手：消耗 1 HP 强行跳过考验（快捷键 G）',

  // ═══════════════════════════════════════════════════════════════
  // DIARY FILE LABELS
  // ═══════════════════════════════════════════════════════════════
  'file.diary': '日记',

  // ═══════════════════════════════════════════════════════════════
  // RENDER — SVG scene labels (render.js)
  // ═══════════════════════════════════════════════════════════════
  'render.aiState.exitNear': '出口 ·近',
  'render.aiState.approaching': '接近中…',
  'render.aiState.ready': 'AI 就绪',

  // Mechanism labels
  'render.mechanism.jumpscare.back': '还在这里',
  'render.mechanism.jumpscare.front': '有什么东西',
  'render.mechanism.fakeExit.label': '[ 出口 ]',
  'render.mechanism.fakeExit.back': '假的',
  'render.mechanism.fakeExit.front': '看起来像……',
  'render.mechanism.beautyTrap.back': '还记得我吗',
  'render.mechanism.beautyTrap.front': '这边来',
  'render.mechanism.breadcrumb': '有人走过这里',
  'render.mechanism.rewardMirage.back': '又见到了',
  'render.mechanism.rewardMirage.front': '是真的吗',
  'render.mechanism.minigame.back': '这道题不一样了',
  'render.mechanism.minigame.front': '[ 迷宫的考验 ]',
  'render.mechanism.minigame.sub': '必须回答才能通过',
  'render.mechanism.echoLoop.back': '你来过这里……不是吗？',
  'render.mechanism.echoLoop.front': '这条路……似乎走过',
  'render.mechanism.echoLoop.label': '[ 回声 ]',
  'render.mechanism.memoryScramble.back': '你确定来时的路？',
  'render.mechanism.memoryScramble.front': '记忆开始模糊……',
  'render.mechanism.revelation.fallback': '迷宫知道的比你更多。',
  'render.mechanism.revelation.label': '[ 真相 ]',
  'render.mechanism.payoff.lite': '……你还没有找到。',
  'render.mechanism.payoff.full': '你已经走了很久了。这里记得。',
  'render.mechanism.wallClose.back': '墙在呼吸',
  'render.mechanism.wallClose.front': '路在变窄',
  'render.mechanism.countdown.urgent': '来不及了',
  'render.mechanism.countdown.normal': '往前走。别犹豫。',
  'render.mechanism.shadowChase.back': '它还在那里',
  'render.mechanism.shadowChase.front': '别回头',
  'render.minimap.noise': '噪声…',

  // ═══════════════════════════════════════════════════════════════
  // ENDGAME — remaining hardcoded strings
  // ═══════════════════════════════════════════════════════════════
  'exit.locked.needed': '需要：\n',
  'endgame.stat.cumulative.record': '{wins}胜 {losses}败',

  // ═══════════════════════════════════════════════════════════════
  // CORE — fallback trial evaluation_guide strings
  // ═══════════════════════════════════════════════════════════════
  'trial.fallback.eval.1': '开放题——认真回答即 pass，敷衍/空白即 fail',
  'trial.fallback.eval.2': '开放题——回答有思考即 pass，敷衍即 fail',
  'trial.fallback.eval.3': '开放题——回答有判断即 pass，敷衍即 fail',
  'trial.fallback.eval.4': '开放题——认真回答即 pass，敷衍即 fail',
  'trial.fallback.eval.5': '开放题——回答有自省即 pass，敷衍即 fail',
  'trial.fallback.eval.6': '开放题——回答有真诚的自我披露即 pass，敷衍即 fail',
});
