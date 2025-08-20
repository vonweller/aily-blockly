import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { API } from '../configs/api.config';
import { ElectronService } from './electron.service';

// 声明 electronAPI 类型
declare const electronAPI: any;

export interface CommonResponse {
  status: number;
  message: string;
  data?: any;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  status: number;
  message: string;
  data?: {
    access_token: string;
    refresh_token?: string;
    token_type: "bearer";
    user?: {
      id: string;
      email?: string;
      phone?: string;
      nickname?: string;
    };
  };
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

  // 登录弹窗显示状态
  showUser = new BehaviorSubject<any>(null);

  constructor() {
    // 不在构造函数中立即初始化，等待ElectronService初始化完成
  }

  /**
   * 初始化认证状态 - 需要在ElectronService初始化后调用
   */
  async initializeAuth(): Promise<void> {
    try {
      const token = await this.getToken2();
      // const userInfo = await this.getUserInfo();

      // console.log('初始化认证状态:', { token });

      if (token) {
        // 延迟执行避免循环依赖
        setTimeout(() => {
          this.getMe(token).then(userInfo => {
            // console.log('获取用户信息:', userInfo);
            if (userInfo) {
              this.userInfoSubject.next(userInfo);
              this.isLoggedInSubject.next(true);
            } else {
              this.isLoggedInSubject.next(false);
            }

            console.log('认证状态:', this.isLoggedInSubject.value);
          }).catch(error => {
            console.error('获取用户信息失败:', error);
            this.isLoggedInSubject.next(false);
          });
        }, 0);
        // 验证 token 是否有效
        // const isValid = await this.verifyToken(token);
        // if (isValid) {
        //   this.isLoggedInSubject.next(true);
        //   this.userInfoSubject.next(userInfo);
        // } else {
        //   await this.clearAuthData();
        // }
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
        // console.log("登录响应: ", response);
        if (response.status === 200 && response.data) {
          // console.log("登录成功，token: ", response.data.access_token);
          // 保存 token 和用户信息
          this.saveToken2(response.data.access_token);
          if (response.data.user) {
            this.saveUserInfo(response.data.user);
            this.userInfoSubject.next(response.data.user);
          }
          this.isLoggedInSubject.next(true);
        } else {
          this.isLoggedInSubject.next(false);
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
      const token = await this.getToken2();
      if (token) {
        // 调用服务器登出接口
        this.http.get<CommonResponse>(API.logout, {
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
      this.http.post<CommonResponse>(API.verifyToken, {}, {
        headers: { Authorization: `Bearer ${token}` }
      }).subscribe({
        next: (response) => resolve(response.data.valid || false),
        error: () => resolve(false)
      });
    });
  }

  /**
   * 获取当前登录用户信息
   */
  private getMe(token: string): Promise<any> {
    return new Promise((resolve, reject) => {
      this.http.get<CommonResponse>(API.me, {
        headers: { Authorization: `Bearer ${token}` }
      }).subscribe({
        next: (response) => {
          if (response.status === 200 && response.data) {
            resolve(response.data);
          } else {
            reject(new Error('获取用户信息失败'));
          }
        },
        error: (error) => reject(error)
      });
    });
  }

  /**
   * 检查是否支持安全存储
   */
  private isSafeStorageAvailable(): boolean {
    try {
      // 使用有错，当前直接返回false
      // return window['safeStorage'];
      return false;
    } catch (error) {
      console.warn('SafeStorage 检查失败:', error);
      return false;
    }
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

  async saveToken2(token: string): Promise<void> {
    try {
      if (this.electronService.isElectron && (window as any).electronAPI?.path && (window as any).electronAPI?.fs) {
        // 获取AppData路径
        const appDataPath = (window as any).electronAPI.path.getAppDataPath();
        const authFilePath = (window as any).electronAPI.path.join(appDataPath, '.aily');

        // 读取现有文件内容或创建新的
        let authData: any = {};
        if ((window as any).electronAPI.fs.existsSync(authFilePath)) {
          try {
            const content = (window as any).electronAPI.fs.readFileSync(authFilePath);
            authData = JSON.parse(content);
          } catch (error) {
            console.warn('读取现有认证文件失败，将创建新文件:', error);
            authData = {};
          }
        }

        // 加密token（如果支持safeStorage）
        let encryptedToken = token;
        if ((window as any).electronAPI?.safeStorage) {
          try {
            const encrypted = (window as any).electronAPI.safeStorage.encryptString(token);
            encryptedToken = encrypted.toString('base64');
          } catch (error) {
            console.warn('token加密失败，使用明文存储:', error);
          }
        }

        // 更新token
        authData.access_token = encryptedToken;
        authData.updated_at = new Date().toISOString();

        // 写入文件
        (window as any).electronAPI.fs.writeFileSync(authFilePath, JSON.stringify(authData, null, 2));
        // console.log('Token已保存到:', authFilePath);
      } else {
        // 降级到localStorage（开发环境或不支持electron）
        localStorage.setItem('aily_auth_token', token);
        // console.log('Token已保存到localStorage（降级方案）');
      }
    } catch (error) {
      console.error('保存token到.aily文件失败:', error);
      throw error;
    }
  }

  async getToken2(): Promise<string | null> {
    try {
      if (this.electronService.isElectron && (window as any).electronAPI?.path && (window as any).electronAPI?.fs) {
        // 获取AppData路径
        const appDataPath = (window as any).electronAPI.path.getAppDataPath();
        const authFilePath = (window as any).electronAPI.path.join(appDataPath, '.aily');

        // 检查文件是否存在
        if ((window as any).electronAPI.fs.existsSync(authFilePath)) {
          // console.log('认证文件存在，正在读取...');
          const content = (window as any).electronAPI.fs.readFileSync(authFilePath, 'utf8');
          const authData = JSON.parse(content);

          // console.log('authData: ', authData);

          return authData.access_token;

          //   // 解密token（如果支持safeStorage）
          //   if ((window as any).electronAPI?.safeStorage) {
          //     try {
          //       console.log('使用safeStorage解密token');
          //       const buffer = Buffer.from(authData.access_token, 'base64');
          //       return (window as any).electronAPI.safeStorage.decryptString(buffer);
          //     } catch (error) {
          //       console.error('Token解密失败:', error);
          //       return null;
          //     }
          //   } else {
          //     // 降级到直接返回（开发环境或不支持safeStorage）
          //     console.log('直接返回未加密的token');
          //     return authData.access_token;
          //   }
        } else {
          console.warn('认证文件不存在:', authFilePath);
          return null;
        }
      } else {
        // console.log('使用localStorage降级模式');
        // console.log('electronService.isElectron:', this.electronService.isElectron);
        // console.log('electronAPI.path:', (window as any).electronAPI?.path);
        // console.log('electronAPI.fs:', (window as any).electronAPI?.fs);
        // 降级到localStorage（开发环境或不支持electron）
        return localStorage.getItem('aily_auth_token');
      }
    } catch (error) {
      console.error('获取token失败:', error);
      return null;
    }
  }

  /**
   * 移除.aily文件和localStorage中的认证数据
   */

  async clearAuthDataFile(): Promise<void> {
    try {
      if (this.electronService.isElectron && (window as any).electronAPI?.path && (window as any).electronAPI?.fs) {
        const appDataPath = (window as any).electronAPI.path.getAppDataPath();
        const authFilePath = (window as any).electronAPI.path.join(appDataPath, '.aily');

        // 删除.aily文件
        if ((window as any).electronAPI.fs.existsSync(authFilePath)) {
          (window as any).electronAPI.fs.unlinkSync(authFilePath);
          console.log('已删除认证文件:', authFilePath);
        }
      } else {
        // 降级到localStorage（开发环境或不支持electron）
        localStorage.removeItem('aily_auth_token');
        console.log('已清除localStorage中的认证数据');
      }
    } catch (error) {
      console.error('清除认证数据失败:', error);
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
      console.log('保存用户信息失败:', error);
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

      const response = await this.http.post<CommonResponse>(
        API.refreshToken,
        { refreshToken }
      ).toPromise();

      if (response?.data?.token) {
        await this.saveToken2(response.data.token);
        if (response.data.refreshToken) {
          await this.saveRefreshToken(response.data.refreshToken);
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
    this.clearAuthDataFile();
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
