import path from 'path';
import fs from 'fs';
import si from 'systeminformation';
import keytar from 'keytar';
import crypto from 'crypto';
import { app, Tray, Menu, BrowserWindow, ipcMain } from 'electron';
import { SDK } from '@crewdle/web-sdk';
import { WebRTCNodePeerConnectionConnector } from '@crewdle/mist-connector-webrtc-node';
import { InMemoryDatabaseConnector } from '@crewdle/mist-connector-in-memory-db';
import { VirtualFSObjectStoreConnector } from '@crewdle/mist-connector-virtual-fs';

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

  try {
    sdk = await SDK.getInstance(config.vendorId, config.accessToken, {
      peerConnectionConnector: WebRTCNodePeerConnectionConnector,
      keyValueDatabaseConnector: InMemoryDatabaseConnector,
      objectStoreConnector: VirtualFSObjectStoreConnector,
    }, config.secretKey);
  } catch (err) {
    console.error('Error initializing SDK', err);
    return;
  }
  
  const user = await sdk.authenticateAgent({
    groupId: config.agentId,
  });
  console.log(user);

  const cpu = await si.cpu();
  console.log(cpu);

  const mem = await si.mem();
  console.log(mem);

  const gpu = await si.graphics();
  console.log(gpu);

  const sto = await si.fsSize();
  console.log(sto);
}

function saveConfig(newConfig: Config) {
  const encryptedConfig = encrypt(JSON.stringify(newConfig));
  fs.writeFile(configPath, JSON.stringify(encryptedConfig), (err) => {
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
  configWindow?.close();
}

async function loadConfig() {
  try {
    const keytarSecret = await keytar.getPassword('crewdle', 'mist-agent-desktop');
    if (keytarSecret) {
      secretKey = Buffer.from(keytarSecret, 'hex');
    }
  } catch (err) {
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
    console.error('Error reading config file', err);
    config = null;
    createConfigWindow();
    return null;
  }
}

app.whenReady().then(() => {
  if (process.platform === 'darwin') {
    app.dock.hide();
  }

  createTray();
  loadConfig();
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
