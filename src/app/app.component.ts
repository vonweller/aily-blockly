import { Component, OnInit, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { CommonModule } from '@angular/common';
import { ElectronService } from './services/electron.service';
import { ConfigService } from './services/config.service';
import { TranslationService } from './services/translation.service';
import { AuthService } from './services/auth.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, CommonModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent implements OnInit {
  title = 'aily-blockly';

  private electronService = inject(ElectronService);
  private configService = inject(ConfigService);
  private translationService = inject(TranslationService);
  private authService = inject(AuthService);

 async ngOnInit() {
    await this.electronService.init();
    await this.configService.init();
    await this.translationService.init();
    
    // 在ElectronService初始化完成后再初始化认证服务
    await this.authService.initializeAuth();
  }
}
