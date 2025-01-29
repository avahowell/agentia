// @ts-ignore: npm imports
import { Anthropic } from '@anthropic-ai/sdk';
import { ContentBlock, MessageParam, ImageBlockParam, MessageStreamEvent, ToolResultBlockParam, Tool, ContentBlockParam } from '@anthropic-ai/sdk/resources/messages/messages';
import { getApiKeys } from './chat.ts';
import { SYSTEM_PROMPT } from './system-prompt.ts';

// Response chunk types
interface ToolCallStart {
    type: 'tool_call_start';
    name: string;
    tool_use_id: string;
}

interface ToolCallUpdate {
    type: 'tool_call_update';
    name: string;
    tool_use_id: string;
    partialInput: string;
}

interface ToolCallComplete {
    type: 'tool_call_complete';
    name: string;
    tool_use_id: string;
    args: Record<string, unknown>;
}

interface ToolResultSuccess {
    type: 'tool_result';
    name: string;
    tool_use_id: string;
    args: Record<string, unknown>;
    result: unknown;
}

interface ToolResultError {
    type: 'tool_error';
    name: string;
    tool_use_id: string;
    args: Record<string, unknown>;
    error: string;
}

interface TextChunk {
    type: 'text_chunk';
    content: string;
}

interface NewContextMessage {
    type: 'new_context_message';
    message: MessageParam;
}

interface ResponseComplete {
    type: 'response_complete';
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
    images?: ImageBlockParam[]
): MessageParam[] {
    const contentBlocks: ContentBlockParam[] = [
        ...(images || []),
        { type: 'text', text: userMessage }
    ];

    return [
        {
            role: 'user',
            content: SYSTEM_PROMPT
        },
        ...messages,
        {
            role: 'user',
            content: contentBlocks
        }
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
    executeToolFn?: (name: string, args: Record<string, unknown>) => Promise<unknown>
): AsyncGenerator<StreamOutput> {
    const keys = await getApiKeys();
    if (!keys.anthropic) {
        throw new Error('Anthropic API key not found. Please add it in settings.');
    }

    const anthropic = new Anthropic({
        apiKey: keys.anthropic,
        dangerouslyAllowBrowser: true,
    });

    let currentMessages = formatMessages(messages, userMessage, images);
    console.log("📨 Formatted messages:", currentMessages);

    let currentToolName = "";
    let currentToolInputString = "";
    let currentToolUseId = "";
    let assistantResponse = "";
    let needsMoreInference = true;

    while (needsMoreInference) {
        needsMoreInference = false;

        const stream = await anthropic.messages.create({
            messages: currentMessages,
            model: 'claude-3-5-sonnet-latest',
            max_tokens: 4096,
            stream: true,
            tools: tools || []
        });

        for await (const chunk of stream as AsyncIterable<MessageStreamEvent>) {
            switch (chunk.type) {
                case 'message_start': {
                    break;
                }
                case 'content_block_start': {
                    if (chunk.content_block.type === 'tool_use') {
                        currentToolUseId = chunk.content_block.id;
                        currentToolName = chunk.content_block.name;
                        yield {
                            type: 'tool_call_start',
                            name: chunk.content_block.name,
                            tool_use_id: chunk.content_block.id
                        } as const;
                    }
                    break;
                }
                case 'content_block_delta': {
                    if (chunk.delta.type === 'text_delta') {
                        yield {
                            type: 'text_chunk',
                            content: chunk.delta.text
                        } as const;
                        assistantResponse += chunk.delta.text;
                    } else if (chunk.delta.type === 'input_json_delta') {
                        currentToolInputString += chunk.delta.partial_json;
                    }
                    break;
                }
                case 'content_block_stop': {
                    if (currentToolUseId === "") {
                        currentMessages.push({
                            role: 'assistant',
                            content: [
                                {
                                    type: 'text',
                                    text: assistantResponse
                                }
                            ]
                        });
                        yield {
                            type: 'new_context_message',
                            message: currentMessages.slice(-1)[0]
                        } as const;
                        assistantResponse = "";
                    }
                    break;
                }
                case 'message_stop': {
                    break;
                }
                case 'message_delta': {
                    if (chunk.delta.stop_reason == 'tool_use') {
                        currentMessages.push({
                            role: 'assistant',
                            content: [
                                {
                                    type: 'tool_use',
                                    id: currentToolUseId,
                                    name: currentToolName,
                                    // handle the case where the input is empty
                                    input: currentToolInputString === "" ? {} : JSON.parse(currentToolInputString),
                                }
                            ]
                        });
                        yield {
                            type: 'new_context_message',
                            message: currentMessages.slice(-1)[0]
                        } as const;
                        assistantResponse = "";
                        // execute tool call
                        try {
                            const result = await executeToolFn?.(currentToolName, currentToolInputString === "" ? {} : JSON.parse(currentToolInputString));
                            const result_stringified = JSON.stringify(result);
                            yield {
                                type: 'tool_result',
                                name: currentToolName,
                                tool_use_id: currentToolUseId,
                                args: currentToolInputString === "" ? {} : JSON.parse(currentToolInputString),
                                result: result_stringified
                            }
                            currentMessages.push({
                                role: 'user',
                                content: [
                                    {
                                        type: 'tool_result',
                                        tool_use_id: currentToolUseId,
                                        content: result_stringified
                                    } as const satisfies ToolResultBlockParam
                                ]
                            });
                            yield {
                                type: 'new_context_message',
                                message: currentMessages.slice(-1)[0]
                            } as const;
                        } catch (e: any) {
                            yield {
                                type: 'tool_error',
                                name: currentToolName,
                                tool_use_id: currentToolUseId,
                                args: currentToolInputString === "" ? {} : JSON.parse(currentToolInputString),
                                error: e.message
                            }
                            currentMessages.push({
                                role: 'user',
                                content: [
                                    {
                                        type: 'tool_result',
                                        tool_use_id: currentToolUseId,
                                        content: e.message
                                    } as const satisfies ToolResultBlockParam
                                ]
                            });
                            yield {
                                type: 'new_context_message',
                                // get the last message added to currentMessages
                                message: currentMessages.slice(-1)[0]
                            } as const;
                        }
                        currentToolInputString = "";
                        currentToolName = "";
                        currentToolUseId = "";

                        needsMoreInference = true;
                    }
                    break;
                }
            }
        }
    }
    yield {
        type: 'response_complete',
        new_context: currentMessages,
    } as const;
}

export async function getSummaryTitle(content: string): Promise<string> {
    const keys = await getApiKeys();
    if (!keys.anthropic) {
        throw new Error('Anthropic API key not found. Please add it in settings.');
    }

    const anthropic = new Anthropic({
        apiKey: keys.anthropic,
        dangerouslyAllowBrowser: true,
    });

    const response = await anthropic.messages.create({
        messages: [{
            role: 'user',
            content: `Please provide a very brief title (4-6 words) summarizing this request: "${content}". 
                     Respond with ONLY the title, no quotes or extra text.`
        }],
        model: 'claude-3-5-sonnet-latest',
        max_tokens: 30,
    });

    if (response.content[0].type === 'text') {
        return response.content[0].text.trim();
    }
    throw new Error('Unexpected response type from AI');
}