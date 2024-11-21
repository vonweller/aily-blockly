import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { BlocklyArduinoComponent } from './blockly-arduino/blockly-arduino.component';
import {
  TranslateService,
  TranslatePipe,
  TranslateDirective
} from "@ngx-translate/core";
import { HeaderComponent } from './components/header/header.component';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet,
    BlocklyArduinoComponent,
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
