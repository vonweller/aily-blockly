export let HEADER_BTNS: IMenuItem[][] = [
  [
    {
      name: '编译',
      data: { type: 'cmd', data: 'compile' },
      icon: 'fa-regular fa-check',
      type: 'act-btn',
      color: '#006adc',
      state: 'default',
    },
    {
      name: '烧录',
      data: { type: 'cmd', data: 'upload' },
      icon: 'fa-regular fa-play',
      type: 'act-btn',
      color: '#009600',
      state: 'default',
    },
    // {
    //   name: '调试',
    //   data: { type: 'cmd', data: 'debug' },
    //   icon: 'fa-regular fa-rocket',
    //   type: 'act-btn',
    //   color: '#f18800',
    // },
  ],
  [
    {
      name: '终端',
      data: { type: 'terminal', data: "default" },
      icon: 'fa-light fa-rectangle-terminal',
    },
    {
      name: '查看代码',
      data: { type: 'tool', data: "code-viewer" },
      icon: 'fa-light fa-rectangle-code',
    },
    {
      name: '串口工具',
      data: { type: 'tool', data: "serial-monitor" },
      icon: 'fa-light fa-monitor-waveform',
    },
    {
      name: 'AI',
      data: { type: 'tool', data: "aily-chat" },
      icon: 'fa-light fa-star-christmas',
      more: 'AI',
    },
    {
      name: '应用商店',
      data: { type: 'tool', data: "store" },
      icon: 'fa-light fa-store',
    },
  ],
];

export interface IMenuItem {
  name?: string;
  text?: string;
  action?: string;
  type?: string;
  data?: any;
  icon?: string;
  color?: string;
  more?: string;
  sep?: boolean;
  state?: 'default' | 'doing' | 'done' | 'error' | 'warn';
  disabled?: boolean;
}

export let HEADER_MENU: IMenuItem[] = [
  {
    name: '新建项目',
    text: 'Ctrl + N',
    data: { type: 'window', path: 'project-new', alwaysOnTop: true, width: 820, height: 550 },
    icon: 'fa-light fa-file-circle-plus',
  },
  {
    name: '打开项目',
    text: 'Ctrl + O',
    data: { type: 'explorer', data: 'project-open' },
    icon: 'fa-light fa-folder-open',
  },
  {
    name: '保存项目',
    text: 'Ctrl + S',
    data: { type: 'cmd', data: 'save' },
    icon: 'fa-light fa-file-circle-check',
    disabled: true,
  },
  {
    name: '另存为',
    text: 'Ctrl + Shift + S',
    data: { type: 'cmd', data: 'save-as' },
    icon: 'fa-light fa-copy',
    disabled: true,
  },
  {
    sep: true,
  },
  {
    name: '在资源管理器打开',
    data: { type: 'other', action: 'openByExplorer', data: 'project' },
    icon: 'fa-light fa-browser',
    // disabled: true,
  },
  {
    name: '关闭项目',
    data: { type: 'cmd', data: 'close' },
    icon: 'fa-light fa-folder-closed',
    disabled: true,
  },
  // {
  //   name: '导出代码',
  //   action: 'code-export',
  //   icon: 'fa-light fa-square-code',
  // },
  {
    sep: true,
  },
  {
    name: '设置',
    action: 'open-window',
    data: { type: 'window', path: 'settings', alwaysOnTop: true, width: 700, height: 550 },
    icon: 'fa-light fa-gear',
  },
  {
    sep: true,
  },
  {
    name: '关于本软件',
    data: { type: 'other', action: 'openByBrowser', url: 'https://aily.pro' },
    icon: 'fa-light fa-globe-pointer',
  },
  {
    name: 'Github',
    data: { type: 'other', action: 'openByBrowser', url: 'https://github.com/ailyProject/aily-blockly' },
    icon: 'fa-brands fa-github-alt',
  },
  {
    sep: true,
  },
  {
    name: '退出',
    data: { type: 'other', action: 'exitApp' },
    icon: 'fa-light fa-xmark',
  },
];

export let GUIDE_MENU: IMenuItem[] = [
  {
    name: '新建项目',
    data: { type: 'window', path: 'project-new', alwaysOnTop: true, width: 820, height: 550 },
    icon: 'fa-light fa-file-circle-plus',
  },
  {
    name: '打开项目',
    data: { type: 'explorer', data: 'project-open' },
    icon: 'fa-light fa-folder-open',
  },
  {
    name: '用户手册',
    data: { type: 'other', action: 'openByBrowser', url: 'https://aily.pro/doc' },
    icon: 'fa-light fa-book-open-cover',
  },
  {
    name: '示例程序',
    data: { type: 'other', action: 'openByBrowser', url: 'https://aily.pro' },
    icon: 'fa-light fa-books',
  }
]