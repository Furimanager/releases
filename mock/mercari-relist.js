(() => {
  const params = new URLSearchParams(location.search);
  const title = params.get("title");
  const titleElement = document.getElementById("mockTaskTitle");

  if (title && titleElement) {
    titleElement.textContent = title;
  }

  const detected = Boolean(document.querySelector('[data-testid="relist-button"]'));

  chrome.runtime.sendMessage({
    type: "MOCK_RELIST_BUTTON_DETECTED",
    taskId: params.get("taskId"),
    detected
  });
})();
