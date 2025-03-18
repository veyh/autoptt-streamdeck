import * as net from "node:net";
import streamDeck from "@elgato/streamdeck";
import varint from "varint";
import {
  ActivationMode as AutopttActivationMode,
  ActivityState as AutopttActivityState,
  Ipc as AutopttIpc,
  Settings as AutopttSettings,
  AppEnabledState as AutopttAppEnabledState,
} from "./autoptt";

const DEFAULT_IPC_HOST = "127.1.2.3";
const DEFAULT_IPC_PORT = 4000;

type State =
  | "idle"
  | "connecting"
  | "connected";

export default class IPC {
  state: State = "idle";
  socket = new net.Socket;
  recvBuffer = Buffer.alloc(0);

  ipcHost = DEFAULT_IPC_HOST;
  ipcPort = DEFAULT_IPC_PORT;

  settings: AutopttSettings | undefined;

  activationMode: AutopttActivationMode = AutopttActivationMode.AUTOMATIC;
  aggregateActivityState: AutopttActivityState = AutopttActivityState.INACTIVE;
  isMuted = false;
  toggleMuteGlobalIsActive = false;
  currentValue = 0;
  appEnabledState = AutopttAppEnabledState.ENABLED;

  serverIpcVersion = -1;

  static VERSION = 2;

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

  setState = (newState: State) => {
    if (this.state === newState) {
      return;
    }

    streamDeck.logger.debug(`[setState] ${this.state} --> ${newState}`);

    this.state = newState;

    this.onStateChanged?.();
  };

  onStateChanged = () => {};

  registerEvents() {
    this.socket.on("close", this.onClose);
    this.socket.on("end", this.onEnd);
    this.socket.on("error", this.onError);
    this.socket.on("connect", this.onConnect);
    this.socket.on("data", this.onData);
  }

  unregisterEvents() {
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

  onError = (e: any) => {
    streamDeck.logger.debug("[onError]", e);

    this.setState("idle");
    this.unregisterEvents();
  };

  onClose = () => {
    streamDeck.logger.debug("[onClose] called");

    this.setState("idle");
    this.unregisterEvents();
  };

  onEnd = () => {
    streamDeck.logger.debug("[onEnd] called");

    this.setState("idle");
    this.unregisterEvents();
  };

  onConnect = () => {
    streamDeck.logger.debug("[onConnect] called");

    this.setState("connected");
    this.configure();
  };

  onData = (data: Buffer) => {
    streamDeck.logger.debug("recv", data.byteLength);

    this.recvBuffer = Buffer.concat([this.recvBuffer, data]);

    while (this.recvBuffer.byteLength > 0) {
      const ok = this.tryDecode();

      if (!ok) {
        break
      }
    }
  };

  tryDecode() {
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

      streamDeck.logger.debug("[onData] AutopttIpc", msgLen, msg);
      this.onMessage(msg);
    }

    catch (err) {
      console.error("[onData] AutopttIpc.decode failed", err);
      return false;
    }

    return true;
  }

  configure() {
    this.write(AutopttIpc.create({
      clientConfigure: {
        ipcTag: "autoptt-streamdeck",
        ipcVersion: IPC.VERSION,

        // this disables current value updates, as we don't currently use them
        currentValueUpdateRateMs: 0,
      }
    }));

    streamDeck.logger.debug("[configure] wrote IpcClientConfigure");
  }

  write(msg: AutopttIpc) {
    const encoded = AutopttIpc.encode(msg).finish();
    const varintBytes = varint.encode(encoded.byteLength);
    const delimited = Buffer.concat([
      Buffer.from(varintBytes),
      encoded
    ]);

    this.socket.write(delimited);
  }

  onMessage(msg: AutopttIpc) {
    if (msg.serverHello) {
      this.serverIpcVersion = msg.serverHello.ipcVersion;
    }

    if (msg.settingsChanged?.settings) {
      this.settings = msg.settingsChanged.settings;
      this.activationMode = msg.settingsChanged.settings.activationMode;
      streamDeck.logger.debug("activationMode", this.activationMode);
    }

    if (msg.muteStateChanged) {
      this.isMuted = msg.muteStateChanged.isMuted;
      streamDeck.logger.debug("isMuted", this.isMuted);
    }

    if (msg.activityStateChanged) {
      this.aggregateActivityState = msg.activityStateChanged.aggregateState;
      streamDeck.logger.debug("aggregateActivityState", this.aggregateActivityState);
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

    this.onMessageHook?.(msg);
  }

  onMessageHook = (_msg: AutopttIpc) => {};

  setAddr(addr?: string) {
    let host = DEFAULT_IPC_HOST;
    let port = DEFAULT_IPC_PORT;

    const parsed = this.parseAddress(addr);
    streamDeck.logger.debug("[setAddr]", { addr, parsed });

    if (parsed) {
      host = parsed[0];
      port = parsed[1];
    }

    if (host === this.ipcHost && port === this.ipcPort) {
      streamDeck.logger.debug("[setAddr] no changes");
      return;
    }

    this.ipcHost = host;
    this.ipcPort = port;

    streamDeck.logger.debug("[setAddr] changed to", host, port);

    if (this.state === "idle") {
      return;
    }

    this.stop();
    this.start();
  }

  parseAddress(addr?: string): [string, number] | null {
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
}
