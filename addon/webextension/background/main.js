/* globals browser, console, XMLHttpRequest, Image, document, setTimeout, navigator */
/* globals selectorLoader, analytics, communication, catcher, makeUuid, auth */

"use strict";

var main = (function () {
  let exports = {};

  const pasteSymbol = (window.navigator.platform.match(/Mac/i)) ? "\u2318" : "Ctrl";
  const { sendEvent } = analytics;

  let manifest = browser.runtime.getManifest();
  let backend;

  let hasSeenOnboarding;

  browser.storage.local.get(["hasSeenOnboarding"]).then((result) => {
    hasSeenOnboarding = !! result.hasSeenOnboarding;
    if (! hasSeenOnboarding) {
      setIconActive(false, null);
    }
  }).catch((error) => {
    console.error("Error getting hasSeenOnboarding:", error);
  });

  exports.setBackend = function (newBackend) {
    backend = newBackend;
    backend = backend.replace(/\/*$/, "");
  };

  exports.getBackend = function () {
    return backend;
  };

  function getOnboardingUrl() {
    return backend + "/#hello";
  }

  for (let permission of manifest.permissions) {
    if (/^https?:\/\//.test(permission)) {
      exports.setBackend(permission);
      break;
    }
  }

  function setIconActive(active, tabId) {
    let path = active ? "icons/icon-highlight-38.png" : "icons/icon-38.png";
    if ((! hasSeenOnboarding) && ! active) {
      path = "icons/icon-starred-38.png";
    }
    browser.browserAction.setIcon({path, tabId});
  }

  function toggleSelector(tab) {
    return analytics.refreshTelemetryPref()
      .then(() => selectorLoader.toggle(tab.id, hasSeenOnboarding))
      .then(active => {
        setIconActive(active, tab.id);
        return active;
      })
      .catch((error) => {
        error.popupMessage = "UNSHOOTABLE_PAGE";
        throw error;
      });
  }

  function shouldOpenMyShots(url) {
    return /^about:(?:newtab|blank)/i.test(url) || /^resource:\/\/activity-streams\//i.test(url);
  }

  browser.browserAction.onClicked.addListener(catcher.watchFunction((tab) => {
    if (shouldOpenMyShots(tab.url)) {
      if (! hasSeenOnboarding) {
        catcher.watchPromise(analytics.refreshTelemetryPref().then(() => {
          sendEvent("goto-onboarding", "selection-button");
          return forceOnboarding();
        }));
        return;
      }
      catcher.watchPromise(analytics.refreshTelemetryPref().then(() => {
        sendEvent("goto-myshots", "about-newtab");
      }));
      catcher.watchPromise(
        auth.authHeaders()
        .then(() => browser.tabs.update({url: backend + "/shots"})));
    } else {
      catcher.watchPromise(
        toggleSelector(tab)
          .then(active => {
            const event = active ? "start-shot" : "cancel-shot";
            sendEvent(event, "toolbar-button");
          }, (error) => {
            if (error.popupMessage == "UNSHOOTABLE_PAGE") {
              sendEvent("goto-onboarding", "selection-button");
              return forceOnboarding();
            }
            throw error;
          }));
    }
  }));

  function forceOnboarding() {
    return browser.tabs.create({url: getOnboardingUrl()}).then((tab) => {
      return toggleSelector(tab);
    });
  }

  browser.contextMenus.create({
    id: "create-screenshot",
    title: browser.i18n.getMessage("contextMenuLabel"),
    contexts: ["page"],
    documentUrlPatterns: ["<all_urls>"]
  });

  browser.contextMenus.onClicked.addListener(catcher.watchFunction((info, tab) => {
    if (! tab) {
      // Not in a page/tab context, ignore
      return;
    }
    catcher.watchPromise(
      toggleSelector(tab)
        .then(() => sendEvent("start-shot", "context-menu")));
  }));

  function urlEnabled(url) {
    if (shouldOpenMyShots(url)) {
      return true;
    }
    if (url.startsWith(backend) || /^(?:about|data|moz-extension):/i.test(url)) {
      return false;
    }
    return true;
  }

  browser.tabs.onActivated.addListener(catcher.watchFunction(({tabId, windowId}) => {
    catcher.watchPromise(browser.tabs.get(tabId).then((tab) => {
      // onActivated may fire before the url is set
      if (!tab.url) {
        return;
      }
      if (urlEnabled(tab.url)) {
        browser.browserAction.enable(tabId);
      } else {
        browser.browserAction.disable(tabId);
      }
    }));
  }));

  browser.tabs.onUpdated.addListener(catcher.watchFunction((id, info, tab) => {
    if (info.url && tab.active) {
      if (urlEnabled(info.url)) {
        browser.browserAction.enable(tab.id);
      } else if (hasSeenOnboarding) {
        browser.browserAction.disable(tab.id);
      }
    }
  }));

  communication.register("sendEvent", (sender, ...args) => {
    catcher.watchPromise(sendEvent(...args));
    // We don't wait for it to complete:
    return null;
  });

  communication.register("openMyShots", (sender) => {
    return catcher.watchPromise(
      auth.authHeaders()
      .then(() => browser.tabs.create({url: backend + "/shots"})));
  });

  communication.register("openShot", (sender, {url, copied}) => {
    if (copied) {
      const id = makeUuid();
      return browser.notifications.create(id, {
        type: "basic",
        iconUrl: "../icons/copy.png",
        title: browser.i18n.getMessage("notificationLinkCopiedTitle"),
        message: browser.i18n.getMessage("notificationLinkCopiedDetails", pasteSymbol)
      });
    }
  });

  communication.register("downloadShot", (sender, info) => {
    // 'data:' urls don't work directly, let's use a Blob
    // see http://stackoverflow.com/questions/40269862/save-data-uri-as-file-using-downloads-download-api
    const binary = atob(info.url.split(',')[1]); // just the base64 data
    const data = Uint8Array.from(binary, char => char.charCodeAt(0))
    const blob = new Blob([data], {type: "image/png"})
    return browser.downloads.download({
      url: URL.createObjectURL(blob),
      filename: info.filename
    });
  });

  communication.register("closeSelector", (sender) => {
    setIconActive(false, sender.tab.id)
  });

  catcher.watchPromise(communication.sendToBootstrap("getOldDeviceInfo").then((deviceInfo) => {
    if (deviceInfo === communication.NO_BOOTSTRAP || ! deviceInfo) {
      return;
    }
    deviceInfo = JSON.parse(deviceInfo);
    if (deviceInfo && typeof deviceInfo == "object") {
      return auth.setDeviceInfoFromOldAddon(deviceInfo).then((updated) => {
        if (updated === communication.NO_BOOTSTRAP) {
          throw new Error("bootstrap.js disappeared unexpectedly");
        }
        if (updated) {
          return communication.sendToBootstrap("removeOldAddon");
        }
      });
    }
  }));

  communication.register("hasSeenOnboarding", () => {
    hasSeenOnboarding = true;
    catcher.watchPromise(browser.storage.local.set({hasSeenOnboarding}));
    setIconActive(false, null);
  });

  return exports;
})();
