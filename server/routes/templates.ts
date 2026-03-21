import { Hono } from 'hono';
import { TemplateService } from '../services/TemplateService';
import { LmapiClient } from '../services/LmapiClient';
import { JudgeService } from '../services/JudgeService';
import { generateId } from '../services/FileService';

export const templatesRouter = new Hono();

templatesRouter.get('/', c => {
  const templates = TemplateService.list();
  return c.json(templates);
});

templatesRouter.get('/:id', c => {
  const { id } = c.req.param();
  const template = TemplateService.get(id);
  if (!template) return c.json({ error: 'Template not found' }, 404);
  return c.json(template);
});

templatesRouter.post('/generate', async c => {
  const body = await c.req.json() as { promptContent?: string; tools?: unknown[]; modelId?: string };

  if (!body.promptContent) {
    return c.json({ error: 'promptContent is required' }, 400);
  }

  let modelId = body.modelId;
  if (!modelId) {
    try {
      const servers = await LmapiClient.getServers();
      const onlineServer = servers.find(s => s.isOnline && s.models.length > 0);
      modelId = onlineServer?.models[0];
    } catch {
      // ignore
    }
  }

  if (!modelId) {
    return c.json({ error: 'No model available. Specify modelId or ensure LMApi is running.' }, 503);
  }

  const tools = body.tools as Array<{ function: { name: string; description: string } }> | undefined;
  const { systemMessage, userMessage } = JudgeService.buildTemplateGeneratorPrompt(
    body.promptContent,
    tools
  );

  try {
    const response = await LmapiClient.chatCompletion({
      model: modelId,
      messages: [
        { role: 'system', content: systemMessage },
        { role: 'user', content: userMessage },
      ],
      stream: false,
    });

    const raw = response.choices[0]?.message.content ?? '';
    const proposed = JudgeService.parseTemplateGeneratorResponse(raw);

    if (!proposed) {
      return c.json({ error: 'Model returned unparseable response', raw }, 422);
    }

    const now = new Date().toISOString();
    const result = {
      id: generateId('tpl'),
      name: proposed.name ?? 'Generated Template',
      description: proposed.description ?? '',
      builtIn: false,
      perspectives: proposed.perspectives ?? [],
      deterministicChecks: proposed.deterministicChecks,
      suggestedTestCases: proposed.suggestedTestCases,
      createdAt: now,
      updatedAt: now,
    };

    return c.json(result);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

templatesRouter.post('/', async c => {
  const body = await c.req.json();
  if (!body.name || !body.perspectives) {
    return c.json({ error: 'name and perspectives are required' }, 400);
  }
  const template = TemplateService.create(body);
  return c.json(template, 201);
});

templatesRouter.put('/:id', async c => {
  const { id } = c.req.param();
  const body = await c.req.json();
  try {
    const updated = TemplateService.update(id, body);
    if (!updated) return c.json({ error: 'Template not found' }, 404);
    return c.json(updated);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 403);
  }
});

templatesRouter.delete('/:id', c => {
  const { id } = c.req.param();
  try {
    const deleted = TemplateService.delete(id);
    if (!deleted) return c.json({ error: 'Template not found' }, 404);
    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 403);
  }
});
