import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RequirementsManagerComponent, RequirementStats, Requirement } from './components/requirements-manager/requirements-manager.component';
import { HardwareManagerComponent, HardwareCategory, Hardware, Pin } from './components/hardware-manager/hardware-manager.component';
import { KnowledgeManagerComponent, KnowledgeCategory, KnowledgeItem } from './components/knowledge-manager/knowledge-manager.component';
import { KeyManagerCategory, KeyManagerComponent, KeyManagerItem } from './components/key-manager/key-manager.component';

@Component({
  selector: 'app-ai-manager',
  imports: [CommonModule, RequirementsManagerComponent, HardwareManagerComponent, KnowledgeManagerComponent, KeyManagerComponent],
  templateUrl: './ai-manager.component.html',
  styleUrl: './ai-manager.component.scss'
})
export class AiManagerComponent {
  // Tab管理
  activeTab: string = 'requirements';
  
  tabs = [
    { id: 'requirements', name: '需求管理', icon: 'icon-list' },
    { id: 'hardware', name: '硬件管理', icon: 'icon-chip' },
    { id: 'knowledge', name: '知识管理', icon: 'icon-book' },
    { id: 'keymemory', name: '关键记忆', icon: 'icon-key' }
  ];

  // 需求管理相关数据
  requirementStats: RequirementStats = {
    total: 12,
    pending: 3,
    inProgress: 5,
    completed: 4
  };

  recentRequirements: Requirement[] = [
    {
      id: '1',
      title: 'LED矩阵显示功能',
      description: '实现8x8 LED矩阵的文字滚动显示',
      status: 'inProgress',
      priority: 'high',
      updateTime: new Date('2025-08-06')
    },
    {
      id: '2',
      title: '温度传感器集成',
      description: '添加DHT22温湿度传感器支持',
      status: 'pending',
      priority: 'medium',
      updateTime: new Date('2025-08-05')
    }
  ];

  // 硬件管理相关数据
  hardwareCategories: HardwareCategory[] = [
    { id: 'mcu', name: '微控制器', icon: 'icon-cpu', count: 5 },
    { id: 'sensor', name: '传感器', icon: 'icon-sensor', count: 8 },
    { id: 'actuator', name: '执行器', icon: 'icon-motor', count: 3 },
    { id: 'communication', name: '通信模块', icon: 'icon-wifi', count: 4 }
  ];

  selectedHardwareCategory = 'mcu';

  filteredHardware: Hardware[] = [
    {
      id: '1',
      name: 'Arduino Uno R3',
      model: 'ATmega328P',
      image: '/assets/hardware/arduino-uno.jpg',
      status: 'connected',
      keySpecs: ['16MHz', '32KB Flash', '2KB SRAM'],
      pins: [
        { number: 'D2', function: 'LED控制', type: 'Digital', configured: true },
        { number: 'D3', function: undefined, type: 'Digital', configured: false }
      ]
    },
    {
      id: '2',
      name: 'ESP32 DevKit',
      model: 'ESP32-WROOM-32',
      image: '/assets/hardware/esp32.jpg',
      status: 'disconnected',
      keySpecs: ['240MHz', 'WiFi', 'Bluetooth']
    }
  ];

  selectedHardware: Hardware | null = null;

  // 知识管理相关数据
  knowledgeCategories: KnowledgeCategory[] = [
    {
      id: '1',
      name: '硬件文档',
      expanded: true,
      itemCount: 15,
      items: [
        {
          id: '1',
          title: 'Arduino编程基础',
          summary: 'Arduino开发板的基本编程方法和常用函数',
          type: 'document',
          tags: ['Arduino', '基础', '编程'],
          author: 'System',
          createTime: new Date('2025-08-01'),
          usageCount: 25
        }
      ]
    },
    {
      id: '2',
      name: '代码示例',
      expanded: false,
      itemCount: 8,
      items: []
    }
  ];

  topKnowledge = { title: 'Arduino编程基础' };
  recentKnowledge = { title: 'ESP32 WiFi配置' };
  recommendedKnowledge = { title: 'STM32入门教程' };

  // 关键记忆相关数据
  keyMemoryStats = {
    total: 18,
    categories: 4,
    recentlyUsed: 6,
    secrets: 3
  };

  keyMemoryCategories: KeyManagerCategory[] = [
    {
      id: '1',
      name: '系统配置',
      icon: 'icon-settings',
      color: '#4299e1',
      expanded: true,
      items: [
        {
          id: '1',
          key: 'API_KEY',
          value: 'sk-xxxxxxxxxxxxxxxxxxxxxxxx',
          type: 'string',
          description: 'OpenAI API密钥',
          tags: ['api', 'openai', 'secret'],
          category: '系统配置',
          isSecret: true,
          lastModified: new Date('2025-08-06'),
          accessCount: 15
        },
        {
          id: '2',
          key: 'DEBUG_MODE',
          value: 'true',
          type: 'boolean',
          description: '调试模式开关',
          tags: ['debug', 'development'],
          category: '系统配置',
          isSecret: false,
          lastModified: new Date('2025-08-07'),
          accessCount: 8
        }
      ]
    },
    {
      id: '2',
      name: '硬件参数',
      icon: 'icon-chip',
      color: '#48bb78',
      expanded: false,
      items: [
        {
          id: '3',
          key: 'ARDUINO_BAUD_RATE',
          value: '115200',
          type: 'number',
          description: 'Arduino串口波特率',
          tags: ['arduino', 'serial', 'baud'],
          category: '硬件参数',
          isSecret: false,
          lastModified: new Date('2025-08-05'),
          accessCount: 25
        },
        {
          id: '4',
          key: 'SENSOR_CONFIG',
          value: '{"temperature": {"pin": 2, "type": "DHT22"}, "humidity": {"pin": 3, "type": "DHT22"}}',
          type: 'json',
          description: '传感器配置参数',
          tags: ['sensor', 'config', 'json'],
          category: '硬件参数',
          isSecret: false,
          lastModified: new Date('2025-08-04'),
          accessCount: 12
        }
      ]
    },
    {
      id: '3',
      name: '网络设置',
      icon: 'icon-wifi',
      color: '#ed8936',
      expanded: false,
      items: [
        {
          id: '5',
          key: 'WIFI_SSID',
          value: 'MyNetwork',
          type: 'string',
          description: 'WiFi网络名称',
          tags: ['wifi', 'network'],
          category: '网络设置',
          isSecret: false,
          lastModified: new Date('2025-08-03'),
          accessCount: 20
        },
        {
          id: '6',
          key: 'MQTT_BROKER',
          value: 'mqtt://192.168.1.100:1883',
          type: 'url',
          description: 'MQTT代理服务器地址',
          tags: ['mqtt', 'broker', 'iot'],
          category: '网络设置',
          isSecret: false,
          lastModified: new Date('2025-08-02'),
          accessCount: 18
        }
      ]
    },
    {
      id: '4',
      name: '项目路径',
      icon: 'icon-folder',
      color: '#9f7aea',
      expanded: false,
      items: [
        {
          id: '7',
          key: 'PROJECT_ROOT',
          value: 'D:\\Projects\\Arduino\\MyProject',
          type: 'file',
          description: '项目根目录路径',
          tags: ['path', 'project'],
          category: '项目路径',
          isSecret: false,
          lastModified: new Date('2025-08-01'),
          accessCount: 30
        }
      ]
    }
  ];

  recentKeyManagerItems: KeyManagerItem[] = [
    this.keyMemoryCategories[0].items[1], // DEBUG_MODE
    this.keyMemoryCategories[1].items[0], // ARDUINO_BAUD_RATE
    this.keyMemoryCategories[2].items[1]  // MQTT_BROKER
  ];

  quickAccessKeyManagerItems: KeyManagerItem[] = [
    this.keyMemoryCategories[1].items[0], // ARDUINO_BAUD_RATE
    this.keyMemoryCategories[0].items[1], // DEBUG_MODE
    this.keyMemoryCategories[3].items[0]  // PROJECT_ROOT
  ];

  // Tab切换方法
  selectTab(tabId: string) {
    this.activeTab = tabId;
  }

  // 需求管理方法
  addRequirement() {
    console.log('添加新需求');
    // 实现添加需求逻辑
  }

  exportRequirements() {
    console.log('导出需求列表');
    // 实现导出逻辑
  }

  viewAllRequirements() {
    console.log('查看所有需求');
    // 实现查看所有需求逻辑
  }

  editRequirement(requirement: Requirement) {
    console.log('编辑需求:', requirement);
    // 实现编辑需求逻辑
  }

  deleteRequirement(requirement: Requirement) {
    console.log('删除需求:', requirement);
    // 实现删除需求逻辑
  }

  // 硬件管理方法
  addHardware() {
    console.log('添加硬件');
    // 实现添加硬件逻辑
  }

  scanHardware() {
    console.log('扫描硬件设备');
    // 实现扫描硬件逻辑
  }

  selectHardwareCategory(categoryId: string) {
    this.selectedHardwareCategory = categoryId;
    // 根据分类筛选硬件
  }

  configureHardware(hardware: Hardware) {
    this.selectedHardware = hardware;
    console.log('配置硬件:', hardware);
  }

  viewHardwareDetails(hardware: Hardware) {
    console.log('查看硬件详情:', hardware);
    // 实现查看硬件详情逻辑
  }

  configurePin(pin: Pin) {
    console.log('配置引脚:', pin);
    // 实现引脚配置逻辑
  }

  // 知识管理方法
  addKnowledge() {
    console.log('添加知识');
    // 实现添加知识逻辑
  }

  importKnowledge() {
    console.log('导入知识');
    // 实现导入知识逻辑
  }

  searchKnowledge(query: string) {
    console.log('搜索知识:', query);
    // 实现知识搜索逻辑
  }

  toggleKnowledgeFilter() {
    console.log('切换知识筛选');
    // 实现筛选切换逻辑
  }

  viewKnowledge(item: KnowledgeItem) {
    console.log('查看知识:', item);
    // 实现查看知识逻辑
  }

  editKnowledge(item: KnowledgeItem) {
    console.log('编辑知识:', item);
    // 实现编辑知识逻辑
  }

  shareKnowledge(item: KnowledgeItem) {
    console.log('分享知识:', item);
    // 实现分享知识逻辑
  }

  // 关键记忆管理方法
  addKeyMemory() {
    console.log('添加关键记忆');
    // 实现添加关键记忆逻辑
  }

  importKeyMemory() {
    console.log('导入关键记忆');
    // 实现导入关键记忆逻辑
  }

  exportKeyMemory() {
    console.log('导出关键记忆');
    // 实现导出关键记忆逻辑
  }

  editKeyMemory(item: KeyManagerItem) {
    console.log('编辑关键记忆:', item);
    // 实现编辑关键记忆逻辑
  }

  deleteKeyMemory(item: KeyManagerItem) {
    console.log('删除关键记忆:', item);
    // 实现删除关键记忆逻辑
  }

  copyKeyMemory(item: KeyManagerItem) {
    console.log('复制关键记忆值:', item.value);
    // 实现复制到剪贴板逻辑
    if (navigator.clipboard) {
      navigator.clipboard.writeText(item.value).then(() => {
        console.log('已复制到剪贴板');
      });
    }
  }

  searchKeyMemory(query: string) {
    console.log('搜索关键记忆:', query);
    // 实现搜索关键记忆逻辑
  }

  toggleSecret(item) {
    console.log('切换机密显示:', item.key);
    // 实现切换机密显示逻辑
  }

  // 全局操作方法
  syncData() {
    console.log('同步数据');
    // 实现数据同步逻辑
  }

  backupData() {
    console.log('备份数据');
    // 实现数据备份逻辑
  }

  generateReport() {
    console.log('生成报告');
    // 实现报告生成逻辑
  }

}
