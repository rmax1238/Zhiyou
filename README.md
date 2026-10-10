# 智邮 (AuroraMail) - 智能邮箱管理与多模型 AI 助手

现代化移动自适应邮箱管理客户端，支持用户账户独立数据隔离、IMAP/SMTP 安全加密协议、新邮件实时推送、多服务商自定义 AI 模型调度（DeepSeek、Gemini、OpenAI、Ollama等）、智能邮件长文速读与多语言对照翻译。

---

## 🌟 核心特性

- 👤 **账户体系与独立数据沙盒**
  - 支持本地账户注册、登录、登出与快速切换。
  - 每个用户的设置（绑定的邮箱账户、邮件列表、AI 服务商与 API Key、LLM 任务路由、自定义标签、滑动手势、界面主题）**完全隔离并加密存储**在当前账户下。
  - 支持一键导出/导入个人的完整配置与邮件数据（JSON 备份），方便跨设备同步与迁移。
- 🔐 **全协议安全邮箱对接**
  - 支持 QQ邮箱、163网易邮箱、Gmail、Outlook 及企业自建邮箱（Dovecot/Postfix/Exchange）。
  - 支持 SSL/TLS (端口 465/993) 与 STARTTLS (端口 587) 强加密握手，保护通信隐私。
- 🤖 **多模型 AI 灵活调度中心**
  - **自动拉取模型列表**：一键从服务商 `/models` 端点拉取并筛选可用模型。
  - **任务级精准路由**：邮件长文总结、跨国多语言翻译、智能公函拟信、智能打标签分别指派最擅长的专属大模型。
- 🏷️ **AI 智能分类打标与手势操作**
  - 自动识别归类为「通知」、「广告」、「验证码」、「垃圾邮件」。
  - 移动端流畅手势：支持向左滑动（默认删除）与向右滑动（默认归档），可完全自定义。
- 🔔 **实时推送与多端自适应**
  - Web Audio 提示音与浏览器原生通知，完美适配手机、平板与桌面宽屏。

---

## 🚀 部署至 Cloudflare 极速指南

针对“**部署在 Cloudflare 上什么方式最简单快捷？**”，以下提供最佳实践方案：

### 方案一：Cloudflare Pages（最简单、最快、零成本，推荐 ⭐⭐⭐⭐⭐）

智邮 (AuroraMail) 前端为标准的 Vite + React 19 单页应用 (SPA)，部署到 **Cloudflare Pages** 仅需 2 分钟，享受全球 Anycast CDN 加速、免费自动化 SSL 证书与无限流量。

#### 步骤 1：通过 GitHub / GitLab 仓库关联部署（零配置自动持续集成）

1. 将本项目代码推送至 GitHub 或 GitLab 仓库。
2. 登录 [Cloudflare 控制台](https://dash.cloudflare.com/)。
3. 进入 **Workers & Pages** -> 点击 **Create Application** -> 选择 **Pages** -> 点击 **Connect to Git**。
4. 选中您的代码仓库，并填写构建设置：
   - **Framework preset (框架预设)**: `Vite`
   - **Build command (构建命令)**: `npm run build`
   - **Build output directory (输出目录)**: `dist`
   - **环境变量 (Environment Variables)**: 添加 `NODE_VERSION` = `20`
5. 点击 **Save and Deploy**。1-2 分钟内即可构建完成，并分配一个专属的 `https://<your-project>.pages.dev` 访问域名！后续每次 Git push 代码将自动触发增量部署。

#### 步骤 2：通过 Wrangler CLI 命令行直接发布（无需 Git 仓库）

若不想关联 Git 仓库，可直接使用官方 Wrangler 命令行：

```bash
# 1. 本地安装依赖并打包
npm install
npm run build

# 2. 一键直推到 Cloudflare Pages
npx wrangler pages deploy dist --project-name=auroramail
```

---

### 方案二：后端 API 在 Cloudflare 上的适配建议

如果您需要使用后端发信或避免客户端调用 AI 时的跨域问题：

1. **AI 客户端直连模式（纯静态即可运行）**：
   - 智邮已支持前端直接调用各大 AI 服务商（如 DeepSeek、OpenAI、SiliconFlow、Moonshot、Google Gemini）。
   - 在部署到 Cloudflare Pages 后，用户只要在「AI 模型调度」填入 API Key 即可全端正常工作，无需运行后端中间层服务器。

2. **Cloudflare Workers AI 原生集成（完全免费、免 API Key）**：
   - 项目中已内置 `/functions/api/ai/chat.ts`。当部署到 Cloudflare Pages 时，会自动识别为云函数。
   - **如何开启免费使用**：
     1. 进入 Cloudflare Dashboard -> **Workers & Pages** -> 选择您的 Pages 项目。
     2. 进入 **Settings** -> **Functions** -> 找到 **Workers AI bindings**。
     3. 点击 **Add binding**：
        - Variable name (变量名): 填入 `AI`
     4. 点击保存并重新部署。
   - 部署后在智邮的「AI 服务商管理」中选择预设的「**Cloudflare Workers AI (免费免密钥)**」，即可每日免费调用 Llama-3.1-8b、Qwen1.5-14b、Mistral 等开源模型进行长邮件总结、翻译与智能拟信！

3. **SMTP 真实发信在边缘环境的解决方案**：
   - 浏览器环境无法直接发起原始 TCP Socket 发送 SMTP 报文。
   - 在 Cloudflare 上实现真实发信，推荐以下两种方式：
     - **推荐 A**：使用 **Resend** / **SendGrid** API 或 Cloudflare 官方集成的 **MailChannels**（通过 HTTP API 发信，边缘零阻碍）。
     - **推荐 B**：利用 Cloudflare Workers 的原生 `cloudflare:sockets` TCP 连接外部 SMTP 服务器（端口 465 SSL/TLS）。

---

## 💻 本地运行与开发

1. **安装依赖**：
   ```bash
   npm install
   ```

2. **启动本地全功能服务**：
   ```bash
   npm run dev
   ```
   访问 `http://localhost:3000` 即可开始使用。
