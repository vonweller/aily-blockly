import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output, SimpleChanges, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NzCodeEditorModule, NzCodeEditorComponent } from 'ng-zorro-antd/code-editor';
import { ArduinoParserService, ArduinoSymbol } from '../../services/arduino-parser.service';

@Component({
  selector: 'app-monaco-editor',
  imports: [
    NzCodeEditorModule,
    CommonModule,
    FormsModule
  ],
  templateUrl: './monaco-editor.component.html',
  styleUrl: './monaco-editor.component.scss'
})
export class MonacoEditorComponent {

  @ViewChild(NzCodeEditorComponent) codeEditor: NzCodeEditorComponent;

  @Input() options: any = {
    language: 'cpp',
    theme: 'vs-dark',
    lineNumbers: 'on',
    automaticLayout: true
  }

  @Input() code = '';

  @Output() codeChange = new EventEmitter<string>();

  @Input() sdkPath: string;
  @Input() librariesPath: string;

  // private editor: any;
  private arduinoSymbols: ArduinoSymbol[] = [];
  private disposables: any[] = [];

  constructor(
    private arduinoParserService: ArduinoParserService
  ) { }

  ngOnInit() {
  }

  ngAfterViewInit() {

  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['sdkPath'] || changes['librariesPath']) {
      setTimeout(async () => {
        if (this.codeEditor) {
          // 解析Arduino SDK和库
          if (this.sdkPath && this.librariesPath) {
            await this.loadArduinoCompletions();
          }
        }
      }, 500);
    }
  }

  ngOnDestroy() {
    this.disposables.forEach(d => d.dispose());
  }

  onCodeChange(newCode: string): void {
    this.codeChange.emit(newCode);
  }

  editorInitialized(editor: any): void {
    // console.log(editor);
    // setTimeout(() => {
    //   editor.getAction('editor.action.formatDocument').run();
    // }, 3000);
  }

  /**
   * 加载Arduino代码补全
   */
  async loadArduinoCompletions(): Promise<void> {
    try {
      // 解析Arduino SDK和库文件
      this.arduinoSymbols = await this.arduinoParserService.parseSDKAndLibraries(
        this.sdkPath,
        this.librariesPath
      );

      // 获取Monaco实例
      const monaco = (window as any).monaco;

      if (!monaco) {
        console.error('Monaco实例未找到');
        return;
      }

      // 注册自定义代码补全提供器
      const disposable = monaco.languages.registerCompletionItemProvider('cpp', {
        provideCompletionItems: (model: any, position: any) => {
          const suggestions = this.arduinoSymbols.map(symbol => {
            const kind = this.getCompletionItemKind(symbol.kind, monaco);
            return {
              label: symbol.name,
              kind: kind,
              detail: symbol.detail,
              documentation: symbol.documentation,
              insertText: symbol.insertText,
              insertTextRules: symbol.kind === 'function'
                ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
                : monaco.languages.CompletionItemInsertTextRule.None
            };
          });

          return {
            suggestions
          };
        }
      });

      this.disposables.push(disposable);

      console.log(`已加载 ${this.arduinoSymbols.length} 个Arduino符号供代码补全使用`);

    } catch (error) {
      console.error('加载Arduino代码补全失败:', error);
    }
  }

  /**
   * 根据符号类型获取对应的Monaco补全项类型
   */
  private getCompletionItemKind(symbolKind: string, monaco: any): number {
    switch (symbolKind) {
      case 'function':
        return monaco.languages.CompletionItemKind.Function;
      case 'class':
        return monaco.languages.CompletionItemKind.Class;
      case 'variable':
        return monaco.languages.CompletionItemKind.Variable;
      default:
        return monaco.languages.CompletionItemKind.Text;
    }
  }

  /**
   * 更新SDK和库文件路径，重新加载补全
   */
  public async updatePaths(sdkPath: string, librariesPath: string): Promise<void> {
    this.sdkPath = sdkPath;
    this.librariesPath = librariesPath;

    // 清理旧的注册
    this.disposables.forEach(d => d.dispose());
    this.disposables = [];

    // 重新加载
    await this.loadArduinoCompletions();
  }

}
