import path from "path";
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
 * 递归查找指定路径下的所有.abi文件
 * @param searchPath 搜索路径
 * @param maxDepth 最大搜索深度，默认为3
 * @param currentDepth 当前深度，内部使用
 * @returns .abi文件路径数组
 */
function findAbiFiles(searchPath: string, maxDepth: number = 3, currentDepth: number = 0): string[] {
    const abiFiles: string[] = [];
    
    try {
        if (currentDepth > maxDepth) {
            return abiFiles;
        }

        const normalizedSearchPath = normalizePath(searchPath);
        
        if (!window['fs'].existsSync(normalizedSearchPath)) {
            return abiFiles;
        }

        const items = window['fs'].readDirSync(normalizedSearchPath);
        
        for (const item of items) {
            const fullPath = window['path'].join(normalizedSearchPath, item);
            const stat = window['fs'].statSync(fullPath);
            
            if (stat.isFile()) {
                // 检查是否为.abi文件
                if (window['path'].extname(item).toLowerCase() === '.abi') {
                    abiFiles.push(normalizePath(fullPath));
                }
            } else if (stat.isDirectory()) {
                // 递归搜索子目录
                const subFiles = findAbiFiles(fullPath, maxDepth, currentDepth + 1);
                abiFiles.push(...subFiles);
            }
        }
    } catch (error) {
        console.warn(`搜索ABI文件时出错: ${searchPath}`, error);
    }
    
    return abiFiles;
}

/**
 * 查找ABI文件工具
 * @param params 参数
 * @returns 工具执行结果
 */
export async function findAbiFilesTool(
    params: {
        searchPath?: string;
        maxDepth?: number;
    } = {}
): Promise<ToolUseResult> {
    try {
        const { searchPath = process.cwd(), maxDepth = 3 } = params;
        
        console.log("在路径下查找ABI文件: ", searchPath);
        
        const abiFiles = findAbiFiles(searchPath, maxDepth);
        
        if (abiFiles.length === 0) {
            return {
                is_error: false,
                content: `在路径 "${searchPath}" 下未找到任何.abi文件（搜索深度: ${maxDepth}）`
            };
        }
        
        const result = {
            searchPath: normalizePath(searchPath),
            maxDepth: maxDepth,
            foundFiles: abiFiles,
            count: abiFiles.length
        };
        
        return {
            is_error: false,
            content: `找到 ${abiFiles.length} 个ABI文件:\n${JSON.stringify(result, null, 2)}`
        };
    } catch (error: any) {
        console.error("查找ABI文件失败:", error);
        
        return {
            is_error: true,
            content: `查找ABI文件失败: ${error.message}`
        };
    }
}

/**
 * 编辑ABI文件工具
 * @param params 参数
 * @returns 工具执行结果
 */
export async function editAbiFileTool(
    params: {
        path?: string;
        content: string;
        encoding?: string;
        createIfNotExists?: boolean;
        autoFind?: boolean;
        searchPath?: string;
    }
): Promise<ToolUseResult> {
    try {
        const {path, content, encoding = 'utf-8', createIfNotExists = true, autoFind = false, searchPath} = params;
        const filePath = path + "/project.abi";

        console.log("编辑ABI文件: ", filePath);

        // 验证路径是否有效
        if (!filePath || filePath.trim() === '') {
            return { 
                is_error: true, 
                content: `无效的ABI文件路径: "${filePath}"` 
            };
        }

        // 验证文件扩展名是否为.abi
        const fileExtension = window['path'].extname(filePath).toLowerCase();
        if (fileExtension !== '.abi') {
            return {
                is_error: true,
                content: `文件扩展名必须为 .abi，当前为: ${fileExtension}`
            };
        }

        // 验证ABI内容格式（基本JSON格式验证）
        try {
            JSON.parse(content);
        } catch (jsonError) {
            return {
                is_error: true,
                content: `ABI内容不是有效的JSON格式: ${jsonError.message}`
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
                    content: `ABI文件不存在: ${filePath}。如需创建新文件，请设置 createIfNotExists 参数为 true。`
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

        console.log(`写入ABI内容长度: ${content.length}`);
        await window['fs'].writeFileSync(filePath, content, encoding);
        
        return { 
            is_error: false, 
            content: `ABI文件编辑成功: ${filePath}` 
        };
    } catch (error: any) {
        console.error("编辑ABI文件失败:", error);
        
        let errorMessage = `编辑ABI文件失败: ${error.message}`;
        if (error.code) {
            errorMessage += `\n错误代码: ${error.code}`;
        }
        
        return { 
            is_error: true, 
            content: errorMessage + `\n目标ABI文件: ${params.path}` 
        };
    }
}
