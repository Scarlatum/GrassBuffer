export type AnyFunction = (...args: any[]) => any;

export type DeriveDescription<T> = T & { desc?: string };

declare type MessageContainer = { 
  date: number, 
  data: string, 
  from: string 
};

export type LLMResponse = {
  choices: Array<{ 
    finish_reason: string 
    message: { 
      role: string, 
      content: string; 
      tool_call_id: string;
      tool_calls: Array<{ id: string, function: { name: string, arguments: string } }>;
      reasoning?: string;
    }; 
  }>;
};