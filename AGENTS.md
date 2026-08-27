# 给 AI 助手的仓库须知

给在这个仓里干活的 AI（Claude Code、Copilot、Cursor 等）。人读的流程在 `CONTRIBUTING.md`，两份内容不重复：那份讲流程，这份只讲**这个仓里容易踩错的具体事实**。

## 前提

- 这个仓是 **public**。任何要推出去的内容——代码、注释、commit message、Issue、PR——都不写真实姓名、单位、住址、明文密码、凭证。
- commit **不要**加 `Co-Authored-By`。
- 有一位协作者在 **Windows** 上开发。不要硬编码路径、不要假设是 bash、不要生成只在 macOS/Linux 能跑的命令。

## 事实清单（弄错会浪费一轮 review）

**运行时**：`server.js` 用 `node:sqlite`，需要 Node ≥ 24。`package.json` 的 `engines` 和 `Dockerfile` 的 `node:24-bookworm-slim` 都以此为准，改一处要一起改。

**`server.js` 没有 export，在模块加载时就 `listen`。** 所以测试用子进程启动它（见 `tests/helpers/server.js`）。**不要为了让测试好写而去重构 `server.js`**——那是独立的产品改动，要单独的 Issue。

**`node --test tests/api/` 在 Node 24 上会失败**（把目录当模块解析）。必须用 glob：`node --test "tests/api/**/*.test.js"`。已经写在 `package.json` 里，别"顺手简化"回去。

**仓里 15 个文件带 UTF-8 BOM**，`style.css` 整个文件是一行，`app.js` 最长行 2067 字符。**这些是已知的、有专门 Issue 的问题，不要在做别的事情时顺手格式化**——那个 diff 会淹掉真正的改动。`package.json` 的 BOM 已经去掉了，因为 BOM 让它不是合法 JSON；不要把 BOM 加回任何文件。

**`writeDb()` 每次写入都把 rooms / members / requests / sessions 四张表全删再全插。** 不要假设它是增量更新。任何关于并发或性能的推断先读那个函数。

**身份永远取自会话，不取自请求体。** 两个 handler 都用 `auth.memberId`。改动这一带时保持这个性质，`tests/api/request.test.js` 里有对应断言。

## 写测试

- 用 `node:test` + `assert`。**`console.log(JSON.stringify(...))` 不是测试**——仓里原来那 7 个脚本就是这么写的，答案错时它们打印错答案然后 exit 0，全部已删除。
- 每条断言对应一条产品规则，注释里点明是哪条。
- 不依赖预装浏览器、不依赖本机绝对路径、不写死端口。
- **加了检查就要证明它会失败**：把产品代码故意改错，跑测试，确认变红，然后还原。还原用备份文件复制回来，**不要用 `git checkout -- <file>`**（会连未提交的改动一起丢），还原后核对 sha256。

## 产品规则从哪来

只有两个来源：`README.md` 的 Product rules，和 Issue 里写下的验收标准。**不要自己推断产品应该怎么样。** 觉得缺一条规则，去 Issue 里提，别直接写进代码。

## 下结论之前

- 说"测试通过"之前：跑的是 `npm test` 吗？`npm run test:syntax` 只是 `node --check`，**只验语法不验行为**。
- 说"CI 全绿"之前：查到那次 run 的 step 级别。PR 有冲突时 CI 一个 run 都不产生，页面上不显示红，是什么都没有。
- 说"远端没有 X"之前：`git fetch` 之后再看，或者直接问 GitHub API。本地的 `origin/main` 可能是过期缓存。
- 说"这个另开 Issue"之前：当场开。说完不开等于没说。
