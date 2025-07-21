import { ToolUseResult } from "./tools";

// 路径处理函数
function normalizePath(inputPath: string): string {
    if (!inputPath) return '';
    
    let normalizedPath = inputPath;
    
    if (typeof inputPath === 'string') {
        const isWindowsPath = /^[A-Za-z]:\\/.test(inputPath);
        
        if (isWindowsPath) {
            normalizedPath = inputPath
                .replace(/\\\\/g, '\\')
                .replace(/\//g, '\\');
        } else {
            normalizedPath = inputPath
                .replace(/\\\\/g, '/')
                .replace(/\\/g, '/')
                .replace(/\/+/g, '/');
        }
        
        if (normalizedPath.length > 1 && (normalizedPath.endsWith('/') || normalizedPath.endsWith('\\'))) {
            normalizedPath = normalizedPath.slice(0, -1);
        }
    }
    
    return normalizedPath;
}

/**
 * 读取文件内容工具
 * @param params 参数
 * @returns 工具执行结果
 */
export async function readFileTool(
    params: {
        path: string;
        encoding?: string;
    }
): Promise<ToolUseResult> {
    try {
        let { path: filePath, encoding = 'utf-8' } = params;
        
        // 路径规范化
        filePath = normalizePath(filePath);
        
        console.log("读取文件: ", filePath);

        // 验证路径是否有效
        if (!filePath || filePath.trim() === '') {
            return { 
                is_error: true, 
                content: `无效的文件路径: "${filePath}"` 
            };
        }

        // 检查文件是否存在
        if (!window['fs'].existsSync(filePath)) {
            return {
                is_error: true,
                content: `文件不存在: ${filePath}`
            };
        }

        // 检查是否为文件（不是目录）
        const isDirectory = await window['fs'].isDirectory(filePath);
        if (isDirectory) {
            return {
                is_error: true,
                content: `路径是目录而不是文件: ${filePath}`
            };
        }

        const fileContent = await window['fs'].readFileSync(filePath, encoding);
        
        return { 
            is_error: false, 
            content: fileContent 
        };
    } catch (error: any) {
        console.error("读取文件失败:", error);
        
        let errorMessage = `读取文件失败: ${error.message}`;
        if (error.code) {
            errorMessage += `\n错误代码: ${error.code}`;
        }
        
        return { 
            is_error: true, 
            content: errorMessage + `\n目标文件: ${params.path}` 
        };
    }
}
