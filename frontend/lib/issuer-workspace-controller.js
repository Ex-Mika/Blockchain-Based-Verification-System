export function createIssuerWorkspaceController({ state, elements, merkleTreeView }) {
  function bindEvents() {
    for (const button of elements.issuerViewButtons) {
      button.addEventListener("click", () => {
        showView(button.dataset.issuerViewButton || "batch");
      });
    }
  }

  function initialize() {
    showView(state.issuerWorkbenchView || "batch");
  }

  function showView(viewName) {
    const nextView = resolveViewName(viewName, elements.issuerViews);
    state.issuerWorkbenchView = nextView;

    for (const button of elements.issuerViewButtons) {
      const isActive = button.dataset.issuerViewButton === nextView;

      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-selected", isActive ? "true" : "false");
      button.tabIndex = isActive ? 0 : -1;
    }

    for (const view of elements.issuerViews) {
      const isActive = view.dataset.issuerView === nextView;

      view.classList.toggle("is-active", isActive);
      view.hidden = !isActive;
    }

    if (nextView === "tree" && state.merkleBuild) {
      window.requestAnimationFrame(() => {
        merkleTreeView.render(state.merkleBuild);
      });
    }
  }

  return {
    bindEvents,
    initialize,
    showView
  };
}

function resolveViewName(viewName, views) {
  if (views.some((view) => view.dataset.issuerView === viewName)) {
    return viewName;
  }

  return "batch";
}
