import path from 'path';
import fs from 'fs';
import si from 'systeminformation';
import keytar from 'keytar';
import crypto from 'crypto';
import { v4 } from 'uuid';
import { getApp } from 'firebase/app';
import { getFunctions, httpsCallable } from 'firebase/functions';

import { app, Tray, Menu, BrowserWindow, ipcMain } from 'electron';
import log from 'electron-log';
import { autoUpdater } from 'electron-updater';

import packageJson from '../package.json';

import { SDK } from '@crewdle/web-sdk';
import { IAgentCapacity, IAuthAgent } from '@crewdle/web-sdk-types';
import { WebRTCNodePeerConnectionConnector } from '@crewdle/mist-connector-webrtc-node';
import { InMemoryDatabaseConnector } from '@crewdle/mist-connector-in-memory-db';
import { getVirtualFSObjectStoreConnector } from '@crewdle/mist-connector-virtual-fs';
import { FaissVectorDatabaseConnector } from '@crewdle/mist-connector-faiss';
import { GraphologyGraphDatabaseConnector } from '@crewdle/mist-connector-graphology';
import { OfficeParserConnector } from '@crewdle/mist-connector-officeparser';
import { WinkNLPConnector } from '@crewdle/mist-connector-wink-nlp';
import { GoogleSearchConnector } from '@crewdle/mist-connector-googleapis';

log.transports.file.fileName = 'mistlet.log';
log.transports.file.level = 'debug';

console.log = log.info;
console.warn = log.warn;
console.error = log.error;

const configPath = path.join(app.getPath('userData'), 'config.json');
const algorithm = 'aes-256-gcm';
const iv = crypto.randomBytes(16);

const firebase = getApp('CREWDLE_WEB_SDK');
const functions = getFunctions(firebase, 'northamerica-northeast1');

let tray: Tray | null = null;
let configWindow: BrowserWindow | null = null;
let config: Config | null = null;
let sdk: SDK | null = null;
let secretKey: Buffer | null = null;
let unsubReporting: (() => void) | null = null;
let unsubConfig: (() => void) | null = null;
let getVramState: (() => { total: number, available: number }) | null = null;

interface Config {
  vendorId: string;
  accessToken: string;
  secretKey: string;
  groupId: string;
}

interface EncryptedConfig {
  content: string;
  tag: string;
  iv: string;
}

function createConfigWindow(): void {
  configWindow?.close();

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
      { label: `Crewdle Mistlet v${packageJson.version}`, enabled: false},
      { type: 'separator'},
      { label: 'Configuration', click: createConfigWindow },
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
    const { LlamacppGenerativeAIWorkerConnector } = await Function('return import("@crewdle/mist-connector-llamacpp")')();
    const { TransformersGenerativeAIWorkerConnector } = await Function('return import("@crewdle/mist-connector-transformers")')();
    getVramState = LlamacppGenerativeAIWorkerConnector.getVramState;

    sdk = await SDK.getInstance(config.vendorId, config.accessToken, {
      peerConnectionConnector: WebRTCNodePeerConnectionConnector,
      keyValueDatabaseConnector: InMemoryDatabaseConnector,
      objectStoreConnector: getVirtualFSObjectStoreConnector({
        baseFolder: app.getPath('userData'),
      }),
      vectorDatabaseConnector: FaissVectorDatabaseConnector,
      graphDatabaseConnector: GraphologyGraphDatabaseConnector,
      generativeAIWorkerConnectors: [
        LlamacppGenerativeAIWorkerConnector,
        TransformersGenerativeAIWorkerConnector,
      ],
      documentParserConnector: OfficeParserConnector,
      nlpLibraryConnector: WinkNLPConnector,
      searchConnector: GoogleSearchConnector,
    }, config.secretKey);
  } catch (err) {
    log.error('Error initializing SDK', err);
    createConfigWindow();
    return;
  }
  log.info('SDK initialized successfully');

  let uuid = await keytar.getPassword('crewdle', 'mist-agent-desktop-uuid');
  if (!uuid) {
    uuid = v4();
    await keytar.setPassword('crewdle', 'mist-agent-desktop-uuid', uuid);
  }
  log.info('Agent authenticating', uuid);

  let agent: IAuthAgent;
  try {
    agent = await sdk.authenticateAgent({
      groupId: config.groupId,
      id: uuid,
    });

    unsubReporting = agent.setReportCapacity(reportCapacity);
    unsubConfig = agent.onConfigurationChange(restartAgent);

    log.info('Agent authenticated successfully');
  } catch (err) {
    log.error('Error authenticating agent', err);
    createConfigWindow();
    return;
  }
}

async function restartAgent(): Promise<void> {
  log.info('New configuration, restarting agent');
  await closeSDK();
  await loadSDK();
}

async function closeSDK(): Promise<void> {
  if (unsubReporting) {
    unsubReporting();
  }
  if (unsubConfig) {
    unsubConfig();
  }
  if (sdk) {
    await sdk.close();
  }
}

async function reportCapacity(): Promise<IAgentCapacity> {
  const cpu = await si.cpu();
  const currentLoad = await si.currentLoad();
  const memory = await si.mem();
  const gpu = await si.graphics();
  const storage = await si.fsSize();
  const interfaces = await si.networkInterfaces();
  let macAddress = '';
  if (interfaces instanceof Array) {
    macAddress = interfaces.find((i) => i.default === true)?.mac ?? '';
  } else {
    macAddress = interfaces.mac;
  }
  let gpuCores = 0;
  if (gpu.controllers instanceof Array) {
    gpuCores = gpu.controllers[0]?.cores ?? 1;
  }
  if (typeof gpuCores === 'string') {
    gpuCores = parseInt(gpuCores, 10);
  }
  let totalVram = 0;
  let availableVram = 0;
  if (getVramState) {
    const vramState = getVramState();
    totalVram = vramState.total ?? gpu.controllers[0]?.vramDynamic ? memory.total : 0;
    availableVram = vramState.available ?? gpu.controllers[0]?.vramDynamic ? memory.available : 0;
  }

  const agentCapacity: IAgentCapacity = {
    version: packageJson.version,
    macAddress,
    cpu: {
      cores: cpu.cores,
      load: currentLoad.currentLoad,
    },
    gpu: {
      cores: gpuCores,
      load: gpu.controllers[0]?.utilizationGpu ?? 0,
    },
    memory: {
      total: memory.total,
      available: memory.available,
    },
    vram: {
      total: totalVram,
      available: availableVram,
    },
    storage: {
      total: storage[0]?.size,
      available: storage[0]?.available,
    },
  };

  log.info('Reporting agent capacity', agentCapacity);
  return agentCapacity;
}

async function saveConfig(newConfig: Partial<Config>) {
  if (!newConfig.vendorId || !newConfig.groupId) {
    log.error('Invalid configuration data');
    createConfigWindow();
    return;
  }

  let completeConfig: Config | undefined;
  try {
    completeConfig = await retrieveConfig(newConfig.vendorId, newConfig.groupId);
  } catch (err) {
    log.error('Error loading config', err);
    createConfigWindow();
    return;
  }

  const encryptedConfig = encrypt(JSON.stringify(completeConfig));
  fs.writeFile(configPath, JSON.stringify(encryptedConfig), (err) => {
    if (err) {
      log.error('Error writing config file', err);
    } else {
      log.info('Configuration saved successfully');
    }
  });

  config = completeConfig;
  await closeSDK();
  await loadSDK();
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
    const vendorId = process.env.CREWDLE_VENDOR_ID;
    const groupId = process.env.CREWDLE_GROUP_ID;

    if (!secretKey || !vendorId || !groupId) {
      log.error('Error reading config file', err);
      createConfigWindow();
      return;
    }

    try {
      await saveConfig({
        vendorId,
        groupId,
      });
    } catch (err) {
      log.error('Error loading config', err);
      createConfigWindow();
      return;
    }
  }

  log.info('Configuration loaded successfully');
}

async function retrieveConfig(vendorId: string, groupId: string): Promise<Config> {
  if (!secretKey) {
    throw new Error('Secret key not found');
  }

  const data = await httpsCallable(functions, 'sdkGetSecrets')({
    vendorId,
    groupId,
    encryptionKey: secretKey.toString('hex'),
  });
  const { content, tag, iv } = data.data as any;

  const decryptedConfig = decrypt({ content, tag, iv });

  let newConfig: Config = {
    vendorId,
    groupId,
    ...JSON.parse(decryptedConfig)
  };

  return newConfig;
}

app.whenReady().then(async () => {
  log.info(`Starting Crewdle Mistlet Desktop v${packageJson.version}`);

  if (SDK.isProduction()) {
    autoUpdater.checkForUpdatesAndNotify();
  }

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

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
