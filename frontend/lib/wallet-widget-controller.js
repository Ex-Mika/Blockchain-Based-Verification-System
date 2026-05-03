const DRAG_THRESHOLD = 6;
const VIEWPORT_MARGIN = 12;

export function createWalletWidgetController({ state, elements }) {
  let dragState = null;

  function bindEvents() {
    elements.walletWidgetToggle?.addEventListener("click", handleToggleClick);
    elements.walletWidgetHandle?.addEventListener("pointerdown", handlePointerDown);
    elements.walletWidgetHandle?.addEventListener("keydown", handleHandleKeyDown);
    window.addEventListener("resize", handleResize);
  }

  function initialize() {
    setWalletWidgetMinimized(Boolean(state.isWalletWidgetMinimized));
    syncFloatingPosition();
  }

  function handleToggleClick(event) {
    event.stopPropagation();
    toggleWalletWidget();
  }

  function handleHandleKeyDown(event) {
    if (!state.isWalletWidgetMinimized) {
      return;
    }

    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    event.preventDefault();
    setWalletWidgetMinimized(false);
  }

  function handlePointerDown(event) {
    if (event.button !== 0 || !elements.walletWidget || !elements.walletWidgetHandle) {
      return;
    }

    if (event.target.closest("#toggle-wallet-widget")) {
      return;
    }

    const rect = elements.walletWidget.getBoundingClientRect();
    dragState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      didDrag: false
    };

    elements.walletWidgetHandle.setPointerCapture?.(event.pointerId);
    elements.walletWidgetHandle.addEventListener("pointermove", handlePointerMove);
    elements.walletWidgetHandle.addEventListener("pointerup", handlePointerUp);
    elements.walletWidgetHandle.addEventListener("pointercancel", handlePointerCancel);
  }

  function handlePointerMove(event) {
    if (!dragState || event.pointerId !== dragState.pointerId || !elements.walletWidget) {
      return;
    }

    const deltaX = event.clientX - dragState.startX;
    const deltaY = event.clientY - dragState.startY;

    if (!dragState.didDrag && Math.hypot(deltaX, deltaY) < DRAG_THRESHOLD) {
      return;
    }

    if (!dragState.didDrag) {
      dragState.didDrag = true;
      elements.walletWidget.classList.add("is-dragging");
    }

    const nextLeft = clamp(
      dragState.left + deltaX,
      VIEWPORT_MARGIN,
      window.innerWidth - dragState.width - VIEWPORT_MARGIN
    );
    const nextTop = clamp(
      dragState.top + deltaY,
      VIEWPORT_MARGIN,
      window.innerHeight - dragState.height - VIEWPORT_MARGIN
    );

    state.walletWidgetPosition = { left: nextLeft, top: nextTop };
    applyFloatingPosition(nextLeft, nextTop);
  }

  function handlePointerUp(event) {
    if (!dragState || event.pointerId !== dragState.pointerId) {
      return;
    }

    const shouldExpand = state.isWalletWidgetMinimized && !dragState.didDrag;
    clearDragState(event.pointerId);

    if (shouldExpand) {
      setWalletWidgetMinimized(false);
    }
  }

  function handlePointerCancel(event) {
    if (!dragState || event.pointerId !== dragState.pointerId) {
      return;
    }

    clearDragState(event.pointerId);
  }

  function clearDragState(pointerId) {
    if (!elements.walletWidget || !elements.walletWidgetHandle) {
      dragState = null;
      return;
    }

    elements.walletWidget.classList.remove("is-dragging");
    elements.walletWidgetHandle.releasePointerCapture?.(pointerId);
    elements.walletWidgetHandle.removeEventListener("pointermove", handlePointerMove);
    elements.walletWidgetHandle.removeEventListener("pointerup", handlePointerUp);
    elements.walletWidgetHandle.removeEventListener("pointercancel", handlePointerCancel);
    dragState = null;
  }

  function handleResize() {
    syncFloatingPosition();
  }

  function toggleWalletWidget() {
    setWalletWidgetMinimized(!state.isWalletWidgetMinimized);
  }

  function setWalletWidgetMinimized(isMinimized) {
    state.isWalletWidgetMinimized = isMinimized;

    if (!elements.walletWidget || !elements.walletWidgetBody || !elements.walletWidgetToggle) {
      return;
    }

    elements.walletWidget.classList.toggle("is-minimized", isMinimized);
    elements.walletWidgetBody.hidden = isMinimized;
    elements.walletWidgetToggle.hidden = isMinimized;
    elements.walletWidgetToggle.setAttribute("aria-expanded", isMinimized ? "false" : "true");
    elements.walletWidgetToggle.setAttribute(
      "aria-label",
      isMinimized ? "Expand wallet console" : "Minimize wallet console"
    );
    setHandleAccessibility(isMinimized);

    window.requestAnimationFrame(() => {
      syncFloatingPosition();
    });
  }

  function setHandleAccessibility(isMinimized) {
    if (!elements.walletWidgetHandle) {
      return;
    }

    if (isMinimized) {
      elements.walletWidgetHandle.setAttribute("role", "button");
      elements.walletWidgetHandle.tabIndex = 0;
      elements.walletWidgetHandle.setAttribute("aria-label", "Expand wallet console");
      return;
    }

    elements.walletWidgetHandle.removeAttribute("role");
    elements.walletWidgetHandle.removeAttribute("aria-label");
    elements.walletWidgetHandle.tabIndex = -1;
  }

  function syncFloatingPosition() {
    if (!elements.walletWidget) {
      return;
    }

    if (!state.walletWidgetPosition) {
      clearFloatingPosition();
      return;
    }

    const rect = elements.walletWidget.getBoundingClientRect();
    const nextLeft = clamp(
      state.walletWidgetPosition.left,
      VIEWPORT_MARGIN,
      window.innerWidth - rect.width - VIEWPORT_MARGIN
    );
    const nextTop = clamp(
      state.walletWidgetPosition.top,
      VIEWPORT_MARGIN,
      window.innerHeight - rect.height - VIEWPORT_MARGIN
    );

    state.walletWidgetPosition = { left: nextLeft, top: nextTop };
    applyFloatingPosition(nextLeft, nextTop);
  }

  function applyFloatingPosition(left, top) {
    if (!elements.walletWidget) {
      return;
    }

    elements.walletWidget.style.left = `${left}px`;
    elements.walletWidget.style.top = `${top}px`;
    elements.walletWidget.style.right = "auto";
    elements.walletWidget.style.bottom = "auto";
  }

  function clearFloatingPosition() {
    if (!elements.walletWidget) {
      return;
    }

    elements.walletWidget.style.left = "";
    elements.walletWidget.style.top = "";
    elements.walletWidget.style.right = "";
    elements.walletWidget.style.bottom = "";
  }

  return {
    bindEvents,
    initialize
  };
}

function clamp(value, min, max) {
  if (max < min) {
    return min;
  }

  return Math.min(Math.max(value, min), max);
}
