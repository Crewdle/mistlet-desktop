import path from 'path';
import fs from 'fs';
import si from 'systeminformation';
import keytar from 'keytar';
import crypto from 'crypto';
import { v4 } from 'uuid';

import { app, Tray, Menu, BrowserWindow, ipcMain } from 'electron';
import log from 'electron-log';
import { autoUpdater } from 'electron-updater';

import { SDK } from '@crewdle/web-sdk';
import { WebRTCNodePeerConnectionConnector } from '@crewdle/mist-connector-webrtc-node';
import { InMemoryDatabaseConnector } from '@crewdle/mist-connector-in-memory-db';
import { getVirtualFSObjectStoreConnector } from '@crewdle/mist-connector-virtual-fs';
import { IAgentCapacity, IAuthAgent } from '@crewdle/web-sdk-types';

log.transports.file.fileName = 'mistlet.log';
log.transports.file.level = 'debug';

const configPath = path.join(app.getPath('userData'), 'config.json');
const algorithm = 'aes-256-gcm';
const iv = crypto.randomBytes(16);

let tray: Tray | null = null;
let configWindow: BrowserWindow | null = null;
let config: Config | null = null;
let sdk: SDK | null = null;
let secretKey: Buffer | null = null;

interface Config {
  vendorId: string;
  accessToken: string;
  secretKey: string;
  agentId: string;
}

interface EncryptedConfig {
  content: string;
  tag: string;
  iv: string;
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
  try {
    const iconPath = path.join(__dirname, 'assets/logo16x16.png');
    tray = new Tray(iconPath);
    const contextMenu = Menu.buildFromTemplate([
      { label: 'Crewdle Mistlet', enabled: false},
      { type: 'separator'},
      { label: 'Configurations', click: createConfigWindow },
      { type: 'separator' },
      { label: 'Quit', role: 'quit' }
    ]);

    tray.setToolTip('Crewdle Mist Agent');
    tray.setContextMenu(contextMenu);
  } catch (err) {
    log.error('Error creating tray', err);
  }
}

async function loadSDK(): Promise<void> {
  if (!config) {
    log.error('Configuration not found');
    return;
  }

  try {
    sdk = await SDK.getInstance(config.vendorId, config.accessToken, {
      peerConnectionConnector: WebRTCNodePeerConnectionConnector,
      keyValueDatabaseConnector: InMemoryDatabaseConnector,
      objectStoreConnector: getVirtualFSObjectStoreConnector({
        baseFolder: app.getPath('userData'),
      }),
    }, config.secretKey);
  } catch (err) {
    log.error('Error initializing SDK', err);
    return;
  }
  log.info('SDK initialized successfully');

  let uuid = await keytar.getPassword('crewdle', 'mist-agent-desktop-uuid');
  if (!uuid) {
    uuid = v4();
    await keytar.setPassword('crewdle', 'mist-agent-desktop-uuid', uuid);
  }
  log.info('Agent authenticating', uuid);
  
  let user: IAuthAgent;
  try {
    user = await sdk.authenticateAgent({
      groupId: config.agentId,
      id: uuid,
    }, async () => {
      const cpu = await si.cpu();
      const currentLoad = await si.currentLoad();
      const memory = await si.mem();
      const gpu = await si.graphics();
      const storage = await si.fsSize();
      let gpuCores = gpu.controllers[0].cores ?? 1;
      if (typeof gpuCores === 'string') {
        gpuCores = parseInt(gpuCores, 10);
      }

      const agentCapacity: IAgentCapacity = {
        cpu: {
          cores: cpu.cores,
          load: currentLoad.currentLoad,
        },
        gpu: {
          cores: gpuCores,
          load: gpu.controllers[0].utilizationGpu ?? 0,
        },
        memory: {
          total: memory.total,
          available: memory.available,
        },
        storage: {
          total: storage[0].size,
          available: storage[0].available,
        },
      };

      log.info('Reporting agent capacity', agentCapacity);
      return agentCapacity;
    });
    log.info('Agent authenticated successfully');
  } catch (err) {
    log.error('Error authenticating agent', err);
    return;
  }
}

function saveConfig(newConfig: Config) {
  const encryptedConfig = encrypt(JSON.stringify(newConfig));
  fs.writeFile(configPath, JSON.stringify(encryptedConfig), (err) => {
    if (err) {
      log.error('Error writing config file', err);
    } else {
      log.info('Configuration saved successfully');
    }
  });

  config = newConfig;
  if (sdk) {
    sdk.close();
  }
  loadSDK();
  configWindow?.close();
}

async function loadConfig() {
  try {
    const keytarSecret = await keytar.getPassword('crewdle', 'mist-agent-desktop');
    if (keytarSecret) {
      secretKey = Buffer.from(keytarSecret, 'hex');
    }
  } catch (err) {
    log.error('Error reading secret key from keytar', err);
  }

  try {
    if (!secretKey) {
      secretKey = crypto.randomBytes(32);
      await keytar.setPassword('crewdle', 'mist-agent-desktop', secretKey.toString('hex'));
    }
    const encryptedConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    const decryptedConfig = decrypt(encryptedConfig);
    config = JSON.parse(decryptedConfig);
  } catch (err) {
    log.error('Error reading config file', err);
    config = null;
    createConfigWindow();
    return null;
  }

  log.info('Configuration loaded successfully');
}

app.whenReady().then(async () => {
  log.info('Starting Crewdle Mistlet Desktop');

  autoUpdater.checkForUpdatesAndNotify();

  log.info('Creating tray');
  createTray();
  if (process.platform === 'darwin') {
    app.dock.hide();
  }

  log.info('Loading configuration');
  await loadConfig();

  log.info('Loading SDK');
  loadSDK();
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

function encrypt(text: string): EncryptedConfig {
  if (!secretKey) {
    throw new Error('Secret key not found');
  }

  const cipher = crypto.createCipheriv(algorithm, secretKey, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();

  return {
    content: encrypted,
    tag: authTag.toString('hex'),
    iv: iv.toString('hex'),
  };
};

const decrypt = (encrypted: EncryptedConfig): string => {
  if (!secretKey) {
    throw new Error('Secret key not found');
  }

  const decipher = crypto.createDecipheriv(algorithm, secretKey, Buffer.from(encrypted.iv, 'hex'));
  decipher.setAuthTag(Buffer.from(encrypted.tag, 'hex'));
  let decrypted = decipher.update(encrypted.content, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
};

process.on('uncaughtException', (error) => {
  log.error('Unhandled Exception', error);
});

autoUpdater.on('update-available', () => {
  console.log('Update available.');
});

autoUpdater.on('update-downloaded', () => {
  console.log('Update downloaded; will install now');
  autoUpdater.quitAndInstall();
});
