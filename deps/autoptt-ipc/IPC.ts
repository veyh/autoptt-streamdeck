import * as net from "node:net";
// @ts-ignore-error
import varint from "varint";
import {
  ActivationMode as AutopttActivationMode,
  ActivityState as AutopttActivityState,
  Ipc as AutopttIpc,
  Settings as AutopttSettings,
  AppEnabledState as AutopttAppEnabledState,
  Settings,
} from "./autoptt.js";
import { base64Decode, base64Encode } from "@bufbuild/protobuf/wire";

const DEFAULT_IPC_HOST = "127.1.2.3";
const DEFAULT_IPC_PORT = 4000;
const DEFAULT_IPC_TAG = "autoptt-ipc-js";

type State =
  | "idle"
  | "connecting"
  | "connected";

type LogFn = (...args: any[]) => void;

export default class IPC {
  private socket = new net.Socket;
  private recvBuffer = Buffer.alloc(0);

  state: State = "idle";

  ipcHost = DEFAULT_IPC_HOST;
  ipcPort = DEFAULT_IPC_PORT;
  ipcTag = DEFAULT_IPC_TAG;
  connectRetryIntervalSec = 0;

  logDebug: LogFn = console.log;
  logError: LogFn = console.error;

  settings: AutopttSettings | undefined;

  activationMode: AutopttActivationMode = AutopttActivationMode.AUTOMATIC;
  aggregateActivityState: AutopttActivityState = AutopttActivityState.INACTIVE;
  isMuted = false;
  toggleMuteGlobalIsActive = false;
  currentValue = 0;
  appEnabledState = AutopttAppEnabledState.ENABLED;
  toggleMuteStates: (boolean | undefined)[] = [];
  activityStates: AutopttActivityState[] = [];
  profileName = "Default";
  profileId = "";
  autoProfileSwitch = false;

  private serverIpcVersion = -1;

  // IPC versions
  // 3 - AutoPTT 2.8.0
  // 4 - AutoPTT 2.11.0
  // 5 - AutoPTT 3.0.0

  static VERSION = 5;

  isCompatible() {
    const server = this.serverIpcVersion;
    const client = IPC.VERSION;

    if (server === client) {
      return true;
    }

    if (server === 1) {
      return false; // too old
    }

    if (server === 2) {
      return false; // too old
    }

    if (server === 3) {
      // individual toggle mute will not work
      return true;
    }

    if (server === 4) {
      // profile switching will not work (there are no profiles :)
      return true;
    }

    return false; // fallback for unknown versions
  }

  supportsProfiles() {
    return this.serverIpcVersion >= 5;
  }

  start() {
    if (this.state !== "idle") {
      return;
    }

    this.registerEvents();

    this.socket.connect({
      family: 4,
      host: this.ipcHost,
      port: this.ipcPort,
      noDelay: true,
    });

    this.serverIpcVersion = -1;
    this.setState("connecting");
  }

  private setState = (newState: State) => {
    if (this.state === newState) {
      return;
    }

    this.logDebug(`[setState] ${this.state} --> ${newState}`);

    this.state = newState;

    this.onStateChanged?.();
  };

  onStateChanged = () => {};

  private registerEvents() {
    this.socket.on("close", this.onClose);
    this.socket.on("end", this.onEnd);
    this.socket.on("error", this.onError);
    this.socket.on("connect", this.onConnect);
    this.socket.on("data", this.onData);
  }

  private unregisterEvents() {
    this.socket.off("close", this.onClose);
    this.socket.off("end", this.onEnd);
    this.socket.off("error", this.onError);
    this.socket.off("connect", this.onConnect);
    this.socket.off("data", this.onData);
  }

  stop() {
    if (this.state === "idle") {
      return;
    }

    this.setState("idle");
    this.unregisterEvents();
    this.socket.destroy();
    this.socket = new net.Socket;
  }

  private onError = (e: any) => {
    this.logDebug("[onError]", e);

    this.setState("idle");
    this.unregisterEvents();

    if (this.connectRetryIntervalSec > 0) {
      const timeSec = this.connectRetryIntervalSec;

      this.logDebug(`[onError] schedule retry in ${timeSec} sec`)

      setTimeout(() => this.start(), timeSec * 1000);
    }
  };

  private onClose = () => {
    this.logDebug("[onClose] called");

    this.setState("idle");
    this.unregisterEvents();
  };

  private onEnd = () => {
    this.logDebug("[onEnd] called");

    this.setState("idle");
    this.unregisterEvents();
  };

  private onConnect = () => {
    this.logDebug("[onConnect] called");

    this.setState("connected");
    this.configure();
  };

  private onData = (data: Buffer) => {
    this.logDebug("recv", data.byteLength);

    this.recvBuffer = Buffer.concat([this.recvBuffer, data]);

    while (this.recvBuffer.byteLength > 0) {
      const ok = this.tryDecode();

      if (!ok) {
        break
      }
    }
  };

  private tryDecode() {
    let msgLen = 0;

    try {
      msgLen = varint.decode(this.recvBuffer);
    }

    catch (_err) {
      return false;
    }

    const varintLen = varint.decode.bytes as number;

    try {
      const msg = AutopttIpc.decode(
        this.recvBuffer.subarray(varintLen, varintLen + msgLen)
      );

      this.recvBuffer = this.recvBuffer.subarray(varintLen + msgLen);

      this.logDebug("[onData] AutopttIpc", msgLen, msg);
      this.onMessage(msg);
    }

    catch (err) {
      this.logError("[onData] AutopttIpc.decode failed", err);
      return false;
    }

    return true;
  }

  private configure() {
    this.write(AutopttIpc.create({
      clientConfigure: {
        ipcTag: this.ipcTag,
        ipcVersion: IPC.VERSION,

        // this disables current value updates, as we don't currently use them
        currentValueUpdateRateMs: 0,
      }
    }));

    this.logDebug("[configure] wrote IpcClientConfigure");
  }

  private write(msg: AutopttIpc) {
    const encoded = AutopttIpc.encode(msg).finish();
    const varintBytes = varint.encode(encoded.byteLength);
    const delimited = Buffer.concat([
      Buffer.from(varintBytes),
      encoded
    ]);

    // this.logDebug("[write]", delimited.length, msg);
    this.socket.write(delimited);
  }

  private onMessage(msg: AutopttIpc) {
    if (msg.serverHello) {
      this.serverIpcVersion = msg.serverHello.ipcVersion;
      this.logDebug("serverIpcVersion", this.serverIpcVersion);
    }

    if (msg.settingsChanged?.settings) {
      this.onSettingsChanged(msg.settingsChanged.settings);
    }

    if (msg.muteStateChanged) {
      this.isMuted = msg.muteStateChanged.isMuted;
      this.logDebug("isMuted", this.isMuted);
    }

    if (msg.activityStateChanged) {
      this.activityStates = msg.activityStateChanged.keyGroupStates;
      this.aggregateActivityState = msg.activityStateChanged.aggregateState;
      this.logDebug("aggregateActivityState", this.aggregateActivityState);
    }

    if (msg.currentValueChanged) {
      this.currentValue = msg.currentValueChanged.value;
    }

    if (msg.appEnabledStateChanged) {
      this.appEnabledState = msg.appEnabledStateChanged.state;
    }

    if (msg.toggleMuteGlobalChanged) {
      this.toggleMuteGlobalIsActive = msg.toggleMuteGlobalChanged.isActive;
    }

    if (msg.toggleMuteChanged) {
      const inner = msg.toggleMuteChanged;

      if (inner.keyGroupIndex < this.toggleMuteStates.length) {
        this.toggleMuteStates.length = inner.keyGroupIndex + 1;
      }

      this.toggleMuteStates[inner.keyGroupIndex] = inner.isActive;
    }

    this.onMessageHook?.(msg);
  }

  private onSettingsChanged(settings: Settings) {
    this.settings = settings;

    if (this.supportsProfiles()) {
      const profile = this.getCurrentProfile()!;

      this.profileId = base64Encode(profile.id);
      this.profileName = profile.name;;
      this.activationMode = profile.settings!.activationMode;
      this.autoProfileSwitch = settings.autoProfileSwitch;
    }

    else {
      this.profileId = "";
      this.profileName = "Default";
      this.activationMode = this.settings.activationMode;
      this.autoProfileSwitch = false;
    }
  }

  onMessageHook = (_msg: AutopttIpc) => {};

  setAddr(addr?: string) {
    let host = DEFAULT_IPC_HOST;
    let port = DEFAULT_IPC_PORT;

    const parsed = this.parseAddress(addr);
    this.logDebug("[setAddr]", { addr, parsed });

    if (parsed) {
      host = parsed[0];
      port = parsed[1];
    }

    if (host === this.ipcHost && port === this.ipcPort) {
      this.logDebug("[setAddr] no changes");
      return;
    }

    this.ipcHost = host;
    this.ipcPort = port;

    this.logDebug("[setAddr] changed to", host, port);

    if (this.state === "idle") {
      return;
    }

    this.stop();
    this.start();
  }

  private parseAddress(addr?: string): [string, number] | null {
    if (!addr) {
      return null;
    }

    const addrWithoutProto = addr.trim().replace("tcp://", "");
    const index = addrWithoutProto.lastIndexOf(":");

    if (index < 0) {
      return null;
    }

    const host = addrWithoutProto.substring(0, index);
    const portStr = addrWithoutProto.substring(index + 1);
    const port = parseInt(portStr);

    if (!isFinite(port) || isNaN(port) || port < 0 || port > 65535) {
      return null;
    }

    return [host, port];
  }

  getCurrentProfile() {
    if (!this.settings) {
      return null;
    }

    return this.settings.profiles[this.settings.profile];
  }

  getCurrentProfileIndex() {
    return this.settings?.profile ?? 0;
  }

  getKeyGroups() {
    if (!this.settings) {
      return [];
    }

    if (!this.supportsProfiles()) {
      return this.settings.keyGroups;
    }

    return this.getCurrentProfile()!.settings!.keyGroups;
  }

  getProfileIdsAndNames() {
    if (!this.settings) {
      return [];
    }

    if (!this.supportsProfiles()) {
      return [];
    }

    return this.settings.profiles.map(x => ({
      id: base64Encode(x.id),
      name: x.name,
    }));
  }

  setActivationMode(mode: AutopttActivationMode) {
    this.write(AutopttIpc.create({
      requestSwapActivationMode: {
        modes: [mode],
      }
    }));
  }

  setPushToMuteGlobalDown(value: boolean) {
    this.write(AutopttIpc.create({
      requestSetPushToMuteGlobalState: {
        isDown: value,
      },
    }));
  }

  setPushToTalkDown(index: number, value: boolean) {
    this.write(AutopttIpc.create({
      requestSetPushToTalkState: {
        keyGroupIndex: index,
        isDown: value,
      }
    }));
  }

  setPushToMuteDown(index: number, value: boolean) {
    this.write(AutopttIpc.create({
      requestSetPushToMuteState: {
        keyGroupIndex: index,
        isDown: value,
      }
    }));
  }

  toggleMuteGlobal() {
    this.write(AutopttIpc.create({
      requestToggleMuteGlobal: {}
    }));
  }

  toggleMute(index: number) {
    this.write(AutopttIpc.create({
      requestToggleMute: {
        keyGroupIndex: index,
      }
    }));
  }

  changeProfile(id: string) {
    const profileId = base64Decode(id);

    this.write(AutopttIpc.create({
      requestChangeProfile: { profileId }
    }));
  }

  setAutoProfileSwitch(value: boolean) {
    this.write(AutopttIpc.create({
      requestSetAutoProfileSwitch: { isEnabled: value }
    }));
  }

  toggleAutoProfileSwitch() {
    this.write(AutopttIpc.create({
      requestToggleAutoProfileSwitch: {}
    }));
  }
}
