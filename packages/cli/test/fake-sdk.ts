import type { Options, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { Sdk } from "../src/run/runner.js";

type Call = { prompt: string; options: Options };
type FakeTool = {
  name: string;
  handler: (
    args: Record<string, unknown>,
  ) => Promise<{ content: { text: string }[]; isError?: boolean }>;
};
type Script = (
  call: Call,
  index: number,
  tools: Record<string, FakeTool>,
) => AsyncGenerator<unknown> | unknown[];

export const msg = {
  init: (session = "sess-1", model = "claude-opus-5-5") => ({
    type: "system",
    subtype: "init",
    session_id: session,
    model,
  }),
  text: (text: string, parent: string | null = null) => ({
    type: "assistant",
    parent_tool_use_id: parent,
    session_id: "sess-1",
    message: { content: [{ type: "text", text }] },
  }),
  tool: (
    id: string,
    name: string,
    input: Record<string, unknown>,
    parent: string | null = null,
  ) => ({
    type: "assistant",
    parent_tool_use_id: parent,
    session_id: "sess-1",
    message: { content: [{ type: "tool_use", id, name, input }] },
  }),
  result: (over: Record<string, unknown> = {}) => ({
    type: "result",
    subtype: "success",
    is_error: false,
    result: "All done.",
    total_cost_usd: 0.25,
    num_turns: 4,
    session_id: "sess-1",
    errors: [],
    ...over,
  }),
};

/** A stand-in for the Agent SDK: records every query() call and plays back a script. */
export function fakeSdk(script: Script) {
  const calls: Call[] = [];
  const sdk: Sdk = {
    query: ({ prompt, options }) => {
      const call = { prompt, options: options ?? {} };
      const index = calls.push(call) - 1;
      const servers = (call.options.mcpServers ?? {}) as Record<string, { tools?: FakeTool[] }>;
      const tools = Object.fromEntries(
        Object.values(servers).flatMap((s) => (s.tools ?? []).map((t) => [t.name, t] as const)),
      );
      const out = script(call, index, tools);
      return (async function* () {
        for await (const m of out as AsyncIterable<unknown>) yield m as SDKMessage;
      })();
    },
    createSdkMcpServer: ((opts: { name: string; tools: FakeTool[] }) => ({
      type: "sdk",
      name: opts.name,
      tools: opts.tools,
    })) as unknown as Sdk["createSdkMcpServer"],
    tool: ((
      name: string,
      _description: string,
      _schema: unknown,
      handler: FakeTool["handler"],
    ) => ({ name, handler })) as unknown as Sdk["tool"],
  };
  return { sdk, calls };
}
