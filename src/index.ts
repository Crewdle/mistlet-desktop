import * as path from 'path';
import * as fs from 'fs';
import { app, Tray, Menu, BrowserWindow, ipcMain } from 'electron';
import { SDK } from '@crewdle/web-sdk';
import { WebRTCNodePeerConnectionConnector } from '@crewdle/mist-connector-webrtc-node';

const configPath = path.join(app.getPath('userData'), 'config.json');

let tray: Tray | null = null;
let configWindow: BrowserWindow | null = null;
let config: Config | null = null;
let sdk: SDK | null = null;

interface Config {
  vendorId: string;
  accessToken: string;
  secretKey: string;
  agentId: string;
}

function createConfigWindow(): void {
  if (configWindow) {
    return;
  }

  configWindow = new BrowserWindow({
    width: 400,
    height: 515,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  configWindow.loadFile('src/config.html');

  configWindow.on('closed', () => {
    configWindow = null;
  });
}

function createTray(): void {
  tray = new Tray('assets/logo16x16.png');
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Configurations', click: createConfigWindow },
    { type: 'separator' },
    { label: 'Quit', role: 'quit' }
  ]);

  tray.setToolTip('Crewdle Mist Agent');
  tray.setContextMenu(contextMenu);
}

async function loadSDK(): Promise<void> {
  if (!config) {
    return;
  }

  sdk = await SDK.getInstance(config.vendorId, config.accessToken, {
    peerConnectionConnector: WebRTCNodePeerConnectionConnector,
  }, config.secretKey);
  
  const key = `${config.agentId}${Math.random()}`;
  const user = await sdk.authenticateUser({
    id: key,
    displayName: key,
    email: `${key}@crewdle.com`,
  });
  console.log(user);
}

function saveConfig(newConfig: Config) {
  fs.writeFile(configPath, JSON.stringify(newConfig, null, 2), (err) => {
    if (err) {
      console.error('Error writing config file', err);
    } else {
      console.log('Configuration saved successfully');
    }
  });

  config = newConfig;
  if (sdk) {
    return;
  }
  loadSDK();
}

function loadConfig() {
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch (err) {
    console.error('Error reading config file', err);
    createConfigWindow();
    return null;
  }
}

app.whenReady().then(() => {
  createTray();
  loadConfig();
  loadSDK();
  if (process.platform === 'darwin') {
    app.dock.hide();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.hide();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createConfigWindow();
  }
});

ipcMain.on('save-config-data', (event, data: any) => {
  saveConfig(data);
});

ipcMain.handle('get-config-data', async (event) => {
  return config;
});
