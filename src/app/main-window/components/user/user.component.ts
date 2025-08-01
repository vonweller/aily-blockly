import { CommonModule } from '@angular/common';
import { Component, Input, Output, EventEmitter, inject, OnInit, OnDestroy, ViewChild, ElementRef, AfterViewInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzSpinModule } from 'ng-zorro-antd/spin';
import { AuthService, LoginRequest, RegisterRequest } from '../../../services/auth.service';
import { Subject, takeUntil } from 'rxjs';
import { SHA256 } from 'crypto-js';

@Component({
  selector: 'app-user',
  imports: [
    CommonModule,
    FormsModule,
    NzButtonModule,
    NzInputModule,
    NzSpinModule
  ],
  templateUrl: './user.component.html',
  styleUrl: './user.component.scss'
})
export class UserComponent implements OnInit, OnDestroy, AfterViewInit {

  @ViewChild('menuBox') menuBox: ElementRef;

  @Input() position = {
    x: 0,
    y: 40,
  };

  @Input() width = 300;

  @Output() closeEvent = new EventEmitter<void>();

  private destroy$ = new Subject<void>();
  private message = inject(NzMessageService);
  private authService = inject(AuthService);

  userInfo = {
    username: '',
    password: '',
    email: ''
  }

  isWaiting = false;
  isRegistering = false;
  isLoggedIn = false;
  currentUser: any = null;

  ngOnInit() {
    // 监听登录状态
    this.authService.isLoggedIn$
      .pipe(takeUntil(this.destroy$))
      .subscribe(isLoggedIn => {
        this.isLoggedIn = isLoggedIn;
      });

    // 监听用户信息
    this.authService.userInfo$
      .pipe(takeUntil(this.destroy$))
      .subscribe(userInfo => {
        this.currentUser = userInfo;
      });
  }

  ngAfterViewInit(): void {
    document.addEventListener('click', this.handleDocumentClick);
    document.addEventListener('contextmenu', this.handleDocumentClick);
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
    document.removeEventListener('click', this.handleDocumentClick);
    document.removeEventListener('contextmenu', this.handleDocumentClick);
  }

  handleDocumentClick = (event: MouseEvent) => {
    event.preventDefault();
    const target = event.target as Node;

    // 检查点击是否在用户组件内
    const isClickInUserBox = this.menuBox && this.menuBox.nativeElement.contains(target);

    if (!isClickInUserBox) {
      this.closeEvent.emit();
    }
  };

  async onLogin() {
    if (!this.userInfo.username || !this.userInfo.password) {
      this.message.warning('请输入用户名和密码');
      return;
    }

    this.isWaiting = true;

    try {
      const loginData: LoginRequest = {
        username: this.userInfo.username,
        password: SHA256(this.userInfo.password).toString()
      };

      this.authService.login(loginData).subscribe({
        next: (response) => {
          if (response.status === 200 && response.data) {
            this.message.success('登录成功');
            this.closeEvent.emit();
          } else {
            this.message.error(response.message || '登录失败');
          }
        },
        error: (error) => {
          console.error('登录错误:', error);
          this.message.error('登录失败，请检查网络连接');
        },
        complete: () => {
          this.isWaiting = false;
        }
      });
    } catch (error) {
      console.error('登录过程中出错:', error);
      this.message.error('登录失败');
      this.isWaiting = false;
    }
  }

  async onRegister() {
    if (!this.userInfo.username || !this.userInfo.password || !this.userInfo.email) {
      this.message.warning('请填写完整的注册信息');
      return;
    }

    this.isWaiting = true;

    try {
      const registerData: RegisterRequest = {
        username: this.userInfo.username,
        password: this.userInfo.password,
        email: this.userInfo.email
      };

      this.authService.register(registerData).subscribe({
        next: (response) => {
          this.message.success('注册成功，请登录');
          this.isRegistering = false;
          // 清空密码，保留用户名用于登录
          this.userInfo.password = '';
          this.userInfo.email = '';
        },
        error: (error) => {
          console.error('注册错误:', error);
          this.message.error('注册失败，请检查网络连接');
        },
        complete: () => {
          this.isWaiting = false;
        }
      });
    } catch (error) {
      console.error('注册过程中出错:', error);
      this.message.error('注册失败');
      this.isWaiting = false;
    }
  }

  async onLogout() {
    this.isWaiting = true;
    try {
      await this.authService.logout();
      this.message.success('已退出登录');
      this.closeEvent.emit();
    } catch (error) {
      console.error('退出登录失败:', error);
      this.message.error('退出登录失败');
    } finally {
      this.isWaiting = false;
    }
  }

  onSettings() {
    console.log('用户设置');
    // 这里可以添加设置逻辑
    this.closeEvent.emit();
  }

  toggleRegisterMode() {
    this.isRegistering = !this.isRegistering;
    // 清空表单
    this.userInfo = {
      username: '',
      password: '',
      email: ''
    };
  }

  more() {
    this.message.warning('服务暂不可用');
  }

}
