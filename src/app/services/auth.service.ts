import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { API } from '../configs/api.config';
import { ElectronService } from './electron.service';

// 声明 electronAPI 类型
declare const electronAPI: any;

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  success: boolean;
  token?: string;
  refreshToken?: string;
  user?: {
    id: string;
    username: string;
    email: string;
  };
  message?: string;
}

export interface RegisterRequest {
  username: string;
  password: string;
  email: string;
}

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private readonly TOKEN_KEY = 'aily_user_token';
  private readonly REFRESH_TOKEN_KEY = 'aily_refresh_token';
  private readonly USER_INFO_KEY = 'aily_user_info';

  private http = inject(HttpClient);
  private electronService = inject(ElectronService);
  
  // 用户登录状态
  private isLoggedInSubject = new BehaviorSubject<boolean>(false);
  public isLoggedIn$ = this.isLoggedInSubject.asObservable();

  // 用户信息
  private userInfoSubject = new BehaviorSubject<any>(null);
  public userInfo$ = this.userInfoSubject.asObservable();

  constructor() {
    this.initializeAuth();
  }

  /**
   * 初始化认证状态
   */
  private async initializeAuth(): Promise<void> {
    try {
      const token = await this.getToken();
      const userInfo = await this.getUserInfo();
      
      if (token && userInfo) {
        // 验证 token 是否有效
        const isValid = await this.verifyToken(token);
        if (isValid) {
          this.isLoggedInSubject.next(true);
          this.userInfoSubject.next(userInfo);
        } else {
          await this.clearAuthData();
        }
      }
    } catch (error) {
      console.error('初始化认证状态失败:', error);
      await this.clearAuthData();
    }
  }

  /**
   * 用户登录
   */
  login(loginData: LoginRequest): Observable<LoginResponse> {
    return this.http.post<LoginResponse>(API.login, loginData).pipe(
      map((response) => {
        if (response.success && response.token) {
          this.saveToken(response.token);
          if (response.refreshToken) {
            this.saveRefreshToken(response.refreshToken);
          }
          if (response.user) {
            this.saveUserInfo(response.user);
            this.userInfoSubject.next(response.user);
          }
          this.isLoggedInSubject.next(true);
        }
        return response;
      }),
      catchError(this.handleError)
    );
  }

  /**
   * 用户注册
   */
  register(registerData: RegisterRequest): Observable<any> {
    return this.http.post(API.register, registerData).pipe(
      catchError(this.handleError)
    );
  }

  /**
   * 用户登出
   */
  async logout(): Promise<void> {
    try {
      const token = await this.getToken();
      if (token) {
        // 调用服务器登出接口
        this.http.post(API.logout, {}, {
          headers: { Authorization: `Bearer ${token}` }
        }).subscribe({
          error: (error) => console.error('服务器登出失败:', error)
        });
      }
    } catch (error) {
      console.error('登出过程中出错:', error);
    } finally {
      await this.clearAuthData();
    }
  }

  /**
   * 验证 token 是否有效
   */
  private verifyToken(token: string): Promise<boolean> {
    return new Promise((resolve) => {
      this.http.post<{valid: boolean}>(API.verifyToken, {}, {
        headers: { Authorization: `Bearer ${token}` }
      }).subscribe({
        next: (response) => resolve(response.valid),
        error: () => resolve(false)
      });
    });
  }

  /**
   * 安全保存 token
   */
  private async saveToken(token: string): Promise<void> {
    try {
      if (this.electronService.isElectron && (window as any).electronAPI?.safeStorage) {
        const encrypted = (window as any).electronAPI.safeStorage.encryptString(token);
        localStorage.setItem(this.TOKEN_KEY, encrypted.toString('base64'));
      } else {
        // 降级到 localStorage（开发环境或不支持 safeStorage）
        localStorage.setItem(this.TOKEN_KEY, token);
      }
    } catch (error) {
      console.error('保存 token 失败:', error);
      throw error;
    }
  }

  /**
   * 获取 token
   */
  async getToken(): Promise<string | null> {
    try {
      const storedData = localStorage.getItem(this.TOKEN_KEY);
      if (!storedData) return null;

      if (this.electronService.isElectron && (window as any).electronAPI?.safeStorage) {
        try {
          const buffer = Buffer.from(storedData, 'base64');
          return (window as any).electronAPI.safeStorage.decryptString(buffer);
        } catch (error) {
          console.error('Token 解密失败:', error);
          localStorage.removeItem(this.TOKEN_KEY);
          return null;
        }
      } else {
        // 降级到直接返回（开发环境）
        return storedData;
      }
    } catch (error) {
      console.error('获取 token 失败:', error);
      return null;
    }
  }

  /**
   * 保存刷新 token
   */
  private async saveRefreshToken(refreshToken: string): Promise<void> {
    try {
      if (this.electronService.isElectron && (window as any).electronAPI?.safeStorage) {
        const encrypted = (window as any).electronAPI.safeStorage.encryptString(refreshToken);
        localStorage.setItem(this.REFRESH_TOKEN_KEY, encrypted.toString('base64'));
      } else {
        localStorage.setItem(this.REFRESH_TOKEN_KEY, refreshToken);
      }
    } catch (error) {
      console.error('保存刷新 token 失败:', error);
    }
  }

  /**
   * 获取刷新 token
   */
  private async getRefreshToken(): Promise<string | null> {
    try {
      const storedData = localStorage.getItem(this.REFRESH_TOKEN_KEY);
      if (!storedData) return null;

      if (this.electronService.isElectron && (window as any).electronAPI?.safeStorage) {
        try {
          const buffer = Buffer.from(storedData, 'base64');
          return (window as any).electronAPI.safeStorage.decryptString(buffer);
        } catch (error) {
          console.error('刷新 token 解密失败:', error);
          localStorage.removeItem(this.REFRESH_TOKEN_KEY);
          return null;
        }
      } else {
        return storedData;
      }
    } catch (error) {
      console.error('获取刷新 token 失败:', error);
      return null;
    }
  }

  /**
   * 保存用户信息
   */
  private async saveUserInfo(userInfo: any): Promise<void> {
    try {
      const userInfoStr = JSON.stringify(userInfo);
      if (this.electronService.isElectron && (window as any).electronAPI?.safeStorage) {
        const encrypted = (window as any).electronAPI.safeStorage.encryptString(userInfoStr);
        localStorage.setItem(this.USER_INFO_KEY, encrypted.toString('base64'));
      } else {
        localStorage.setItem(this.USER_INFO_KEY, userInfoStr);
      }
    } catch (error) {
      console.error('保存用户信息失败:', error);
    }
  }

  /**
   * 获取用户信息
   */
  private async getUserInfo(): Promise<any> {
    try {
      const storedData = localStorage.getItem(this.USER_INFO_KEY);
      if (!storedData) return null;

      let userInfoStr: string;
      if (this.electronService.isElectron && (window as any).electronAPI?.safeStorage) {
        try {
          const buffer = Buffer.from(storedData, 'base64');
          userInfoStr = (window as any).electronAPI.safeStorage.decryptString(buffer);
        } catch (error) {
          console.error('用户信息解密失败:', error);
          localStorage.removeItem(this.USER_INFO_KEY);
          return null;
        }
      } else {
        userInfoStr = storedData;
      }

      return JSON.parse(userInfoStr);
    } catch (error) {
      console.error('获取用户信息失败:', error);
      return null;
    }
  }

  /**
   * 刷新 token
   */
  async refreshAuthToken(): Promise<boolean> {
    try {
      const refreshToken = await this.getRefreshToken();
      if (!refreshToken) return false;

      const response = await this.http.post<{token: string, refreshToken?: string}>(
        API.refreshToken, 
        { refreshToken }
      ).toPromise();

      if (response?.token) {
        await this.saveToken(response.token);
        if (response.refreshToken) {
          await this.saveRefreshToken(response.refreshToken);
        }
        return true;
      }
      return false;
    } catch (error) {
      console.error('刷新 token 失败:', error);
      return false;
    }
  }

  /**
   * 清除所有认证数据
   */
  private async clearAuthData(): Promise<void> {
    localStorage.removeItem(this.TOKEN_KEY);
    localStorage.removeItem(this.REFRESH_TOKEN_KEY);
    localStorage.removeItem(this.USER_INFO_KEY);
    this.isLoggedInSubject.next(false);
    this.userInfoSubject.next(null);
  }

  /**
   * 获取当前登录状态
   */
  get isAuthenticated(): boolean {
    return this.isLoggedInSubject.value;
  }

  /**
   * 获取当前用户信息
   */
  get currentUser(): any {
    return this.userInfoSubject.value;
  }

  /**
   * 错误处理
   */
  private handleError(error: any): Observable<never> {
    console.error('认证服务错误:', error);
    return throwError(() => error);
  }
}
