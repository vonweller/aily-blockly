import { Injectable } from '@angular/core';
import { BehaviorSubject, Subject } from 'rxjs';
import { Buffer } from 'buffer'; 

// 声明Electron API全局接口
declare global {
  interface Window {
    electronAPI: {
      SerialPort: {
        list: () => Promise<any[]>;
        create: (options: any) => any;
      }
    }
  }
}

@Injectable({
  providedIn: 'root'
})
export class SerialMonitorService {
  viewMode = {
    showHex: false, // hex显示
    showCtrlChar: true, // 控制字符显示
    autoWarp: true, // 换行显示
    autoScroll: true, // 自动滚动显示
    showTimestamp: true, // 时间显示
  }

  inputMode = {
    hex: false,
    enter: false,
  }

  dataList: dataItem[] = [];

  dataUpdated = new Subject<void>();
  
  // 串口相关属性
  private serialPort: any = null;
  private lastDataTime = 0;
  private isConnected = false;
  
  // 状态观察对象
  connectionStatus = new BehaviorSubject<boolean>(false);
  availablePorts = new BehaviorSubject<any[]>([]);

  constructor() { }
  
  /**
   * 获取可用串口列表
   */
  async getPortsList(): Promise<any[]> {
    try {
      const ports = await window.electronAPI.SerialPort.list();
      this.availablePorts.next(ports);
      return ports;
    } catch (error) {
      console.error('获取串口列表失败:', error);
      return [];
    }
  }

  /**
   * 连接到指定串口
   * @param options 串口配置选项 {path, baudRate, ...}
   */
  async connect(options: any): Promise<boolean> {
    if (this.isConnected) {
      await this.disconnect();
    }

    try {
      const serialOptions = {
        path: options.path,
        baudRate: options.baudRate || 9600,
        dataBits: options.dataBits || 8,
        stopBits: options.stopBits || 1,
        parity: options.parity || 'none',
        autoOpen: false
      };

      this.serialPort = window.electronAPI.SerialPort.create(serialOptions);
      console.log('连接到串口:', this.serialPort);
      
      return new Promise((resolve, reject) => {
        this.serialPort.on('open', () => {
          this.isConnected = true;
          this.connectionStatus.next(true);
          this.setupDataListeners();
          resolve(true);
        });

        this.serialPort.on('error', (err: any) => {
          console.error('串口错误:', err);
          this.isConnected = false;
          this.connectionStatus.next(false);
          reject(err);
        });

        this.serialPort.open((err: any) => {
          if (err) {
            console.error('打开串口失败:', err);
            this.isConnected = false;
            this.connectionStatus.next(false);
            reject(err);
          }
        });
      });
    } catch (error) {
      console.error('连接串口失败:', error);
      this.isConnected = false;
      this.connectionStatus.next(false);
      return false;
    }
  }

  /**
   * 设置数据监听器
   */
  private setupDataListeners() {
    if (!this.serialPort) return;

    this.serialPort.on('data', (data) => {
      this.processReceivedData(data);
    });

    this.serialPort.on('close', () => {
      this.isConnected = false;
      this.connectionStatus.next(false);
      console.log('串口已关闭');
    });
  }

  /**
   * 处理接收到的数据
   * 根据时间间隔规则存储数据：
   * 1. 如果距离上次数据超过1秒，创建新记录
   * 2. 如果不到1秒，追加到当前记录
   */
  private processReceivedData(data) {
    const currentTime = Date.now();
    const timeString = new Date().toLocaleTimeString();
    
    // 检查是否需要创建新的数据项
    if (this.dataList.length === 0 || 
        currentTime - this.lastDataTime > 1000 || 
        this.dataList[this.dataList.length - 1].dir !== 'r') {
      // 创建新的数据项
      this.dataList.push({
        time: timeString,
        data: data,
        dir: 'r'
      });
    } else {
      // 将数据添加到最后一个项目
      const lastItem = this.dataList[this.dataList.length - 1];
      // 合并Buffer数据
      const combinedData = Buffer.concat([lastItem.data, data]);
      lastItem.data = combinedData;
    }
    
    // 更新最后一次接收数据的时间
    this.lastDataTime = currentTime;

    this.dataUpdated.next();
  }

  /**
   * 发送数据到串口
   */
  sendData(data: string): Promise<boolean> {
    if (!this.isConnected || !this.serialPort) {
      return Promise.resolve(false);
    }

    return new Promise((resolve) => {
      let bufferToSend;
      
      if (typeof data === 'string') {
        // 如果输入模式是hex，则将字符串解析为hex
        if (this.inputMode.hex) {
          // 移除空格和非hex字符
          const hexString = data.replace(/[^0-9A-Fa-f]/g, '');
          // 确保有偶数个字符
          const paddedHex = hexString.length % 2 ? '0' + hexString : hexString;
          // 转换为Buffer
          bufferToSend = Buffer.from(paddedHex, 'hex');
        } else {
          // 普通字符串
          let textToSend = data;
          // 如果设置了enter选项，添加换行符
          if (this.inputMode.enter) {
            textToSend += '\r\n';
          }
          bufferToSend = Buffer.from(textToSend);
        }
      } else {
        // 已经是Buffer
        bufferToSend = data;
      }

      this.serialPort.write(bufferToSend, (err: any) => {
        if (err) {
          console.error('发送数据失败:', err);
          resolve(false);
        } else {
          // 记录发送的数据到dataList
          this.dataList.push({
            time: new Date().toLocaleTimeString(),
            data: bufferToSend,
            dir: 's'
          });
          
          this.dataUpdated.next();
          resolve(true);
        }
      });
    });
  }

  /**
   * 断开串口连接
   */
  disconnect(): Promise<boolean> {
    if (!this.isConnected || !this.serialPort) {
      return Promise.resolve(true);
    }

    return new Promise((resolve) => {
      this.serialPort.close((err: any) => {
        if (err) {
          console.error('关闭串口失败:', err);
          resolve(false);
        } else {
          this.isConnected = false;
          this.connectionStatus.next(false);
          this.serialPort = null;
          resolve(true);
        }
      });
    });
  }

  /**
   * 清除数据列表
   */
  clearData() {
    this.dataList = [];
  }

  /**
   * 检查是否已连接
   */
  isPortConnected(): boolean {
    return this.isConnected;
  }
}

interface dataItem {
  time: string,
  data: any,
  dir: 'r' | 's'
}
