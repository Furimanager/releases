(() => {
  const params = new URLSearchParams(location.search);
  const detected = Boolean(document.querySelector('[data-testid="relist-button"]'));

  chrome.runtime.sendMessage({
    type: "MOCK_RELIST_BUTTON_DETECTED",
    nonce: params.get("nonce"),
    detected
  });
})();
