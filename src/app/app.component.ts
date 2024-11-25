import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import {
  TranslateService,
  TranslatePipe,
  TranslateDirective
} from "@ngx-translate/core";
import { HeaderComponent } from './components/header/header.component';
import { BlocklyComponent } from './blockly/blockly.component';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet,
    BlocklyComponent,
    TranslatePipe,
    TranslateDirective,
    HeaderComponent
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent {
  title = 'aily-blockly';

  constructor(private translate: TranslateService) {
    this.translate.addLangs(['zh', 'en']);
    this.translate.setDefaultLang('zh');
    this.translate.use('zh');
  }
}
