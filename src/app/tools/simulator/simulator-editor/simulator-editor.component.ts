import { Component, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { LEDElement, SSD1306Element } from "@wokwi/elements";

@Component({
  selector: 'app-simulator-editor',
  imports: [],
  templateUrl: './simulator-editor.component.html',
  styleUrl: './simulator-editor.component.scss',
  schemas: [CUSTOM_ELEMENTS_SCHEMA]
})
export class SimulatorEditorComponent {

  ngOnInit() {
    // 注册Wokwi元素
    this.registerWokwiElements();
  }

  private registerWokwiElements() {
    customElements.define('simulator-led', LEDElement);
    customElements.define('simulator-ssd1306', SSD1306Element);
  }
}
