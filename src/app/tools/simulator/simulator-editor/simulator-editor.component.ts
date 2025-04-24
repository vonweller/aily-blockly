import { Component, CUSTOM_ELEMENTS_SCHEMA, ElementRef, ViewChild } from '@angular/core';
import "@wokwi/elements";
import { dia, shapes, util } from '@joint/core';
import { ELEMENTS_CONFIG } from './elements.config';

import { v4 as uuidv4 } from 'uuid'; // 需要添加uuid依赖包

@Component({
  selector: 'app-simulator-editor',
  imports: [],
  templateUrl: './simulator-editor.component.html',
  styleUrl: './simulator-editor.component.scss',
  schemas: [CUSTOM_ELEMENTS_SCHEMA]
})
export class SimulatorEditorComponent {
  @ViewChild('paper', { static: true }) paperContainer!: ElementRef<HTMLDivElement>;
  private graph!: dia.Graph;
  private paper!: dia.Paper;
  
  // 元素ID到JointJS元素的映射
  private elementMap: Map<string, dia.Element> = new Map();

  constructor(
  ) {}

  ngOnInit() {
    this.loadJoint();
    this.setupPinStateListener();
  }

  // 监听引脚状态变化
  private setupPinStateListener() {
    this.simulatorService.pinStateChange.subscribe(pinState => {
      // 更新所有使用该引脚的元素
      this.elementMap.forEach((element, id) => {
        const elementType = element.get('type').split('.')[1].replace('Element', '').toLowerCase();
        
        // 获取组件ID属性
        const componentId = element.prop('componentId');
        if (!componentId) return;
        
        // 更新Wokwi元素属性
        // 这里需要根据不同元素类型进行自定义处理
        if (elementType === 'wokwi-led') {
          // 如果是LED元素，更新其状态
          this.updateWokwiElementState(element, pinState);
        } else if (elementType === 'wokwi-buzzer') {
          // 如果是蜂鸣器，更新其状态
          this.updateWokwiElementState(element, pinState);
        }
        // 添加其他元素类型的处理...
      });
    });
  }

  // 更新Wokwi元素的状态
  private updateWokwiElementState(element: dia.Element, pinState: any) {
    // 获取元素的DOM引用
    const elementId = element.id;
    const elementView = this.paper.findViewByModel(elementId);
    if (!elementView) return;
    
    // 获取foreignObject中的Wokwi元素
    const wokwiElement = elementView.el.querySelector('foreignObject > *') as any;
    if (!wokwiElement) return;
    
    // 根据元素类型来设置属性
    const elementType = element.get('type').split('.')[1].replace('Element', '').toLowerCase();
    
    if (elementType === 'wokwi-led') {
      // LED亮灭取决于引脚状态
      if (wokwiElement.getAttribute('pin') === pinState.pin) {
        wokwiElement.setAttribute('value', pinState.value ? 'true' : 'false');
      }
    } else if (elementType === 'wokwi-buzzer') {
      // 蜂鸣器状态设置
      if (wokwiElement.getAttribute('pin') === pinState.pin) {
        wokwiElement.setAttribute('value', pinState.value ? 'true' : 'false');
      }
    }
    // 添加其他元素类型的处理...
  }

  loadJoint() {
    const namespace = shapes;

    this.graph = new dia.Graph({}, { cellNamespace: namespace });

    this.paper = new dia.Paper({
      el: this.paperContainer.nativeElement,
      model: this.graph,
      width: '100%',
      height: '100%',
      background: { color: 'transparent' },
      cellViewNamespace: namespace,
      preventDefaultViewAction: false
    });

    // 设置模拟器使用的开发板
    this.simulatorService.setBoard('wokwi-arduino-uno');

    // 加载元素
    const arduino = this.loadWokwiElement('wokwi-arduino-uno', { x: 25, y: 225 });
    const led = this.loadWokwiElement('wokwi-led', { x: 25, y: 25 }, { color: 'red', pin: '13' });
    const buzzer = this.loadWokwiElement('wokwi-buzzer', { x: 125, y: 25 }, { pin: '8' });
    const button = this.loadWokwiElement('wokwi-pushbutton', { x: 225, y: 25 }, { pin: '2' });
    
    // 这里可以添加连线逻辑，连接元素
  }

  /**
   * 加载Wokwi元素并创建JointJS元素
   * @param elementType 元素类型，如'wokwi-led'、'wokwi-arduino-uno'等
   * @param position 位置{x, y}
   * @param props 元素属性，如LED的color、pin等
   * @param options 可选配置项
   * @returns 创建的JointJS元素
   */
  loadWokwiElement(
    elementType: string,
    position: { x: number, y: number },
    props: Record<string, any> = {},
    options: {
      size?: { width: number, height: number },
      autoResize?: boolean,
      padding?: number,
      backgroundColor?: string
    } = {}
  ): dia.Element {
    // 生成组件唯一ID
    const componentId = uuidv4();
    
    // 默认选项
    const defaultOptions = {
      autoResize: true,
      padding: 10,
      backgroundColor: 'transparent'
    };

    const mergedOptions = { ...defaultOptions, ...options };

    // 将componentId添加到属性中
    const allProps = { ...props, 'data-component-id': componentId };

    // 创建属性字符串
    const propsString = Object.entries(allProps)
      .map(([key, value]) => `${key}="${value}"`)
      .join(' ');

    // 创建元素定义
    const elementName = elementType.charAt(0).toUpperCase() + elementType.slice(1) + 'Element';
    const CustomElement = dia.Element.define(`example.${elementName}`, {
      attrs: {
        body: {
          width: 'calc(w)',
          height: 'calc(h)',
          fill: 'transparent',
        },
        foreignObject: {
          width: `calc(w)`,
          height: `calc(h)`,
        }
      },
      componentId: componentId // 保存组件ID到元素属性
    }, {
      markup: util.svg`
        <rect @selector="body"/>
        <foreignObject @selector="foreignObject">
            <${elementType} ${propsString}></${elementType}>
        </foreignObject>
      `
    });

    // 创建元素实例
    const element = new CustomElement();
    element.position(position.x, position.y);
    
    // 获取元素配置尺寸
    const p = ELEMENTS_CONFIG[elementType.toLowerCase()];
    if (p) {
      const size = { width: p.width, height: p.height };
      element.resize(size.width, size.height);
    } else {
      console.warn(`未找到元素配置: ${elementType}`);
    }
    
    // 添加到图表
    element.addTo(this.graph);
    
    // 保存元素到映射表
    this.elementMap.set(componentId, element);
    
    // 向模拟器服务注册组件
    if (elementType !== 'wokwi-arduino-uno') { // 开发板本身不需要注册
      // 提取引脚配置
      const pinConfig: Record<string, string> = {};
      if (props.pin) {
        pinConfig['pin'] = props.pin;
      }
      
      // 注册组件
      this.simulatorService.registerComponent(componentId, elementType, pinConfig);
    }
    
    // 添加事件监听
    this.setupElementEventListeners(element, elementType, componentId, props);

    return element;
  }

  // 设置元素事件监听器
  private setupElementEventListeners(element: dia.Element, elementType: string, componentId: string, props: any) {
    // 这里添加针对不同元素类型的事件监听
    // 例如按钮的点击、开关的切换等
    
    // 为按钮元素添加点击事件
    if (elementType === 'wokwi-pushbutton') {
      const pin = props.pin;
      if (pin) {
        const buttonView = this.paper.findViewByModel(element.id);
        if (buttonView) {
          buttonView.el.addEventListener('mousedown', () => {
            // 按钮按下，设置引脚为高电平
            this.simulatorService.setPinState(pin, true);
          });
          
          buttonView.el.addEventListener('mouseup', () => {
            // 按钮释放，设置引脚为低电平
            this.simulatorService.setPinState(pin, false);
          });
        }
      }
    }
    
    // 可添加其他元素类型的事件处理...
  }

  // 连接两个元素
  connectParts(source: dia.Element, sourcePin: string, target: dia.Element, targetPin: string) {
    // 连线逻辑实现
    // 例如创建连接两个元件的导线
    // 这需要根据实际UI设计来实现
  }
}
