export const toolParamNames = [
    "command"
] as const;

export type ToolParamName = (typeof toolParamNames)[number];

export interface ToolUse {
    type: "tool_use"
    name: ToolName
}