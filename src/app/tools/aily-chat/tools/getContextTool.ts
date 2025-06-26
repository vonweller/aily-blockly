import { ToolUseResult } from "./tools";
import { ProjectService } from "../../../services/project.service";


interface GetContextInput {
    info_type?: 'all' | 'project' | 'platform' | 'system' | 'editingMode';
}

interface ProjectInfo {
    path: string;
    name?: string;
    rootFolder?: string;
}

interface PlatformInfo {
    type: string;
    version: string;
    nodeVersion?: string;
    browser?: string;
}

interface SystemInfo {
    hostname: string;
    platform: string;
    arch: string;
    cpus: number;
    memory: string;
    username?: string;
}

interface EditingMode {
    mode: 'blockly' | 'code' | 'unknown';
}

interface GetContextResult {
    project?: ProjectInfo;
    platform?: PlatformInfo;
    system?: SystemInfo;
    editingMode?: EditingMode;
}

/**
 * Get context tool implementation for retrieving environment context information
 */
export async function getContextTool(prjService: ProjectService, input: GetContextInput): Promise<ToolUseResult> {
    const { info_type = 'all' } = input;
    const result: GetContextResult = {};

    let is_error = false;

    try {
        // Only include requested information types
        if (info_type === 'all' || info_type === 'project') {
            result.project = await getProjectInfo(prjService);
        }

        if (info_type === 'all' || info_type === 'editingMode') {
            result.editingMode = getEditingMode();
        }
    } catch (error) {
        console.error('Error getting context information:', error);
    }

    return {
        is_error,
        content: JSON.stringify(result, null, 2)
    }
}

async function getProjectInfo(projectService): Promise<ProjectInfo> {
    try {
        const currentDir = projectService.currentProjectPath;
        const packageJsonPath = window["path"].join(currentDir, 'package.json');
        
        let name = undefined;
        let rootFolder = window["path"].basename(currentDir);
        
        if (window['fs'].existsSync(packageJsonPath)) {
            const packageJson = JSON.parse(window['fs'].readFileSync(packageJsonPath, 'utf8'));
            name = packageJson.name;
        }
        
        return {
            path: currentDir,
            name,
            rootFolder
        };
    } catch (error) {
        console.error('Error getting project info:', error);
        return { path: process.cwd() };
    }
}

function getEditingMode(): { mode: 'blockly' | 'code' | 'unknown' } {
    try {
        // Make sure we're in a browser environment
        if (typeof window !== 'undefined' && window.location) {
            const path = window.location.pathname;
            
            if (path.includes('/main/blockly-editor')) {
                return { mode: 'blockly' };
            } else if (path.includes('/main/code-editor')) {
                return { mode: 'code' };
            }
        }
        
        return { mode: 'unknown' };
    } catch (error) {
        console.error('Error determining editing mode:', error);
        return { mode: 'unknown' };
    }
}