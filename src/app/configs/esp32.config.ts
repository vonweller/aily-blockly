import { IMenuItem } from "./menu.config";

export let ESP32_CONFIG_MENU: IMenuItem[] = [
    {
        sep: true,
    },
    {
        name: 'ESP32.UPLOAD_SPEED',
        data: {},
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
        data: {},
        icon: 'fa-light fa-tablet-rugged',
        children: [
            { name: 'QIO', data: '', check: false },
            { name: 'DIO', data: '', check: true }
        ]
    },
    {
        name: 'ESP32.FLASH_SIZE',
        data: {},
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
        data: {},
        icon: "fa-light fa-hard-drive",
        children: [
            { name: 'Default 4MB with spiffs (1.2MB APP/1.5MB SPIFFS)', data: '', check: true },
            { name: 'Default 4MB with ffat (1.2MB APP/1.5MB FATFS)', data: '', check: false },
            { name: 'Default 4MB with OTA (2MB APP/2MB OTA)', data: '', check: false },
            { name: 'Minimal SPIFFS (1.9MB APP with OTA/190KB SPIFFS)', data: '', check: false }
        ]
    },
]