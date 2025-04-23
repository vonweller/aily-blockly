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

@Injectable({
  providedIn: 'root'
})
export class SimulatorService {

  runner: AVRRunner;

  constructor() { }


  loadBinary(file) {

  }

  run() {

  }
}
