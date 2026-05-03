import { getVerifierElements } from "./lib/elements.js";
import { createVerifierController } from "./lib/verifier-controller.js";

const elements = getVerifierElements();
const verifierController = createVerifierController({ elements });

function init() {
  verifierController.bindEvents();
  verifierController.initialize();
}

init();
