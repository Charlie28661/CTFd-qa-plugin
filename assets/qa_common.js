/* CTFd Q&A plugin shared helpers: API calls, polling, DOM building.
 * All user-supplied text is inserted via textContent to prevent XSS. */
(function () {
  "use strict";

  var root = (window.init && window.init.urlRoot) || "";

  function url(path) {
    return root + path;
  }

  function api(method, path, body) {
    var opts = {
      method: method,
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    };
    if (method !== "GET") {
      // CTFd's CSRF check requires non-GET requests to use Content-Type
      // application/json with a CSRF-Token header (DELETE included), so always send a JSON body.
      opts.headers["Content-Type"] = "application/json";
      opts.headers["CSRF-Token"] = (window.init && window.init.csrfNonce) || "";
      opts.body = JSON.stringify(body || {});
    }
    return fetch(url(path), opts).then(function (res) {
      var type = res.headers.get("Content-Type") || "";
      if (type.indexOf("application/json") === -1) {
        // Usually the session expired and we were redirected to the login page
        if (res.redirected || res.status === 403) {
          throw new Error("Your session has expired. Please reload the page.");
        }
        throw new Error("Server error (" + res.status + ")");
      }
      return res.json().then(function (json) {
        if (!res.ok || json.success === false) {
          throw new Error(json.message || "Something went wrong (" + res.status + ")");
        }
        return json.data;
      });
    });
  }

  /* Run fn (returns a Promise) periodically. Pauses while the tab is hidden and refreshes immediately when it becomes visible again.
   * Only one fn runs at a time, so responses are always applied in order. A refresh requested while
   * one is in flight (e.g. right after the user changed something) runs as soon as it finishes,
   * because the in-flight response may predate the change. */
  function poller(fn, interval) {
    var timer = null;
    var running = false;
    var pending = false;

    function tick() {
      clearTimeout(timer);
      if (document.hidden) {
        return;
      }
      if (running) {
        pending = true;
        return;
      }
      running = true;
      Promise.resolve()
        .then(fn)
        .catch(function (e) {
          console.warn("[ctfd-qa]", e);
        })
        .then(function () {
          running = false;
          if (pending) {
            pending = false;
            tick();
          } else {
            timer = setTimeout(tick, interval);
          }
        });
    }

    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) tick();
    });
    tick();
    return { refresh: tick };
  }

  /* el("div", {class: "x", onclick: fn}, ["text", childNode]) */
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (key) {
      var value = attrs[key];
      if (value === null || value === undefined || value === false) return;
      if (key === "class") node.className = value;
      else if (key === "text") node.textContent = value;
      else if (key.indexOf("on") === 0 && typeof value === "function")
        node.addEventListener(key.slice(2), value);
      else if (key === "style" && typeof value === "object")
        Object.assign(node.style, value);
      else if (value === true) node.setAttribute(key, "");
      else node.setAttribute(key, value);
    });
    [].concat(children || []).forEach(function (child) {
      if (child === null || child === undefined || child === false) return;
      node.appendChild(
        typeof child === "string" || typeof child === "number"
          ? document.createTextNode(String(child))
          : child
      );
    });
    return node;
  }

  /* plural(2, "vote") -> "2 votes" */
  function plural(n, word) {
    return n + " " + word + (n === 1 ? "" : "s");
  }

  function timeAgo(isoString) {
    var diff = (Date.now() - new Date(isoString).getTime()) / 1000;
    if (diff < 60) return "just now";
    if (diff < 3600) return plural(Math.floor(diff / 60), "minute") + " ago";
    if (diff < 86400) return plural(Math.floor(diff / 3600), "hour") + " ago";
    return new Date(isoString).toLocaleString();
  }

  var toastBox = null;
  function toast(message, kind) {
    if (!toastBox) {
      toastBox = el("div", { class: "qa-toasts" });
      document.body.appendChild(toastBox);
    }
    var item = el("div", {
      class: "qa-toast" + (kind === "error" ? " qa-toast-error" : ""),
      text: message,
    });
    toastBox.appendChild(item);
    setTimeout(function () {
      item.remove();
    }, 3500);
  }

  /* Poll result bar chart */
  function pollBars(poll, opts) {
    opts = opts || {};
    var total = poll.options.reduce(function (sum, o) {
      return sum + (o.votes || 0);
    }, 0);
    var max = poll.options.reduce(function (m, o) {
      return Math.max(m, o.votes || 0);
    }, 0);
    return el(
      "div",
      { class: "qa-bars" },
      poll.options.map(function (o) {
        var votes = o.votes || 0;
        var pct = total ? Math.round((votes / total) * 100) : 0;
        var mine = (poll.my_votes || []).indexOf(o.id) !== -1;
        return el(
          "div",
          {
            class:
              "qa-bar" +
              (votes && votes === max ? " qa-bar-top" : "") +
              (mine && !opts.hideMine ? " qa-bar-mine" : ""),
          },
          [
            el("div", { class: "qa-bar-label" }, [
              el("span", { class: "qa-bar-text", text: o.text }),
              el("span", { class: "qa-bar-num", text: pct + "% · " + plural(votes, "vote") }),
            ]),
            el("div", { class: "qa-bar-track" }, [
              el("div", { class: "qa-bar-fill", style: { width: pct + "%" } }),
            ]),
          ]
        );
      })
    );
  }

  window.CTFdQA = {
    url: url,
    api: api,
    poller: poller,
    el: el,
    plural: plural,
    timeAgo: timeAgo,
    toast: toast,
    pollBars: pollBars,
  };
})();
