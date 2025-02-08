// 这个文件用于和cli交互，进行编译和烧录等操作
import { ipcMain } from 'electron';
import { spawn } from 'child_process';
import * as pty from '@lydell/node-pty';

