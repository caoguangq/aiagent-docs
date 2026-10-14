# ✅Chunk的metadata怎么设计的？怎么用？

> 原文链接：https://thoughts.aliyun.com/workspaces/6963289eb0fc2e001bb052eb/docs/69be4ba451b144000159c394

## ✅Chunk的metadata怎么设计的？怎么用？

metadata的作用，主要有两方面：

1、记录扩展信息

2、用于数据过滤（如权限控制）

###### ✅RAG优化技术：元数据过滤

什么是元数据 在RAG中，元数据（Metadata） 是附加到文本块（Chunk）上的结构化信息，它是描述了该文本块的“数据”。 一个文本块的元数据可以包含：文件名、页码、userid等等。这些信息可以用于一些特殊的功能要求。 我们在之前的

LLMentor

以下是我们定义的一个常量类，我们把需要用到的metadata的key都定义进去了。

```
package cn.hollis.llm.mentor.know.engine.ai.constant;﻿/** * 元数据的键常量 * @author Hollis */public class MetadataKeyConstant {    /**     * 文件名称     */    public static final String FILE_NAME = "fileName";﻿﻿    public static final String DOC_ID = "docId";﻿    public static final String CHUNK_ID = "chunkId";﻿    /**     * 父块ID     */    public static final String PARENT_CHUNK_ID = "parentChunkId";﻿    /**     * 同级块ID     */    public static final String BROTHER_CHUNK_ID = "brotherChunkId";﻿﻿    public static final String BROTHER_CHUNK_INDEX = "brotherChunkIndex";﻿    public static final String BROTHER_CHUNK_TOTAL = "brotherChunkTotal";﻿    /**     * 头级别     */    public static final String HEADER_LEVEL = "headerLevel";﻿    /**     * 访问权限     */    public static final String ACCESSIBLE_BY = "accessibleBy";﻿    /**     * 文件地址     */    public static final String URL = "url";﻿    /**     * 文件版本     */    public static final String VERSION = "version";﻿    /**     * 分类     */    public static final String CATEGORY = "category";﻿    /**     * 摘要     */    public static final String SUMMARY = "summary";﻿    /**     * 关键字     */    public static final String KEYWORDS = "keywords";﻿    /**     * 跳过embedding标记，true表示不需要做embedding     */    public static final String SKIP_EMBEDDING = "skipEmbedding";}﻿Plain Text
```

#### 扩展信息

向量数据库中我们需要保存一些，比如文档的名称，文档的地址等信息，这些信息可以用来标记当前分段的归属。

#### 父子分块

###### ✅父子分段的切分和检索逻辑

传统固定长度切分会把一个完整的语义单元（如一段说明、一个步骤）切成两半，而我们为了解决这个问题，采用了标题分段+父子分段的方式。 先按 Markdown 标题层级切分，保证每个分段边界在标题处。超长分段保留完整父分段，用于展示时替换，检索时

LLMentor

#### 权限控制

###### 文档检索权限体系实现

...

LLMentor

#### 文档引用

###### ✅如何把引用文档内容返回给用户？

在RAG中，给问题回答增加参考来源是比较常见的做法，一方面可以增加回答的可信度，另外也能让用户直接查看完整文档，获取更多信息，如：  具体实现方式分两步，首先在分段时，需要在每一个分段中记录下来当前分段所属的文档的名称、以及对应的地址。 在

LLMentor

