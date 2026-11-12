import {
  MessageFlags,
  type ButtonInteraction,
  type ChannelSelectMenuInteraction,
  type ModalSubmitInteraction,
  type RoleSelectMenuInteraction,
  type StringSelectMenuInteraction,
} from "discord.js";
import logger from "../../lib/logger";
import {
  handlePanelButton as runPanelButton,
  handlePanelModal as runPanelModal,
  handlePanelSelect as runPanelSelect,
} from "../../lib/panel";

/** The panel's own components — buttons, select menus and modals. */

export type PanelSelectInteraction =
  | StringSelectMenuInteraction
  | RoleSelectMenuInteraction
  | ChannelSelectMenuInteraction;

/** Panel buttons. */
export async function handlePanelButton(interaction: ButtonInteraction): Promise<void> {
  try {
    await runPanelButton(interaction);
  } catch (e) {
    logger.error("[PANEL] button handler error:", e);
    try {
      await interaction.reply({ content: "❌ เกิดข้อผิดพลาด", flags: MessageFlags.Ephemeral });
    } catch {
      /* ignore */
    }
  }
}

/** Panel select menus. */
export async function handlePanelSelect(interaction: PanelSelectInteraction): Promise<void> {
  try {
    await runPanelSelect(interaction);
  } catch (e) {
    logger.error("[PANEL] select handler error:", e);
    try {
      await interaction.reply({ content: "An error occurred", flags: MessageFlags.Ephemeral });
    } catch {
      /* ignore */
    }
  }
}

/** Panel modals. */
export async function handlePanelModal(interaction: ModalSubmitInteraction): Promise<void> {
  try {
    await runPanelModal(interaction);
  } catch (e) {
    logger.error("[PANEL] modal handler error:", e);
    try {
      await interaction.reply({ content: "❌ เกิดข้อผิดพลาด", flags: MessageFlags.Ephemeral });
    } catch {
      /* ignore */
    }
  }
}
