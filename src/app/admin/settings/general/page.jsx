"use client";

import SettingsForm from "../_components/SettingsForm";
import { settingsPages } from "../_components/settingsData";

export default function GeneralSettingsPage() {
  return <SettingsForm config={settingsPages.general} />;
}
