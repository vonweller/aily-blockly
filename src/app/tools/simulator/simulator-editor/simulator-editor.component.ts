import { Component, CUSTOM_ELEMENTS_SCHEMA, ElementRef, ViewChild, viewChild } from '@angular/core';
import "@wokwi/elements";
import { dia, shapes, util } from '@joint/core';
import { ELEMENTS_CONFIG } from './elements.config';

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

  ngOnInit() {
    // 注册Wokwi元素
    // this.registerWokwiElements();
    this.loadJoint();
  }

  // private registerWokwiElements() {
  //   customElements.define('wokwi-led', LEDElement);
  //   customElements.define('wokwi-arduino-uno', ArduinoUnoElement);
  //   customElements.define('wokwi-ssd1306', SSD1306Element);
  // }

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

    // 使用新函数加载元素
    const led = this.loadWokwiElement('wokwi-led', { x: 25, y: 25 }, { color: 'red', pin: '13' });
    const arduino = this.loadWokwiElement('wokwi-arduino-uno', { x: 25, y: 225 });
    const ssd1306 = this.loadWokwiElement('wokwi-ssd1306', { x: 25, y: 25 });
    const lcd1602 = this.loadWokwiElement('wokwi-lcd1602', { x: 25, y: 25 }, { pins: 'i2c' });
    const buzzer = this.loadWokwiElement('wokwi-buzzer', { x: 25, y: 25 }, { pin: '8' });
    const dht22 = this.loadWokwiElement('wokwi-dht22', { x: 25, y: 25 }, { pin: '2' });
  }

  /**
   * 加载Wokwi元素并创建JointJS元素
   * @param elementType 元素类型，如'led'、'arduino-uno'等
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
    // 默认选项
    const defaultOptions = {
      autoResize: true,
      padding: 10,
      backgroundColor: 'transparent'
    };

    const mergedOptions = { ...defaultOptions, ...options };

    // 创建属性字符串
    const propsString = Object.entries(props)
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
      }
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
    console.log(elementType);

    let p = ELEMENTS_CONFIG[elementType.toLowerCase()]
    console.log(p);

    let size = { width: p.width, height: p.height }
    element.resize(size.width, size.height);
    element.addTo(this.graph);

    return element;
  }

  contectParts() {
    // ...existing code...
  }
}
