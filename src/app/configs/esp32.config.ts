import { IMenuItem } from "./menu.config";

export let ESP32_CONFIG_MENU: IMenuItem[] = [
    {
        sep: true,
    },
    {
        name: 'ESP32.FLASH_MODE',
        // text: 'Ctrl + O',
        // action: 'project-open',
        // data: { type: 'project-open', data: 'project-open' },
        icon: 'fa-light fa-tablet-rugged',
    },
    {
        name: 'ESP32.FLASH_SIZE',
        // text: 'Ctrl + N',
        // action: 'project-new',
        // data: { type: 'project-new', path: 'project-new', alwaysOnTop: true, width: 820, height: 550 },
        icon: "fa-light fa-tablet-rugged",
    },
    {
        name: 'ESP32.PARTITION_SCHEME',
        // text: 'Ctrl + S',
        // action: 'project-save',
        // data: { type: 'cmd', data: 'save' },
        icon: "fa-light fa-database",
    },
    {
        name: 'ESP32.UPLOAD_SPEED:',
        // text: 'Ctrl + Shift + S',
        // action: 'project-save-as',
        // data: { type: 'cmd', data: 'save-as' },
        icon: "fa-light fa-up-from-line",
    }
]