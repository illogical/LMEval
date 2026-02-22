// LMApi TypeScript types for client consumption

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: object; // JSON Schema
  };
}

export interface LmapiChatCompletionRequest {
  model: string;
  messages: Array<{
    role: 'system' | 'user' | 'assistant' | 'tool';
    content?: string | null;
    tool_calls?: ToolCall[];
    tool_call_id?: string;
  }>;
  tools?: ToolDefinition[];
  tool_choice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  // LMAPI extensions
  serverName?: string;
  groupId?: string;
  maxParallelPerServer?: number;
  provider?: string;
}

export interface LmapiChatCompletionResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: 'assistant';
      content?: string | null;
      tool_calls?: ToolCall[];
    };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  lmapi?: {
    server_name: string;
    duration_ms: number;
    group_id?: string;
  };
}

export interface LmapiServerStatus {
  config: { name: string; baseUrl: string };
  isOnline: boolean;
  models: string[];
  runningModels: string[];
  activeModels: string[];
  activeRequests: number;
  lastChecked: number;
}

export interface LmapiBatchResponse {
  results: LmapiChatCompletionResponse[];
  group_id: string;
}
