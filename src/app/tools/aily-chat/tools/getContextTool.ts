import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

interface GetContextInput {
    info_type?: 'all' | 'project' | 'platform' | 'system';
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

interface GetContextResult {
    project?: ProjectInfo;
    platform?: PlatformInfo;
    system?: SystemInfo;
}

/**
 * Get context tool implementation for retrieving environment context information
 */
export async function getContextTool(input: GetContextInput): Promise<GetContextResult> {
    const { info_type = 'all' } = input;
    const result: GetContextResult = {};

    try {
        // Only include requested information types
        if (info_type === 'all' || info_type === 'project') {
            result.project = await getProjectInfo();
        }

        if (info_type === 'all' || info_type === 'platform') {
            result.platform = getPlatformInfo();
        }

        if (info_type === 'all' || info_type === 'system') {
            result.system = getSystemInfo();
        }
    } catch (error) {
        console.error('Error getting context information:', error);
    }

    return result;
}

async function getProjectInfo(): Promise<ProjectInfo> {
    try {
        const currentDir = process.cwd();
        const packageJsonPath = path.join(currentDir, 'package.json');
        
        let name = undefined;
        let rootFolder = path.basename(currentDir);
        
        if (fs.existsSync(packageJsonPath)) {
            const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
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

function getPlatformInfo(): PlatformInfo {
    try {
        const isNode = typeof process !== 'undefined' && process.versions && process.versions.node;
        
        return {
            type: process.platform,
            version: os.release(),
            nodeVersion: isNode ? process.version : undefined,
        };
    } catch (error) {
        console.error('Error getting platform info:', error);
        return { 
            type: 'unknown',
            version: 'unknown'
        };
    }
}

function getSystemInfo(): SystemInfo {
    try {
        const totalMemGB = Math.round(os.totalmem() / (1024 * 1024 * 1024) * 10) / 10;
        
        return {
            hostname: os.hostname(),
            platform: os.platform(),
            arch: os.arch(),
            cpus: os.cpus().length,
            memory: `${totalMemGB} GB`,
            username: os.userInfo().username
        };
    } catch (error) {
        console.error('Error getting system info:', error);
        return { 
            hostname: 'unknown',
            platform: 'unknown',
            arch: 'unknown',
            cpus: 0,
            memory: 'unknown'
        };
    }
}