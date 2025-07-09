# 用户登录对话框组件 (AuthDialogComponent)

这是一个功能完整的用户登录/注册对话框组件，支持用户登录、注册和退出登录功能。

## 功能特性

- ✅ 用户登录表单验证
- ✅ 用户注册表单验证
- ✅ 密码显示/隐藏切换
- ✅ 登录状态管理
- ✅ 表单错误提示
- ✅ 加载状态显示
- ✅ 响应式表单验证
- ✅ 深色主题适配

## 组件接口

### 输入属性 (Inputs)

| 属性名 | 类型 | 默认值 | 描述 |
|--------|------|--------|------|
| `isLoggedIn` | boolean | false | 当前用户是否已登录 |
| `currentUser` | User \| null | null | 当前登录的用户信息 |

### 输出事件 (Outputs)

| 事件名 | 参数类型 | 描述 |
|--------|----------|------|
| `loginSuccess` | User | 登录成功时触发，返回用户信息 |
| `logoutSuccess` | void | 退出登录成功时触发 |
| `cancelled` | void | 取消操作时触发 |
| `confirmed` | void | 确认操作时触发（已登录状态） |

### User 接口

```typescript
export interface User {
  id?: string;
  username: string;
  email: string;
}
```

## 使用方法

### 1. 导入组件

```typescript
import { AuthDialogComponent, User } from './path/to/auth-dialog.component';

@Component({
  imports: [AuthDialogComponent, CommonModule, NzButtonModule],
  // ...
})
export class YourComponent {
  showAuthDialog = false;
  currentUser: User | null = null;
}
```

### 2. 在模板中使用

```html
<!-- 触发按钮 -->
<button nz-button nzType="primary" (click)="showAuthDialog = true">
  {{ currentUser ? '用户中心' : '登录' }}
</button>

<!-- 对话框遮罩 -->
<div *ngIf="showAuthDialog" class="dialog-overlay" (click)="closeDialog()">
  <div class="dialog-container" (click)="$event.stopPropagation()">
    <app-auth-dialog
      [isLoggedIn]="!!currentUser"
      [currentUser]="currentUser"
      (loginSuccess)="onLoginSuccess($event)"
      (logoutSuccess)="onLogoutSuccess()"
      (cancelled)="closeDialog()"
      (confirmed)="closeDialog()">
    </app-auth-dialog>
  </div>
</div>
```

### 3. 处理事件

```typescript
onLoginSuccess(user: User): void {
  this.currentUser = user;
  this.showAuthDialog = false;
  // 保存用户信息到本地存储或状态管理
  localStorage.setItem('currentUser', JSON.stringify(user));
}

onLogoutSuccess(): void {
  this.currentUser = null;
  this.showAuthDialog = false;
  // 清除本地存储的用户信息
  localStorage.removeItem('currentUser');
}

closeDialog(): void {
  this.showAuthDialog = false;
}
```

## 样式定制

组件使用了深色主题，如需自定义样式，可以覆盖以下 CSS 类：

- `.prompt-box` - 对话框容器
- `.auth-form` - 表单容器
- `.form-group` - 表单组
- `.user-info` - 用户信息显示区域
- `.footer` - 底部按钮区域

## 表单验证

组件内置了完整的表单验证：

- **用户名**: 必填，最少3个字符
- **邮箱**: 注册时必填，必须是有效邮箱格式
- **密码**: 必填，最少6个字符
- **确认密码**: 注册时必填，必须与密码一致

## API 集成

当前组件使用模拟数据进行演示。要集成真实的 API，需要修改以下方法：

```typescript
// 在 auth-dialog.component.ts 中修改
private performLogin(username: string, password: string): void {
  // 替换为真实的登录 API 调用
  this.authService.login(username, password).subscribe({
    next: (user) => {
      this.isLoading = false;
      this.message.success('登录成功！');
      this.loginSuccess.emit(user);
    },
    error: (error) => {
      this.isLoading = false;
      this.errorMessage = error.message || '登录失败';
    }
  });
}

private performRegister(username: string, email: string, password: string): void {
  // 替换为真实的注册 API 调用
  this.authService.register(username, email, password).subscribe({
    next: (user) => {
      this.isLoading = false;
      this.message.success('注册成功！');
      this.loginSuccess.emit(user);
    },
    error: (error) => {
      this.isLoading = false;
      this.errorMessage = error.message || '注册失败';
    }
  });
}
```

## 依赖项

确保项目中安装了以下依赖：

- `@angular/forms` (ReactiveFormsModule)
- `@angular/common` (CommonModule)
- `ng-zorro-antd` (Button, Input, Message components)

## 测试账号

用于演示的测试账号：
- 用户名: `demo`
- 密码: `123456`
