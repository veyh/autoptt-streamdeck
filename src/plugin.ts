import streamDeck from "@elgato/streamdeck";
import { ActivityState } from "./actions/activity-state";

streamDeck.logger.setLevel("trace");

const activityStateAction = new ActivityState;
streamDeck.actions.registerAction(activityStateAction);

streamDeck.system.onApplicationDidLaunch(ev => {
  activityStateAction.onApplicationDidLaunch(ev);
});

streamDeck.connect();
