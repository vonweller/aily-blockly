// import { app, BrowserWindow, ipcMain } from 'electron';
// import { Client } from "@modelcontextprotocol/sdk/client/index.js";
// import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = require("@modelcontextprotocol/sdk/client/stdio.js");
const { ipcMain } = require("electron");

let mcpClient;
let mcpTransport = null;
let tools = [];

// 设置IPC处理器
function registerMCPHandlers() {
    ipcMain.handle('mcp:connect', async (event, command, args) => {
        try {
            mcpClient = new Client({
                name: "mcp-client",
                version: "1.0.0",
            });

            mcpTransport = new StdioClientTransport({
                command,
                args,
            });

            console.log("mcpTransport: ", mcpTransport);
            await mcpClient.connect(mcpTransport);

            const toolsResult = await mcpClient.listTools();
            tools = toolsResult.tools.map((tool) => {
                return {
                    name: tool.name,
                    description: tool.description,
                    input_schema: tool.inputSchema,
                };
            });

            console.log("Connected to MCP server with tools:", tools.map(({ name }) => name));
            return { success: true, tools };
        } catch (e) {
            console.error("Failed to connect to MCP server:", e);
            return { success: false, error: e.message };
        }
    });

    ipcMain.handle('mcp:use-tool', async (event, toolName, args) => {
        try {
            if (!mcpTransport) {
                throw new Error("MCP transport is not connected");
            }

            const tool = tools.find((t) => t.name === toolName);
            if (!tool) {
                throw new Error(`Tool ${toolName} not found`);
            }

            const result = await mcpClient.callTool({
                name: toolName,
                arguments: args,
            });

            return { success: true, result };
        } catch (e) {
            console.error("Failed to use MCP tool:", e);
            return { success: false, error: e.message };
        }
    });
}


module.exports = {
    registerMCPHandlers,
}