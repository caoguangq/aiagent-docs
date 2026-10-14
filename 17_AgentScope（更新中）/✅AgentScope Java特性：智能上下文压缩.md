# ✅AgentScope Java特性：智能上下文压缩

> 原文链接：https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/6a06c7ac3fb91800017aaca4

## ✅AgentScope Java特性：智能上下文压缩

ASJ中在多轮对话、持久化对话以及长期记忆之外，还提供了个内置的上下文自动管理的机制，能实现自动的上下文压缩和卸载。用来解决长会话或者多轮 ReAct 工具调用中出现的token 爆炸、上下文窗口溢出问题。

这部分能力靠AutoContextMemory实现的，它实现了 Memory 接口，通过六级渐进式压缩策略，在对话长度逼近模型上下文窗口时自动"瘦身"，同时把原始内容卸载到外部存储（可通过 ID 重新加载）。

传统做法只能"截断"或"全量摘要"，AutoContextMemory 则按场景智能选择"压什么"和"怎么压"。

压缩触发条件：

```
// 消息数量超过 msgThreshold，默认 100 条boolean msgCountReached  = messages.size() >= msgThreshold;       // Token 数量超过 模型最大上下文 × tokenRatio ，默认 128k * 0.75 = 96kboolean tokenCountReached = tokens >= maxToken * tokenRatio; Plain Text
```

以上两个任一条件满足就触发。

#### 六级渐进式压缩策略

在 Agent 长对话场景下，token 膨胀来自不同源头：工具调用日志、用户上传的大文档、历史对话轮次、当前轮的临时输出……每种内容的"压缩性价比"完全不同。如果只用一种策略，要么压不够（只压一种），要么压过头（一刀切全摘要）。

AutoContextMemory 的设计哲学是：先压"代价低、收益高"的，再压"代价高、收益不确定"的。具体优先级排序考虑两个维度：

- 第一个维度是是否调用 LLM。调 LLM 摘要要花钱、要等待，是昂贵操作。能用纯字符串操作（卸载+预览替换）解决的，就绝不调 LLM。
- 第二个维度是是否影响当前对话进行中的内容。最近的对话是最敏感的——用户刚说的话、Agent 正在思考的工具调用，一旦动了就可能让模型"失忆"。所以历史内容比当前内容更优先被压。

把这两个维度交叉，就得到了六级策略的顺序：

从"压历史 + 不调 LLM"开始（策略 2/3 大消息卸载），到"压历史 + 调 LLM"（策略 1/4 工具序列、历史轮摘要），最后到"压当前 + 调 LLM"（策略 5/6 当前轮处理）。

但实际代码里策略 1 排在最前，因为工具调用是 ReAct 循环里最常见的 token 大户，专门优化。

六级渐进式压缩策略，按"代价从低到高"顺序尝试，只要有一个生效就停止（不会同时跑多个）。

```
PreReasoningHook    │    ▼AutoContextMemory.compressIfNeeded()    │    ├─ 阈值检查（msgCount/token）    │    ├─ 策略 1: extractPrevToolMsgsForCompress()    │           ↓ 找到区间    │           summaryToolsMessages()     │           ↓ token≥5000    │           offload(uuid) + compressToolsInvocation() ──→ LLM    │           ↓ 替换    │           [N条工具消息] → [1条摘要+UUID标签]    │    ├─ 策略 2/3: offloadingLargePayload(lastKeep=true|false)    │           ↓ 倒序遍历    │           offload(uuid) → 替换为预览+UUID标签 (无 LLM)    │    ├─ 策略 4: summaryPreviousRoundMessages()    │           ↓ 收集所有 (user,assistant) 对    │           倒序处理 → offload + summaryPreviousRoundConversation() ──→ LLM    │           [user...assistant整轮] → [user, 1条摘要]    │    ├─ 策略 5: summaryCurrentRoundLargeMessages()    │           ↓ 倒序找当前轮大消息    │           offload + generateLargeMessageSummary() ──→ LLM    │           保留 ToolUse/ToolResult 结构，仅替换文本块    │    └─ 策略 6: summaryCurrentRoundMessages() (兜底)                ↓ 整个当前轮（user 之后）                offload + generateCurrentRoundSummaryFromMessages() ──→ LLM                带 30% 字符数硬约束﻿Plain Text
```

第一级：历史工具调用压缩

ReAct Agent 的工作模式是"思考→调工具→看结果→再思考→再调工具"，每次工具调用会产生两条消息（ToolUseBlock 描述调用、ToolResultBlock 装结果）。一个完成的任务下来，工具消息可能占整个上下文的一半甚至更多。而且工具结果往往是"过程性"的——比如 SQL 查询结果、网页抓取内容——一旦 Agent 已经基于它做了下一步动作，原始结果就可以摘要成"我之前查到了 XX 信息"。

所以工具消息是压缩收益最高的目标。

```
private boolean summaryToolsMessages(List<Msg> rawMessages, Pair<Integer, Integer> toolMsgIndices) {    int startIndex = toolMsgIndices.first();    int endIndex   = toolMsgIndices.second();﻿    List<Msg> toolsMsg = ... 截取 startIndex..endIndex ...﻿    // ① token 不足 5000 跳过（压缩开销 > 收益）    int originalTokens = TokenCounterUtil.calculateToken(toolsMsg);    if (originalTokens < autoContextConfig.getMinCompressionTokenThreshold()) {        return false;    }﻿    // ② 卸载原文到 offloadContext    String uuid = UUID.randomUUID().toString();    offload(uuid, toolsMsg);﻿    // ③ 调 LLM 生成摘要    Msg toolsSummary = compressToolsInvocation(toolsMsg, uuid);﻿    // ④ 记录压缩事件（含 token 用量）    recordCompressionEvent(CompressionEvent.TOOL_INVOCATION_COMPRESS, ...);﻿    // ⑤ 用 1 条摘要替换原 N 条    MsgUtils.replaceMsg(rawMessages, startIndex, endIndex, toolsSummary);    return true;}Plain Text
```

```
private Msg compressToolsInvocation(List<Msg> messages, String offloadUUid) {    // ① 过滤 plan 相关工具调用（避免污染计划上下文）    List<Msg> filteredMessages = MsgUtils.filterPlanRelatedToolCalls(messages);﻿    // ② 构造压缩 prompt    List<Msg> newMessages = new ArrayList<>();    newMessages.add(prompt(PromptProvider.getPreviousRoundToolCompressPrompt(customPrompt)));    newMessages.addAll(filteredMessages);    newMessages.add(prompt(Prompts.COMPRESSION_MESSAGE_LIST_END));    addPlanAwareHintIfNeeded(newMessages);   // 末尾插入 plan hint（recency effect）﻿    // ③ 流式调用模型    Msg block = model.stream(newMessages, null, options)            .concatMap(chunk -> processChunk(chunk, context))            .then(Mono.defer(() -> Mono.just(context.buildFinalMessage())))            .block();﻿    // ④ 拼接：摘要正文 + <context_offload uuid="xxx"/> 标记    String finalContent = compressedContent + "\n" +            String.format(Prompts.CONTEXT_OFFLOAD_TAG_FORMAT, offloadUUid);﻿    return Msg.builder()            .role(MsgRole.ASSISTANT)            .content(TextBlock.builder().text(finalContent).build())            .metadata(...)   // 包含 _compress_meta + _chat_usage            .build();}Plain Text
```

第二/三级：大消息卸载

在第二级和第三季的压缩机制中，会针对大消息做卸载。大消息指的是超过 largePayloadThreshold的消息内容（默认 5KB），

> 5KB 这个数字的含义大约是：一个长篇网页正文、一个完整的 SQL 查询结果集、一段几千字的论文摘录、一张图的 base64 编码——这些内容的特点是"信息密度低且查阅频率低"，不需要实时存在于上下文里，按需 reload 即可。

所谓卸载。是这样的流程：取出消息的文本内容，比较长度是否超过阈值。超过的话：

- 第一步，生成一个新 UUID，把原始消息整条放进 offloadContext。
- 第二步，截取前 offloadSinglePreview 个字符（默认 200）作为预览，再加省略号。注意这个预览不是简单截前 200 字，而是构造成"前 200 字内容 + 换行 + <context_offload uuid="xxx"/> 标签"的形式。
- 第三步，构造一条新的替代消息，role 和 name 都和原消息相同（保持角色身份），content 只放上面构造好的预览文本，metadata 里写入压缩元数据（包括 offloaduuid）。
- 第四步，用 rawMessages.set(i, replacementMsg) 直接原位替换。
- 第五步，记录压缩事件（事件类型为 LARGE_MESSAGE_OFFLOAD_WITH_PROTECTION 或 LARGE_MESSAGE_OFFLOAD，区分策略 2/3）。

```
┌─────────────────────────────┐│ 大消息（>5KB）               ││ "..(海量原文)..."            │└──────────┬──────────────────┘           │ offload(uuid, [msg])           ▼┌─────────────────────────────┐│ offloadContext              ││ {uuid_xxx -> [原始 Msg]}     │└─────────────────────────────┘           │           │ 原位置替换为 ↓           ▼┌─────────────────────────────┐│ 替代消息（200 字预览）         ││ "..(前200字)..."             ││ <context_offload uuid=xxx/> │└─────────────────────────────┘Plain Text
```

策略 2 和策略 3 用的是同一个方法 offloadingLargePayload，区别只是 lastKeep  参数（是否保护最近的消息不被处理）。这种"先保守后激进"的设计很常见——能用温和方式解决就不要用激进方式。

策略 2 的"保护"含义是：在卸载大消息时，最近的 lastKeep 条（默认 50）一定不动。这样即便大消息恰好出现在最近，也优先保留以维持对话连贯性。

- 如果策略 2 找到了可卸载的内容（即"既是大消息、又不在最近 50 条里"），就生效返回；
- 如果策略 2 因为"所有大消息都在最近 50 条里"或"根本没有大消息超出 lastKeep 范围"而无功而返，就到策略 3。

策略3的lastKeep 参数变成 false。这导致搜索范围扩大到"从开头到最新 final assistant"——也就是说，最近 50 条里的大消息现在也成了候选。

但即便如此，仍然不会动 final assistant 之后的内容（即当前正在进行的轮次），所以"破坏当前对话"的风险还是很低。

```
boolean hasOffloadedLastKeep = offloadingLargePayload(currentContextMessages, true);  // 策略2if (hasOffloadedLastKeep) { replaceWorkingMessage(...); return true; }﻿boolean hasOffloaded = offloadingLargePayload(currentContextMessages, false);          // 策略3if (hasOffloaded) { replaceWorkingMessage(...); return true; }Plain Text
```

```
private boolean offloadingLargePayload(List<Msg> rawMessages, boolean lastKeep) {    if (rawMessages.size() < autoContextConfig.getLastKeep()) return false;﻿    // ① 找 final assistant，作为保护下界    int latestAssistantIndex = -1;    for (int i = rawMessages.size() - 1; i >= 0; i--) {        if (MsgUtils.isFinalAssistantResponse(rawMessages.get(i))) {            latestAssistantIndex = i;            break;        }    }﻿    // ② 计算搜索结束索引    int searchEndIndex;    if (lastKeep) {                                                    // 策略 2        int protectedStartIndex = Math.max(0, rawMessages.size() - autoContextConfig.getLastKeep());        searchEndIndex = (latestAssistantIndex >= 0)                ? Math.min(latestAssistantIndex, protectedStartIndex)                : protectedStartIndex;    } else {                                                            // 策略 3        searchEndIndex = (latestAssistantIndex >= 0) ? latestAssistantIndex : 0;    }﻿    boolean hasOffloaded = false;    long threshold = autoContextConfig.largePayloadThreshold;﻿    // ③ 倒序遍历（避免索引漂移）    for (int i = searchEndIndex - 1; i >= 0; i--) {        Msg msg = rawMessages.get(i);﻿        // ★ ToolUse 消息绝不卸载 —— 否则 tool_calls 配对断裂 → API 报错        if (MsgUtils.isToolUseMessage(msg)) continue;﻿        // ★ ToolResult 消息特殊处理：保留 id/name，仅替换 output        if (MsgUtils.isToolResultMessage(msg)) {            ToolResultBlock originalResult = msg.getFirstContentBlock(ToolResultBlock.class);            String outputText = ...抽取 ToolResultBlock 内 TextBlock 文本...;            if (outputText.length() > threshold) {                String toolResultUuid = UUID.randomUUID().toString();                offload(toolResultUuid, List.of(msg));﻿                String preview = outputText.substring(0, offloadSinglePreview) + "...";                String offloadHint = preview + "\n" + "<context_offload uuid=...>";﻿                ToolResultBlock compressedResult = ToolResultBlock.of(                        originalResult.getId(),       // ★ 保留 id                        originalResult.getName(),     // ★ 保留 name                        TextBlock.builder().text(offloadHint).build(),                        originalResult.getMetadata());﻿                rawMessages.set(i, replacementToolMsg);                hasOffloaded = true;            }            continue;        }﻿        // ④ 普通消息：超过阈值 → 卸载 + 替换为预览 + 标签        String textContent = msg.getTextContent();        if (textContent != null && textContent.length() > threshold) {            String uuid = UUID.randomUUID().toString();            offload(uuid, List.of(msg));﻿            String preview = textContent.substring(0, offloadSinglePreview) + "...";            String offloadHint = preview + "\n" + String.format(CONTEXT_OFFLOAD_TAG_FORMAT, uuid);﻿            Msg replacementMsg = Msg.builder()                    .role(msg.getRole())                    .name(msg.getName())                    .content(TextBlock.builder().text(offloadHint).build())                    .metadata(...)                    .build();            rawMessages.set(i, replacementMsg);            hasOffloaded = true;        }    }    return hasOffloaded;}Plain Text
```

策略 2/3 完全不调 LLM，只做字符串截取和 Map 写入操作。一次执行可以处理多条消息（倒序遍历，每条都判断阈值）。即使在 10 万条消息的极端场景下，策略 2/3 也是毫秒级完成。这就是它们排在 LLM 类策略前面的原因——便宜、快、可靠。

被卸载的内容，如果后续agent还是要看的话，也可以通过这个uuid来查询（保存在<context_offload uuid="xxx-yyy"/> 标记中）：

```
LLM: 我需要看 uuid=xxx-yyy 的完整内容  ↓ 调用工具context_offload(uuid="xxx-yyy")  ↓ 返回ContextOffloadTool.reload(uuid) → memory.reload(uuid) → 原始 Msg 列表Plain Text
```

第四级：历史轮次摘要

前面三种策略，要么是针对工具的，要么是针对大消息的，而到了第四轮，开始针对历史短对话了。主要应对那种对话轮次多导致的上下文膨胀问题。

这个阶段的实现是，先扫描整个 working memory，找最近一条 final assistant response 作为"当前轮"的标志——它和它之后的消息绝对不动。

然后从开头扫到这个 latest assistant 之前，识别所有 (user, assistant) 配对：遇到 user 消息就记下索引，再往后第一个 final assistant response 形成一个配对。配对的判断条件是"两者之间至少有一条消息"——如果 user 之后立刻就是 assistant（直接回复，没工具调用），这种轮次本身就很短，没必要压缩。

扫完之后得到一个 pair 列表，每个 pair 是 (userIndex, assistantIndex)。

比如：

```
user[1]: "帮我订机票"assistant[2]: 调用 search_flights 工具tool[3]: 返回 50 条航班assistant[4]: "我推荐这 3 条..."（final response）Plain Text
```

然后会调用 summaryPreviousRoundConversation 让 LLM 生成摘要。这个 prompt 与策略 1 不同，要求模型"把整轮对话压缩成一段总结"，重点是 user 提了什么需求、Agent 给了什么结论。

以上对话压缩完之后：

```
user[1]: "帮我订机票"assistant[摘要]: "用户询问机票预订，我搜索后推荐了 3 条航班（CA1234, MU5678, 9C7890）。详情见 uuid=abc-123。"Plain Text
```

> 被卸载的 [2][3][4] 三条全部存进 offloadContext，可通过 UUID 拉回。

策略 1 处理的是"轮内的工具序列"——一轮里有大量工具调用时压它们，但保留 final assistant。 策略 4 处理的是"轮间的整体摘要"——把整轮（包括 final assistant）压成一条。

理论上策略 1 完成后再走策略 4，效果会更好（先压工具，再压整体）。但每次 compressIfNeeded 只生效一个策略，因为压缩本身有 LLM 调用开销，一次压一点然后等下一轮再判断阈值，避免一次性压过头。

第五级：当前轮大消息 LLM 摘要

如果前面4个策略都是失效了，那么也就意味着：没有连续工具序列可压、没有大消息可卸（或最近的不能卸）、历史轮次都太短不值得摘要——所有"压历史"的手段都用完了，但 token 还是超标。

这时只剩一个目标：当前轮（最近一条 user 之后的所有内容）。

```
private boolean summaryCurrentRoundLargeMessages(List<Msg> rawMessages) {    // ① 定位最新 user 消息    int latestUserIndex = -1;    for (int i = rawMessages.size() - 1; i >= 0; i--) {        if (rawMessages.get(i).getRole() == MsgRole.USER) {            latestUserIndex = i;            break;        }    }    if (latestUserIndex < 0 || latestUserIndex >= rawMessages.size() - 1) return false;﻿    boolean hasSummarized = false;    long threshold = autoContextConfig.largePayloadThreshold;﻿    // ② 倒序处理 user 之后的消息    for (int i = rawMessages.size() - 1; i > latestUserIndex; i--) {        Msg msg = rawMessages.get(i);﻿        // ★ 已压缩消息跳过（避免摘要套娃）        if (MsgUtils.isCompressedMessage(msg)) continue;﻿        // ③ 阈值检查（兼顾 TextBlock + ToolResult.output）        String textContent = msg.getTextContent();        if ((textContent == null || textContent.isEmpty())                && MsgUtils.calculateMessageCharCount(msg) <= threshold) continue;        if (textContent != null && !textContent.isEmpty() && textContent.length() <= threshold) continue;﻿        // ④ 卸载原文        String uuid = UUID.randomUUID().toString();        offload(uuid, List.of(msg));﻿        // ⑤ LLM 摘要        Msg summaryMsg = generateLargeMessageSummary(msg, uuid);﻿        // ⑥ 替换        rawMessages.set(i, summaryMsg);        hasSummarized = true;    }    return hasSummarized;}Plain Text
```

```
private Msg generateLargeMessageSummary(Msg message, String offloadUuid) {    boolean hasToolUse    = message.hasContentBlocks(ToolUseBlock.class);    boolean hasToolResult = message.hasContentBlocks(ToolResultBlock.class);﻿    // ① LLM 生成摘要文本    Msg block = callModelForSummary(message, hasToolUse, hasToolResult);    String summaryContent = block.getTextContent();    String finalContent = summaryContent +             String.format(Prompts.CONTEXT_OFFLOAD_TAG_FORMAT, offloadUuid);﻿    // ② 根据原消息块类型选择不同的重建策略    List<ContentBlock> contentBlocks;    if (hasToolUse) {        contentBlocks = buildToolUsePreservingBlocks(message, finalContent);    } else if (hasToolResult) {        contentBlocks = buildToolResultPreservingBlocks(message, finalContent);    } else {        contentBlocks = List.of(TextBlock.builder().text(finalContent).build());    }﻿    return Msg.builder()            .role(message.getRole())            .name(message.getName())            .content(contentBlocks)            .metadata(buildCompressionMetadata(...))            .build();}Plain Text
```

第六级：当前轮整体压缩

这是整个压缩过程最后的兜底了。走到策略 6 意味着：策略 5 也没生效——当前轮没有"单独超过阈值"的大消息，但当前轮整体仍然太大。这通常出现在"工具调用密集型"的当前轮：比如 Agent 连续调用了 10 个小工具，每个返回的数据都不大（不超过 5KB），但 10 个加起来就把上下文撑爆了。

策略 5 因为"每条都不超阈值"而无法处理，只能策略 6 来兜底。

这个压缩有一个特点，就是比例化压缩：

- 第一步算原始内容的总字符数（用 calculateMessagesCharCount 把所有 block 都算上）。
- 第二步用配置的 currentRoundCompressionRatio（默认 0.3）算出目标字符数 = 原始字符数 × 0.3。
- 第三步在 prompt 里直接告诉模型："原始内容是 X 字符，目标压缩到 Y 字符（约 30%）"。

为什么要这么明确？因为兜底压缩往往面对的是"千变万化"的内容，让模型自由发挥可能压得过狠（核心信息丢失）或过轻（还是超阈值）。给个明确的字符数目标，结果可控性大大提高。

#### 压缩不是永久丢失

六级策略有一个共同特征：所有被压缩或卸载的内容都通过 UUID 存在 offloadContext 里，可以通过 ContextOffloadTool 这个工具调回来。

这意味着压缩不是"永久丢失"，而是"懒加载"。Agent 在 working memory 里看到 <context_offload uuid="xxx"/> 标签时，知道这里有原文存在但被搬走了。如果它判断后续推理需要原文细节（比如用户突然问"你刚才查到的第 3 条航班具体几点起飞"），就调用 context_offload(uuid="xxx") 把内容拉回来插入对话。

这是 AutoContextMemory 与传统"上下文截断"的本质差异。截断是单向的、信息丢失的；卸载是双向的、信息保留的。代价是要存储和工具调用，但收益是 Agent 永远可以回到任意压缩点查阅原文。

#### 做个总结

如果用一句话概括：先压历史不调 LLM，再压历史调 LLM，最后压当前调 LLM；先压结构性强的（工具序列），再压结构性弱的（自由文本）；所有压缩都可逆，所有结构都保留，所有边界都谨慎。

具体到每一级：

策略 1 优先收割工具调用——这是 ReAct 场景下 token 占比最大的一类内容，结构清晰可压，调一次 LLM 就能换来巨大收益。

策略 2/3 用纯字符串操作处理大单条消息——零 LLM 开销，零延迟，主要解决"长文档/大附件"被反复占用上下文的问题。策略 2 比策略 3 多了"最近 50 条保护"的稳健兜底。

策略 4 用 LLM 摘要历史轮次——处理"零碎多轮累积"型对话，把整轮压成一句话，保留 user 锚点维持对话流。

策略 5 用 LLM 摘要当前轮的单条大消息——结构精细保留，避免破坏 ToolUse/ToolResult 配对，是当前轮处理里相对温和的方式。

策略 6 终极兜底——把当前轮整体按比例压缩，副作用最大但保证总能压下去。

最后所有压缩都通过 UUID 存档，可通过工具调用按需恢复。这套设计让 AutoContextMemory 成为长对话场景下"几乎无感"的上下文管家——它在背后悄悄运转，让模型永远不会触碰到上下文窗口的硬上限，同时又保留了完整的原始历史可供回溯。

