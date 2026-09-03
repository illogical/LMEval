import { Router } from 'express';
import { TemplateService } from '../services/TemplateService';
import { LmapiClient } from '../services/LmapiClient';
import { JudgeService } from '../services/JudgeService';
import { generateId } from '../services/FileService';

export const templatesRouter = Router();

templatesRouter.get('/', (req, res) => {
  const templates = TemplateService.list();
  res.json(templates);
});

templatesRouter.get('/:id', (req, res) => {
  const { id } = req.params;
  const template = TemplateService.get(id);
  if (!template) return void res.status(404).json({ error: 'Template not found' });
  res.json(template);
});

templatesRouter.post('/generate', async (req, res) => {
  const body = req.body as { promptContent?: string; tools?: unknown[]; modelId?: string };

  if (!body.promptContent) {
    return void res.status(400).json({ error: 'promptContent is required' });
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
    return void res.status(503).json({ error: 'No model available. Specify modelId or ensure LMApi is running.' });
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
      return void res.status(422).json({ error: 'Model returned unparseable response', raw });
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

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

templatesRouter.post('/', (req, res) => {
  const body = req.body;
  if (!body.name || !body.perspectives) {
    return void res.status(400).json({ error: 'name and perspectives are required' });
  }
  const template = TemplateService.create(body);
  res.status(201).json(template);
});

templatesRouter.put('/:id', (req, res) => {
  const { id } = req.params;
  const body = req.body;
  try {
    const updated = TemplateService.update(id, body);
    if (!updated) return void res.status(404).json({ error: 'Template not found' });
    res.json(updated);
  } catch (err) {
    res.status(403).json({ error: (err as Error).message });
  }
});

templatesRouter.delete('/:id', (req, res) => {
  const { id } = req.params;
  try {
    const deleted = TemplateService.delete(id);
    if (!deleted) return void res.status(404).json({ error: 'Template not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(403).json({ error: (err as Error).message });
  }
});
