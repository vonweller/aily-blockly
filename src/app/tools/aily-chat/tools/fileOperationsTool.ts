import { ToolUseResult } from "./tools";

export async function fileOperationsTool(
    params: {
        operation: 'list' | 'read' | 'create' | 'edit' | 'delete' | 'exists';
        path: string;
        content?: string;
        is_folder?: boolean;
    }
): Promise<ToolUseResult> {
    try {
        const { operation, path: filePath, content, is_folder = false } = params;

        let is_error = false;
        
        switch (operation) {
            case 'list':
                const files = await window['fs'].readdir(filePath);
                const fileDetails = await Promise.all(
                    files.map(async (file) => {
                        const fullPath = window['path'].join(filePath, file);
                        const stats = await window['fs'].stat(fullPath);
                        return {
                            name: file,
                            isDirectory: stats.isDirectory(),
                            size: stats.size,
                            modifiedTime: stats.mtime,
                        };
                    })
                );
                return { is_error, content: JSON.stringify(fileDetails, null, 2) };
                
            case 'read':
                const fileContent = await window['fs'].readFile(filePath, 'utf-8');
                return { is_error, content: fileContent };
                
            case 'create':
                if (is_folder) {
                    await window['fs'].mkdir(filePath, { recursive: true });
                    return { is_error, content: `Folder created at: ${filePath}` };
                } else {
                    const dir = window['path'].dirname(filePath);
                    if (!window['fs'].existsSync(dir)) {
                        await window['fs'].mkdir(dir, { recursive: true });
                    }
                    await window['fs'].writeFile(filePath, content || '');
                    return { is_error, content: `File created at: ${filePath}` };
                }
                
            case 'edit':
                await window['fs'].writeFile(filePath, content || '');
                return { is_error, content: `File updated at: ${filePath}` };
                
            case 'delete':
                if (is_folder) {
                    await window['fs'].rm(filePath, { recursive: true, force: true });
                    return { is_error, content: `Folder deleted: ${filePath}` };
                } else {
                    await window['fs'].unlink(filePath);
                    return { is_error, content: `File deleted: ${filePath}` };
                }
                
            case 'exists':
                const exists = window['fs'].existsSync(filePath);
                if (exists && is_folder !== undefined) {
                    const stats = window['fs'].statSync(filePath);
                    const isDir = stats.isDirectory();
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
        return { is_error: true, content: `File operation failed: ${error.message}` };
    }
}