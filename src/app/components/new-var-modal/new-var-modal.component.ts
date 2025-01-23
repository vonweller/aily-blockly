import { Component, OnInit } from '@angular/core';
import { NzModalFooterDirective, NzModalRef } from 'ng-zorro-antd/modal';
import * as Blockly from 'blockly';
import { NzMessageService } from 'ng-zorro-antd/message';
import { BlocklyService } from '../../blockly/blockly.service';
import { FormsModule } from '@angular/forms';
import { NzButtonComponent } from 'ng-zorro-antd/button';
import { NzInputDirective } from 'ng-zorro-antd/input';
import { NgIf } from '@angular/common';

const VAR_TYPE = [
  { name: 'int', value: 'int' },
  { name: 'long', value: 'long' },
  { name: 'float', value: 'float' },
  { name: 'double', value: 'double' },
  { name: 'char', value: 'char' },
  { name: 'String', value: 'String' },
  { name: 'boolean', value: 'boolean' },
];

@Component({
  selector: 'app-new-var-modal',
  templateUrl: './new-var-modal.component.html',
  styleUrls: ['./new-var-modal.component.scss'],
  imports: [
    FormsModule,
    NzButtonComponent,
    NzModalFooterDirective,
    NzInputDirective,
    NgIf,
  ],
})
export class NewVarModalComponent implements OnInit {
  varType = 'b4aVariable';
  varName = '';

  isObject = false;

  VAR_TYPE = VAR_TYPE;

  constructor(
    private modal: NzModalRef,
    private message: NzMessageService,
    private blocklyService: BlocklyService,
  ) {}

  ngOnInit(): void {
    this.isObject = !this.VAR_TYPE.map((el) => el.value).includes(this.varType);
  }

  addVar() {
    if (this.varName == '') {
      this.message.warning('变量名不能为空');
      return;
    }
    let existing = Blockly.Variables.nameUsedWithAnyType(
      this.varName,
      this.blocklyService.workspace,
    );
    if (existing) {
      this.message.warning('变量名已存在');
    } else {
      this.blocklyService.workspace.createVariable(this.varName, this.varType);
      this.modal.triggerOk();
      // this.modal.close({ varType: this.varType, varName: this.varName })
    }
  }
}
