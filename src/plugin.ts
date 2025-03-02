import streamDeck, { LogLevel } from "@elgato/streamdeck";
import { ActivityState } from "./actions/activity-state";

streamDeck.logger.setLevel(LogLevel.TRACE);

const activityStateAction = new ActivityState;
streamDeck.actions.registerAction(activityStateAction);

streamDeck.system.onApplicationDidLaunch(ev => {
  activityStateAction.onApplicationDidLaunch(ev);
});

streamDeck.connect();
