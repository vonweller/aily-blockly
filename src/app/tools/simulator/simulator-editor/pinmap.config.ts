export interface PinMapping {
    port: string;  // 'B', 'C', 'D' 等
    bit: number;   // 0-7
  }
  
  export interface BoardConfig {
    name: string;
    pinMappings: Record<string, PinMapping>;
  }
  
  // Arduino UNO (ATmega328P) 引脚映射
  export const ARDUINO_UNO_MAPPING: BoardConfig = {
    name: 'Arduino UNO',
    pinMappings: {
      '0': { port: 'D', bit: 0 },  // RX
      '1': { port: 'D', bit: 1 },  // TX
      '2': { port: 'D', bit: 2 },
      '3': { port: 'D', bit: 3 },  // PWM
      '4': { port: 'D', bit: 4 },
      '5': { port: 'D', bit: 5 },  // PWM
      '6': { port: 'D', bit: 6 },  // PWM
      '7': { port: 'D', bit: 7 },
      '8': { port: 'B', bit: 0 },
      '9': { port: 'B', bit: 1 },  // PWM
      '10': { port: 'B', bit: 2 }, // PWM
      '11': { port: 'B', bit: 3 }, // PWM
      '12': { port: 'B', bit: 4 },
      '13': { port: 'B', bit: 5 },
      'A0': { port: 'C', bit: 0 },
      'A1': { port: 'C', bit: 1 },
      'A2': { port: 'C', bit: 2 },
      'A3': { port: 'C', bit: 3 },
      'A4': { port: 'C', bit: 4 },  // SDA
      'A5': { port: 'C', bit: 5 },  // SCL
    }
  };
  
  // Arduino MEGA (ATmega2560) 引脚映射
  export const ARDUINO_MEGA_MAPPING: BoardConfig = {
    name: 'Arduino MEGA',
    pinMappings: {
      // 串口引脚
      '0': { port: 'E', bit: 0 },  // RX0
      '1': { port: 'E', bit: 1 },  // TX0
      
      // 数字引脚 2-13
      '2': { port: 'E', bit: 4 },
      '3': { port: 'E', bit: 5 },  // PWM
      '4': { port: 'G', bit: 5 },
      '5': { port: 'E', bit: 3 },  // PWM
      '6': { port: 'H', bit: 3 },  // PWM
      '7': { port: 'H', bit: 4 },
      '8': { port: 'H', bit: 5 },
      '9': { port: 'H', bit: 6 },  // PWM
      '10': { port: 'B', bit: 4 }, // PWM
      '11': { port: 'B', bit: 5 }, // PWM
      '12': { port: 'B', bit: 6 }, // PWM
      '13': { port: 'B', bit: 7 },
      
      // 数字引脚 14-21 (也是串口引脚)
      '14': { port: 'J', bit: 1 },  // TX3
      '15': { port: 'J', bit: 0 },  // RX3
      '16': { port: 'H', bit: 1 },  // TX2
      '17': { port: 'H', bit: 0 },  // RX2
      '18': { port: 'D', bit: 3 },  // TX1
      '19': { port: 'D', bit: 2 },  // RX1
      '20': { port: 'D', bit: 1 },  // SDA
      '21': { port: 'D', bit: 0 },  // SCL
      
      // 数字引脚 22-53
      '22': { port: 'A', bit: 0 },
      '23': { port: 'A', bit: 1 },
      '24': { port: 'A', bit: 2 },
      '25': { port: 'A', bit: 3 },
      '26': { port: 'A', bit: 4 },
      '27': { port: 'A', bit: 5 },
      '28': { port: 'A', bit: 6 },
      '29': { port: 'A', bit: 7 },
      '30': { port: 'C', bit: 7 },
      '31': { port: 'C', bit: 6 },
      '32': { port: 'C', bit: 5 },
      '33': { port: 'C', bit: 4 },
      '34': { port: 'C', bit: 3 },
      '35': { port: 'C', bit: 2 },
      '36': { port: 'C', bit: 1 },
      '37': { port: 'C', bit: 0 },
      '38': { port: 'D', bit: 7 },
      '39': { port: 'G', bit: 2 },
      '40': { port: 'G', bit: 1 },
      '41': { port: 'G', bit: 0 },
      '42': { port: 'L', bit: 7 },
      '43': { port: 'L', bit: 6 },
      '44': { port: 'L', bit: 5 }, // PWM
      '45': { port: 'L', bit: 4 }, // PWM
      '46': { port: 'L', bit: 3 }, // PWM
      '47': { port: 'L', bit: 2 }, // PWM
      '48': { port: 'L', bit: 1 }, // PWM
      '49': { port: 'L', bit: 0 }, // PWM
      '50': { port: 'B', bit: 3 }, // MISO
      '51': { port: 'B', bit: 2 }, // MOSI
      '52': { port: 'B', bit: 1 }, // SCK
      '53': { port: 'B', bit: 0 }, // SS
      
      // 模拟引脚 A0-A15
      'A0': { port: 'F', bit: 0 },
      'A1': { port: 'F', bit: 1 },
      'A2': { port: 'F', bit: 2 },
      'A3': { port: 'F', bit: 3 },
      'A4': { port: 'F', bit: 4 },
      'A5': { port: 'F', bit: 5 },
      'A6': { port: 'F', bit: 6 },
      'A7': { port: 'F', bit: 7 },
      'A8': { port: 'K', bit: 0 },
      'A9': { port: 'K', bit: 1 },
      'A10': { port: 'K', bit: 2 },
      'A11': { port: 'K', bit: 3 },
      'A12': { port: 'K', bit: 4 },
      'A13': { port: 'K', bit: 5 },
      'A14': { port: 'K', bit: 6 },
      'A15': { port: 'K', bit: 7 },
    }
  };
  
  export const BOARD_MAPPINGS: Record<string, BoardConfig> = {
    'wokwi-arduino-uno': ARDUINO_UNO_MAPPING,
    'wokwi-arduino-mega': ARDUINO_MEGA_MAPPING
  };