// @ts-ignore: npm imports
import { Anthropic } from "@anthropic-ai/sdk";
import {
  ContentBlock,
  MessageParam,
  ImageBlockParam,
  MessageStreamEvent,
  ToolResultBlockParam,
  Tool,
  ContentBlockParam,
} from "@anthropic-ai/sdk/resources/messages/messages";
import { getApiKeys } from "./chat.ts";
import { SYSTEM_PROMPT } from "./system-prompt.ts";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { TextBlockParam } from "@anthropic-ai/sdk/src/resources/index.js";

// Response chunk types
interface ToolCallStart {
  type: "tool_call_start";
  name: string;
  tool_use_id: string;
}

interface ToolCallUpdate {
  type: "tool_call_update";
  name: string;
  tool_use_id: string;
  partialInput: string;
}

interface ToolCallComplete {
  type: "tool_call_complete";
  name: string;
  tool_use_id: string;
  args: Record<string, unknown>;
}

interface ToolResultSuccess {
  type: "tool_result";
  name: string;
  tool_use_id: string;
  args: Record<string, unknown>;
  result: unknown;
}

interface ToolResultError {
  type: "tool_error";
  name: string;
  tool_use_id: string;
  args: Record<string, unknown>;
  error: string;
}

interface TextChunk {
  type: "text_chunk";
  content: string;
}

interface NewContextMessage {
  type: "new_context_message";
  message: MessageParam;
}

interface ResponseComplete {
  type: "response_complete";
  new_context: MessageParam[];
}

export type StreamOutput =
  | TextChunk
  | ToolCallStart
  | ToolCallUpdate
  | ToolCallComplete
  | ToolResultSuccess
  | ToolResultError
  | ResponseComplete
  | NewContextMessage;

function formatMessages(
  messages: MessageParam[],
  userMessage: string,
  images?: ImageBlockParam[],
): MessageParam[] {
  const contentBlocks: ContentBlockParam[] = [
    ...(images || []),
    { type: "text", text: userMessage },
  ];

  return [
    {
      role: "user",
      content: SYSTEM_PROMPT,
    },
    ...messages,
    {
      role: "user",
      content: contentBlocks,
    },
  ];
}

// Given a message context, a user message, a set of tools, and a set of images,
// stream the assistant response, including tool calls and results.
//
// returns a generator of StreamOutput
// finally outputs the new messages context.
export async function* streamAssistantResponse(
  messages: MessageParam[],
  userMessage: string,
  images?: ImageBlockParam[],
  tools?: Tool[],
  executeToolFn?: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<CallToolResult>,
): AsyncGenerator<StreamOutput> {
  // Ensure necessary API key is available.
  const keys = await getApiKeys();
  if (!keys.anthropic) {
    throw new Error("Anthropic API key not found. Please add it in settings.");
  }
  const anthropic = new Anthropic({
    apiKey: keys.anthropic,
    dangerouslyAllowBrowser: true,
  });
  const initialMessages = formatMessages(messages, userMessage, images);

  // Define the immutable state used in processing.
  const initialState = {
    currentMessages: initialMessages,
    currentToolName: "",
    currentToolInputString: "",
    currentToolUseId: "",
    assistantResponse: "",
    needsMoreInference: false,
  };

  // Helper: Process a single chunk into new state and output events.
  const processChunk = (
    state: typeof initialState,
    chunk: MessageStreamEvent,
  ): { newState: typeof initialState; outputs: StreamOutput[] } => {
    let outputs: StreamOutput[] = [];
    let newState = { ...state };

    switch (chunk.type) {
      case "message_start":
        // No state change for message_start.
        break;
      case "content_block_start":
        if (chunk.content_block.type === "tool_use") {
          newState = {
            ...newState,
            currentToolUseId: chunk.content_block.id,
            currentToolName: chunk.content_block.name,
          };
          outputs.push({
            type: "tool_call_start",
            name: chunk.content_block.name,
            tool_use_id: chunk.content_block.id,
          });
        }
        break;
      case "content_block_delta":
        if (chunk.delta.type === "text_delta") {
          newState = {
            ...newState,
            assistantResponse: newState.assistantResponse + chunk.delta.text,
          };
          outputs.push({ type: "text_chunk", content: chunk.delta.text });
        } else if (chunk.delta.type === "input_json_delta") {
          newState = {
            ...newState,
            currentToolInputString:
              newState.currentToolInputString + chunk.delta.partial_json,
          };
          outputs.push({
            type: "tool_call_update",
            name: newState.currentToolName,
            tool_use_id: newState.currentToolUseId,
            partialInput: chunk.delta.partial_json,
          });
        }
        break;
      case "content_block_stop":
        if (newState.currentToolUseId === "") {
          // Finalize accumulated text by appending a new assistant message.
          const textMessage: MessageParam = {
            role: "assistant",
            content: [{ type: "text", text: newState.assistantResponse }],
          };
          newState = {
            ...newState,
            currentMessages: [...newState.currentMessages, textMessage],
            assistantResponse: "",
          };
          outputs.push({ type: "new_context_message", message: textMessage });
        }
        break;
      case "message_delta":
        if (chunk.delta.stop_reason === "tool_use") {
          // Prepare a tool call message.
          const toolInput =
            newState.currentToolInputString === ""
              ? {}
              : JSON.parse(newState.currentToolInputString);
          const toolMessage: MessageParam = {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: newState.currentToolUseId,
                name: newState.currentToolName,
                input: toolInput,
              },
            ],
          };
          newState = {
            ...newState,
            currentMessages: [...newState.currentMessages, toolMessage],
          };
          outputs.push({ type: "new_context_message", message: toolMessage });
          // Signal that a tool call should be executed.
          newState = { ...newState, needsMoreInference: true };
        }
        break;
      default:
        break;
    }
    return { newState, outputs };
  };

  // Helper: Execute the tool call and update state accordingly.
  const processToolCall = async (
    state: typeof initialState,
  ): Promise<{ newState: typeof initialState; outputs: StreamOutput[] }> => {
    let outputs: StreamOutput[] = [];
    const toolInput =
      state.currentToolInputString === ""
        ? {}
        : JSON.parse(state.currentToolInputString);
    try {
      if (!executeToolFn) throw new Error("No tool executor provided");
      const result = await executeToolFn(state.currentToolName, toolInput);
      const resultString = JSON.stringify(result);
      outputs.push({
        type: "tool_result",
        name: state.currentToolName,
        tool_use_id: state.currentToolUseId,
        args: toolInput,
        result: resultString,
      });
      const resultContent = result.content.map((c: any) => {
        switch (c.type) {
          case "text":
            return { type: "text", text: c.text } as TextBlockParam;
          case "image":
            return {
              type: "image",
              source: {
                data: c.data,
                media_type: c.mimeType,
                type: "base64",
              },
            } as ImageBlockParam;
          default:
            return { type: "text", text: "" } as TextBlockParam;
        }
      });
      const resultMessage: MessageParam = {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: state.currentToolUseId,
            content: resultContent,
            is_error: result.isError,
          },
        ],
      };
      const newMessages = [...state.currentMessages, resultMessage];
      outputs.push({ type: "new_context_message", message: resultMessage });
      return {
        newState: {
          ...state,
          currentMessages: newMessages,
          currentToolName: "",
          currentToolInputString: "",
          currentToolUseId: "",
        },
        outputs,
      };
    } catch (e: any) {
      outputs.push({
        type: "tool_error",
        name: state.currentToolName,
        tool_use_id: state.currentToolUseId,
        args: toolInput,
        error: e.message,
      });
      const errorMessage: MessageParam = {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: state.currentToolUseId,
            content: e.message,
          },
        ],
      };
      const newMessages = [...state.currentMessages, errorMessage];
      outputs.push({ type: "new_context_message", message: errorMessage });
      return {
        newState: {
          ...state,
          currentMessages: newMessages,
          currentToolName: "",
          currentToolInputString: "",
          currentToolUseId: "",
        },
        outputs,
      };
    }
  };

  // Recursive function to process the response stream.
  async function* processStream(
    state: typeof initialState,
  ): AsyncGenerator<StreamOutput> {
    const stream = await anthropic.messages.create({
      messages: state.currentMessages,
      model: "claude-3-5-sonnet-latest",
      max_tokens: 4096,
      stream: true,
      tools: tools || [],
    });
    let currentState = state;
    for await (const chunk of stream) {
      // For "tool_use" message_delta chunks, execute the tool call.
      if (
        chunk.type === "message_delta" &&
        chunk.delta.stop_reason === "tool_use"
      ) {
        const { newState, outputs } = processChunk(currentState, chunk);
        for (const out of outputs) {
          yield out;
        }
        const toolCallResult = await processToolCall(newState);
        for (const out of toolCallResult.outputs) {
          yield out;
        }
        currentState = toolCallResult.newState;
      } else {
        const { newState, outputs } = processChunk(currentState, chunk);
        for (const out of outputs) {
          yield out;
        }
        currentState = newState;
      }
    }
    if (currentState.needsMoreInference) {
      // Reset flag and recursively process the next round.
      currentState = { ...currentState, needsMoreInference: false };
      yield* processStream(currentState);
    } else {
      return currentState;
    }
  }

  // Start the recursive stream processing.
  yield* processStream(initialState);
  // Finalize by yielding the complete message context.
  yield {
    type: "response_complete",
    new_context: initialState.currentMessages,
  };
}

export async function getSummaryTitle(content: string): Promise<string> {
  const keys = await getApiKeys();
  if (!keys.anthropic) {
    throw new Error("Anthropic API key not found. Please add it in settings.");
  }

  const anthropic = new Anthropic({
    apiKey: keys.anthropic,
    dangerouslyAllowBrowser: true,
  });

  const response = await anthropic.messages.create({
    messages: [
      {
        role: "user",
        content: `Please provide a very brief title (4-6 words) summarizing this request: "${content}".
                     Respond with ONLY the title, no quotes or extra text.`,
      },
    ],
    model: "claude-3-5-sonnet-latest",
    max_tokens: 30,
  });

  if (response.content[0].type === "text") {
    return response.content[0].text.trim();
  }
  throw new Error("Unexpected response type from AI");
}
