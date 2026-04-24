(function () {
  const isResearchPage = window.location.pathname === "/dashboard/research" || window.location.pathname.startsWith("/dashboard/research/");

  if (!isResearchPage) {
    return;
  }

  const markerId = "furimane-extension-installed-marker";

  if (!document.getElementById(markerId)) {
    const marker = document.createElement("span");
    marker.id = markerId;
    marker.hidden = true;
    marker.setAttribute("data-installed", "true");
    document.documentElement.appendChild(marker);
  }

  const notifyPage = () => {
    window.dispatchEvent(
      new CustomEvent("furimane-extension-installed", {
        detail: {
          source: "furimane-extension"
        }
      })
    );
  };

  notifyPage();

  window.setTimeout(notifyPage, 300);
})();
