import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';
import * as AVR8js from 'avr8js';
import { BoardConfig, BOARD_MAPPINGS, PinMapping } from './pinmap.config';

export interface PinState {
  pin: string;
  value: boolean;
}

export interface ComponentConfig {
  id: string;
  type: string;
  pins: Record<string, string>;
}

@Injectable({
  providedIn: 'root'
})
export class SimulatorService {
  // 引脚状态变化的可观察对象
  pinStateChange = new Subject<PinState>();

  // 模拟器状态
  private isRunning = false;
  private boardType = '';
  private boardConfig: BoardConfig | null = null;
  private components: Map<string, ComponentConfig> = new Map();
  
  // AVR8js 相关
  private cpu: AVR8js.CPU | null = null;
  private ports: Map<string, AVR8js.AVRIOPort> = new Map();
  
  constructor() { }

  /**
   * 设置模拟器使用的开发板类型
   * @param boardType 开发板类型，如'wokwi-arduino-uno'
   */
  setBoard(boardType: string): void {
    this.boardType = boardType;
    // 从配置中加载对应开发板的映射
    this.boardConfig = BOARD_MAPPINGS[boardType] || null;
    if (!this.boardConfig) {
      console.error(`未找到开发板 ${boardType} 的配置`);
    } else {
      console.log(`已加载 ${this.boardConfig.name} 引脚映射配置`);
    }
    
    // 初始化AVR8js的CPU和端口
    this.initializeAVR();
  }

  /**
   * 向模拟器注册组件
   * @param id 组件唯一ID
   * @param type 组件类型，如'wokwi-led'
   * @param pins 引脚配置，如 { pin: '13' }
   */
  registerComponent(id: string, type: string, pins: Record<string, string>): void {
    this.components.set(id, { id, type, pins });
    
    // 可以在这里做一些初始化工作
    console.log(`组件已注册: ${type}, ID: ${id}, 引脚:`, pins);
  }

  /**
   * 设置引脚状态
   * @param pin 引脚编号或名称
   * @param value 引脚状态 (true=高电平, false=低电平)
   */
  setPinState(pin: string, value: boolean): void {
    // 将Arduino引脚编号转换为AVR端口和引脚
    const portPin = this.mapArduinoToAVRPin(pin);
    if (portPin) {
      const { port, pinIndex } = portPin;
      
      // 如果能找到对应端口，设置引脚状态
      const avrPort = this.ports.get(port);
      if (avrPort) {
        avrPort.setPin(pinIndex, value);
      }
    }
    
    // 发出引脚状态变化通知
    this.pinStateChange.next({ pin, value });
  }

  /**
   * 启动模拟器
   */
  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    
    // 这里添加启动模拟器的代码
    console.log('模拟器已启动');
  }

  /**
   * 停止模拟器
   */
  stop(): void {
    if (!this.isRunning) return;
    this.isRunning = false;
    
    // 这里添加停止模拟器的代码
    console.log('模拟器已停止');
  }

  /**
   * 初始化AVR8js仿真环境
   * 这是一个简化版实现，实际使用时需要根据AVR8js API进行完整实现
   */
  private initializeAVR(): void {
    try {
      // 创建一个AVR CPU实例
      // 这里根据实际情况配置CPU型号、时钟频率等
      const program = new Uint16Array(0x4000); // 16KB程序空间
      const cpu = new AVR8js.CPU(program);
      this.cpu = cpu;
      
      // 初始化IO端口
      const portB = new AVR8js.AVRIOPort(cpu, AVR8js.portBConfig);
      const portC = new AVR8js.AVRIOPort(cpu, AVR8js.portCConfig);
      const portD = new AVR8js.AVRIOPort(cpu, AVR8js.portDConfig);
      
      // 保存端口引用
      this.ports.set('B', portB);
      this.ports.set('C', portC);
      this.ports.set('D', portD);
      
      console.log('AVR8js环境初始化完成');
    } catch (e) {
      console.error('初始化AVR8js失败:', e);
    }
  }

  /**
   * 将Arduino引脚编号映射到AVR端口和引脚
   * @param pin Arduino引脚编号
   * @returns 对应的AVR端口和引脚索引
   */
  private mapArduinoToAVRPin(pin: string): { port: string, pinIndex: number } | null {
    if (!this.boardConfig) {
      console.error('未设置开发板配置，无法映射引脚');
      return null;
    }
    
    const pinMapping = this.boardConfig.pinMappings[pin];
    if (!pinMapping) {
      console.error(`未找到引脚 ${pin} 的映射配置`);
      return null;
    }
    
    return {
      port: pinMapping.port,
      pinIndex: pinMapping.bit
    };
  }
}
