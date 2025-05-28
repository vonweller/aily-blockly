import { Component, EventEmitter, Output } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { NzToolTipModule } from 'ng-zorro-antd/tooltip';
import { BlockItemComponent } from './block-item/block-item.component';
import { CommonModule } from '@angular/common';
import { ElectronService } from '../../services/electron.service';
import { ProjectService } from '../../services/project.service';
import { MenuComponent } from '../../components/menu/menu.component';
import { LibContentComponent } from './lib-content/lib-content.component';

@Component({
  selector: 'app-lib-editor',
  imports: [
    CommonModule,
    TranslateModule,
    NzToolTipModule,
    BlockItemComponent,
    MenuComponent,
    LibContentComponent
  ],
  templateUrl: './lib-editor.component.html',
  styleUrl: './lib-editor.component.scss'
})
export class LibEditorComponent {
  @Output() close = new EventEmitter();

  libList: any[] = [];
  blocks = [];

  currentLib: any;

  constructor(
    private electronService: ElectronService,
    private projectService: ProjectService
  ) { }

  back() {
    this.close.emit();
  }

  showLibList = false;
  openLibList() {
    this.showLibList = !this.showLibList;
    const nodeModulesPath = this.projectService.currentProjectPath + '\\node_modules\\@aily-project';
    let libList0 = this.electronService.readDir(nodeModulesPath);
    this.libList = libList0.filter((item: any) => {
      if (item.name.includes('lib-')) {
        const toolboxPath = `${nodeModulesPath}\\${item.name}\\toolbox.json`;
        try {
          const toolboxContent = this.electronService.readFile(toolboxPath);
          if (toolboxContent) {
            const toolboxData = JSON.parse(toolboxContent);
            // 将icon内容添加到item中
            item.icon = toolboxData.icon || '';
            item.text = item.name;
            item.name = toolboxData.name || item.name.replace('lib-', '');

          }
        } catch (error) {
          console.warn(`Failed to read toolbox.json for ${item.name}:`, error);
          item.icon = '';
        }
        return item;
      }
    });
    console.log('libList', this.libList);
    this.showLibList = true;
  }

  closeLibList() {
    this.showLibList = false;
  }

  selectLib(item) {
    console.log('selectLib', item);
    this.currentLib = item;
  }

  onBlockClicked(block: any) {

  }
}
