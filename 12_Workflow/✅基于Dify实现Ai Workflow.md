# ✅基于Dify实现Ai Workflow

> 原文链接：https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/69882cb7d31fed00010e2406

## ✅基于Dify实现Ai Workflow

Anthropic在 《Building Effective Agents》这篇文章中也提了一些关于workflow用来构建智能体系统的一些"范式"。我们借助这几种范式也顺带介绍下工作流的常见搭建方式。

#### Prompt Chaining

提示链模式将任务分解为一系列步骤，每次 LLM 调用都处理前一次 LLM 的输出。你可以在任何中间步骤上添加校验（如示图中的“Gate”），以确保该过程仍运行在正轨上。

![](images/img_001.png)

如以下方式，我们通过一个LLM链，生成一份公众号文章，三个不同的节点，分别做大纲生成，文章生成以及内容润色。

![](images/img_002.png)

DSL内容（可直接导入Dify）：

PromptChain

ing.yml

(

6.4 KB

)

-

0

%

#### Routing

路由模式根据输入类型路由到不同专用处理流程或模型。

![](images/img_003.png)

在上面的流程中，我们引入一个问题分类器，做用户的意图识别，根据意图分别路由到不同的分支，生成公众号文章或者小红书文案。

![](images/img_004.png)

DSL内容（可直接导入Dify）：

Rout

ing.yml

(

9.8 KB

)

-

0

%

#### Parallelization

LLM有时可以同时处理一项任务，并以编程方式聚合它们的输出，这种工作流称为并行模式。其具备两个关键变体：

- 分段 Sectioning : 将任务分解为并行运行的独立子任务。
- 投票 Voting ：多次运行同一任务，以获取到多样化的输出。

![](images/img_005.png)

比如以下工作流，我们通过并行的方式同时生成文章的标题和内容，最终组合成一篇完整的文章。

![](images/img_006.png)

DSL内容（可直接导入Dify）：

Parallelizat

ion.yml

(

9.7 KB

)

-

0

%

#### Evaluator-Optimizer

评估者-优化者模式中，调用一个 LLM 生成响应内容，而另一个 LLM 在循环中提供评估和反馈，直到评估被接受通过。

![](images/img_007.png)

以下流程中，我们增加了一个循环，在循环中不断优化和润色文章内容。

![](images/img_008.png)

DSL内容（可直接导入Dify）：

Evaluator-Optimi

zer.yml

(

18.0 KB

)

-

0

%

#### Orchestrator-Workers

在协调器-工作者模式中，一个中央协调者 LLM 动态分解任务，将其委派给工作者 LLM，并综合它们的结果。

![](images/img_009.png)

