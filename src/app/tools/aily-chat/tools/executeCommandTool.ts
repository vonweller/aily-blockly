import { ToolUseResult } from "./tools";
import { CmdService } from "../../../services/cmd.service";


export async function executeCommandTool(cmdService: CmdService, data: any): Promise<ToolUseResult> {
    let toolResult = null;
    let is_error = false;

    try {
        if (!data.tool_args || !data.tool_args.command) {
            toolResult = "执行command命令失败: 缺少必要的参数 'command'";
            console.error(toolResult);
            return;
        }

        await cmdService.runAsync(data.tool_args.command, data.tool_args.cwd)
        toolResult = `执行command命令 "${data.tool_args.command}" 成功！`
    } catch (e) {
        console.error('执行command命令失败:', e);
        toolResult = `执行command命令失败: ${e.message}`;
        is_error = true;
    } finally {
        return {
            is_error,
            content: toolResult
        };
    }
}