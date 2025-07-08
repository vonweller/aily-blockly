import { connectionStrategies } from "@joint/core";
import { ToolUseResult } from "./tools";


// 路径处理示例
function normalizePath(inputPath) {
    // 将反斜杠转换为正斜杠，处理各种转义情况
    return inputPath
        .replace(/\\\\/g, '/')  // 处理双反斜杠
        .replace(/\\/g, '/')   // 处理单反斜杠
        .replace(/\/+/g, '/')  // 合并多个斜杠
        .replace(/\/$/, '');   // 移除尾部斜杠
}


export async function fileOperationsTool(
    params: {
        operation: 'list' | 'read' | 'create' | 'edit' | 'delete' | 'exists' | 'rename';
        path: string;
        name?: string;
        content?: string;
        is_folder?: boolean;
    }
): Promise<ToolUseResult> {
    try {
        let { operation, path: basePath, name, content, is_folder = false } = params;

        // 处理路径转义和规范化
        basePath = normalizePath(basePath);

        // 构建完整文件路径
        let filePath = basePath;
        if (name) {
            filePath = window['path'].join(basePath, name);
        }
        console.log("Final filePath: ", filePath);

        let is_error = false;

        switch (operation) {
            case 'list':
                const files = await window['fs'].readDirSync(filePath);
                const fileDetails = await Promise.all(
                    files.map(async (file) => {
                        const fullPath = window['path'].join(filePath, file.name);
                        const stats = await window['fs'].statSync(fullPath);
                        return {
                            name: file,
                            isDirectory: await window['fs'].isDirectory(fullPath),
                            size: stats.size,
                            modifiedTime: stats.mtime,
                        };
                    })
                );
                return { is_error, content: JSON.stringify(fileDetails, null, 2) };

            case 'read':
                const fileContent = await window['fs'].readFileSync(filePath, 'utf-8');
                return { is_error, content: fileContent };

            case 'create':
                if (is_folder) {
                    await window['fs'].mkdirSync(filePath, { recursive: true });
                    return { is_error, content: `Folder created at: ${filePath}` };
                } else {
                    const dir = window['path'].dirname(filePath);
                    if (!window['fs'].existsSync(dir)) {
                        await window['fs'].mkdirSync(dir, { recursive: true });
                    }
                    await window['fs'].writeFileSync(filePath, content || '');
                    return { is_error, content: `File created at: ${filePath}` };
                }

            case 'edit':
                await window['fs'].writeFileSync(filePath, content || '');
                return { is_error, content: `File updated at: ${filePath}` };

            case 'rename':
                let backupPath;

                if (is_folder) {
                    // Create backup folder with timestamp
                    const dirName = window['path'].basename(filePath);
                    const parentDir = window['path'].dirname(filePath);
                    backupPath = window['path'].join(parentDir, `ZBAK_${dirName}`);

                    await window['fs'].mkdirSync(backupPath, { recursive: true });

                    // Copy directory contents recursively
                    async function copyDirRecursive(src, dest) {
                        const entries = await window['fs'].readDirSync(src);
                        for (const entry of entries) {
                            const srcPath = window['path'].join(src, entry.name);
                            const destPath = window['path'].join(dest, entry.name);

                            if (await window['fs'].isDirectory(srcPath)) {
                                await window['fs'].mkdirSync(destPath, { recursive: true });
                                await copyDirRecursive(srcPath, destPath);
                            } else {
                                const content = await window['fs'].readFileSync(srcPath, 'utf-8');
                                await window['fs'].writeFileSync(destPath, content);
                            }
                        }
                    }

                    await copyDirRecursive(filePath, backupPath);
                    await window['fs'].rmdirSync(filePath, { recursive: true });
                } else {
                    // Create backup file
                    const dir = window['path'].dirname(filePath);
                    const filename = window['path'].basename(filePath);
                    const ext = window['path'].extname(filePath);
                    const baseFilename = filename.replace(ext, '');
                    backupPath = window['path'].join(dir, `ZBAK_${baseFilename}${ext}`);

                    const fileContent = await window['fs'].readFileSync(filePath, 'utf-8');
                    await window['fs'].writeFileSync(backupPath, fileContent);
                    await window['fs'].unlinkSync(filePath);
                }

                return { is_error, content: `Deleted ${is_folder ? 'folder' : 'file'} at: ${filePath} (backup at: ${backupPath})` };

            case 'delete':
                console.log(`Deleting ${is_folder ? 'folder' : 'file'} at: ${filePath}`);
                if (is_folder) {
                    await window['fs'].rmdirSync(filePath, { recursive: true, force: true });
                    return { is_error, content: `Folder deleted at: ${filePath}` };
                }
                try {
                    await window['fs'].unlinkSync(filePath, null);
                    return { is_error, content: `File deleted at: ${filePath}` };
                } catch (err) {
                    is_error = true;
                    return { is_error, content: `File deletion failed: ${filePath}` };
                }

            case 'exists':
                const exists = window['fs'].existsSync(filePath);
                if (exists && is_folder !== undefined) {
                    const isDir = window['fs'].isDirectory(filePath);
                    if (is_folder !== isDir) {
                        return {
                            is_error,
                            content: `false (path exists but is ${isDir ? 'a directory' : 'a file'})`
                        };
                    }
                }
                return { is_error, content: exists.toString() };

            default:
                return { is_error: true, content: `Invalid operation: ${operation}` };
        }
    } catch (error: any) {
        console.log("File operation error:", error);
        return { is_error: true, content: `File operation failed: ${error.message}` };
    }
}
