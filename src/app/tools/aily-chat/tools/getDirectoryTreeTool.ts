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

// 构建目录树的递归函数
async function buildDirectoryTree(dirPath: string, currentDepth: number = 0, maxDepth: number = 3) {
    if (currentDepth > maxDepth) {
        return null;
    }

    try {
        const stats = await window['fs'].statSync(dirPath);
        const isDirectory = await window['fs'].isDirectory(dirPath);
        const name = window['path'].basename(dirPath);

        const node = {
            name,
            path: dirPath,
            isDirectory,
            size: stats.size,
            modifiedTime: stats.mtime,
            children: [] as any[]
        };

        if (isDirectory && currentDepth < maxDepth) {
            try {
                const files = await window['fs'].readDirSync(dirPath);
                for (const file of files) {
                    const childPath = window['path'].join(dirPath, file.name);
                    const childNode = await buildDirectoryTree(childPath, currentDepth + 1, maxDepth);
                    if (childNode) {
                        node.children.push(childNode);
                    }
                }
                // 按名称排序，目录在前
                node.children.sort((a, b) => {
                    if (a.isDirectory && !b.isDirectory) return -1;
                    if (!a.isDirectory && b.isDirectory) return 1;
                    return a.name.localeCompare(b.name);
                });
            } catch (error) {
                console.warn(`无法读取目录: ${dirPath}`, error);
            }
        }

        return node;
    } catch (error) {
        console.warn(`无法获取文件信息: ${dirPath}`, error);
        return null;
    }
}

/**
 * 获取目录树工具
 * @param params 参数
 * @returns 工具执行结果
 */
export async function getDirectoryTreeTool(
    params: {
        path: string;
        maxDepth?: number;
        includeFiles?: boolean;
    }
): Promise<ToolUseResult> {
    try {
        let { path: dirPath, maxDepth = 3, includeFiles = true } = params;
        
        // 路径规范化
        dirPath = normalizePath(dirPath);
        
        console.log("获取目录树: ", dirPath);

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

        // 限制最大深度以防止性能问题
        if (maxDepth > 10) {
            maxDepth = 10;
        }

        const directoryTree = await buildDirectoryTree(dirPath, 0, maxDepth);
        
        if (!directoryTree) {
            return { 
                is_error: true, 
                content: `无法构建目录树: ${dirPath}` 
            };
        }

        // 如果不包含文件，过滤掉文件节点
        if (!includeFiles) {
            function filterDirectoriesOnly(node: any): any {
                if (!node.isDirectory) {
                    return null;
                }
                
                return {
                    ...node,
                    children: node.children
                        .map(filterDirectoriesOnly)
                        .filter((child: any) => child !== null)
                };
            }
            
            const filteredTree = filterDirectoriesOnly(directoryTree);
            return { 
                is_error: false, 
                content: JSON.stringify(filteredTree, null, 2) 
            };
        }

        return { 
            is_error: false, 
            content: JSON.stringify(directoryTree, null, 2) 
        };
    } catch (error: any) {
        console.error("获取目录树失败:", error);
        
        let errorMessage = `获取目录树失败: ${error.message}`;
        if (error.code) {
            errorMessage += `\n错误代码: ${error.code}`;
        }
        
        return { 
            is_error: true, 
            content: errorMessage + `\n目标目录: ${params.path}` 
        };
    }
}
