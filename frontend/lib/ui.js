const TOAST_STACK_ID = "app-toast-stack";
const TOAST_DISMISS_MS = {
  neutral: 3200,
  success: 3600,
  warning: 4200,
  error: 5200
};

export function setStatus(element, variant, message) {
  if (!element) {
    return;
  }

  renderStatus(element, variant, message);
}

export function resetStatus(element) {
  if (!element) {
    return;
  }

  renderStatus(
    element,
    element.dataset.defaultVariant || "neutral",
    element.dataset.defaultMessage || ""
  );
}

export function showToast(variant, message, options = {}) {
  if (!message) {
    return;
  }

  const toastStack = getToastStack();
  const toast = document.createElement("div");
  const toastMessage = document.createElement("p");
  const toastController = createToastController(toast, toastMessage);

  toastMessage.className = "toast-message";
  toast.append(toastMessage);
  toastStack.append(toast);

  window.requestAnimationFrame(() => {
    toast.classList.add("is-visible");
  });

  toastController.update(variant, message, options);
  return toastController;
}

export function humanizeError(error) {
  if (!error) {
    return "Unknown error.";
  }

  if (typeof error === "string") {
    return error;
  }

  if (error.shortMessage) {
    return error.shortMessage;
  }

  if (error.message?.includes("too big to be stored in a QR Code")) {
    return "The verification payload is still too large for a scannable QR code. Reduce the batch proof size or move to a lookup-based verification link.";
  }

  if (error.message) {
    return error.message;
  }

  return "Unexpected error.";
}

export function shortenAddress(address) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function shortenHash(hash) {
  return `${hash.slice(0, 10)}...${hash.slice(-8)}`;
}

export function formatNetworkName(networkName) {
  if (!networkName || networkName === "unknown") {
    return "Detected network";
  }

  return networkName;
}

function renderStatus(element, variant, message) {
  const nextMessage = message || "";

  element.textContent = nextMessage;
  element.className = `status-message status-${variant}`;
  element.hidden = !nextMessage;
}

function getToastStack() {
  let toastStack = document.querySelector(`#${TOAST_STACK_ID}`);
  if (toastStack) {
    return toastStack;
  }

  toastStack = document.createElement("div");
  toastStack.id = TOAST_STACK_ID;
  toastStack.className = "toast-stack";
  document.body.append(toastStack);
  return toastStack;
}

function createToastController(toast, toastMessage) {
  let dismissTimer = null;
  let removeTimer = null;

  function clearTimers() {
    if (dismissTimer) {
      window.clearTimeout(dismissTimer);
      dismissTimer = null;
    }

    if (removeTimer) {
      window.clearTimeout(removeTimer);
      removeTimer = null;
    }
  }

  function applyState(variant, message) {
    toast.className = `toast toast-${variant}`;
    toast.setAttribute("role", variant === "error" ? "alert" : "status");
    toast.setAttribute("aria-live", variant === "error" ? "assertive" : "polite");
    toastMessage.textContent = message;
  }

  function scheduleDismiss(variant, dismissMs) {
    dismissTimer = window.setTimeout(() => {
      toast.classList.remove("is-visible");
      removeTimer = window.setTimeout(() => {
        toast.remove();
      }, 180);
    }, dismissMs ?? TOAST_DISMISS_MS[variant] ?? TOAST_DISMISS_MS.neutral);
  }

  return {
    update(variant, message, options = {}) {
      if (!message) {
        return;
      }

      clearTimers();
      applyState(variant, message);

      if (!options.persistent) {
        scheduleDismiss(variant, options.dismissMs);
      }
    },
    dismiss() {
      clearTimers();
      toast.classList.remove("is-visible");
      removeTimer = window.setTimeout(() => {
        toast.remove();
      }, 180);
    }
  };
}
