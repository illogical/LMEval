export interface LmapiServerStatus {
  config: { name: string; baseUrl: string };
  isOnline: boolean;
  models: string[];
  runningModels: string[];
  activeModels: string[];
  activeRequests: number;
  lastChecked: number;
}

export interface LmapiLoadedModelsResponse {
  models: string[];
}

export interface LmapiChatCompletionRequest {
  model: string;
  messages: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string;
  }>;
  stream: false;
  groupId?: string;
}

export interface LmapiChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: { role: string; content: string };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  lmapi?: {
    server_name: string;
    duration_ms: number;
    group_id?: string;
  };
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface LmapiBatchResponse {
  results: LmapiChatCompletionResponse[];
  groupId: string;
  duration_ms: number;
}
