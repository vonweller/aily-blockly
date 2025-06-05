import { Injectable } from '@angular/core';
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

@Injectable({
  providedIn: 'root'
})
export class McpService {

  mcp: Client;
  transport: StdioClientTransport | null = null;
  tools: MCPTool[] = [];

  constructor() {}

  async init() {
    await this.connectToServer();
  }

  async connectToServer() {
    try {
      // TODO 调整成从json配置文件中读取相应参数并初始化
      const result = await window["mcp"].connect("C:\\Users\\stao\\.local\\bin\\uvx.exe", ["mcp-server-fetch"])
      if (result.success === true) {
        // result.tools为列表，添加到tools中
        this.tools.push(...result.tools);
      } else {
        console.error("Failed to connect to MCP server: ", result.error);
      }
      console.log("Connecting to MCP server result: ", result);
    } catch (e) {
      console.log("Failed to connect to MCP server: ", e);
      throw e;
    }
  }

  async use_tool(toolName: string, args: { [key: string]: unknown }) {
    try {
      const result = await window["mcp"].useTool(toolName, args);
      /*** 
        "success": true,
        "result": {
        "content": [
            {
              "type": "text",
              "text": "1 validation error for Fetch\nurl\n  Input should be a valid URL, relative URL without a base [type=url_parsing, input_value='www.baidu.com', input_type=str]\n    For further information visit https://errors.pydantic.dev/2.11/v/url_parsing"
            }
          ],
        "isError": true
      }
      */

      if (result.success && result.isError !== true) {
        return result.result.content.map((item: any) => item.text).join("\n");
      } else {
        console.error("Tool usage failed:", result.error);
        return "Tool usage failed: " + result.error;
      }
    } catch (e) {
      console.error("Error using tool:", e);
      return "Error using tool: " + e;
    }
  }
}

export interface MCPTool {
  name: string;
  description: string;
  input_schema: { [key: string]: any };
}