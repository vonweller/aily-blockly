import { Injectable } from '@angular/core';
import {
  avrInstruction,
  AVRTimer,
  CPU,
  timer0Config,
  AVRUSART,
  usart0Config,
  AVRIOPort,
  portBConfig,
  portCConfig,
  portDConfig
} from "avr8js";
import { AVRRunner } from './avrruner';
import { BoardConfig, PinMapping, BOARD_MAPPINGS } from './/pin-mapping.config';
import { BehaviorSubject, Subject } from 'rxjs';

export interface PinState {
  pin: string;
  value: boolean;
  isInput: boolean;
  isOutput: boolean;
}

export interface ComponentState {
  id: string;
  elementType: string;
  pins: Record<string, boolean>;
}

@Injectable({
  providedIn: 'root'
})
export class SimulatorService {
  runner: AVRRunner;
  
  // 当前选择的开发板类型
  private currentBoard: string = 'wokwi-arduino-uno';
  private boardConfig: BoardConfig = BOARD_MAPPINGS[this.currentBoard];
  
  // 所有已加载的组件
  private components: Map<string, ComponentState> = new Map();
  
  // 引脚状态更新流
  public pinStateChange = new Subject<PinState>();
  
  // AVR端口映射
  private portMap: Record<string, AVRIOPort> = {};

  constructor() {}

  // 设置当前开发板
  setBoard(boardType: string) {
    if (BOARD_MAPPINGS[boardType]) {
      this.currentBoard = boardType;
      this.boardConfig = BOARD_MAPPINGS[boardType];
    } else {
      console.error(`不支持的开发板类型: ${boardType}`);
    }
  }

  // 加载二进制文件并初始化模拟器
  loadBinary(hex: string) {
    this.runner = new AVRRunner(hex);
    
    // 初始化端口映射
    this.portMap = {
      'B': this.runner.portB,
      'C': this.runner.portC,
      'D': this.runner.portD
      // MEGA有更多端口需要映射
    };
    
    // 监听AVR端口状态变化
    this.setupPortListeners();
  }

  // 开始运行模拟器
  run() {
    if (!this.runner) {
      console.error('请先加载程序');
      return;
    }
    
    this.runner.execute((cpu) => {
      // 模拟器运行回调
      // 这里可以更新UI或收集性能数据
    });
  }

  // 停止运行
  stop() {
    if (this.runner) {
      this.runner.stop();
    }
  }

  // 注册组件
  registerComponent(id: string, elementType: string, pinConfig: Record<string, string>) {
    const componentState: ComponentState = {
      id,
      elementType,
      pins: {}
    };
    
    // 初始化组件的引脚状态
    Object.keys(pinConfig).forEach(pinKey => {
      const arduinoPin = pinConfig[pinKey];
      componentState.pins[pinKey] = false;
      
      // 设置组件引脚的初始状态
      this.updateComponentPinState(id, pinKey, false);
    });
    
    this.components.set(id, componentState);
    return componentState;
  }

  // 获取Arduino引脚到AVR端口的映射
  getPinMapping(pin: string): PinMapping | null {
    return this.boardConfig.pinMappings[pin] || null;
  }

  // 设置Arduino引脚状态
  setPinState(pin: string, value: boolean) {
    const mapping = this.getPinMapping(pin);
    if (!mapping || !this.portMap[mapping.port]) {
      console.warn(`无法设置引脚 ${pin} 的状态，映射不存在`);
      return;
    }
    
    const port = this.portMap[mapping.port];
    // 设置引脚方向为输出
    port.setDDR(1 << mapping.bit);
    // 设置引脚值
    if (value) {
      port.setPort(port.port | (1 << mapping.bit));
    } else {
      port.setPort(port.port & ~(1 << mapping.bit));
    }
    
    // 通知引脚状态变化
    this.pinStateChange.next({
      pin,
      value,
      isInput: false,
      isOutput: true
    });
  }

  // 获取Arduino引脚状态
  getPinState(pin: string): boolean | null {
    const mapping = this.getPinMapping(pin);
    if (!mapping || !this.portMap[mapping.port]) {
      console.warn(`无法获取引脚 ${pin} 的状态，映射不存在`);
      return null;
    }
    
    const port = this.portMap[mapping.port];
    return !!(port.port & (1 << mapping.bit));
  }

  // 更新组件引脚状态
  updateComponentPinState(componentId: string, pinKey: string, value: boolean) {
    const component = this.components.get(componentId);
    if (component) {
      component.pins[pinKey] = value;
    }
  }

  // 设置组件监听
  private setupPortListeners() {
    // 这里需要监听AVR端口状态变化，并更新组件状态
    // 由于AVR8JS没有直接的端口状态变化事件，需要在execute循环中定期检查
    
    // 简单实现：在每个执行周期检查所有组件的引脚状态
    setInterval(() => {
      this.components.forEach((component, id) => {
        // 假设组件的第一个引脚配置是Arduino引脚号
        const pinKey = Object.keys(component.pins)[0]; 
        if (pinKey) {
          const arduinoPin = pinKey; // 简化，实际可能需要从组件中获取配置
          const currentState = this.getPinState(arduinoPin);
          
          if (currentState !== null && currentState !== component.pins[pinKey]) {
            this.updateComponentPinState(id, pinKey, currentState);
            // 触发组件状态更新
            this.pinStateChange.next({
              pin: arduinoPin,
              value: currentState,
              isInput: false,
              isOutput: true
            });
          }
        }
      });
    }, 50); // 每50ms检查一次
  }
}
