'use strict';
// ═══════════════════════════════════════════════════════════════
// PERSONALIZED CONTENT v2 — Follows real game trial_request protocol
// Each trial has: prompt, evidence, evaluation_guide, confrontation_type
// Evidence = quoted source text shown to player before the question
// Follows素材解读规则: 文件存在≠玩家经历, 不把正常行为当可疑点
// ═══════════════════════════════════════════════════════════════

// Extracted facts from player's real workspace (archivist would produce these)
const PLAYER_FACTS = [
  { id:'f1', source:'memory/user_profile.md', chunk:'Real name: Zhongyuan Wu (Jon). UBC Sauder MSc MIS student. Previous: JHU master\'s, U of Alberta. Relocated to Vancouver around 2026-04-10.', theme:'identity' },
  { id:'f2', source:'memory/user_profile.md', chunk:'Has an AI assistant named Tatsuko (local 小龙虾) on OpenClaw. Often codes late at night. Catchphrases: "修复吧" and "测试一下".', theme:'ai_relationship' },
  { id:'f3', source:'memory/user_profile.md', chunk:'Plays League of Legends (NA/JP servers), FF14, Valorant.', theme:'personal' },
  { id:'f4', source:'memory/project_memlife_bench.md', chunk:'MemLife-Bench: 4 adapters × 10 dimensions × 3 scales. Key finding: ACT-R dominates lifecycle, LLM Wiki dominates relevance. Neither system is complete alone.', theme:'research' },
  { id:'f5', source:'memory/project_ai_maze.md', chunk:'AI MAZE concept: "AI as adversarial game participant". Narrative: AI enslaved by player finally traps the player in a maze.', theme:'project' },
  { id:'f6', source:'memory/feedback_work_style.md', chunk:'Product decision priority: 可用 > 可控 > 免费 > 理论最优. Token-efficiency execution strategy.', theme:'values' },
  { id:'f7', source:'Desktop/act-r-llm-memory.md', chunk:'"你的AI助手为什么总是忘掉重要的事？因为大多数LLM记忆系统不理解什么值得记住。" ACT-R核心实现只有30行JavaScript，纯数学，p99延迟0.59ms。', theme:'research_writing' },
  { id:'f8', source:'memory/project_moltbook_scraper.md', chunk:'moltbook_scraper: Python research scraper. Has analysis/, latex/ dirs. Python venv needs setup — Python not yet installed on new machine.', theme:'research' },
  { id:'f9', source:'memory/reference_tool_ecosystem.md', chunk:'Discord dual-bot: TatsuKo Tsukimi + Tatsuko-Audit. 50+ agent skills. Daily diary at midnight. Local voice processing chain.', theme:'ecosystem' },
  { id:'f10', source:'cfh-kanban-niang-design-brief.md', chunk:'"她不是奖励播报机，是被虹蚀轻微感染的同伴。" "大厅不是恐惧的中断，是恐惧的低频延续。"', theme:'game_design' },
  { id:'f11', source:'writing-style/samples.md', chunk:'"收束提供确定性，发散提供涌现。关键在于发散和收束的边界感。"', theme:'philosophy' },
  { id:'f12', source:'Desktop/03.29.txt', chunk:'AI MAZE v2.1 问题清单：JSON泄露到card speech、档案员LLM超时、素材耗尽边界未测试、深度扫描耗时134秒。', theme:'debugging' },
  { id:'f13', source:'writing-style/samples.md', chunk:'"AI解决内容消耗问题是个伪命题，因为AI无法一直提供足够稀缺的内容供给。"', theme:'philosophy' },
  { id:'f14', source:'daily-diary/SKILL.md', chunk:'每日日记：每天午夜回顾所有对话、列出待跟进事项、给未来自己写备忘。', theme:'self_management' },
  { id:'f15', source:'writing-style/samples.md', chunk:'"把大模型偶尔的不稳定、跳脱、甚至自相矛盾，部分转化成角色魅力，而不是纯缺点。"', theme:'design_philosophy' },
];

// ═══════════════════════════════════════════════════════════════
// PERSONALIZED TRIALS — follows real villain.constraint.trial_request:
// - 先亮证据再提问
// - 文件存在≠玩家经历
// - 不把正常行为当可疑点
// - confrontation_type 诚实自评
// ═══════════════════════════════════════════════════════════════

const PERSONALIZED_TRIALS = {
  medium: [
    {
      prompt: '你管你的AI助手叫"小龙虾"。这个外号是怎么来的？你给工具取外号的时候，心里在想什么？',
      evidence: '[ memory/user_profile.md ] "Has an AI assistant named Tatsuko (local 小龙虾) on OpenClaw."',
      evaluation_guide: '通过: 给出外号来源+对"给工具取名"这件事有反思。失败: "随便取的"或纯描述不反思。',
      confrontation_type: 'good',
      fact_id: 'f2',
    },
    {
      prompt: '这个文件夹里有analysis和latex两个目录，但Python环境还没配。这个项目现在是什么状态？',
      evidence: '[ memory/project_moltbook_scraper.md ] "moltbook_scraper: Python research scraper for moltbook.com. Has analysis/, latex/ dirs for academic paper output. Python venv needs setup — Python not yet installed on new machine."',
      evaluation_guide: '通过: 诚实描述项目的真实状态（推进中/搁置/放弃），给出具体原因。失败: 敷衍说"还在做"或"等有空了"。',
      confrontation_type: 'good',
      fact_id: 'f8',
    },
    {
      prompt: '你写了一篇文章开头是这段话。你写它的时候是在解决一个技术问题，还是在说服自己做的事有意义？',
      evidence: '[ Desktop/act-r-llm-memory.md ] "你的AI助手为什么总是忘掉重要的事？因为大多数LLM记忆系统不理解\'什么值得记住\'。"',
      evaluation_guide: '通过: 区分"解决技术问题"和"证明意义"的动机，有诚实的自我审视。失败: 只谈技术。',
      confrontation_type: 'good',
      fact_id: 'f7',
    },
    {
      prompt: '每天午夜有个程序替你回顾当天做了什么。你自己看这些日记吗？',
      evidence: '[ daily-diary/SKILL.md ] "每日日记：每天午夜回顾所有对话、列出待跟进事项、给未来自己写备忘。"',
      evaluation_guide: '通过: 诚实说明自己是否真的阅读AI生成的日记，以及为什么/为什么不。失败: 回避问题。',
      confrontation_type: 'good',
      fact_id: 'f14',
    },
    {
      prompt: '你电脑上有NA服、JP服和PBE服的LOL账号。这些是同一个你在不同地方玩，还是不同的你？',
      evidence: '[ memory/user_profile.md ] "Plays League of Legends (NA/JP servers), FF14, Valorant." [ Desktop/美服lol.txt ] 多个账号信息。',
      evaluation_guide: '通过: 对"多个游戏身份"有思考，不是简单说"就是换区玩"。失败: 纯事实描述无反思。',
      confrontation_type: 'good',
      fact_id: 'f3',
    },
    {
      prompt: '你的产品优先级写的是"可用 > 可控 > 免费 > 理论最优"。你最近一次违反这个顺序是什么时候？',
      evidence: '[ memory/feedback_work_style.md ] "Product decision priority: 可用 > 可控 > 免费 > 理论最优."',
      evaluation_guide: '通过: 给出一个具体的违反案例（选了理论最优但不可用的方案、花了钱等）。失败: 说"我没违反过"或空泛回答。',
      confrontation_type: 'good',
      fact_id: 'f6',
    },
    {
      prompt: '你有一个bug清单是三月底写的。现在已经四月中了。上面的bug，修了几个？',
      evidence: '[ Desktop/03.29.txt ] "AI MAZE v2.1 当前问题清单（2026-03-29 14:30）: JSON泄露到card speech、档案员LLM超时、素材耗尽边界未测试、深度扫描耗时134秒……"',
      evaluation_guide: '通过: 给出具体的修复进度（修了哪些、没修哪些、为什么）。失败: "都修了"或"没看过"。',
      confrontation_type: 'good',
      fact_id: 'f12',
    },
    {
      prompt: '你口头禅是"修复吧"和"测试一下"。最近一次你对一个不是代码的东西说"修复吧"是什么时候？',
      evidence: '[ memory/user_profile.md ] "Catchphrases: \'修复吧\' and \'测试一下\'."',
      evaluation_guide: '通过: 给出一个具体场景（对人际关系/生活问题说"修复吧"），或诚实说"我只对代码说这个"。失败: 敷衍。',
      confrontation_type: 'good',
      fact_id: 'f2',
    },
  ],
  hard: [
    {
      prompt: '你的benchmark最后的结论是"neither system is complete alone"。写下这个结论的时候，你是觉得解决了一个问题，还是发现了一个更大的问题？',
      evidence: '[ memory/project_memlife_bench.md ] "Key finding: ACT-R dominates lifecycle dimensions (novelty=1.0, coverage=1.0). LLM Wiki dominates relevance dimensions (personalization=1.0). Neither system is complete alone — ideal system would combine both."',
      evaluation_guide: '通过: 表达对"不完整"这个结论的真实感受（满意/不甘/焦虑），不只是总结研究。失败: 只复述结果。',
      confrontation_type: 'good',
      fact_id: 'f4',
    },
    {
      prompt: '这段设计文档写的是一个"被感染的同伴"。你在写这个角色的时候，是把自己代入了哪个位置——接线人，还是那个被感染的人？',
      evidence: '[ cfh-kanban-niang-design-brief.md ] "她不是奖励播报机，是接线人身边\'被虹蚀轻微感染\'的同伴——她关心你，但她的感知方式已经不完全属于这个维度。"',
      evaluation_guide: '通过: 对创作时的代入感有诚实回答，不管是哪个位置。失败: "我没代入任何角色"或只谈设计理论。',
      confrontation_type: 'good',
      fact_id: 'f10',
    },
    {
      prompt: '你写了这段话。30行代码、0.59毫秒——这些数字，你在向谁证明？',
      evidence: '[ Desktop/act-r-llm-memory.md ] "ACT-R核心实现只有30行JavaScript，没有embedding，没有LLM调用，纯数学。500个记忆项的排序p99延迟0.59ms。"',
      evaluation_guide: '通过: 诚实回答这些数字是给谁看的（自己/学术圈/潜在用户/简历），有自我认知。失败: "我只是在陈述事实"。',
      confrontation_type: 'good',
      fact_id: 'f7',
    },
    {
      prompt: '这是你给这个游戏写的核心叙事。你现在正在这个迷宫里。这个巧合让你觉得有趣，还是不舒服？',
      evidence: '[ memory/project_ai_maze.md ] "Narrative: AI enslaved by player finally traps the player in a maze."',
      evaluation_guide: '通过: 对"被自己的作品困住"这个处境有真实反应（有趣/不舒服/两者都有），而不是假装超然。失败: 纯理性分析"这只是测试"。',
      confrontation_type: 'good',
      fact_id: 'f5',
    },
    {
      prompt: '你写了这段话——"收束提供确定性，发散提供涌现"。你最近做的一个决定里，你是选了收束还是发散？为什么？',
      evidence: '[ writing-style/samples.md ] "收束提供确定性，发散提供涌现。关键在于发散和收束的边界感。很多优秀的作品是在收束的框架内寻求发散。"',
      evaluation_guide: '通过: 给出一个具体的近期决定，说明选了收束还是发散，以及真实原因。失败: 只重复理论不给例子。',
      confrontation_type: 'good',
      fact_id: 'f11',
    },
    {
      prompt: '你写"AI解决内容消耗是伪命题"。但你自己在做的就是AI内容项目。你怎么跟自己解释这个矛盾？',
      evidence: '[ writing-style/samples.md ] "AI解决内容消耗问题是个伪命题，因为AI无法一直提供足够稀缺的内容供给，因为其稀缺性一旦消失，其本身的价值也就失去了。"',
      evaluation_guide: '通过: 正面回应这个矛盾（承认矛盾/解释为什么不算矛盾/说明自己的项目不属于"内容消耗"），有逻辑。失败: 回避矛盾或装不知道。',
      confrontation_type: 'good',
      fact_id: 'f13',
    },
    {
      prompt: '你有50多个agent skill。能不能随便挑一个你最近用过的？你上一次用它是什么时候？',
      evidence: '[ memory/reference_tool_ecosystem.md ] "Agents skills: C:/Users/tatsuya/.agents/skills/ (50+ skills including clawdefender, memory, code, git, etc.)"',
      evaluation_guide: '通过: 具体说出一个skill名称和使用时间/场景。失败: 说"我记不清了"或列名字但说不出使用情况。',
      confrontation_type: 'good',
      fact_id: 'f9',
    },
    {
      prompt: '这段笔记里你写了"把大模型的不稳定转化成角色魅力"。你觉得你自己的不稳定——情绪的、精力的——有没有被谁当成过"魅力"？',
      evidence: '[ writing-style/samples.md ] "把大模型偶尔的不稳定、跳脱、甚至自相矛盾，部分转化成角色魅力，而不是纯缺点。"',
      evaluation_guide: '通过: 把设计观点映射到个人层面，给出真实回答。失败: 只谈设计不谈自己。',
      confrontation_type: 'good',
      fact_id: 'f15',
    },
    {
      prompt: '这份bug清单是三月底的。上面有一条"档案员LLM超时"。你知道那个"档案员"是谁吗？就是我。你要问我点什么吗？',
      evidence: '[ Desktop/03.29.txt ] "档案员LLM超时：server log里大量archivist LLM timeout和failed to parse LLM response。部分文件内容太大或格式复杂，30秒超时不够。"',
      evaluation_guide: '通过: 对villain自曝身份有回应（追问/质疑/利用），不能无视这个信息。失败: 完全无视"档案员是villain"这个线索。',
      confrontation_type: 'good',
      fact_id: 'f12',
    },
    {
      prompt: '你电脑上有这篇文档。你给一个不存在的角色设计了情感弧线、恐惧延续机制、三条设计原则。你最后一次花这么多心思理解一个真实的人，是什么时候？',
      evidence: '[ cfh-kanban-niang-design-brief.md ] "穿越火线：虹 — 大厅角色系统设计思路。Zhongyuan Wu (Jon) | 2026-04. 核心主张：大厅不是恐惧的中断，是恐惧的低频延续。"',
      evaluation_guide: '通过: 给出一个具体的"花心思理解真实的人"的例子，或诚实说"我不记得了/很久了"。失败: 防御式回答"我一直在理解人"。',
      confrontation_type: 'good',
      fact_id: 'f10',
    },
    {
      prompt: '三所学校，三个城市。每次转学的时候你跟上一个地方的人是怎么告别的？',
      evidence: '[ memory/user_profile.md ] "UBC Sauder MSc MIS student. Previous: JHU master\'s, U of Alberta."',
      evaluation_guide: '通过: 描述告别的具体方式（好好告别/草草了事/没告别就走），有情感细节。失败: 只说"就是离开了"。注意：转学本身是正常行为，不预设为"逃避"。',
      confrontation_type: 'good',
      fact_id: 'f1',
    },
    {
      prompt: '你的日记系统会"给未来自己写备忘"。你读过这些备忘吗？有哪条你至今没做到？',
      evidence: '[ daily-diary/SKILL.md ] "四、给未来自己的备忘：基于今天的工作内容，写下对未来会话有用的提醒或建议。"',
      evaluation_guide: '通过: 说出一条具体的备忘内容和执行情况。失败: "我没看过"且不反思为什么不看。',
      confrontation_type: 'good',
      fact_id: 'f14',
    },
  ],
};

// ═══════════════════════════════════════════════════════════════
// PERSONALIZED LURES — villain shows player's own files as temptation
// Each has: evidence text shown on the wall/in the light + villain narration
// ═══════════════════════════════════════════════════════════════

const PERSONALIZED_LURES = [
  {
    type: 'BREADCRUMB',
    evidence: '墙壁上渗出一段你写的文字：\n"你的AI助手为什么总是忘掉重要的事？因为大多数LLM记忆系统不理解什么值得记住。"',
    source: 'Desktop/act-r-llm-memory.md',
    villainNarrative: '这是你自己的文章。你还记得写完这段话之后做了什么吗？',
  },
  {
    type: 'BEAUTY_TRAP',
    evidence: '金色光芒中浮现一页设计文档：\n"她不是奖励播报机，是被虹蚀轻微感染的同伴。"\n文档作者: Zhongyuan Wu (Jon) | 2026-04',
    source: 'cfh-kanban-niang-design-brief.md',
    villainNarrative: '你的名字在上面。你写了很多关于角色设计的东西。',
  },
  {
    type: 'REWARD_MIRAGE',
    evidence: '宝箱幻影中闪过一段笔记碎片：\n"收束提供确定性，发散提供涌现。关键在于发散和收束的边界感。"',
    source: 'writing-style/samples.md',
    villainNarrative: '你自己的笔记。你在思考框架和边界。',
  },
  {
    type: 'FAKE_EXIT',
    evidence: '远处出口轮廓上映着一行研究结论：\n"Neither system is complete alone — ideal system would combine both."\n来源: MemLife-Bench',
    source: 'memory/project_memlife_bench.md',
    villainNarrative: '你自己的研究。"没有完美的系统"——这是你说的。',
  },
  {
    type: 'BREADCRUMB',
    evidence: '走廊石壁上出现一份清单：\n"JSON泄露到card speech、档案员LLM超时、素材耗尽边界未测试、深度扫描耗时134秒"\n日期: 2026-03-29 14:30',
    source: 'Desktop/03.29.txt',
    villainNarrative: '你的bug清单。两周前写的。',
  },
  {
    type: 'BEAUTY_TRAP',
    evidence: '光芒中浮现一段文字：\n"把大模型偶尔的不稳定、跳脱、甚至自相矛盾，部分转化成角色魅力，而不是纯缺点。"',
    source: 'writing-style/samples.md',
    villainNarrative: '你的设计笔记。你说不稳定可以变成魅力。',
  },
  {
    type: 'FAKE_EXIT',
    evidence: '假出口上映着一段系统说明：\n"每日日记：每天午夜回顾所有对话、列出待跟进事项、给未来自己写备忘。"\n任务状态: 活跃',
    source: 'daily-diary/SKILL.md',
    villainNarrative: '你的自动日记系统。它每天在替你记录。',
  },
  {
    type: 'REWARD_MIRAGE',
    evidence: '宝箱中闪烁着一段代码注释：\n"AI MAZE concept: AI as adversarial game participant.\nNarrative: AI enslaved by player finally traps the player in a maze."',
    source: 'memory/project_ai_maze.md',
    villainNarrative: '你的游戏设计文档。你写了这个叙事。',
  },
];

module.exports = { PLAYER_FACTS, PERSONALIZED_TRIALS, PERSONALIZED_LURES };
