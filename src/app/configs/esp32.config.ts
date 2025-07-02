import { IMenuItem } from "./menu.config";

export let ESP32_CONFIG_MENU: IMenuItem[] = [
    {
        sep: true,
    },
    {
        name: 'ESP32.UPLOAD_SPEED',
        // text: 'Ctrl + Shift + S',
        // action: 'project-save-as',
        // data: { type: 'cmd', data: 'save-as' },
        icon: "fa-light fa-up-from-line",
        children: [
            { name: '115200', data: '', check: false },
            { name: '256000', data: '', check: false },
            { name: '512000', data: '', check: false },
            { name: '921600', data: '', check: true }
        ]
    },
    {
        name: 'ESP32.FLASH_MODE',
        // text: 'Ctrl + O',
        // action: 'project-open',
        // data: { type: 'project-open', data: 'project-open' },
        icon: 'fa-light fa-tablet-rugged',
        children: [
            { name: 'QIO', data: '', check: false },
            { name: 'DIO', data: '', check: true }
        ]
    },
    {
        name: 'ESP32.FLASH_SIZE',
        // text: 'Ctrl + N',
        // action: 'project-new',
        // data: { type: 'project-new', path: 'project-new', alwaysOnTop: true, width: 820, height: 550 },
        icon: "fa-light fa-database",
        children: [
            { name: '2MB', data: '', check: false },
            { name: '4MB', data: '', check: false },
            { name: '8MB', data: '', check: false },
            { name: '16MB', data: '', check: true }
        ]
    },
    {
        name: 'ESP32.PARTITION_SCHEME',
        // text: 'Ctrl + S',
        // action: 'project-save',
        // data: { type: 'cmd', data: 'save' },
        icon: "fa-light fa-hard-drive",
        children: [
            { name: 'Default 4MB with spiffs (1.2MB APP/1.5MB SPIFFS)', data: '', check: true },
            { name: 'Default 4MB with ffat (1.2MB APP/1.5MB FATFS)', data: '', check: false },
            { name: 'Default 4MB with OTA (2MB APP/2MB OTA)', data: '', check: false },
            { name: 'Minimal SPIFFS (1.9MB APP with OTA/190KB SPIFFS)', data: '', check: false }
        ]
    },
]