import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule, AbstractControl } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzMessageService } from 'ng-zorro-antd/message';

export interface User {
  id?: string;
  username: string;
  email: string;
}

@Component({
  selector: 'app-auth-dialog',
  imports: [
    CommonModule,
    ReactiveFormsModule,
    NzButtonModule,
    NzInputModule
  ],
  templateUrl: './auth-dialog.component.html',
  styleUrl: './auth-dialog.component.scss'
})
export class AuthDialogComponent {
  @Input() isLoggedIn: boolean = false;
  @Input() currentUser: User | null = null;
  @Output() loginSuccess = new EventEmitter<User>();
  @Output() logoutSuccess = new EventEmitter<void>();
  @Output() cancelled = new EventEmitter<void>();
  @Output() confirmed = new EventEmitter<void>();

  isLogin = true; // true for login, false for register
  showPassword = false;
  isLoading = false;
  errorMessage = '';
  authForm: FormGroup;

  constructor(
    private fb: FormBuilder,
    private message: NzMessageService
  ) {
    this.authForm = this.createForm();
  }

  private createForm(): FormGroup {
    return this.fb.group({
      username: ['', [Validators.required, Validators.minLength(3)]],
      email: ['', [Validators.email]],
      password: ['', [Validators.required, Validators.minLength(6)]],
      confirmPassword: ['']
    }, { validators: this.passwordMatchValidator });
  }

  private passwordMatchValidator(control: AbstractControl): { [key: string]: any } | null {
    const password = control.get('password');
    const confirmPassword = control.get('confirmPassword');

    if (!password || !confirmPassword) {
      return null;
    }

    if (password.value !== confirmPassword.value) {
      confirmPassword.setErrors({ passwordMismatch: true });
      return { passwordMismatch: true };
    } else {
      confirmPassword.setErrors(null);
      return null;
    }
  }

  toggleMode(): void {
    this.isLogin = !this.isLogin;
    this.errorMessage = '';
    this.authForm.reset();
    
    // Update form validators based on mode
    if (this.isLogin) {
      this.authForm.get('email')?.clearValidators();
      this.authForm.get('confirmPassword')?.clearValidators();
    } else {
      this.authForm.get('email')?.setValidators([Validators.required, Validators.email]);
      this.authForm.get('confirmPassword')?.setValidators([Validators.required]);
    }
    
    this.authForm.get('email')?.updateValueAndValidity();
    this.authForm.get('confirmPassword')?.updateValueAndValidity();
  }

  togglePassword(): void {
    this.showPassword = !this.showPassword;
  }

  onSubmit(): void {
    if (this.authForm.invalid) {
      this.markFormGroupTouched();
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';

    const formValue = this.authForm.value;

    if (this.isLogin) {
      this.performLogin(formValue.username, formValue.password);
    } else {
      this.performRegister(formValue.username, formValue.email, formValue.password);
    }
  }

  private performLogin(username: string, password: string): void {
    // 模拟登录API调用
    setTimeout(() => {
      // 这里应该调用真实的登录API
      if (username === 'demo' && password === '123456') {
        const user: User = {
          id: '1',
          username: username,
          email: 'demo@example.com'
        };
        this.isLoading = false;
        this.message.success('登录成功！');
        this.loginSuccess.emit(user);
      } else {
        this.isLoading = false;
        this.errorMessage = '用户名或密码错误';
      }
    }, 1000);
  }

  private performRegister(username: string, email: string, password: string): void {
    // 模拟注册API调用
    setTimeout(() => {
      // 这里应该调用真实的注册API
      const user: User = {
        id: Date.now().toString(),
        username: username,
        email: email
      };
      this.isLoading = false;
      this.message.success('注册成功！');
      this.loginSuccess.emit(user);
    }, 1000);
  }

  logout(): void {
    this.logoutSuccess.emit();
    this.message.success('已退出登录');
  }

  cancel(): void {
    this.cancelled.emit();
  }

  confirm(): void {
    this.confirmed.emit();
  }

  private markFormGroupTouched(): void {
    Object.keys(this.authForm.controls).forEach(key => {
      const control = this.authForm.get(key);
      control?.markAsTouched();
    });
  }
}
