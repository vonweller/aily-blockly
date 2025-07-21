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
 * 编辑文件工具
 * @param params 参数
 * @returns 工具执行结果
 */
export async function editFileTool(
    params: {
        path: string;
        content: string;
        encoding?: string;
        createIfNotExists?: boolean;
    }
): Promise<ToolUseResult> {
    try {
        let { path: filePath, content, encoding = 'utf-8', createIfNotExists = false } = params;
        
        // 路径规范化
        filePath = normalizePath(filePath);
        
        console.log("编辑文件: ", filePath);

        // 验证路径是否有效
        if (!filePath || filePath.trim() === '') {
            return { 
                is_error: true, 
                content: `无效的文件路径: "${filePath}"` 
            };
        }

        // 检查文件是否存在
        if (!window['fs'].existsSync(filePath)) {
            if (createIfNotExists) {
                // 如果文件不存在且允许创建，先创建文件
                const dir = window['path'].dirname(filePath);
                if (!window['fs'].existsSync(dir)) {
                    await window['fs'].mkdirSync(dir, { recursive: true });
                }
            } else {
                return {
                    is_error: true,
                    content: `文件不存在: ${filePath}。如需创建新文件，请设置 createIfNotExists 参数为 true。`
                };
            }
        } else {
            // 检查是否为文件（不是目录）
            const isDirectory = await window['fs'].isDirectory(filePath);
            if (isDirectory) {
                return {
                    is_error: true,
                    content: `路径是目录而不是文件: ${filePath}`
                };
            }
        }

        console.log(`写入内容长度: ${content.length}`);
        await window['fs'].writeFileSync(filePath, content, encoding);
        
        return { 
            is_error: false, 
            content: `文件编辑成功: ${filePath}` 
        };
    } catch (error: any) {
        console.error("编辑文件失败:", error);
        
        let errorMessage = `编辑文件失败: ${error.message}`;
        if (error.code) {
            errorMessage += `\n错误代码: ${error.code}`;
        }
        
        return { 
            is_error: true, 
            content: errorMessage + `\n目标文件: ${params.path}` 
        };
    }
}
