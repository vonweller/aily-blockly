import { Injectable } from '@angular/core';
import { ElectronService } from './electron.service';

export interface ArduinoSymbol {
    name: string;
    kind: string | 'function' | 'variable' | 'class'; // 'function', 'variable', 'class', etc.
    detail: string;
    documentation?: string;
    insertText: string;
    parameters?: string[];
    returnType?: string;
    filePath?: string;
}

@Injectable({
    providedIn: 'root'
})
export class ArduinoParserService {
    private symbols: ArduinoSymbol[] = [];

    constructor(private electronService: ElectronService) { }

    async parseSDKAndLibraries(sdkPath: string, librariesPath: string): Promise<ArduinoSymbol[]> {
        this.symbols = [];

        // 解析SDK路径
        if (this.electronService.exists(sdkPath)) {
            await this.parseDirectory(sdkPath);
        }

        // 解析库路径
        if (this.electronService.exists(librariesPath)) {
            await this.parseDirectory(librariesPath);
        }
        return this.symbols;
    }

    private async parseDirectory(directoryPath: string): Promise<void> {
        const files = this.electronService.readDir(directoryPath);
        for (const file of files) {
            const filePath = file.path + '/' + file.name;
            if (this.electronService.isDirectory(filePath)) {
                await this.parseDirectory(filePath);
            } else if (file.name.endsWith('.h') || file.name.endsWith('.cpp')) {
                await this.parseFile(filePath);
            }
        }
    }

    private async parseFile(filePath: string): Promise<void> {
        try {
            const content = this.electronService.readFile(filePath);

            // 解析函数
            this.parseFunctions(content, filePath);

            // 解析类
            this.parseClasses(content, filePath);

            // 解析变量
            this.parseVariables(content, filePath);

        } catch (error) {
            console.error(`解析文件 ${filePath} 时出错:`, error);
        }
    }

    private parseFunctions(content: string, filePath: string): void {
        // 使用正则表达式查找函数声明
        const functionRegex = /(\w+)\s+(\w+)\s*\(([\s\S]*?)\)\s*(\{|;)/g;
        let match;

        while ((match = functionRegex.exec(content)) !== null) {
            const returnType = match[1];
            const name = match[2];
            const params = match[3].trim();

            // 排除类内部方法和预处理器宏
            if (!name.startsWith('#') && name !== 'if' && name !== 'for' && name !== 'while') {
                const parameters = params.split(',').map(p => p.trim()).filter(p => p);

                this.symbols.push({
                    name,
                    kind: 'function',
                    detail: `${returnType} ${name}(${params})`,
                    // documentation: `来自文件: ${window['path'].basename(filePath)}`,
                    insertText: `${name}(${parameters.map((_, i) => `\${${i + 1}}`).join(', ')})`,
                    parameters,
                    returnType,
                    filePath
                });
            }
        }
    }

    private parseClasses(content: string, filePath: string): void {
        // 解析类定义
        const classRegex = /class\s+(\w+)(?:\s*:\s*(?:public|protected|private)\s+(\w+))?\s*\{/g;
        let match;

        while ((match = classRegex.exec(content)) !== null) {
            const name = match[1];
            const baseClass = match[2] || '';

            this.symbols.push({
                name,
                kind: 'class',
                detail: baseClass ? `class ${name} : ${baseClass}` : `class ${name}`,
                // documentation: `来自文件: ${window['path'].basename(filePath)}`,
                insertText: name,
                filePath
            });
        }
    }

    private parseVariables(content: string, filePath: string): void {
        // 解析全局变量
        const varRegex = /(const\s+)?(\w+)\s+(\w+)\s*=\s*([^;]*);/g;
        let match;

        while ((match = varRegex.exec(content)) !== null) {
            const isConst = !!match[1];
            const type = match[2];
            const name = match[3];
            const value = match[4];

            if (!name.startsWith('_') && !this.symbols.some(s => s.name === name)) {
                this.symbols.push({
                    name,
                    kind: 'variable',
                    detail: `${isConst ? 'const ' : ''}${type} ${name} = ${value}`,
                    // documentation: `来自文件: ${window['path'].basename(filePath)}`,
                    insertText: name,
                    filePath
                });
            }
        }
    }
}