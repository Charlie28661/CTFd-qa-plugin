/* Presentation mode: large-type view of top questions or poll results.
 * The current view is stored in localStorage, so pressing "Present" in the admin panel
 * switches the presentation window on the same computer. */
(function () {
  "use strict";

  var S = window.CTFdQA;
  var el = S.el;
  var body = document.getElementById("qa-present");
  var eventId = body.dataset.eventId;
  var KEY = "qa-present-" + eventId;
  var MAX_QUESTIONS = 6;

  var qaBox = document.getElementById("sp-qa");
  var pollBox = document.getElementById("sp-poll");
  var select = document.getElementById("sp-poll-select");
  var hideBtn = document.getElementById("sp-hide-results");
  var qaBtn = document.querySelector('.sp-controls [data-mode="qa"]');

  var state = null;
  // view: {mode: "qa" | "poll", pollId, hideResults}
  var view = { mode: "qa", pollId: null, hideResults: false };

  function loadView() {
    try {
      var saved = JSON.parse(localStorage.getItem(KEY) || "null");
      if (saved) {
        view.mode = saved.mode === "poll" ? "poll" : "qa";
        view.pollId = saved.pollId || null;
        view.hideResults = !!saved.hideResults;
      }
    } catch (e) {}
  }

  function saveView() {
    try {
      localStorage.setItem(KEY, JSON.stringify(view));
    } catch (e) {}
  }

  function setView(patch) {
    Object.assign(view, patch);
    saveView();
    render();
  }

  // ---------- Q&A ----------
  function renderQA() {
    var list = state.questions
      .filter(function (q) { return !q.is_hidden && !q.is_answered; })
      .slice(0, MAX_QUESTIONS);
    var pending = state.questions.filter(function (q) { return !q.is_hidden && !q.is_answered; }).length;

    qaBox.replaceChildren(
      el("div", { class: "sp-section-head" }, [
        el("h2", { text: "Top questions" }),
        el("span", { text: pending + " pending" }),
      ])
    );
    if (!list.length) {
      qaBox.appendChild(el("p", { class: "sp-empty", text: state.event.qa_open ? "No questions yet. Ask away!" : "Questions are closed" }));
      return;
    }
    list.forEach(function (q) {
      qaBox.appendChild(
        el("div", { class: "sp-question" + (q.is_pinned ? " is-pinned" : "") }, [
          el("div", { class: "sp-votes" }, [el("span", { text: "▲" }), el("strong", { text: q.upvotes })]),
          el("div", { class: "sp-q-body" }, [
            el("div", { class: "sp-q-content", text: q.content }),
            el("div", { class: "sp-q-author" }, [
              // Respect anonymity on the projected screen
              q.is_anonymous ? "Anonymous" : q.user_name,
              q.is_pinned ? el("span", { class: "sp-pin", text: "Pinned" }) : null,
            ]),
          ]),
          el("button", {
            type: "button",
            class: "sp-answer",
            text: "✓ Answered",
            title: "Mark as answered",
            onclick: function (e) {
              e.currentTarget.disabled = true;
              markAnswered(q, true);
            },
          }),
        ])
      );
    });
  }

  // ---------- Mark as answered (with undo) ----------
  var undoBar = document.getElementById("sp-undo");
  var undoTimer = null;

  function markAnswered(q, answered) {
    return S.api("PATCH", "/admin/qa/api/questions/" + q.id, { is_answered: answered })
      .then(function () {
        if (answered) showUndo(q);
        else undoBar.hidden = true;
        return poller.refresh();
      })
      .catch(function (err) {
        alert(err.message);
        render();
      });
  }

  function showUndo(q) {
    var preview = q.content.length > 24 ? q.content.slice(0, 24) + "…" : q.content;
    undoBar.replaceChildren(
      el("span", { text: "Marked as answered: " + preview }),
      el("button", { type: "button", text: "Undo", onclick: function () { markAnswered(q, false); } })
    );
    undoBar.hidden = false;
    clearTimeout(undoTimer);
    undoTimer = setTimeout(function () { undoBar.hidden = true; }, 8000);
  }

  // ---------- Polls ----------
  function currentPoll() {
    var polls = state.polls;
    var chosen = polls.filter(function (p) { return p.id === view.pollId; })[0];
    if (chosen) return chosen;
    // If none is selected (or it was deleted), show the latest open poll
    return polls.filter(function (p) { return p.state === "open"; })[0] || polls[0] || null;
  }

  function renderPoll() {
    var poll = currentPoll();
    pollBox.replaceChildren();
    if (!poll) {
      pollBox.appendChild(el("p", { class: "sp-empty", text: "No polls yet" }));
      return;
    }
    pollBox.appendChild(
      el("div", { class: "sp-section-head" }, [
        el("h2", { text: poll.title }),
        el("span", {
          text: (poll.state === "open" ? "Live · " : poll.state === "closed" ? "Closed · " : "Not started · ") + S.plural(poll.voters, "participant"),
        }),
      ])
    );
    if (view.hideResults) {
      pollBox.appendChild(
        el("div", { class: "sp-options-only" }, poll.options.map(function (o) {
          return el("div", { class: "sp-option", text: o.text });
        }))
      );
    } else {
      pollBox.appendChild(S.pollBars(poll, { hideMine: true }));
    }
  }

  // ---------- Controls ----------
  function renderControls() {
    var current = currentPoll();
    var options = [el("option", { value: "", text: "Poll…", disabled: true })].concat(
      state.polls.map(function (p) {
        var label = (p.state === "open" ? "● " : "") + p.title;
        return el("option", { value: p.id, text: label.length > 30 ? label.slice(0, 30) + "…" : label });
      })
    );
    select.replaceChildren.apply(select, options);
    select.value = view.mode === "poll" && current ? String(current.id) : "";
    select.classList.toggle("active", view.mode === "poll");
    qaBtn.classList.toggle("active", view.mode === "qa");
    hideBtn.hidden = view.mode !== "poll";
    hideBtn.textContent = view.hideResults ? "Show results" : "Hide results";
  }

  function render() {
    if (!state) return;
    qaBox.hidden = view.mode !== "qa";
    pollBox.hidden = view.mode !== "poll";
    if (view.mode === "qa") renderQA();
    else renderPoll();
    renderControls();
  }

  qaBtn.addEventListener("click", function () { setView({ mode: "qa" }); });
  select.addEventListener("change", function () {
    setView({ mode: "poll", pollId: parseInt(select.value, 10) });
  });
  hideBtn.addEventListener("click", function () { setView({ hideResults: !view.hideResults }); });

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(function () {});
  }
  document.getElementById("sp-fullscreen").addEventListener("click", toggleFullscreen);

  document.addEventListener("keydown", function (e) {
    if (e.target.tagName === "SELECT" || e.ctrlKey || e.metaKey || e.altKey) return;
    var k = e.key.toLowerCase();
    if (k === "q") setView({ mode: "qa" });
    else if (k === "p") {
      var p = currentPoll();
      setView({ mode: "poll", pollId: p ? p.id : null });
    } else if (k === "h") setView({ hideResults: !view.hideResults });
    else if (k === "f") toggleFullscreen();
  });

  // Switch when "Present" is pressed in the admin panel (another tab on the same computer)
  window.addEventListener("storage", function (e) {
    if (e.key !== KEY) return;
    loadView();
    render();
  });

  // Fade out the controls after 3 seconds of inactivity
  var idleTimer = null;
  function wake() {
    body.classList.remove("sp-idle");
    clearTimeout(idleTimer);
    idleTimer = setTimeout(function () { body.classList.add("sp-idle"); }, 3000);
  }
  document.addEventListener("mousemove", wake);
  wake();

  // Build the join URL from the address the teacher's browser used. A server-side external URL
  // shows the internal host (e.g. http://ctfd:8000) when CTFd runs behind a reverse proxy.
  document.getElementById("sp-join-url").textContent = location.origin + S.url("/qa/" + eventId);

  var lastJson = "";
  loadView();
  var poller = S.poller(function () {
    return S.api("GET", "/admin/qa/api/events/" + eventId + "/state").then(function (data) {
      var json = JSON.stringify(data);
      if (json === lastJson) return;
      lastJson = json;
      state = data;
      render();
    });
  }, 2000);
})();
