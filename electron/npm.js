const { ipcMain } = require("electron");
const fs = require("fs");
const path = require("path");
const os = require("os");

function registerNpmHandlers(mainWindow) {
    ipcMain.handle("npm-install", async (event, data) => { });
    ipcMain.handle("npm-list", async (event, data) => { });
    ipcMain.handle("npm-search", async (event, data) => { });
    ipcMain.handle("npm-info", async (event, data) => { });
}