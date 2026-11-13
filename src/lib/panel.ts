/**
 * The server configuration panel.
 *
 * The implementation lives in the `src/lib/panel/` folder — `builders.ts`
 * renders the containers, `button.ts` / `select.ts` / `modal.ts` handle the
 * three interaction kinds. This file stays the public entry point so the
 * existing imports (`from "../lib/panel"`) keep working.
 */
export {
  buildComingSoonPanel,
  buildMainMenu,
  buildProtectPanel,
  buildStatusPanel,
  buildVerifyEditModal,
  buildVerifyPanel,
  buildVerifyPublicContainer,
} from "./panel/builders";
export { handlePanelButton, protectButtonAction, type ProtectButtonAction } from "./panel/button";
export { handlePanelModal } from "./panel/modal";
export { handlePanelSelect, type PanelSelectInteraction } from "./panel/select";
export { deny, isAdmin } from "./panel/shared";
