# autoptt-ipc

This is the Javascript version of the AutoPTT IPC. 

## Usage

Tiny example

```ts
import IPC from "autoptt-ipc/IPC";
import { Ipc as AutopttIpc, ActivityState } from "autoptt-ipc/autoptt";

const ipc = new IPC;

ipc.onStateChanged = () => {
  console.log(`state changed to ${ipc.state}`); 
};

ipc.onMessageHook = (msg: AutopttIpc) => {
  if (msg.activityStateChanged) {
    const text = (msg.activityStateChanged.aggregateState === ActivityState.INACTIVE)
      ? "mic inactive"
      : "mic active";

    console.log(text);
  }
};

ipc.start();
```

For actual projects this is used in, look here

- [veyh/autoptt-bitfocus-companion](https://github.com/veyh/autoptt-bitfocus-companion/blob/master/src/main.ts)
- [veyh/autoptt-streamdeck](https://github.com/veyh/autoptt-streamdeck/blob/master/src/actions/activity-state.ts)

