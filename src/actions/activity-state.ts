import streamDeck, { Action, action, ApplicationDidLaunchEvent, DidReceiveSettingsEvent, KeyDownEvent, KeyUpEvent, SendToPluginEvent, SingletonAction, WillAppearEvent, WillDisappearEvent } from "@elgato/streamdeck";
import IPC from "../IPC";
import {
	ActivationMode as AutopttActivationMode,
	ActivityState as AutopttActivityState,
	AppEnabledState as AutopttAppEnabledState,
	Ipc as AutopttIpc,
} from "../autoptt";

type Settings = {
	ipcAddress?: string;
	onKeyDown?: OnKeyDownAction;
	keyGroupCount?: number;
};

type OnKeyDownAction =
	| "mode:voice-activity"
	| "mode:tap"
	| "mode:manual"
	| "mode:om2ptt-tap"
	| "mode:om2ptt-manual"
	| "swap:manual-voice"
	| "swap:manual-tap"
	| "swap:manual-om2ptt-manual"
	| "ptm-global"
	| string;

@action({ UUID: "com.autoptt.streamdeck.activity-state" })
export class ActivityState extends SingletonAction<Settings> {
	contexts: {
		[actionId: string]: Context
	} = {};

	onApplicationDidLaunch(_ev: ApplicationDidLaunchEvent) {
		for (const cx of Object.values(this.contexts)) {
			cx.ipc.start();
		}
	}

	override onWillAppear(ev: WillAppearEvent<Settings>): void | Promise<void> {
		if (!this.contexts[ev.action.id]) {
			this.contexts[ev.action.id] = new Context(this, ev.action.id);
		}

		const cx = this.contexts[ev.action.id];

		cx.ipc.setAddr(ev.payload.settings.ipcAddress);
		cx.ipc.start();
		cx.updateIcon(true);
		cx.updateTitle(true);
	}

	override onWillDisappear(ev: WillDisappearEvent<Settings>): void | Promise<void> {
		const cx = this.contexts[ev.action.id];

		if (cx) {
			cx.ipc.stop();
			delete this.contexts[ev.action.id];
		}
	}

	override async onKeyDown(ev: KeyDownEvent<Settings>): Promise<void> {
		const cx = this.contexts[ev.action.id];

		if (!cx) {
			return;
		}

		if (cx.ipc.serverIpcVersion !== IPC.VERSION) {
			return;
		}

		const settings = await ev.action.getSettings();

		switch (settings.onKeyDown) {
			case "mode:voice-activity": {
				return cx.ipc.setActivationMode(AutopttActivationMode.AUTOMATIC);
			}

			case "mode:tap": {
				return cx.ipc.setActivationMode(AutopttActivationMode.TAP_PTT);
			}

			case "mode:manual": {
				return cx.ipc.setActivationMode(AutopttActivationMode.MANUAL);
			}

			case "mode:om2ptt-tap": {
				return cx.ipc.setActivationMode(AutopttActivationMode.TAP_OPEN_MIC_TO_PTT);
			}

			case "mode:om2ptt-manual": {
				return cx.ipc.setActivationMode(AutopttActivationMode.MANUAL_OPEN_MIC_TO_PTT);
			}

			case "swap:manual-voice": {
				if (cx.ipc.settings?.activationMode === AutopttActivationMode.MANUAL) {
					return cx.ipc.setActivationMode(AutopttActivationMode.AUTOMATIC);
				}

				return cx.ipc.setActivationMode(AutopttActivationMode.MANUAL);
			}

			case "swap:manual-tap": {
				if (cx.ipc.settings?.activationMode === AutopttActivationMode.MANUAL) {
					return cx.ipc.setActivationMode(AutopttActivationMode.TAP_PTT);
				}

				return cx.ipc.setActivationMode(AutopttActivationMode.MANUAL);
			}

			case "swap:manual-om2ptt-manual": {
				if (cx.ipc.settings?.activationMode === AutopttActivationMode.MANUAL) {
					return cx.ipc.setActivationMode(AutopttActivationMode.MANUAL_OPEN_MIC_TO_PTT);
				}

				return cx.ipc.setActivationMode(AutopttActivationMode.MANUAL);
			}

			case "ptm-global": {
				if (!settings.onKeyDown) {
					break;
				}

				return cx.ipc.setPushToMuteGlobalDown(true);
			}

			default: {
				if (!settings.onKeyDown) {
					break;
				}

				if (settings.onKeyDown.startsWith("ptt:")) {
					const [_key, indexStr] = settings.onKeyDown.split(":");
					const index = parseInt(indexStr);
					return cx.ipc.setPushToTalkDown(index, true);
				}

				if (settings.onKeyDown.startsWith("ptm:")) {
					const [_key, indexStr] = settings.onKeyDown.split(":");
					const index = parseInt(indexStr);
					return cx.ipc.setPushToMuteDown(index, true);
				}

				break;
			}
		}
	}

	override async onKeyUp(ev: KeyUpEvent<Settings>): Promise<void> {
		const cx = this.contexts[ev.action.id];

		if (!cx) {
			return;
		}

		if (cx.ipc.serverIpcVersion !== IPC.VERSION) {
			return;
		}

		const settings = await ev.action.getSettings();

		if (!settings.onKeyDown) {
			return;
		}

		if (settings.onKeyDown === "ptm-global") {
			return cx.ipc.setPushToMuteGlobalDown(false);
		}

		if (settings.onKeyDown.startsWith("ptt:")) {
			const [_key, indexStr] = settings.onKeyDown.split(":");
			const index = parseInt(indexStr);
			return cx.ipc.setPushToTalkDown(index, false);
		}

		if (settings.onKeyDown.startsWith("ptm:")) {
			const [_key, indexStr] = settings.onKeyDown.split(":");
			const index = parseInt(indexStr);
			return cx.ipc.setPushToMuteDown(index, false);
		}
	}

	override onDidReceiveSettings(ev: DidReceiveSettingsEvent<Settings>): void {
		const cx = this.contexts[ev.action.id];

		if (cx) {
			cx.ipc.setAddr(ev.payload.settings.ipcAddress);
			cx.ipc.start();
		}
	}

	override onSendToPlugin(ev: SendToPluginEvent<any, Settings>) {
		streamDeck.logger.debug("[onSendToPlugin]", ev);

		if (ev.type === "sendToPlugin"
		&& ev.payload.event === "getOnKeyDownOptions") {
			this.updatePropertyInspector(ev.action);
		}
	}

	async updatePropertyInspector(action: Action<Settings>) {
		const cx = this.contexts[action.id];

		if (!cx) {
			return;
		}

		let keyGroupCount = await this.updateKeyGroupCount(action, cx);
		let hotkeyActions = [];

		for (let i = 0; i < keyGroupCount; i++) {
			hotkeyActions.push({ value: `ptt:${i}`, label: `Push-to-Talk ${i + 1}` });
			hotkeyActions.push({ value: `ptm:${i}`, label: `Push-to-Mute ${i + 1}` });
		}

		hotkeyActions.push({ value: "ptm-global", label: "Push-to-Mute (Global)" });

		streamDeck.ui.current?.sendToPropertyInspector({
			event: "getOnKeyDownOptions",
			items: [{
				label: "Set Activity Mode",
				children: [
					{ value: "mode:voice-activity", label: "Mode: Voice Activity" },
					{ value: "mode:tap",            label: "Mode: Tap" },
					{ value: "mode:manual",         label: "Mode: Manual" },
					{ value: "mode:om2ptt-tap",     label: "Mode: Open Mic to PTT (Tap)" },
					{ value: "mode:om2ptt-manual",  label: "Mode: Open Mic to PTT (Manual)" },
				],
			}, {
				label: "Swap Activity Mode",
				children: [
					{ value: "swap:manual-voice",
					  label: "Mode: Manual/Voice (\"Toggle Mute via PTT\")" },
					{ value: "swap:manual-tap",
					  label: "Mode: Manual/Tap" },
					{ value: "swap:manual-om2ptt-manual",
					  label: "Mode: Manual/Open Mic to PTT (Manual) (\"Toggle Mute via Open Mic\")" },
				],
			}, {
				label: "Hotkey",
				children: hotkeyActions,
			}],
		});
	}

	async updateKeyGroupCount(action: Action<Settings>, cx: Context): Promise<number> {
		let settings = await action.getSettings();
		let keyGroupCount = 0;

		if (cx.ipc.state === "connected") {
			keyGroupCount = cx.ipc.settings?.keyGroups.length ?? 0;
		}

		else {
			keyGroupCount = settings.keyGroupCount ?? 0;
		}

		await action.setSettings({ ...settings, keyGroupCount });

		return keyGroupCount;
	}
}

class Context {
	parent: ActivityState;
	actionId: string;

	ipc = new IPC;
	icon = "";
	title = "";

	constructor(parent: ActivityState, actionId: string) {
		this.parent = parent;
		this.actionId = actionId;

		this.ipc.onMessageHook = this.onIpcMessage;
		this.ipc.onStateChanged = this.onIpcStateChanged;

		this.updateIcon();
		this.updateTitle();
	}

	onIpcMessage = (msg: AutopttIpc) => {
		if (msg.settingsChanged || msg.muteStateChanged || msg.activityStateChanged) {
			this.updateIcon();
		}

		if (msg.settingsChanged) {
			this.updateTitle();
		}

		if (msg.appEnabledStateChanged) {
			this.updateIcon();
			this.updateTitle();
		}
	};

	onIpcStateChanged = () => {
		this.updateIcon();
		this.updateTitle();
	};

	updateIcon(force?: boolean) {
		const newIcon = this.getIcon();

		if (newIcon === this.icon && !force) {
			return;
		}

		this.getAction()?.setImage(newIcon);
		this.icon = newIcon;
	}

	getIcon() {
		if (this.ipc.state !== "connected") {
			return "imgs/actions/activity-state/autoptt-logo-4-scaled-gray-50-opacity-60pct.png";
		}

		if (this.ipc.serverIpcVersion !== IPC.VERSION) {
			return "imgs/actions/activity-state/autoptt-logo-4-scaled-gray-50-opacity-60pct.png";
		}

		if (this.ipc.isMuted) {
			return "imgs/actions/activity-state/autoptt-logo-4-scaled-red-60pct.png";
		}

		switch (this.ipc.aggregateActivityState) {
			case AutopttActivityState.ACTIVE:
				return "imgs/actions/activity-state/autoptt-logo-4-scaled-green-60pct.png";

			case AutopttActivityState.ACTIVE_RELEASE_DELAY:
			case AutopttActivityState.ACTIVE_TAP_ACTIVATION_WINDOW:
				return "imgs/actions/activity-state/autoptt-logo-4-scaled-yellow-60pct.png";

			default:
			case AutopttActivityState.INACTIVE:
				return "imgs/actions/activity-state/autoptt-logo-4-scaled-gray-50-opacity-60pct.png";
		}
	}

	updateTitle(force?: boolean) {
		const newTitle = this.getTitle();

		if (this.title === newTitle && !force) {
			return;
		}

		this.getAction()?.setTitle(newTitle);
		this.title = newTitle;
	}

	getTitle() {
		if (this.ipc.state !== "connected") {
			return "Not Conn";
		}

		if (this.ipc.serverIpcVersion < IPC.VERSION) {
			return "Not\nCompatible\nUpdate\nAutoPTT";
		}

		if (this.ipc.serverIpcVersion > IPC.VERSION) {
			return "Not\nCompatible\nUpdate\nPlugin";
		}

		if (this.ipc.appEnabledState === AutopttAppEnabledState.DISABLED_BLOCKED_BY_GUI) {
			return "Blocked\nby GUI";
		}

		if (this.ipc.appEnabledState === AutopttAppEnabledState.DISABLED_INVALID_LICENSE) {
			return "Invalid\nLicense";
		}

		switch (this.ipc.settings?.activationMode) {
			case AutopttActivationMode.AUTOMATIC:
				return "VA";

			case AutopttActivationMode.MANUAL:
				return "PTT";

			case AutopttActivationMode.TAP_PTT:
				return "Tap";

			case AutopttActivationMode.MANUAL_OPEN_MIC_TO_PTT:
				return "OM2PTT";

			case AutopttActivationMode.TAP_OPEN_MIC_TO_PTT:
				return "OM2Tap";

			default:
				return "";
		}
	}

	getAction() {
		for (const action of this.parent.actions) {
			if (action.id === this.actionId) {
				return action;
			}
		}

		return null;
	}
}
