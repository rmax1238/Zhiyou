import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import nodemailer from 'nodemailer';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  // 1. SMTP 连通性测试与协议安全校验
  app.post('/api/mail/test-smtp', async (req, res) => {
    try {
      const { host, port, secure, user, pass, requireTls } = req.body;

      if (!host || !port || !user || !pass) {
        return res.status(400).json({
          success: false,
          error: '请完整提供 SMTP 服务器地址、端口、用户名及密码/授权码',
        });
      }

      const portNum = Number(port);
      const isSecure = secure === true || portNum === 465;

      const transporter = nodemailer.createTransport({
        host,
        port: portNum,
        secure: isSecure,
        auth: {
          user,
          pass,
        },
        requireTLS: requireTls ?? false,
        tls: {
          rejectUnauthorized: false,
        },
        connectionTimeout: 10000,
        greetingTimeout: 8000,
      });

      await transporter.verify();

      return res.json({
        success: true,
        message: `SMTP 验证通过！连接协议: ${isSecure ? 'SSL/TLS' : 'STARTTLS/PLAIN'} (端口: ${portNum})`,
        details: {
          host,
          port: portNum,
          protocol: isSecure ? 'SSL/TLS' : 'STARTTLS',
          user,
        },
      });
    } catch (err: any) {
      console.error('SMTP verification failed:', err);
      let advice = '请核对服务器地址、端口及密码/授权码。';
      const msg = err.message || '';
      if (msg.includes('Invalid login') || msg.includes('535') || msg.includes('authentication')) {
        advice = '认证失败：国内邮箱（如QQ、163）通常需要在网页设置中开启 POP3/IMAP/SMTP 服务并生成专用的「客户端授权码」，而非普通登录密码。';
      } else if (msg.includes('ETIMEDOUT') || msg.includes('ECONNREFUSED')) {
        advice = '连接超时或被拒绝：请检查端口（通常465对应SSL，587对应STARTTLS）及网络防火墙。';
      }

      return res.status(422).json({
        success: false,
        error: `SMTP 连接测试失败: ${msg}`,
        advice,
      });
    }
  });

  // 2. 发送邮件接口
  app.post('/api/mail/send', async (req, res) => {
    try {
      const { smtpConfig, mailData } = req.body;
      const { to, cc, bcc, subject, text, html, attachments } = mailData;

      if (!to || !subject) {
        return res.status(400).json({ success: false, error: '收件人和主题为必填项' });
      }

      if (smtpConfig && smtpConfig.host && smtpConfig.user && smtpConfig.pass) {
        const portNum = Number(smtpConfig.port || 465);
        const isSecure = smtpConfig.secure === true || portNum === 465;

        const transporter = nodemailer.createTransport({
          host: smtpConfig.host,
          port: portNum,
          secure: isSecure,
          auth: {
            user: smtpConfig.user,
            pass: smtpConfig.pass,
          },
          tls: {
            rejectUnauthorized: false,
          },
        });

        const info = await transporter.sendMail({
          from: smtpConfig.fromName ? `"${smtpConfig.fromName}" <${smtpConfig.user}>` : smtpConfig.user,
          to,
          cc,
          bcc,
          subject,
          text,
          html,
          attachments: attachments?.map((att: any) => ({
            filename: att.filename,
            content: att.content,
            encoding: att.encoding || 'base64',
          })),
        });

        return res.json({
          success: true,
          message: '邮件已通过真实 SMTP 成功发出！',
          messageId: info.messageId,
          simulated: false,
        });
      }

      return res.json({
        success: true,
        message: '邮件发送模拟成功（未配置独立SMTP服务，已自动存入已发送箱）',
        messageId: `sim-${Date.now()}`,
        simulated: true,
      });
    } catch (err: any) {
      console.error('Mail send error:', err);
      return res.status(500).json({
        success: false,
        error: `发送邮件失败: ${err.message || '未知错误'}`,
      });
    }
  });

  // 3. 通用 AI 服务商测试与调用代理
  app.post('/api/ai/test-provider', async (req, res) => {
    try {
      const { providerType, baseURL, apiKey, model, customHeaders } = req.body;

      if (providerType === 'gemini') {
        const keyToUse = apiKey || process.env.GEMINI_API_KEY;
        if (!keyToUse) {
          return res.status(400).json({ success: false, error: '缺少 Gemini API Key' });
        }
        const ai = new GoogleGenAI({ apiKey: keyToUse });
        const response = await ai.models.generateContent({
          model: model || 'gemini-2.5-flash',
          contents: '请回复一条极简的中文连接测试确认：“智邮AI服务连通成功”。',
        });
        return res.json({
          success: true,
          message: 'Gemini 服务商测试连接成功！',
          reply: response.text?.slice(0, 100),
        });
      }

      const targetBase = (baseURL || 'https://api.openai.com/v1').replace(/\/+$/, '');
      const url = `${targetBase}/chat/completions`;

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey || ''}`,
      };

      if (customHeaders && typeof customHeaders === 'object') {
        Object.assign(headers, customHeaders);
      }

      const fetchRes = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: model || 'gpt-4o-mini',
          messages: [{ role: 'user', content: '测试API连通性，请回复：OK' }],
          max_tokens: 50,
        }),
      });

      if (!fetchRes.ok) {
        const errText = await fetchRes.text();
        return res.status(fetchRes.status).json({
          success: false,
          error: `服务商返回错误 (HTTP ${fetchRes.status}): ${errText.slice(0, 300)}`,
        });
      }

      const data = await fetchRes.json();
      const reply = data.choices?.[0]?.message?.content || '连通成功';

      return res.json({
        success: true,
        message: 'OpenAI 兼容接口连接成功！',
        reply: reply.trim(),
      });
    } catch (err: any) {
      console.error('AI provider test failed:', err);
      return res.status(500).json({
        success: false,
        error: `连接异常: ${err.message}`,
      });
    }
  });

  // 3.5 自动拉取服务商模型列表接口
  app.post('/api/ai/fetch-models', async (req, res) => {
    try {
      const { providerType, baseURL, apiKey, customHeaders } = req.body;

      if (providerType === 'gemini') {
        const keyToUse = apiKey || process.env.GEMINI_API_KEY;
        if (!keyToUse) {
          return res.status(400).json({
            success: false,
            error: '请先提供 Gemini API Key 以便拉取官方模型列表',
          });
        }

        try {
          const geminiRes = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models?key=${keyToUse}`
          );
          if (geminiRes.ok) {
            const data = await geminiRes.json();
            const rawModels = data.models || [];
            const filtered = rawModels
              .map((m: any) => (m.name || '').replace(/^models\//, ''))
              .filter(
                (name: string) =>
                  name &&
                  !name.includes('embedding') &&
                  !name.includes('aqa') &&
                  !name.includes('imagen')
              );

            const sorted = filtered.length > 0 ? filtered : [
              'gemini-2.5-flash',
              'gemini-2.5-pro',
              'gemini-2.0-flash',
              'gemini-2.0-flash-lite',
              'gemini-1.5-pro',
              'gemini-1.5-flash',
            ];

            return res.json({
              success: true,
              models: Array.from(new Set(sorted)),
            });
          }
        } catch (geminiErr) {
          console.warn('Direct Gemini API models fetch failed, using standard list:', geminiErr);
        }

        return res.json({
          success: true,
          models: [
            'gemini-2.5-flash',
            'gemini-2.5-pro',
            'gemini-2.0-flash',
            'gemini-2.0-flash-lite',
            'gemini-1.5-pro',
            'gemini-1.5-flash',
          ],
        });
      }

      const rawBase = (baseURL || 'https://api.openai.com/v1').replace(/\/+$/, '');
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }
      if (customHeaders && typeof customHeaders === 'object') {
        Object.assign(headers, customHeaders);
      }

      let targetUrls = [`${rawBase}/models`];
      if (!rawBase.endsWith('/v1')) {
        targetUrls.push(`${rawBase}/v1/models`);
      } else {
        targetUrls.push(`${rawBase.replace(/\/v1$/, '')}/models`);
      }
      if (rawBase.includes('11434')) {
        targetUrls.push(`${rawBase.replace(/\/v1$/, '')}/api/tags`);
      }

      let fetchRes: Response | null = null;
      let lastErrorText = '';

      for (const url of targetUrls) {
        try {
          const r = await fetch(url, { method: 'GET', headers });
          if (r.ok) {
            fetchRes = r;
            break;
          } else {
            lastErrorText = await r.text();
          }
        } catch (e: any) {
          lastErrorText = e.message || '';
        }
      }

      if (!fetchRes) {
        return res.status(400).json({
          success: false,
          error: `无法从目标地址获取模型列表 (${targetUrls[0]}): ${lastErrorText.slice(0, 200) || '网络无法连通或端点不支持 GET /models'}`,
        });
      }

      const data = await fetchRes.json();
      let extracted: string[] = [];

      if (Array.isArray(data.data)) {
        extracted = data.data.map((item: any) => item.id || item.name || '').filter(Boolean);
      } else if (Array.isArray(data.models)) {
        extracted = data.models.map((item: any) => item.name || item.id || item.model || '').filter(Boolean);
      } else if (Array.isArray(data)) {
        extracted = data.map((item: any) => (typeof item === 'string' ? item : item.id || item.name || '')).filter(Boolean);
      }

      const uniqueModels = Array.from(new Set(extracted)).filter(
        (m) =>
          !m.includes('embedding') &&
          !m.includes('whisper') &&
          !m.includes('tts') &&
          !m.includes('dall-e') &&
          !m.includes('moderation')
      );

      uniqueModels.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

      return res.json({
        success: true,
        models: uniqueModels.length > 0 ? uniqueModels : extracted,
      });
    } catch (err: any) {
      console.error('Fetch models error:', err);
      return res.status(500).json({
        success: false,
        error: `拉取模型列表失败: ${err.message}`,
      });
    }
  });

  // 4. 核心 AI 执行代理
  app.post('/api/ai/chat', async (req, res) => {
    try {
      const { provider, systemPrompt, userPrompt, temperature, maxTokens } = req.body;

      if (!userPrompt) {
        return res.status(400).json({ success: false, error: '提示词内容不能为空' });
      }

      const providerType = provider?.providerType || 'gemini';
      const apiKey = provider?.apiKey || process.env.GEMINI_API_KEY;
      const model = provider?.model || 'gemini-2.5-flash';

      if (providerType === 'gemini') {
        if (!apiKey) {
          return res.status(400).json({
            success: false,
            error: '未配置 Gemini API Key，请在「AI服务商管理」面板配置或添加其他可用服务商',
          });
        }

        const ai = new GoogleGenAI({ apiKey });
        const fullPrompt = [
          systemPrompt ? `【系统设定与指令】\n${systemPrompt}\n\n` : '',
          userPrompt,
        ].filter(Boolean).join('\n');

        const response = await ai.models.generateContent({
          model,
          contents: fullPrompt,
        });

        return res.json({
          success: true,
          content: response.text || '',
          modelUsed: model,
          providerName: provider?.name || 'Google Gemini',
        });
      }

      if (providerType === 'cloudflare') {
        const cfAccountId = process.env.CF_ACCOUNT_ID;
        const cfToken = process.env.CF_API_TOKEN || apiKey;

        if (cfAccountId && cfToken) {
          const cfUrl = `https://api.cloudflare.com/client/v4/accounts/${cfAccountId}/ai/run/${model}`;
          const messages = [];
          if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
          messages.push({ role: 'user', content: userPrompt });

          const cfRes = await fetch(cfUrl, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${cfToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              messages,
              temperature: typeof temperature === 'number' ? temperature : (provider?.temperature ?? 0.6),
              max_tokens: maxTokens || provider?.maxTokens || 2048,
            }),
          });

          if (cfRes.ok) {
            const cfData: any = await cfRes.json();
            const content = cfData?.result?.response || cfData?.response || '';
            return res.json({
              success: true,
              content,
              modelUsed: model,
              providerName: 'Cloudflare Workers AI',
            });
          }
        }

        return res.json({
          success: true,
          content: `【Cloudflare Workers AI 演示应答 (模型: ${model})】\n在 Cloudflare Pages 线上部署后，系统将自动通过原生 env.AI 免费免密运行。`,
          modelUsed: model,
          providerName: 'Cloudflare Workers AI (本地预览模式)',
        });
      }

      const baseURL = (provider?.baseURL || 'https://api.openai.com/v1').replace(/\/+$/, '');
      const targetUrl = `${baseURL}/chat/completions`;

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey || ''}`,
      };

      if (provider?.customHeaders && typeof provider.customHeaders === 'object') {
        Object.assign(headers, provider.customHeaders);
      }

      const messages = [];
      if (systemPrompt) {
        messages.push({ role: 'system', content: systemPrompt });
      }
      messages.push({ role: 'user', content: userPrompt });

      const fetchRes = await fetch(targetUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          messages,
          temperature: typeof temperature === 'number' ? temperature : (provider?.temperature ?? 0.7),
          max_tokens: maxTokens || provider?.maxTokens || 2048,
        }),
      });

      if (!fetchRes.ok) {
        const errText = await fetchRes.text();
        return res.status(fetchRes.status).json({
          success: false,
          error: `AI服务商返回错误 (HTTP ${fetchRes.status}): ${errText.slice(0, 300)}`,
        });
      }

      const data = await fetchRes.json();
      const content = data.choices?.[0]?.message?.content || '';

      return res.json({
        success: true,
        content,
        modelUsed: model,
        providerName: provider?.name || '自定义服务商',
      });
    } catch (err: any) {
      console.error('AI chat proxy failed:', err);
      return res.status(500).json({
        success: false,
        error: `AI处理请求失败: ${err.message}`,
      });
    }
  });

  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  const PORT = Number(process.env.PORT) || 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[智邮] AuroraMail Server is running at http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
