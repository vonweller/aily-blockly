import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { CommonModule } from '@angular/common';
import { ElectronService } from './services/electron.service';
import { ConfigService } from './services/config.service';
import { TranslationService } from './services/translation.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, CommonModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent {
  title = 'aily-blockly';

  constructor(
    private electronService: ElectronService,
    private configService:ConfigService,
    private translationService: TranslationService
  ) {}

 async ngOnInit() {
    await this.electronService.init();
    await this.configService.init();
    await this.translationService.init();
  }
}
