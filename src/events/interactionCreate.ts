import { Events, type Interaction } from "discord.js";
import { handleAutocomplete, handleSlashCommand } from "./interactionCreate/command";
import {
  handlePanelButton,
  handlePanelModal,
  handlePanelSelect,
  type PanelSelectInteraction,
} from "./interactionCreate/panel";
import { handleVerifyButton, handleVerifyModal } from "./interactionCreate/verify";

export const name = Events.InteractionCreate;

export async function execute(interaction: Interaction) {
  // ─── Slash Commands ────────────────────────────────────────────────────────
  if (interaction.isChatInputCommand()) {
    await handleSlashCommand(interaction);
    return;
  }

  // ─── Autocomplete ──────────────────────────────────────────────────────────
  if (interaction.isAutocomplete()) {
    await handleAutocomplete(interaction);
    return;
  }

  // ─── Button Interactions ───────────────────────────────────────────────────
  if (interaction.isButton()) {
    if (interaction.customId.startsWith("panel:")) {
      await handlePanelButton(interaction);
      return;
    }
    // User pressed the "Verify" button on the verification panel
    if (
      interaction.customId === "verify_start" ||
      interaction.customId === "verify_enter_code"
    ) {
      await handleVerifyButton(interaction);
      return;
    }
    return;
  }

  // ─── String / Role / Channel Select Menus ──────────────────────────────────
  if (isPanelSelect(interaction)) {
    await handlePanelSelect(interaction);
    return;
  }

  // ─── Modal Submissions ─────────────────────────────────────────────────────
  if (interaction.isModalSubmit()) {
    if (interaction.customId.startsWith("panel:")) {
      await handlePanelModal(interaction);
      return;
    }
    if (
      interaction.customId === "verify_modal_submit" ||
      interaction.customId === "verify_code_modal_submit"
    ) {
      await handleVerifyModal(interaction);
    }
  }
}

/** Is this one of the panel's select menus? */
function isPanelSelect(interaction: Interaction): interaction is PanelSelectInteraction {
  return (
    (interaction.isStringSelectMenu() ||
      interaction.isRoleSelectMenu() ||
      interaction.isChannelSelectMenu()) &&
    interaction.customId.startsWith("panel:")
  );
}
