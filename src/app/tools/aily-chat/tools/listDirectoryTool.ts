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
 * 列出目录内容工具
 * @param params 参数
 * @returns 工具执行结果
 */
export async function listDirectoryTool(
    params: {
        path: string;
    }
): Promise<ToolUseResult> {
    try {
        let { path: dirPath } = params;
        
        // 路径规范化
        dirPath = normalizePath(dirPath);
        
        console.log("列出目录内容: ", dirPath);

        // 验证路径是否有效
        if (!dirPath || dirPath.trim() === '') {
            return { 
                is_error: true, 
                content: `无效的目录路径: "${dirPath}"` 
            };
        }

        // 检查路径是否存在
        if (!window['fs'].existsSync(dirPath)) {
            return {
                is_error: true,
                content: `目录不存在: ${dirPath}`
            };
        }

        // 检查是否为目录
        const isDirectory = await window['fs'].isDirectory(dirPath);
        if (!isDirectory) {
            return {
                is_error: true,
                content: `路径不是目录: ${dirPath}`
            };
        }

        const files = await window['fs'].readDirSync(dirPath);
        const fileDetails = await Promise.all(
            files.map(async (file) => {
                const fullPath = window['path'].join(dirPath, file.name);
                const stats = await window['fs'].statSync(fullPath);
                return {
                    name: file.name,
                    isDirectory: await window['fs'].isDirectory(fullPath),
                    size: stats.size,
                    modifiedTime: stats.mtime,
                };
            })
        );

        // 按名称排序，目录在前
        fileDetails.sort((a, b) => {
            if (a.isDirectory && !b.isDirectory) return -1;
            if (!a.isDirectory && b.isDirectory) return 1;
            return a.name.localeCompare(b.name);
        });

        return { 
            is_error: false, 
            content: JSON.stringify(fileDetails, null, 2) 
        };
    } catch (error: any) {
        console.error("列出目录内容失败:", error);
        
        let errorMessage = `列出目录内容失败: ${error.message}`;
        if (error.code) {
            errorMessage += `\n错误代码: ${error.code}`;
        }
        
        return { 
            is_error: true, 
            content: errorMessage + `\n目标路径: ${params.path}` 
        };
    }
}
